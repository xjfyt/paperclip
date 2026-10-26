import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { NextFunction, Request, Response } from "express";
import { activityLog, authUsers, companies, companyMemberships } from "../../packages/db/src/index.js";
import { capabilityEvidence } from "../../packages/db/src/schema/capability_evidence.js";
import { capabilityEvidenceService } from "../../server/src/services/capability-evidence.js";
import { capabilityEvidenceRoutes } from "../../server/src/routes/capability-evidence.js";
import { accessService } from "../../server/src/services/access.js";
import { HttpError } from "../../server/src/errors.js";
import { createFixtureDb } from "./fixture-db.js";
import type { AppendCapabilityEvidence, CapabilityReceipt } from "../../packages/shared/src/capability-evidence.js";

const require = createRequire(new URL("../../server/package.json", import.meta.url));
const express = require("express");
const supertest = require("supertest");
const { and, eq } = await import(require.resolve("drizzle-orm"));
// Real disposable PostgreSQL and real router/service/schema only. These are
// explicit fixture attestations, NOT real C3/C4 qualification. No adapters,
// providers, external accounts, credentials, probes or execution are invoked.
async function fixture() {
  const db = await createFixtureDb(); // Identity guard precedes every mutation.
  try {
    const [company, other] = await db.insert(companies).values([
      { name: "Capability evidence fixture only", status: "paused", issuePrefix: `E${randomUUID().slice(0, 8)}` },
      { name: "Capability foreign fixture only", status: "paused", issuePrefix: `E${randomUUID().slice(0, 8)}` },
    ]).returning();
    const reviewerId = `fixture-reviewer-${randomUUID()}`;
    const service = capabilityEvidenceService(db);
    const receipt: CapabilityReceipt = {
      adapterType: "qoder_cn", capability: "localExecution", runtime: "fixture-runtime", runtimeVersion: "fixture-1",
      environmentAlias: "fixture-only-not-live", accountAlias: "fixture-no-account", testedCommit: "a".repeat(40),
      level: "C3", result: "passed", sourceResourceId: "fixture-not-real-resource", sourceRunId: "fixture-no-run",
      testedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    };
    const input = (expectedRevision: number, overrides: Partial<AppendCapabilityEvidence> = {}): AppendCapabilityEvidence => ({
      expectedRevision, idempotencyKey: randomUUID(), action: "record", reason: "verification", receipt, ...overrides,
    });
    const rows = () => db.select().from(capabilityEvidence).where(eq(capabilityEvidence.companyId, company.id));
    const audit = () => db.select().from(activityLog).where(and(eq(activityLog.companyId, company.id), eq(activityLog.entityType, "capability_evidence")));
    return { db, company, other, reviewerId, service, receipt, input, rows, audit };
  } catch (error) { await db.$client.end({ timeout: 1 }); throw error; }
}

test("independent connections serialize CAS and exact retries with one atomic audit per receipt", async () => {
  const f = await fixture(); const otherDb = await createFixtureDb();
  try {
    const remote = capabilityEvidenceService(otherDb);
    const attempts = [f.input(0), f.input(0)];
    const results = await Promise.allSettled([
      f.service.append(f.company.id, f.reviewerId, attempts[0]),
      remote.append(f.company.id, f.reviewerId, attempts[1]),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    const winnerIndex = results.findIndex(result => result.status === "fulfilled");
    const winner = (results[winnerIndex] as PromiseFulfilledResult<Awaited<ReturnType<typeof f.service.append>>>).value;
    expect(winner.revision).toBe(1);
    const [retryA, retryB] = await Promise.all([
      f.service.append(f.company.id, f.reviewerId, attempts[winnerIndex]),
      remote.append(f.company.id, f.reviewerId, attempts[winnerIndex]),
    ]);
    expect(retryA).toEqual(winner); expect(retryB).toEqual(winner);
    await expect(remote.append(f.company.id, "another-fixture-reviewer", attempts[winnerIndex])).rejects.toMatchObject({ status: 409 });
    await expect(remote.append(f.company.id, f.reviewerId, { ...attempts[winnerIndex], reason: "retested" })).rejects.toMatchObject({ status: 409 });
    expect(await f.rows()).toHaveLength(1);
    const audit = await f.audit(); expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entityId: winner.id, actorId: f.reviewerId, action: "capability_evidence.record" });
    expect(audit[0].details).toEqual({ revision: 1, targetId: null, evidenceKind: "operator_attestation" });
    expect(JSON.stringify(audit)).not.toContain(f.receipt.accountAlias);
    // A retry remains exact even after a later committed revision.
    await remote.append(f.company.id, f.reviewerId, f.input(1));
    expect(await f.service.append(f.company.id, f.reviewerId, attempts[winnerIndex])).toEqual(winner);
    expect(await f.audit()).toHaveLength(2);
  } finally { await otherDb.$client.end({ timeout: 1 }); await f.db.$client.end({ timeout: 1 }); }
});

