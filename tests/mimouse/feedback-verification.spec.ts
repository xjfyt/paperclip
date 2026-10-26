import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import type { NextFunction, Request, Response } from "express";
import { activityLog, authUsers, companies, companyMemberships, companySecrets, executionWorkspaces, heartbeatRuns,
  issueAccessGrants, issues, projects, mimouseCodingDeliveries as deliveries, mimouseFeedbackInbox as inbox,
  mimouseFeedbackPromotions as promotions, mimouseFeedbackVerifications as verifications } from "../../packages/db/src/index.js";
import { feedbackInboxService } from "../../server/src/services/mimouse-feedback.js";
import { feedbackPromotionService } from "../../server/src/services/mimouse-feedback-promotion.js";
import { feedbackVerificationService } from "../../server/src/services/mimouse-feedback-verification.js";
import { mimouseFeedbackRoutes } from "../../server/src/routes/mimouse-feedback.js";
import { HttpError } from "../../server/src/errors.js";
import type { FeedbackVerificationPreview, FeedbackVerificationConfirm } from "../../packages/shared/src/mimouse-feedback-verification.js";
import { createFixtureDb } from "./fixture-db.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const express = require("express") as typeof import("express");
const supertest = require("supertest") as typeof import("supertest");
const { and, eq, sql } = await import(require.resolve("drizzle-orm"));
const beforeSha = "a".repeat(40), afterSha = "b".repeat(40);
const privateMarkers = ["UNTRUSTED_LOG_BODY_NEVER_EXPORT", "COMMAND_NEVER_EXPORT", "LOG_LOCATION_NEVER_EXPORT", "PRIVATE_REPRODUCTION", "fixture-private-token", "fixture.invalid/repo"];
function noPrivateText(value: unknown) { for (const marker of privateMarkers) expect(JSON.stringify(value)).not.toContain(marker); }
/** Explicit session actors plus persisted membership/ACL, not a login/SSO proof.
 * All data is a disposable recorded fixture, not a real defect/test-run claim.
 * No model, git command, credential resolution, provider, heartbeat or worker. */
