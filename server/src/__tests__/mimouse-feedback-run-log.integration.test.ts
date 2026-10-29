import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, agents, authUsers, authSessions, companies, companyMemberships, createDb, heartbeatRuns, heartbeatRunEvents, issues, issueAccessGrants, instanceUserRoles, mimouseFeedbackInbox } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { mimouseFeedbackRoutes } from "../routes/mimouse-feedback.js";
import { HttpError } from "../errors.js";
let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
const companyId = randomUUID(), otherCompanyId = randomUUID(), agentId = randomUUID(), otherAgentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
const userId = randomUUID(), otherUserId = randomUUID(), sessionId = randomUUID(), otherSessionId = randomUUID();
const actor = { type: "board", source: "session", userId, sessionId, companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }] } as Express.Request["actor"];
const second = { ...actor, userId: otherUserId, sessionId: otherSessionId };
const base = `/companies/${companyId}/feedback-inbox`, selection = { runId, eventSeq: 1 };
function app(identity: Express.Request["actor"] = actor) {
  const server = express(); server.use(express.json()); server.use((req, _res, next) => { req.actor = identity; next(); }); server.use(mimouseFeedbackRoutes(db));
  server.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error instanceof HttpError ? error.status : 400).json({ error: error instanceof Error ? error.message : "denied" })); return server;
}
const post = (suffix: string, body: unknown, identity = actor) => request(app(identity)).post(`${base}/${suffix}`).send(body);
beforeAll(async () => {
  temporary = await startEmbeddedPostgresTestDatabase("run-log-reference-20261029-"); db = createDb(temporary.connectionString);
  await db.insert(companies).values([{ id: companyId, name: "Run log", issuePrefix: "RLG" }, { id: otherCompanyId, name: "Other", issuePrefix: "RLX" }]);
  await db.insert(authUsers).values([userId, otherUserId].map(id => ({ id, name: "Fixture", email: `${id}@example.invalid`, createdAt: new Date(), updatedAt: new Date() })));
  await db.insert(authSessions).values([{ id: sessionId, userId }, { id: otherSessionId, userId: otherUserId }].map(item => ({ ...item, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000), createdAt: new Date(), updatedAt: new Date() })));
  await db.insert(companyMemberships).values([userId, otherUserId].map(principalId => ({ companyId, principalType: "user", principalId, membershipRole: "owner", status: "active" })));
  await db.insert(agents).values([{ id: agentId, companyId, name: "Fixture", role: "engineer", adapterType: "process" }, { id: otherAgentId, companyId: otherCompanyId, name: "Other", role: "engineer", adapterType: "process" }]);
  await db.insert(issues).values({ id: issueId, companyId, title: "PRIVATE_TASK_SENTINEL", description: "PRIVATE_BODY_SENTINEL", visibility: "private", createdByUserId: userId, responsibleUserId: userId });
  await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, scopeKind: "issue", issueId, contextSnapshot: { issueId: randomUUID(), secret: "CONTEXT_SENTINEL" }, stdoutExcerpt: "STDOUT_SENTINEL", stderrExcerpt: "STDERR_SENTINEL", logRef: "/private/LOG_PATH_SENTINEL" });
  await db.insert(heartbeatRunEvents).values({ companyId, runId, agentId, seq: 1, eventType: "PROVIDER_FIELD_SENTINEL", message: "MESSAGE_SENTINEL", payload: { secret: "PAYLOAD_SENTINEL" }, sourceEventId: "PROVIDER_ID_SENTINEL" });
}, 90000);
afterAll(async () => { await temporary?.cleanup(); });
it("rejects non-reviewers, implicit/key sessions, cross-company and hidden source reads", async () => {
  for (const identity of [{ ...actor, source: "local_implicit" }, { ...actor, source: "board_key" }, { ...actor, type: "agent", companyId, agentId }, { ...actor, memberships: [{ companyId, membershipRole: "member", status: "active" }] }, { ...actor, sessionId: "missing" }]) {
    const denied = identity as Express.Request["actor"];
    expect((await post("run-log-preview", selection, denied)).status).toBe(403);
    expect((await post("run-log-import", { ...selection, previewDigest: "a".repeat(64), confirm: true }, denied)).status).toBe(403);
    expect((await request(app(denied)).get(`${base}/${randomUUID()}/run-log-source`)).status).toBe(403);
  }
  expect((await post("run-log-preview", selection, second)).status).toBe(404);
  expect((await request(app()).post(`/companies/${otherCompanyId}/feedback-inbox/run-log-preview`).send(selection)).status).toBe(403);
  const foreignRun = randomUUID(); await db.insert(heartbeatRuns).values({ id: foreignRun, companyId: otherCompanyId, agentId: otherAgentId });
  expect((await post("run-log-preview", { runId: foreignRun, eventSeq: 1 })).status).toBe(404);
});
it("exports only fixed metadata and imports exactly one candidate/audit under contention", async () => {
  const preview = await post("run-log-preview", selection); expect(preview.status).toBe(200); expect(preview.headers["cache-control"]).toBe("no-store");
  expect(JSON.stringify(preview.body)).not.toContain("SENTINEL");
  expect(preview.body.reference).toMatchObject({ softwareVersion: "unknown", commitSha: null, reproduction: "not_performed", contentIncluded: false });
  const payload = { ...selection, previewDigest: preview.body.previewDigest, confirm: true };
  const imports = await Promise.all(Array.from({ length: 5 }, () => post("run-log-import", payload)));
  expect(imports.map(response => response.status).sort()).toEqual([200, 200, 200, 200, 201]);
  const feedbackId = imports[0].body.item.id;
  const rows = await db.select().from(mimouseFeedbackInbox).where(eq(mimouseFeedbackInbox.companyId, companyId)); expect(rows).toHaveLength(1);
  const audits = await db.select().from(activityLog).where(eq(activityLog.action, "feedback.run_log.imported")); expect(audits).toHaveLength(1);
  expect(JSON.stringify([rows, audits])).not.toContain("SENTINEL"); expect(audits[0].runId).toBeNull();
  expect((await request(app()).get(`${base}/${feedbackId}/run-log-source`)).status).toBe(200);
  expect((await request(app(second)).get(`${base}/${feedbackId}`)).status).toBe(200);
  expect((await request(app(second)).get(`${base}/${feedbackId}/run-log-source`)).status).toBe(404);
  expect((await post("run-log-import", payload, second)).status).toBe(404);
});
it("never grants private source access through instance-admin flags, database roles or privacy rollout modes", async () => {
  const [candidate] = await db.select({ id: mimouseFeedbackInbox.id }).from(mimouseFeedbackInbox).where(eq(mimouseFeedbackInbox.companyId, companyId));
  const mode = process.env.PAPERCLIP_ISSUE_PRIVACY_MODE;
  await db.insert(instanceUserRoles).values({ userId: otherUserId, role: "instance_admin" });
  try {
    for (const privacyMode of ["enforce", "off", "shadow"]) {
      process.env.PAPERCLIP_ISSUE_PRIVACY_MODE = privacyMode;
      for (const identity of [second, { ...second, isInstanceAdmin: true }]) {
        expect((await post("run-log-preview", selection, identity)).status).toBe(404);
        expect((await post("run-log-import", { ...selection, previewDigest: "a".repeat(64), confirm: true }, identity)).status).toBe(404);
        expect((await request(app(identity)).get(`${base}/${candidate.id}/run-log-source`)).status).toBe(404);
        expect((await request(app(identity)).get(`${base}/${candidate.id}`)).status).toBe(200);
      }
    }
  } finally {
    if (mode === undefined) delete process.env.PAPERCLIP_ISSUE_PRIVACY_MODE; else process.env.PAPERCLIP_ISSUE_PRIVACY_MODE = mode;
    await db.delete(instanceUserRoles).where(and(eq(instanceUserRoles.userId, otherUserId), eq(instanceUserRoles.role, "instance_admin")));
  }
});
it("uses strict canonical ancestor privacy rather than an unrelated readable context issue", async () => {
  const parentId = randomUUID(), childId = randomUUID(), hiddenRun = randomUUID();
  await db.insert(issues).values({ id: parentId, companyId, title: "PRIVATE_ANCESTOR_SENTINEL", visibility: "private", createdByUserId: otherUserId, responsibleUserId: otherUserId });
  await db.insert(issues).values({ id: childId, companyId, title: "PRIVATE_CHILD_SENTINEL", visibility: "open", parentId, privacyParentIssueId: parentId, createdByUserId: otherUserId, responsibleUserId: otherUserId });
  await db.insert(heartbeatRuns).values({ id: hiddenRun, companyId, agentId, scopeKind: "issue", issueId: childId, contextSnapshot: { issueId } });
  await db.insert(heartbeatRunEvents).values({ companyId, runId: hiddenRun, agentId, seq: 1, eventType: "fixture" });
  const [child] = await db.select({ visibility: issues.visibility, privacyParentIssueId: issues.privacyParentIssueId }).from(issues).where(eq(issues.id, childId));
  expect(child).toEqual({ visibility: "open", privacyParentIssueId: parentId });
  const mode = process.env.PAPERCLIP_ISSUE_PRIVACY_MODE;
  try {
    process.env.PAPERCLIP_ISSUE_PRIVACY_MODE = "off";
    expect((await post("run-log-preview", { runId: hiddenRun, eventSeq: 1 }, { ...actor, isInstanceAdmin: true })).status).toBe(404);
    // The actual ancestor principal remains allowed; source privacy is not a blanket deny.
    expect((await post("run-log-preview", { runId: hiddenRun, eventSeq: 1 }, second)).status).toBe(200);
  } finally { if (mode === undefined) delete process.env.PAPERCLIP_ISSUE_PRIVACY_MODE; else process.env.PAPERCLIP_ISSUE_PRIVACY_MODE = mode; }
});
it("rechecks revocation, current session and actor-bound digest on every confirmation", async () => {
  await db.insert(issueAccessGrants).values({ issueId, subjectType: "user", subjectId: otherUserId, grantedByUserId: userId, source: "explicit" });
  const preview = await post("run-log-preview", selection, second); expect(preview.status).toBe(200);
  expect((await post("run-log-import", { ...selection, confirm: true, previewDigest: preview.body.previewDigest })).status).toBe(409);
  await db.update(issueAccessGrants).set({ revokedAt: new Date() }).where(and(eq(issueAccessGrants.issueId, issueId), eq(issueAccessGrants.subjectId, otherUserId)));
  expect((await post("run-log-import", { ...selection, confirm: true, previewDigest: preview.body.previewDigest }, second)).status).toBe(404);
  await db.update(authSessions).set({ expiresAt: new Date(0) }).where(eq(authSessions.id, otherSessionId));
  expect((await post("run-log-preview", selection, second)).status).toBe(403);
});
it("rejects microsecond-stale metadata and same sequence with a replaced event identity", async () => {
  const preview = await post("run-log-preview", selection); expect(preview.status).toBe(200);
  await db.update(heartbeatRunEvents).set({ createdAt: sql`${heartbeatRunEvents.createdAt} + interval '1 microsecond'` }).where(eq(heartbeatRunEvents.runId, runId));
  expect((await post("run-log-import", { ...selection, previewDigest: preview.body.previewDigest, confirm: true })).status).toBe(409);
  const fresh = await post("run-log-preview", selection);
  await db.delete(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId, runId));
  await db.insert(heartbeatRunEvents).values({ companyId, runId, agentId, seq: 1, eventType: "replacement", createdAt: new Date() });
  expect((await post("run-log-import", { ...selection, previewDigest: fresh.body.previewDigest, confirm: true })).status).toBe(409);
  const latest = await post("run-log-preview", selection);
  expect((await post("run-log-import", { ...selection, previewDigest: latest.body.previewDigest, confirm: true })).status).toBe(409);
  const [source] = await db.select({ id: mimouseFeedbackInbox.id }).from(mimouseFeedbackInbox).where(eq(mimouseFeedbackInbox.companyId, companyId));
  expect((await request(app()).get(`${base}/${source.id}/run-log-source`)).status).toBe(409);
});
it("rejects manually spoofed internal namespaces and caller-supplied source content", async () => {
  for (const extra of [{ contextSnapshot: { issueId } }, { payload: {} }, { message: "malicious" }, { eventSeq: 0 }]) expect((await post("run-log-preview", { ...selection, ...extra })).status).toBe(400);
  const response = await request(app()).post(base).send({ sourceKind: "application_log", sourceInstance: "internal.run-log.v1", externalId: `${runId}:1`, title: "fake", text: "fake", product: "Paperclip", occurredAt: new Date().toISOString() }); expect(response.status).toBe(400);
});

