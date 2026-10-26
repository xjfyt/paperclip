import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { NextFunction, Request, Response } from "express";
import { activityLog, companies, companySecrets, companySecretVersions, companySecretProviderConfigs, approvals, capabilityEvidence, type Db,
  mimouseNotificationRevisions as revisions, mimouseNotificationEndpoints as endpoints, mimouseNotificationSubscriptions as subscriptions, mimouseNotificationDeliveries as deliveries } from "../../packages/db/src/index.js";
import { secretService } from "../../server/src/services/secrets.js";
import { notificationConfiguration } from "../../server/src/services/mimouse-notifications/configuration.js";
import { notificationReconciliation } from "../../server/src/services/mimouse-notifications/reconciliation.js";
import { notificationVerification } from "../../server/src/services/mimouse-notifications/verification.js";
import { notificationEvidence } from "../../server/src/services/mimouse-notifications/evidence.js";
import { mimouseNotificationRoutes } from "../../server/src/routes/mimouse-notifications.js";
import { capabilityEvidenceService } from "../../server/src/services/capability-evidence.js";
import { HttpError } from "../../server/src/errors.js";
import { evaluateNotificationEvidence, type AppendNotificationEvidence } from "../../packages/shared/src/notification-evidence.js";
import { createFixtureDb } from "./fixture-db.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { and, eq, sql } = await import(require.resolve("drizzle-orm"));
const express = require("express"), supertest = require("supertest");
// Central runner only. Real guarded disposable PostgreSQL and HTTP router,
// no real provider/account/send. Seeded accepted and declarations remain C2 fixtures.
async function fixture() {
  const db = await createFixtureDb();
  try {
    const [company, other] = await db.insert(companies).values(["verification", "foreign"].map(name => ({ name: `Notification ${name} fixture`, status: "paused", issuePrefix: `V${randomUUID().slice(0, 8)}` }))).returning();
    const secret = await secretService(db).create(company.id, { name: "offline-fixture", provider: "local_encrypted", value: JSON.stringify({ url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=never-send-fixture" }) });
    const config = { name: "Verification fixture", kind: "wecom_webhook" as const, config: {}, secretRef: secret.id, secretVersion: 1 };
    const endpoint = await notificationConfiguration(db).create(company.id, config, "fixture-admin");
    const [subscription] = await db.insert(subscriptions).values({ companyId: company.id, endpointId: endpoint.id, eventType: "manual.test", enabled: false }).returning();
    const snapshot = { kind: endpoint.kind, configVersion: endpoint.configVersion, secretRef: secret.id, secretVersion: 1, targetKey: endpoint.targetKey, renderVersion: 1, locale: "en", title: "Fixture only", text: "Never sent" };
    const [delivery] = await db.insert(deliveries).values({ companyId: company.id, endpointId: endpoint.id, subscriptionId: subscription.id, eventId: `manual-test:${randomUUID()}`, snapshot, state: "accepted", attempt: 1, lastCode: "fixture_only", createdAt: new Date(Date.now() - 60000) }).returning();
    const review = await notificationReconciliation(db).record(company.id, delivery.id, { requestId: randomUUID(), outcome: "accepted", evidence: "Fixture report of acceptance only; not a recipient observation", expectedState: "accepted", expectedAttempt: 1 }, "fixture-reviewer");
    const service = notificationEvidence(db), verification = notificationVerification(db);
    const input = (expectedRevision = 0, patch: Partial<AppendNotificationEvidence> = {}): AppendNotificationEvidence => ({ expectedRevision, idempotencyKey: randomUUID(), expectedConfigVersion: 1, expectedEpoch: endpoint.verificationEpoch, confirm: true, action: "record", reason: "verification", receipt: {
      category: "live_connection", result: "passed", runtimeVersion: "fixture-v1", environmentAlias: "fixture-not-live", accountAlias: "fixture-no-account", reportRef: "fixture-report", testedCommit: "a".repeat(40),
      testedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), deliveryId: delivery.id, reviewId: review.id, expectedState: "accepted", expectedAttempt: 1, confirmRealTarget: true,
    }, ...patch });
    const rows = () => db.select().from(capabilityEvidence).where(eq(capabilityEvidence.companyId, company.id));
    const epoch = async () => (await db.select().from(endpoints).where(eq(endpoints.id, endpoint.id)))[0].verificationEpoch;
    return { db, company, other, secret, endpoint, subscription, snapshot, delivery, review, config, service, verification, input, rows, epoch, cleanup: async () => { await db.update(endpoints).set({ enabled: false }).where(eq(endpoints.id, endpoint.id)); await db.$client.end({ timeout: 1 }); } };
  } catch (error) { await db.$client.end({ timeout: 1 }); throw error; }
}
async function noExternal<T>(body: () => Promise<T>) {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async () => { calls++; throw Error("No external calls permitted by verification fixture"); }) as typeof fetch;
  try { const result = await body(); expect(calls).toBe(0); return result; } finally { globalThis.fetch = previous; }
}

function declarationWithPid(db: Db, companyId: string, endpointId: string, input: AppendNotificationEvidence) {
  let identify!: (pid: number) => void, unidentified!: (error: unknown) => void;
  const pid = new Promise<number>((resolve, reject) => { identify = resolve; unidentified = reject; });
  const result = db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout = '8s'`);
    const rows = await tx.execute(sql`SELECT pg_backend_pid() AS pid`) as unknown as Array<{ pid: number }>;
    identify(rows[0].pid);
    return notificationEvidence(tx as unknown as Db).append(companyId, endpointId, "admin", input);
  });
  void result.catch(unidentified);
  return { pid, result };
}
async function waitBlockedBy(waiter: number, blocker: number) {
  // Do not infer ordering from a sleep: prove the two live PostgreSQL backends
  // reached the intended blocking edge before allowing the FK operation.
  // A separate guarded observer avoids borrowing either held transaction's
  // pool when the central runner deliberately uses maxConnections=1.
  const observer = await createFixtureDb();
  try {
    await expect.poll(async () => {
      const rows = await observer.$client.unsafe("SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked", [blocker, waiter]);
      return rows[0]?.blocked;
    }, { timeout: 5000, intervals: [20, 50, 100] }).toBe(true);
  } finally { await observer.$client.end({ timeout: 1 }); }
}

test("latest endpoint/version query survives 120 newer rows; accepted and old reviews do not generate evidence", async () => {
  const f = await fixture();
  try { await noExternal(async () => {
    expect(f.delivery.snapshot.verificationEpoch).toBe(f.endpoint.verificationEpoch);
    await f.db.insert(deliveries).values(Array.from({ length: 120 }, () => ({ companyId: f.company.id, endpointId: f.endpoint.id, subscriptionId: f.subscription.id, eventId: randomUUID(), snapshot: { ...f.snapshot, configVersion: 99 }, state: "accepted" })));
    const first = await f.verification.read(f.company.id, f.endpoint.id);
    expect(first.latestTest?.id).toBe(f.delivery.id); expect(first.latestTest?.review?.id).toBe(f.review.id); expect(await f.rows()).toHaveLength(0);
    const [failed] = await f.db.insert(deliveries).values({ companyId: f.company.id, endpointId: f.endpoint.id, subscriptionId: f.subscription.id, eventId: randomUUID(), snapshot: f.snapshot, state: "rejected", lastCode: "fixture_failure" }).returning();
    expect((await f.verification.read(f.company.id, f.endpoint.id)).latestTest?.id).toBe(failed.id);
    await expect(f.service.append(f.company.id, f.endpoint.id, "admin", f.input())).rejects.toMatchObject({ status: 422 });
  }); } finally { await f.cleanup(); }
});

test("two connections serialize CAS and exact canonical retries; adapter list never exposes notification receipt", async () => {
  const f = await fixture(), otherDb = await createFixtureDb();
  try { await noExternal(async () => {
    const remote = notificationEvidence(otherDb); const attempts = [f.input(), f.input()];
    const results = await Promise.allSettled([f.service.append(f.company.id, f.endpoint.id, "admin", attempts[0]), remote.append(f.company.id, f.endpoint.id, "admin", attempts[1])]);
    expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect((results.find(item => item.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    const i = results.findIndex(item => item.status === "fulfilled"), winner = (results[i] as PromiseFulfilledResult<any>).value;
    const reordered = Object.fromEntries(Object.entries(attempts[i]).reverse());
    expect(await remote.append(f.company.id, f.endpoint.id, "admin", reordered)).toEqual(winner);
    await expect(remote.append(f.company.id, f.endpoint.id, "other-admin", attempts[i])).rejects.toMatchObject({ status: 409 });
    expect(await f.rows()).toHaveLength(1);
    const adapter = await capabilityEvidenceService(f.db).list(f.company.id); expect(adapter.events).toEqual([]); expect(adapter.headRevision).toBe(1);
    const history = await f.service.list(f.company.id, f.endpoint.id); expect(history.events).toHaveLength(1); expect(history.events[0].receipt?.machineVerified).toBe(false);
    const view = await f.verification.read(f.company.id, f.endpoint.id);
    expect(evaluateNotificationEvidence(f.company.id, view, history.events).find(row => row.category === "live_connection")?.status).toBe("manual_passed");
    await f.service.append(f.company.id, f.endpoint.id, "admin", f.input(1, { action: "revoke", targetId: winner.id, receipt: undefined }));
    expect(await capabilityEvidenceService(f.db).list(f.company.id)).toMatchObject({ events: [], headRevision: 2 });
  }); } finally { await otherDb.$client.end({ timeout: 1 }); await f.cleanup(); }
});

test("security ABA invalidates evidence, but resolve/name/pause and current-to-previous do not", async () => {
  const f = await fixture();
  try {
    const first = await f.service.append(f.company.id, f.endpoint.id, "admin", f.input()); const original = await f.epoch();
    await secretService(f.db).resolveSecretValue(f.company.id, f.secret.id, 1);
    await f.db.update(companySecrets).set({ name: "renamed fixture", description: "ordinary edit", updatedAt: new Date() }).where(eq(companySecrets.id, f.secret.id));
    await f.db.update(endpoints).set({ enabled: true, name: "renamed endpoint" }).where(eq(endpoints.id, f.endpoint.id));
    await f.db.update(endpoints).set({ enabled: false }).where(eq(endpoints.id, f.endpoint.id));
    await f.db.update(companySecretVersions).set({ status: "previous" }).where(eq(companySecretVersions.secretId, f.secret.id));
    expect(await f.epoch()).toBe(original);
    await f.db.update(companySecrets).set({ status: "disabled" }).where(eq(companySecrets.id, f.secret.id));
    expect(await f.epoch()).toBe(original + 1); expect((await f.verification.read(f.company.id, f.endpoint.id)).credentialStatus).toBe("unavailable");
    await f.db.update(companySecrets).set({ status: "active" }).where(eq(companySecrets.id, f.secret.id));
    expect(await f.epoch()).toBe(original + 2);
    const view = await f.verification.read(f.company.id, f.endpoint.id), history = await f.service.list(f.company.id, f.endpoint.id);
    expect(evaluateNotificationEvidence(f.company.id, view, history.events).find(row => row.receiptId === first.id)?.status).toBe("stale");
    await f.db.update(companySecretVersions).set({ revokedAt: new Date() }).where(eq(companySecretVersions.secretId, f.secret.id)); expect(await f.epoch()).toBe(original + 3);
    await f.db.update(companySecretVersions).set({ revokedAt: null }).where(eq(companySecretVersions.secretId, f.secret.id)); expect(await f.epoch()).toBe(original + 4);
    await expect(f.service.append(f.company.id, f.endpoint.id, "admin", f.input(1))).rejects.toMatchObject({ status: 409 });
  } finally { await f.cleanup(); }
});

test("provider security updates affect exact bindings, not display/health or unrelated defaults", async () => {
  const f = await fixture();
  try {
    const [provider] = await f.db.insert(companySecretProviderConfigs).values({ companyId: f.company.id, provider: "aws_secrets_manager", displayName: "Offline AWS fixture", status: "ready", config: { region: "fixture" } }).returning();
    await f.db.update(companySecrets).set({ provider: "aws_secrets_manager", providerConfigId: provider.id }).where(eq(companySecrets.id, f.secret.id));
    await f.db.update(companySecretVersions).set({ providerVersionRef: "fixture-pinned-version" }).where(eq(companySecretVersions.secretId, f.secret.id));
    const original = await f.epoch();
    await noExternal(async () => expect((await f.verification.read(f.company.id, f.endpoint.id)).credentialStatus).toBe("metadata_active"));
    await f.db.update(companySecretProviderConfigs).set({ displayName: "renamed", healthStatus: "ok", healthCheckedAt: new Date(), isDefault: true }).where(eq(companySecretProviderConfigs.id, provider.id));
    expect(await f.epoch()).toBe(original);
    await f.db.update(companySecretProviderConfigs).set({ config: { region: "another-fixture-region" } }).where(eq(companySecretProviderConfigs.id, provider.id)); expect(await f.epoch()).toBe(original + 1);
    await f.db.update(companySecretProviderConfigs).set({ status: "disabled" }).where(eq(companySecretProviderConfigs.id, provider.id)); expect(await f.epoch()).toBe(original + 2);
    await f.db.update(companySecretProviderConfigs).set({ status: "ready" }).where(eq(companySecretProviderConfigs.id, provider.id)); expect(await f.epoch()).toBe(original + 3);
  } finally { await f.cleanup(); }
});

test("credential revocation racing an evidence write waits in one lock order and never validates the old epoch", async () => {
  const f = await fixture(), otherDb = await createFixtureDb(); let release!: () => void; let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  let mutation: Promise<unknown> | undefined; let blockerPid = 0;
  try {
    mutation = otherDb.transaction(async tx => { blockerPid = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`) as unknown as Array<{ pid: number }>)[0].pid; await tx.update(companySecrets).set({ status: "disabled" }).where(eq(companySecrets.id, f.secret.id)); entered(); await held; });
    await Promise.race([ready, mutation]);
    const declaration = declarationWithPid(f.db, f.company.id, f.endpoint.id, f.input());
    const rejection = expect(declaration.result).rejects.toMatchObject({ status: 409 });
    await waitBlockedBy(await declaration.pid, blockerPid);
    release(); await mutation; await rejection; expect(await f.rows()).toHaveLength(0);
  } finally { release?.(); await mutation?.catch(() => {}); await otherDb.$client.end({ timeout: 1 }); await f.cleanup(); }
});