async function fixture() {
  const db = await createFixtureDb(); // Server-owned data-directory identity is verified before any mutation.
  try {
    const [company] = await db.insert(companies).values({ name: "Feedback verification fixture only", status: "active", issuePrefix: `FV${randomUUID().slice(0, 6).toUpperCase()}` }).returning();
    async function reviewer() {
      const userId = randomUUID();
      await db.insert(authUsers).values({ id: userId, name: "Fixture human reviewer", email: `${userId}@fixture.invalid`, createdAt: new Date(), updatedAt: new Date() });
      const [membership] = await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" }).returning();
      const actor: Express.Request["actor"] = { type: "board", source: "session", userId, companyIds: [company.id], memberships: [{ companyId: company.id, membershipRole: "owner", status: "active" }] };
      return { userId, membership, actor };
    }
    const owner = await reviewer();
    const source = (await feedbackInboxService(db).import(company.id, { sourceKind: "application_log", sourceInstance: "verification-fixture", externalId: randomUUID(),
      title: "Fixture feedback", text: "UNTRUSTED_LOG_BODY_NEVER_EXPORT\npassword=fixture-private-token", product: "Fixture app", softwareVersion: "1", commitSha: beforeSha, traceId: "fixture-trace", occurredAt: "2026-01-01T00:00:00Z" }, owner.userId)).item;
    const promoted = await feedbackPromotionService(db).promote(company.id, source.id, owner.userId, { requestId: randomUUID(), confirm: true, title: "Fixture human review",
      reproduction: "PRIVATE_REPRODUCTION", expectedBehavior: "Expected fixture behavior", fixProposal: "Fixture fix proposal", acceptanceCriteria: ["Same recorded check after fix"] });
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Fixture repository references only" }).returning();
    const [workspace] = await db.insert(executionWorkspaces).values({ companyId: company.id, projectId: project.id, sourceIssueId: promoted.issueId,
      mode: "isolated", strategyType: "git_worktree", name: "Reference only — not executed", branchName: "paperclip/fixture", repoUrl: "https://fixture.invalid/repo", cwd: "/fixture/not-executed" }).returning();
    await db.update(issues).set({ projectId: project.id, executionWorkspaceId: workspace.id }).where(eq(issues.id, promoted.issueId));
    // FK target only: no credential value or provider/version is ever resolved.
    const [secret] = await db.insert(companySecrets).values({ companyId: company.id, key: "fixture-reference-only", name: "Fixture reference only", provider: "local_encrypted" }).returning();
    const failed = { commitSha: beforeSha, command: "fixture-do-not-execute COMMAND_NEVER_EXPORT", logRef: "fixture://LOG_LOCATION_NEVER_EXPORT",
      exitCode: 1, status: "failed", startedAt: "2026-01-01T01:00:00Z", finishedAt: "2026-01-01T01:01:00Z" };
    const passed = { ...failed, commitSha: afterSha, exitCode: 0, status: "passed", startedAt: "2026-01-01T02:00:00Z", finishedAt: "2026-01-01T02:01:00Z" };
    const common = { companyId: company.id, issueId: promoted.issueId, workspaceId: workspace.id, secretRef: secret.id, gitlabOrigin: "https://fixture.invalid", projectId: 1, sourceBranch: "paperclip/fixture", targetBranch: "main" };
    const [before, after] = await db.insert(deliveries).values([
      { ...common, baseSha: "c".repeat(40), headSha: beforeSha, evidence: [failed] },
      { ...common, baseSha: beforeSha, headSha: afterSha, evidence: [passed] },
    ]).returning();
    const [otherIssue] = await db.insert(issues).values({ companyId: company.id, title: "Different private task", status: "backlog", visibility: "private", createdByUserId: owner.userId }).returning();
    const [otherDelivery] = await db.insert(deliveries).values({ ...common, issueId: otherIssue.id, baseSha: beforeSha, headSha: afterSha, evidence: [passed] }).returning();
    function app(actor = owner.actor) {
      const server = express(); server.use(express.json()); server.use((req, _res, next) => { req.actor = actor; next(); }); server.use(mimouseFeedbackRoutes(db));
      server.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => res.status(error instanceof HttpError ? error.status : 500).json({ error: "denied" })); return server;
    }
    const base = `/companies/${company.id}/feedback-inbox/${source.id}`;
    const selection = { reproduction: { deliveryId: before.id, checkIndex: 0 }, regression: { deliveryId: after.id, checkIndex: 0 } };
    const rows = () => db.select().from(verifications).where(eq(verifications.companyId, company.id));
    const audits = () => db.select().from(activityLog).where(and(eq(activityLog.companyId, company.id), eq(activityLog.action, "feedback.verification.attested")));
    async function preview(actor = owner.actor) { const response = await supertest(app(actor)).post(`${base}/verification-preview`).send(selection); expect(response.status, JSON.stringify(response.body)).toBe(200); expect(response.headers["cache-control"]).toBe("no-store"); return response.body as FeedbackVerificationPreview; }
    const draft = (previewDigest: string): FeedbackVerificationConfirm => ({ ...selection, requestId: randomUUID(), previewDigest, confirmReproduction: true, confirmFix: true, confirmComparableEnvironment: true });
    return { db, companyId: company.id, owner, reviewer, source, promoted, before, after, failed, passed, otherIssue, otherDelivery, app, base, selection, rows, audits, preview, draft, service: feedbackVerificationService(db) };
  } catch (error) { await db.$client.end({ timeout: 1 }); throw error; }
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function grant(f: Fixture, userId: string) {
  const [row] = await f.db.insert(issueAccessGrants).values({ issueId: f.promoted.issueId, subjectType: "user", subjectId: userId, source: "explicit", grantedByUserId: f.owner.userId }).returning(); return row;
}
async function postgresFailure(operation: PromiseLike<unknown>, code: string) {
  let captured: unknown; try { await operation; } catch (error) { captured = error; }
  expect(captured).toBeTruthy();
  let current = captured as { code?: string; cause?: unknown };
  while (current?.cause && !current.code) current = current.cause as typeof current;
  expect(current?.code).toBe(code);
}