it("rolls back the candidate if its atomic audit cannot be written", async () => {
  const safeRun = randomUUID(); await db.insert(heartbeatRuns).values({ id: safeRun, companyId, agentId });
  await db.insert(heartbeatRunEvents).values({ companyId, runId: safeRun, agentId, seq: 1, eventType: "fixture" });
  const chosen = { runId: safeRun, eventSeq: 1 }, preview = await post("run-log-preview", chosen);
  expect(preview.status).toBe(200);
  await db.execute(sql`alter table activity_log add constraint run_log_fixture_audit_failure check (action <> 'feedback.run_log.imported') not valid`);
  try {
    const result = await post("run-log-import", { ...chosen, previewDigest: preview.body.previewDigest, confirm: true }); expect(result.status).not.toBe(201);
    const candidates = await db.select({ id: mimouseFeedbackInbox.id }).from(mimouseFeedbackInbox).where(eq(mimouseFeedbackInbox.externalId, `${safeRun}:1`)); expect(candidates).toHaveLength(0);
  } finally { await db.execute(sql`alter table activity_log drop constraint run_log_fixture_audit_failure`); }
  const result = await post("run-log-import", { ...chosen, previewDigest: preview.body.previewDigest, confirm: true }); expect(result.status).toBe(201);
  await db.update(authSessions).set({ expiresAt: new Date(Date.now() + 3600000) }).where(eq(authSessions.id, otherSessionId));
  const otherPreview = await post("run-log-preview", chosen, second); expect(otherPreview.status).toBe(200);
  const duplicate = await post("run-log-import", { ...chosen, previewDigest: otherPreview.body.previewDigest, confirm: true }, second);
  expect(duplicate.status).toBe(200); expect(duplicate.body.item.id).toBe(result.body.item.id);
  const audit = await db.select({ id: activityLog.id }).from(activityLog).where(and(eq(activityLog.entityId, result.body.item.id), eq(activityLog.action, "feedback.run_log.imported"))); expect(audit).toHaveLength(1);
});
it("denies deleted issue bindings and event/agent identity mismatches without guessing context", async () => {
  const unboundRun = randomUUID(), mismatchedRun = randomUUID(), deletedIssueId = randomUUID();
  await db.insert(issues).values({ id: deletedIssueId, companyId, title: "Deleted fixture", visibility: "private", createdByUserId: userId });
  await db.insert(heartbeatRuns).values([{ id: unboundRun, companyId, agentId, scopeKind: "issue", issueId: deletedIssueId, contextSnapshot: { issueId } }, { id: mismatchedRun, companyId, agentId }]);
  await db.insert(heartbeatRunEvents).values([{ companyId, runId: unboundRun, agentId, seq: 1, eventType: "fixture" }, { companyId, runId: mismatchedRun, agentId: otherAgentId, seq: 1, eventType: "fixture" }]);
  await db.delete(issues).where(eq(issues.id, deletedIssueId));
  const [tombstone] = await db.select({ scopeKind: heartbeatRuns.scopeKind, issueId: heartbeatRuns.issueId }).from(heartbeatRuns).where(eq(heartbeatRuns.id, unboundRun));
  expect(tombstone).toEqual({ scopeKind: "issue", issueId: null });
  expect((await post("run-log-preview", { runId: unboundRun, eventSeq: 1 })).status).toBe(404);
  expect((await post("run-log-preview", { runId: mismatchedRun, eventSeq: 1 })).status).toBe(404);
});
it("revalidates database membership even when the request carries a stale admin role", async () => {
  await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId)));
  try { expect((await post("run-log-preview", selection)).status).toBe(403); }
  finally { await db.update(companyMemberships).set({ status: "active" }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId))); }
});