test("config revisions, foreign references, latest reviews and actual approval resources are enforced", async () => {
  const f = await fixture();
  try {
    await expect(f.service.append(f.other.id, f.endpoint.id, "admin", f.input())).rejects.toMatchObject({ status: 404 });
    await expect(f.service.append(f.company.id, f.endpoint.id, "admin", f.input(0, { receipt: { ...f.input().receipt!, reviewId: randomUUID() } }))).rejects.toMatchObject({ status: 422 });
    const sibling = await notificationConfiguration(f.db).create(f.company.id, { ...f.config, name: "Same company different endpoint" }, "admin");
    await expect(f.service.append(f.company.id, sibling.id, "admin", f.input())).rejects.toMatchObject({ status: 422 });
    const [approval] = await f.db.insert(approvals).values({ companyId: f.company.id, type: "budget_increase", status: "pending", payload: {} }).returning();
    const [subscription] = await f.db.insert(subscriptions).values({ companyId: f.company.id, endpointId: f.endpoint.id, eventType: "approval.requested", enabled: false }).returning();
    const [delivery] = await f.db.insert(deliveries).values({ companyId: f.company.id, endpointId: f.endpoint.id, subscriptionId: subscription.id, eventId: `approval:${approval.id}`, snapshot: { ...f.snapshot, policyEvent: "approval.requested", policyResourceId: approval.id }, state: "accepted", attempt: 1, createdAt: new Date(Date.now() - 5000) }).returning();
    const review = await notificationReconciliation(f.db).record(f.company.id, delivery.id, { requestId: randomUUID(), outcome: "accepted", evidence: "C4 fixture only", expectedState: "accepted", expectedAttempt: 1 }, "fixture-reviewer");
    const request = f.input(0, { receipt: { ...f.input().receipt!, category: "approval_scenario", deliveryId: delivery.id, reviewId: review.id, approvalChecks: { received: true, detailLink: true, permissionChecked: true, noGetAction: true } } });
    const saved = await f.service.append(f.company.id, f.endpoint.id, "admin", request); expect(saved.receipt?.resourceId).toBe(approval.id);
    const changedAccount = await secretService(f.db).create(f.company.id, { name: "changed-account", provider: "local_encrypted", value: JSON.stringify({ url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=other-fixture-account" }) });
    await notificationConfiguration(f.db).revise(f.company.id, f.endpoint.id, 1, { ...f.config, name: "New version and account", secretRef: changedAccount.id }, "admin");
    expect((await f.verification.read(f.company.id, f.endpoint.id)).latestTest).toBeNull();
    await expect(f.service.append(f.company.id, f.endpoint.id, "admin", f.input(1))).rejects.toMatchObject({ status: 409 });
    expect(await f.service.append(f.company.id, f.endpoint.id, "admin", request)).toEqual(saved);
  } finally { await f.cleanup(); }
});

test("audit failure and credential-change rollback leave no partial evidence or epoch", async () => {
  const f = await fixture(); const name = `fixture_notify_evidence_${randomUUID().replaceAll("-", "")}`;
  try {
    const original = await f.epoch();
    await expect(f.db.transaction(async tx => { await tx.update(companySecrets).set({ status: "disabled" }).where(eq(companySecrets.id, f.secret.id)); throw Error("rollback credential"); })).rejects.toThrow("rollback credential"); expect(await f.epoch()).toBe(original);
    await f.db.$client.unsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.company_id='${f.company.id}'::uuid AND NEW.action='notification.verification.record' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`);
    await f.db.$client.unsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    await expect(f.service.append(f.company.id, f.endpoint.id, "admin", f.input())).rejects.toThrow(); expect(await f.rows()).toHaveLength(0);
    expect(await f.db.select().from(activityLog).where(and(eq(activityLog.companyId, f.company.id), eq(activityLog.action, "notification.verification.record")))).toHaveLength(0);
  } finally { await f.db.$client.unsafe(`DROP TRIGGER IF EXISTS ${name} ON activity_log`); await f.db.$client.unsafe(`DROP FUNCTION IF EXISTS ${name}()`); await f.cleanup(); }
});

test("real HTTP routes enforce role/session actor scope and keep declarations separate from sends", async () => {
  const f = await fixture();
  try {
    function app(actor: Express.Request["actor"]) { const server = express(); server.use(express.json()); server.use((req: Request, _res: Response, next: NextFunction) => { req.actor = actor; next(); }); server.use("/api", mimouseNotificationRoutes(f.db)); server.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => res.status(error instanceof HttpError ? error.status : 500).json({ error: "fixture rejection" })); return supertest(server); }
    const owner: Express.Request["actor"] = { type: "board", source: "session", userId: "fixture-admin", companyIds: [f.company.id], memberships: [{ companyId: f.company.id, membershipRole: "owner", status: "active" }] };
    const path = `/api/companies/${f.company.id}/notifications/endpoints/${f.endpoint.id}/verification`;
    await noExternal(async () => {
      expect((await app(owner).get(path)).headers["cache-control"]).toBe("no-store");
      const created = await app(owner).post(`${path}/evidence`).send(f.input()); expect(created.status).toBe(200); expect(created.body.reviewerId).toBe(owner.userId);
      for (const actor of [{ ...owner, memberships: [{ companyId: f.company.id, membershipRole: "member", status: "active" }] }, { ...owner, companyIds: [f.other.id], memberships: [] }, { type: "agent", source: "agent_key", companyId: f.company.id, agentId: randomUUID() }] as Express.Request["actor"][]) {
        expect((await app(actor).get(path)).status).toBe(403); expect((await app(actor).get(`${path}/evidence`)).status).toBe(403); expect((await app(actor).post(`${path}/evidence`).send(f.input(1))).status).toBe(403);
      }
      // This fixture mounts the router directly, without the application login
      // middleware. Its established assertBoard boundary rejects non-board with 403.
      const anonymous = app({ type: "none", source: "none" } as Express.Request["actor"]);
      expect((await anonymous.get(path)).status).toBe(403);
      expect((await anonymous.get(`${path}/evidence`)).status).toBe(403);
      expect((await anonymous.post(`${path}/evidence`).send(f.input(1))).status).toBe(403);
      expect(await f.rows()).toHaveLength(1);
      expect(await f.db.select().from(deliveries).where(eq(deliveries.companyId, f.company.id))).toHaveLength(1);
    });
  } finally { await f.cleanup(); }
});


test("endpoint revision FK insertion does not deadlock with the company-ledger lock", async () => {
  const f = await fixture(), otherDb = await createFixtureDb(); let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  let revision: Promise<unknown> | undefined; let blockerPid = 0;
  try {
    // Reproduce the existing configuration.revise transaction's exact order:
    // UPDATE endpoint, then INSERT revisions with company/endpoint foreign keys.
    revision = otherDb.transaction(async tx => {
      blockerPid = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`) as unknown as Array<{ pid: number }>)[0].pid;
      await tx.update(endpoints).set({ configVersion: 2, enabled: false }).where(eq(endpoints.id, f.endpoint.id)); entered(); await held;
      await tx.insert(revisions).values({ companyId: f.company.id, endpointId: f.endpoint.id, configVersion: 2, snapshot: { ...f.config, configVersion: 2 }, actorId: "fixture-editor" });
    });
    await Promise.race([ready, revision]);
    const declaration = declarationWithPid(f.db, f.company.id, f.endpoint.id, f.input());
    const rejected = expect(declaration.result).rejects.toMatchObject({ status: 409 });
    await waitBlockedBy(await declaration.pid, blockerPid); release(); await revision; await rejected;
    expect(await f.rows()).toHaveLength(0);
    expect(await f.db.select().from(revisions).where(and(eq(revisions.endpointId, f.endpoint.id), eq(revisions.configVersion, 2)))).toHaveLength(1);
  } finally { release?.(); await revision?.catch(() => {}); await otherDb.$client.end({ timeout: 1 }); await f.cleanup(); }
});