test("real promotion and independent PostgreSQL clients deduplicate one attestation, retaining historical corrections", async () => {
  const f = await fixture(), second = await createFixtureDb();
  try {
    const preview = await f.preview(), body = f.draft(preview.previewDigest);
    expect(preview.assessment).toBe("awaiting_human_attestation"); noPrivateText(preview);
    expect(preview.snapshot).toMatchObject({ feedbackId: f.source.id, issueId: f.promoted.issueId, machineVerification: "reference_integrity_only", environment: "not_machine_verified", executionStarted: false, issueStatusChanged: false });
    expect(await f.rows()).toHaveLength(0); expect(await f.audits()).toHaveLength(0);
    const remote = feedbackVerificationService(second);
    const [a, b] = await Promise.all([f.service.confirm(f.companyId, f.source.id, f.owner.userId, body), remote.confirm(f.companyId, f.source.id, f.owner.userId, body)]);
    expect(a).toEqual(b); expect(a).toMatchObject({ assessment: "human_attested", historical: true, actorUserId: f.owner.userId });
    expect(await f.rows()).toHaveLength(1); expect(await f.audits()).toHaveLength(1);
    const [stored] = await f.rows(); expect(stored.snapshot).toEqual(a.snapshot); noPrivateText(stored); noPrivateText(await f.audits());
    const options = await supertest(f.app()).get(`${f.base}/verification-options`); expect(options.status).toBe(200); expect(options.body.checks).toHaveLength(2); noPrivateText(options.body);
    const history = await supertest(f.app()).get(`${f.base}/verifications`); expect(history.status).toBe(200); expect(history.headers["cache-control"]).toBe("no-store"); expect(history.body.items).toEqual([a]); noPrivateText(history.body);
    await expect(remote.confirm(f.companyId, f.source.id, f.owner.userId, { ...body, previewDigest: "f".repeat(64) })).rejects.toMatchObject({ status: 409 });
    const alternate = await f.reviewer(); await grant(f, alternate.userId);
    await expect(remote.confirm(f.companyId, f.source.id, alternate.userId, body)).rejects.toMatchObject({ status: 409 });
    // A new review preserves the old snapshot, even after the underlying receipt changes.
    await f.db.update(deliveries).set({ evidence: [{ ...f.passed, logRef: "fixture://changed-reference" }] }).where(eq(deliveries.id, f.after.id));
    expect(await remote.confirm(f.companyId, f.source.id, f.owner.userId, body)).toEqual(a);
    const newer = await supertest(f.app()).post(`${f.base}/verifications`).send(f.draft((await f.preview()).previewDigest)); expect(newer.status).toBe(200);
    expect(newer.body.id).not.toBe(a.id); expect(newer.body.historical).toBe(true); expect(newer.body.snapshot.regression.checkDigest).not.toBe(a.snapshot.regression.checkDigest);
    expect(await f.rows()).toHaveLength(2); expect(await f.audits()).toHaveLength(2);
    expect((await f.rows()).find(row => row.id === a.id)?.snapshot).toEqual(a.snapshot);
    const [issue] = await f.db.select().from(issues).where(eq(issues.id, f.promoted.issueId));
    expect(issue).toMatchObject({ status: "backlog", assigneeAgentId: null, assigneeUserId: null, visibility: "private" });
    expect(await f.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.companyId))).toHaveLength(0);
  } finally { await second.$client.end({ timeout: 1 }); await f.db.$client.end({ timeout: 1 }); }
});

test("PostgreSQL composite foreign keys reject foreign company, promotion, task and either delivery", async () => {
  const f = await fixture(); let foreign: Fixture | undefined;
  try {
    foreign = await fixture(); const body = f.draft((await f.preview()).previewDigest);
    await f.service.confirm(f.companyId, f.source.id, f.owner.userId, body);
    const [stored] = await f.rows();
    for (const patch of [{ companyId: foreign.companyId }, { feedbackId: foreign.source.id }, { issueId: f.otherIssue.id },
      { reproductionDeliveryId: foreign.before.id }, { regressionDeliveryId: foreign.after.id },
      { reproductionDeliveryId: f.otherDelivery.id }, { regressionDeliveryId: f.otherDelivery.id }]) {
      await postgresFailure(f.db.insert(verifications).values({ ...stored, id: randomUUID(), requestId: randomUUID(), ...patch }), "23503");
    }
    await postgresFailure(f.db.insert(verifications).values({ ...stored, id: randomUUID() }), "23505");
    await postgresFailure(f.db.update(verifications).set({ snapshot: { forged: true } }).where(eq(verifications.id, stored.id)), "23514");
    await postgresFailure(f.db.delete(verifications).where(eq(verifications.id, stored.id)), "23514");
    expect((await f.rows())[0].snapshot).toEqual(stored.snapshot);
    expect(await f.rows()).toHaveLength(1);
    expect(await f.db.select().from(promotions).where(eq(promotions.feedbackId, f.source.id))).toHaveLength(1);
  } finally { await foreign?.db.$client.end({ timeout: 1 }); await f.db.$client.end({ timeout: 1 }); }
});