test("company isolation, revocation and same-context supersession preserve immutable history", async () => {
  const f = await fixture();
  try {
    const originalInput = f.input(0);
    const first = await f.service.append(f.company.id, f.reviewerId, originalInput);
    expect((await f.service.list(f.other.id)).events).toEqual([]);
    await expect(f.service.append(f.other.id, f.reviewerId, f.input(0, { action: "revoke", receipt: undefined, targetId: first.id, reason: "incorrect" }))).rejects.toMatchObject({ status: 404 });
    // Idempotency keys are company-local, not a way to read another company.
    const foreign = await f.service.append(f.other.id, f.reviewerId, originalInput);
    expect(foreign.companyId).toBe(f.other.id); expect(foreign.id).not.toBe(first.id);
    await expect(f.service.append(f.company.id, f.reviewerId, f.input(1, {
      action: "supersede", targetId: first.id, receipt: { ...f.receipt, runtimeVersion: "fixture-2" },
    }))).rejects.toMatchObject({ status: 422 });
    const replacement = await f.service.append(f.company.id, f.reviewerId, f.input(1, {
      action: "supersede", targetId: first.id, reason: "retested", receipt: { ...f.receipt, result: "failed" },
    }));
    await expect(f.service.append(f.company.id, f.reviewerId, f.input(2, {
      action: "revoke", receipt: undefined, targetId: first.id, reason: "incorrect",
    }))).rejects.toMatchObject({ status: 409 });
    const revoked = await f.service.append(f.company.id, f.reviewerId, f.input(2, {
      action: "revoke", receipt: undefined, targetId: replacement.id, reason: "incorrect",
    }));
    expect(revoked).toMatchObject({ action: "revoke", targetId: replacement.id, receipt: null, revision: 3 });
    expect((await f.service.list(f.company.id)).events.map(row => row.action)).toEqual(["record", "supersede", "revoke"]);
    expect((await f.service.list(f.company.id, 1)).events.map(row => row.revision)).toEqual([2, 3]);
    expect((await f.rows()).find(row => row.id === first.id)?.receipt).toEqual(f.receipt);
    expect(await f.audit()).toHaveLength(3);
    // Exercise the actual migration trigger, not just service conventions.
    await expect(f.db.$client.unsafe("UPDATE capability_evidence SET reason = 'incorrect' WHERE id = $1", [first.id])).rejects.toThrow("append-only");
    await expect(f.db.$client.unsafe("DELETE FROM capability_evidence WHERE id = $1", [first.id])).rejects.toThrow("append-only");
    expect(await f.rows()).toHaveLength(3);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});

test("audit failure in PostgreSQL rolls back the receipt and leaves the retry key reusable", async () => {
  const f = await fixture();
  // Generated SQL identifiers are hex-only; the UUID condition is generated by
  // PostgreSQL. This trigger affects only this test company's capability audit.
  const name = `fixture_capability_audit_${randomUUID().replaceAll("-", "")}`;
  let functionCreated = false, triggerCreated = false;
  try {
    await f.db.$client.unsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.company_id = '${f.company.id}'::uuid AND NEW.entity_type = 'capability_evidence' THEN
          RAISE EXCEPTION 'fixture capability audit failure';
        END IF;
        RETURN NEW;
      END; $$`);
    functionCreated = true;
    await f.db.$client.unsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    triggerCreated = true;
    const input = f.input(0);
    await expect(f.service.append(f.company.id, f.reviewerId, input)).rejects.toThrow();
    expect(await f.rows()).toHaveLength(0); expect(await f.audit()).toHaveLength(0);
    await f.db.$client.unsafe(`DROP TRIGGER ${name} ON activity_log`); triggerCreated = false;
    expect((await f.service.append(f.company.id, f.reviewerId, input)).revision).toBe(1);
    expect(await f.rows()).toHaveLength(1); expect(await f.audit()).toHaveLength(1);
  } finally {
    try {
      if (triggerCreated) await f.db.$client.unsafe(`DROP TRIGGER IF EXISTS ${name} ON activity_log`);
      if (functionCreated) await f.db.$client.unsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    } finally { await f.db.$client.end({ timeout: 1 }); }
  }
});

test("real HTTP route enforces company admin ACL and records reviewer from the authenticated fixture actor", async ({ request }) => {
  const f = await fixture();
  try {
    const ownerId = randomUUID(), viewerId = randomUUID();
    await f.db.insert(authUsers).values([ownerId, viewerId].map(id => ({ id, name: "Capability fixture user", email: `${id}@fixture.invalid`, createdAt: new Date(), updatedAt: new Date() })));
    await f.db.insert(companyMemberships).values([
      { companyId: f.company.id, principalType: "user", principalId: ownerId, membershipRole: "owner", status: "active" },
      { companyId: f.company.id, principalType: "user", principalId: viewerId, membershipRole: "viewer", status: "active" },
    ]);
    await accessService(f.db).ensureRoleDefaultGrants(f.company.id, ownerId, "owner", ownerId);
    function app(actor: Express.Request["actor"]) {
      const server = express(); server.use(express.json());
      server.use((req: Request, _res: Response, next: NextFunction) => { req.actor = actor; next(); });
      server.use("/api", capabilityEvidenceRoutes(f.db));
      server.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        res.status(error instanceof HttpError ? error.status : 500).json({ error: "fixture request rejected" });
      });
      return supertest(server);
    }
    // Explicit actor fixtures test ACL, not the actual login/session middleware.
    const owner: Express.Request["actor"] = { type: "board", source: "session", userId: ownerId, companyIds: [f.company.id], memberships: [{ companyId: f.company.id, membershipRole: "owner", status: "active" }] };
    const url = `/api/companies/${f.company.id}/capability-evidence`;
    const created = await app(owner).post(url).send(f.input(0));
    expect(created.status).toBe(200); expect(created.body.reviewerId).toBe(ownerId);
    const read = await app(owner).get(url); expect(read.status).toBe(200); expect(read.headers["cache-control"]).toBe("no-store");
    for (const actor of [
      { ...owner, userId: viewerId, memberships: [{ companyId: f.company.id, membershipRole: "viewer", status: "active" }] },
      { ...owner, companyIds: [f.other.id], memberships: [] },
      { type: "agent", source: "agent_key", companyId: f.company.id, agentId: randomUUID() },
      { type: "agent", source: "agent_key", companyId: f.other.id, agentId: randomUUID() },
    ] as Express.Request["actor"][]) {
      const deniedRead = await app(actor).get(url); expect(deniedRead.status).toBe(403);
      expect(JSON.stringify(deniedRead.body)).not.toContain(f.receipt.accountAlias);
      expect((await app(actor).post(url).send(f.input(1))).status).toBe(403);
    }
    expect((await app({ type: "none", source: "none" } as Express.Request["actor"]).get(url)).status).toBe(401);
    expect(await f.rows()).toHaveLength(1); expect(await f.audit()).toHaveLength(1);
    // Separately prove the centrally mounted endpoint through the actual
    // disposable local-trusted HTTP server; this is not an authenticated SSO test.
    const liveRead = await request.get(url); expect(liveRead.status()).toBe(200);
    expect((await liveRead.json()).events[0].id).toBe(created.body.id);
    expect((await request.post(url, { data: f.input(1, { receipt: { ...f.receipt, result: "blocked" } }) })).status()).toBe(200);
    expect(await f.rows()).toHaveLength(2); expect(await f.audit()).toHaveLength(2);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});