test("default-to-explicit provider FK binding does not deadlock with a verification reader", async () => {
  const f = await fixture(), otherDb = await createFixtureDb(); let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  let rotation: Promise<unknown> | undefined; let blockerPid = 0;
  try {
    const [provider] = await f.db.insert(companySecretProviderConfigs).values({ companyId: f.company.id, provider: "aws_secrets_manager", displayName: "Offline provider FK fixture", status: "ready", isDefault: true, config: {} }).returning();
    await f.db.update(companySecrets).set({ provider: "aws_secrets_manager", providerConfigId: null }).where(eq(companySecrets.id, f.secret.id));
    await f.db.update(companySecretVersions).set({ providerVersionRef: "fixture-version" }).where(eq(companySecretVersions.secretId, f.secret.id));
    const request = f.input(0, { expectedEpoch: await f.epoch() });
    // Existing rotate holds the secret row before its providerConfig FK check.
    // No real AWS create/rotate/resolve is invoked by this SQL lock fixture.
    rotation = otherDb.transaction(async tx => {
      blockerPid = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`) as unknown as Array<{ pid: number }>)[0].pid;
      await tx.select().from(companySecrets).where(eq(companySecrets.id, f.secret.id)).for("no key update"); entered(); await held;
      await tx.update(companySecrets).set({ providerConfigId: provider.id }).where(eq(companySecrets.id, f.secret.id));
    });
    await Promise.race([ready, rotation]);
    const declaration = declarationWithPid(f.db, f.company.id, f.endpoint.id, request);
    const rejected = expect(declaration.result).rejects.toMatchObject({ status: 409 });
    await waitBlockedBy(await declaration.pid, blockerPid); release(); await rotation; await rejected;
    expect(await f.rows()).toHaveLength(0);
  } finally { release?.(); await rotation?.catch(() => {}); await otherDb.$client.end({ timeout: 1 }); await f.cleanup(); }
});