test("stale check, replaced sanitized source and invalid chronology never insert a receipt or audit", async () => {
  const f = await fixture();
  try {
    const body = f.draft((await f.preview()).previewDigest);
    await f.db.update(deliveries).set({ evidence: [{ ...f.passed, logRef: "fixture://replacement" }] }).where(eq(deliveries.id, f.after.id));
    expect((await supertest(f.app()).post(`${f.base}/verifications`).send(body)).status).toBe(409);
    await f.db.update(deliveries).set({ evidence: [f.passed] }).where(eq(deliveries.id, f.after.id));
    const [original] = await f.db.select().from(inbox).where(eq(inbox.id, f.source.id));
    await f.db.update(inbox).set({ body: "Changed sanitized source without changing raw-import digest" }).where(eq(inbox.id, f.source.id));
    expect((await supertest(f.app()).post(`${f.base}/verifications`).send(body)).status).toBe(409);
    await f.db.update(inbox).set({ body: original.body }).where(eq(inbox.id, f.source.id));
    for (const patch of [{ exitCode: 1 }, { status: "not_run" }, { commitSha: beforeSha }, { startedAt: f.failed.startedAt, finishedAt: f.failed.finishedAt }, { finishedAt: "2999-01-01T00:00:00Z" }]) {
      await f.db.update(deliveries).set({ evidence: [{ ...f.passed, ...patch }] }).where(eq(deliveries.id, f.after.id));
      expect((await supertest(f.app()).post(`${f.base}/verification-preview`).send(f.selection)).status).toBe(422);
    }
    expect(await f.rows()).toHaveLength(0); expect(await f.audits()).toHaveLength(0);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});

test("real private-task ACL, member revocation, company scope and task binding gate preview, write and history", async () => {
  const f = await fixture(); let foreign: Fixture | undefined;
  try {
    foreign = await fixture(); const reviewer = await f.reviewer();
    for (const suffix of ["verification-options", "verifications"]) expect((await supertest(f.app(reviewer.actor)).get(`${f.base}/${suffix}`)).status).toBe(404);
    expect((await supertest(f.app(reviewer.actor)).post(`${f.base}/verification-preview`).send(f.selection)).status).toBe(404);
    const access = await grant(f, reviewer.userId), body = f.draft((await f.preview(reviewer.actor)).previewDigest);
    expect((await supertest(f.app(reviewer.actor)).post(`${f.base}/verifications`).send(body)).status).toBe(200);
    await f.db.update(issueAccessGrants).set({ revokedAt: new Date() }).where(eq(issueAccessGrants.id, access.id));
    expect((await supertest(f.app(reviewer.actor)).post(`${f.base}/verifications`).send(body)).status).toBe(404);
    for (const suffix of ["verification-options", "verifications"]) expect((await supertest(f.app(reviewer.actor)).get(`${f.base}/${suffix}`)).status).toBe(404);
    await f.db.update(issueAccessGrants).set({ revokedAt: null }).where(eq(issueAccessGrants.id, access.id));
    await f.db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.id, reviewer.membership.id));
    expect((await supertest(f.app(reviewer.actor)).post(`${f.base}/verifications`).send(body)).status).toBe(403); // actor still claims active: service rechecks DB.
    for (const actor of [{ ...f.owner.actor, source: "local_implicit" }, { ...f.owner.actor, companyIds: [foreign.companyId] }, { type: "agent", source: "agent_key", companyId: f.companyId, agentId: randomUUID() }] as Express.Request["actor"][]) {
      expect((await supertest(f.app(actor)).post(`${f.base}/verification-preview`).send(f.selection)).status).toBe(403);
    }
    for (const delivery of [foreign.after, f.otherDelivery]) expect((await supertest(f.app()).post(`${f.base}/verification-preview`).send({ ...f.selection, regression: { deliveryId: delivery.id, checkIndex: 0 } })).status).toBe(404);
    expect((await supertest(f.app()).post(`/companies/${f.companyId}/feedback-inbox/${foreign.source.id}/verification-preview`).send(f.selection)).status).toBe(404);
    await f.db.update(companies).set({ status: "paused" }).where(eq(companies.id, f.companyId));
    expect((await supertest(f.app()).get(`${f.base}/verifications`)).status).toBe(403);
    expect(await f.rows()).toHaveLength(1); expect(await f.audits()).toHaveLength(1);
  } finally { await foreign?.db.$client.end({ timeout: 1 }); await f.db.$client.end({ timeout: 1 }); }
});

test("a real advisory-lock waiter rechecks authority after revocation instead of replaying stale access", async () => {
  const f = await fixture(), holder = await createFixtureDb();
  let release = () => {}, held: Promise<unknown> | undefined, pending: Promise<{ value?: unknown; error?: unknown }> | undefined;
  try {
    const body = f.draft((await f.preview()).previewDigest), key = `feedback-verification:${f.companyId}:${body.requestId}`;
    let acquired!: () => void; const locked = new Promise<void>(resolve => { acquired = resolve; });
    const untilRelease = new Promise<void>(resolve => { release = resolve; });
    held = holder.transaction(async tx => { await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key},0))`); acquired(); await untilRelease; });
    await Promise.race([locked, held]);
    pending = f.service.confirm(f.companyId, f.source.id, f.owner.userId, body).then(value => ({ value }), error => ({ error }));
    await expect.poll(async () => {
      const rows = await f.db.$client.unsafe(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted
        AND classid=((hashtextextended($1,0)>>32)&4294967295)::oid AND objid=(hashtextextended($1,0)&4294967295)::oid) AS waiting`, [key]);
      return rows[0]?.waiting;
    }, { timeout: 5000 }).toBe(true);
    // A service that loaded/locked membership before waiting would block this
    // revocation; bound that failure rather than hanging the fixture database.
    await f.db.transaction(async tx => { await tx.execute(sql`set local lock_timeout='1500ms'`);
      await tx.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.id, f.owner.membership.id)); });
    release(); await held;
    expect((await pending).error).toMatchObject({ status: 403 });
    expect(await f.rows()).toHaveLength(0); expect(await f.audits()).toHaveLength(0);
  } finally { release(); try { await Promise.all([held, pending]); } finally { await holder.$client.end({ timeout: 1 }); await f.db.$client.end({ timeout: 1 }); } }
});

test("real audit failure rolls back the receipt and preserves the request for a safe retry", async () => {
  const f = await fixture(), name = `fixture_feedback_verification_${randomUUID().replaceAll("-", "")}`;
  let functionCreated = false, triggerCreated = false;
  try {
    const body = f.draft((await f.preview()).previewDigest);
    await f.db.$client.unsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.company_id='${f.companyId}'::uuid AND NEW.action='feedback.verification.attested' THEN RAISE EXCEPTION 'fixture verification audit failure'; END IF;
      RETURN NEW; END; $$`); functionCreated = true;
    await f.db.$client.unsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION ${name}()`); triggerCreated = true;
    expect((await supertest(f.app()).post(`${f.base}/verifications`).send(body)).status).toBe(500);
    expect(await f.rows()).toHaveLength(0); expect(await f.audits()).toHaveLength(0);
    await f.db.$client.unsafe(`DROP TRIGGER ${name} ON activity_log`); triggerCreated = false;
    const saved = await supertest(f.app()).post(`${f.base}/verifications`).send(body); expect(saved.status).toBe(200);
    expect((await supertest(f.app()).post(`${f.base}/verifications`).send(body)).body).toEqual(saved.body);
    expect(await f.rows()).toHaveLength(1); expect(await f.audits()).toHaveLength(1);
  } finally {
    try { if (triggerCreated) await f.db.$client.unsafe(`DROP TRIGGER IF EXISTS ${name} ON activity_log`); if (functionCreated) await f.db.$client.unsafe(`DROP FUNCTION IF EXISTS ${name}()`); }
    finally { await f.db.$client.end({ timeout: 1 }); }
  }
});
