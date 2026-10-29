import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { activityLog, agents, authSessions, authUsers, companies, companyMemberships, createDb, heartbeatRuns, instanceUserRoles, issues, projects, routines, routineRuns,
  mimouseResearchCandidates as candidates } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { researchRoutineHistory } from "./history.js";
import { prepareResearchReport } from "./evidence.js";
import { accessService } from "../access.js";
import { canActorReadIssuePrivacy } from "../authorization.js";
import { mimouseResearchRoutineRoutes } from "../../routes/mimouse-research-routines.js";
import { errorHandler } from "../../middleware/error-handler.js";
let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: ReturnType<typeof createDb>;
beforeAll(async () => { temporary = await startEmbeddedPostgresTestDatabase("research-history-disposable-"); db = createDb(temporary.connectionString); }, 90000);
afterAll(async () => { await db?.$client.end({ timeout: 1 }); await temporary?.cleanup(); });
async function fixture() {
  const companyId = randomUUID(), userId = randomUUID(), sessionId = randomUUID(), now = new Date();
  await db.insert(companies).values({ id: companyId, name: "Read-only research fixture", issuePrefix: `R${companyId.slice(0, 5)}` });
  await db.insert(authUsers).values({ id: userId, name: "History owner", email: `${userId}@example.invalid`, createdAt: now, updatedAt: now });
  await db.insert(authSessions).values({ id: sessionId, token: randomUUID(), userId, expiresAt: new Date(Date.now() + 3600000), createdAt: now, updatedAt: now });
  await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
  await accessService(db).ensureRoleDefaultGrants(companyId, userId, "owner", userId);
  const [project] = await db.insert(projects).values({ companyId, name: "Open source", visibility: "open" }).returning();
  const [routine] = await db.insert(routines).values({ companyId, title: "Existing research", status: "paused", projectId: project.id }).returning();
  const [agent] = await db.insert(agents).values({ companyId, name: "Inert agent", adapterType: "process", status: "idle" }).returning();
  const actor: Express.Request["actor"] = { type: "board", source: "session", userId, sessionId, companyIds: [companyId] };
  const read = (limit = 10, beforeId?: string) => researchRoutineHistory(db, companyId, routine.id, actor, { limit, beforeId });
  async function receipt(timestamp = "2026-10-29T00:00:00.000999Z", linked = false) {
    const [row] = await db.insert(routineRuns).values({ companyId, routineId: routine.id, source: "schedule", status: linked ? "issue_created" : "received", createdAt: sql`${timestamp}::timestamptz` }).returning();
    if (!linked) return { row };
    const [issue] = await db.insert(issues).values({ companyId, title: "Source task", status: "in_progress", projectId: project.id, originKind: "routine_execution", originId: routine.id, originRunId: row.id }).returning();
    await db.update(routineRuns).set({ linkedIssueId: issue.id }).where(eq(routineRuns.id, row.id));
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent.id, scopeKind: "issue", issueId: issue.id, status: "failed" }).returning();
    const input = { routineRunId: row.id, issueId: issue.id, title: "Report", product: "MiWork", currentState: "A", proposedState: "B", recommendation: "Human review",
      sources: [{ url: "https://example.invalid/not-fetched", retrievedAt: "2026-10-29T00:00:00Z", product: "MiWork", gap: "Fixture", suggestion: "Review", evidence: "NEVER_RETURN_REPORT_BODY" }] };
    const prepared = prepareResearchReport(input, { companyId, routineId: routine.id, routineRunId: row.id, issueId: issue.id, runId: run.id, agentId: agent.id,
      bindingUpdatedAt: now.toISOString(), reportBodyHash: "a".repeat(64), sourceVerification: "agent_report", disposition: "quarantined" });
    const [report] = await db.insert(candidates).values({ ...prepared, companyId, actorId: `agent:${agent.id}` }).returning();
    return { row, issue, run, report };
  }
  return { companyId, userId, sessionId, project, routine, actor, read, receipt, agent };
}
it("uses real session/member admission and preserves paused-company reads", async () => {
  const f = await fixture(); await f.receipt();
  for (const actor of [{ ...f.actor, source: "local_implicit" }, { ...f.actor, sessionId: null }, { ...f.actor, sessionId: randomUUID() }, { ...f.actor, source: "agent_key", type: "agent" }]) {
    await expect(researchRoutineHistory(db, f.companyId, f.routine.id, actor as Express.Request["actor"], { limit: 10 })).rejects.toMatchObject({ status: 403 });
  }
  await db.update(companies).set({ status: "paused" }).where(eq(companies.id, f.companyId));
  expect((await f.read()).items).toHaveLength(1);
  await db.update(companyMemberships).set({ membershipRole: "member" }).where(eq(companyMemberships.principalId, f.userId));
  await expect(researchRoutineHistory(db, f.companyId, f.routine.id, { ...f.actor, isInstanceAdmin: true }, { limit: 10 })).rejects.toMatchObject({ status: 403 });
  await db.update(companyMemberships).set({ membershipRole: "owner" }).where(eq(companyMemberships.principalId, f.userId));
  await db.delete(authSessions).where(eq(authSessions.id, f.sessionId));
  await expect(f.read()).rejects.toMatchObject({ status: 403 });
});
it("pages exact PostgreSQL microseconds through invisible rows and rechecks cursor privacy", async () => {
  const f = await fixture(), visible: string[] = [];
  for (let i = 0; i < 25; i++) visible.push((await f.receipt(i < 23 ? "2026-10-29T00:00:00.000654Z" : "2026-10-29T00:00:00.000321Z")).row.id);
  const hidden = await f.receipt("2026-10-29T00:00:00.000655Z", true);
  await db.update(issues).set({ visibility: "private", createdByUserId: f.userId, responsibleUserId: f.userId }).where(eq(issues.id, hidden.issue!.id));
  let page = await f.read(3); const ids = page.items.map(row => row.id);
  const newer = await f.receipt("2026-10-29T00:00:01.000001Z");
  while (page.nextBeforeId) { page = await f.read(3, page.nextBeforeId); ids.push(...page.items.map(row => row.id)); }
  expect(ids.sort()).toEqual(visible.sort()); expect(new Set(ids).size).toBe(ids.length); expect(ids).not.toContain(newer.row.id);
  await expect(f.read(3, hidden.row.id)).rejects.toMatchObject({ status: 404 });
  await expect(f.read(3, randomUUID())).rejects.toMatchObject({ status: 404 });
  const other = await fixture(), foreign = await other.receipt(); await expect(f.read(3, foreign.row.id)).rejects.toMatchObject({ status: 404 });
  await db.update(projects).set({ visibility: "private", privacyOwnerUserId: f.userId }).where(eq(projects.id, f.project.id));
  await expect(f.read()).rejects.toMatchObject({ status: 404 });
});
it("reports reception separately from failed attempts, and never borrows coalesced reports", async () => {
  const f = await fixture(), original = await f.receipt(undefined, true);
  const [coalesced] = await db.insert(routineRuns).values({ companyId: f.companyId, routineId: f.routine.id, source: "schedule", status: "coalesced", linkedIssueId: original.issue!.id, coalescedIntoRunId: original.row.id }).returning();
  const page = await f.read();
  expect(page.items.find(row => row.id === original.row.id)).toMatchObject({ reportState: "received", attempts: [{ status: "failed" }], externalSourcesVerified: false, agentDispatched: false });
  expect(page.items.find(row => row.id === coalesced.id)).toMatchObject({ reportState: "coalesced", reports: [], attempts: [] });
  expect(JSON.stringify(page)).not.toContain("NEVER_RETURN_REPORT_BODY");
  await db.update(candidates).set({ evidence: { ...original.report!.evidence, provenance: { ...original.report!.evidence.provenance!, agentId: randomUUID() } } }).where(eq(candidates.id, original.report!.id));
  expect((await f.read()).items.find(row => row.id === original.row.id)).toMatchObject({ reportState: "needs_review", reports: [] });
});
it("marks duplicate provenance identities and truncated attempts needs_review", async () => {
  const f = await fixture(), original = await f.receipt(undefined, true);
  await db.insert(candidates).values({ companyId: f.companyId, requestId: randomUUID(), actorId: original.report!.actorId, requestDigest: "a".repeat(64), evidenceHash: "b".repeat(64), evidence: original.report!.evidence });
  expect((await f.read()).items[0]).toMatchObject({ reportState: "needs_review", reports: [] });
  await db.insert(heartbeatRuns).values(Array.from({ length: 101 }, () => ({ companyId: f.companyId, agentId: f.agent.id, scopeKind: "issue" as const, issueId: original.issue!.id, status: "failed" })));
  expect((await f.read()).items[0]).toMatchObject({ reportState: "needs_review", reports: [] });
});
it("checks full structural/privacy ancestors and canonical run permissions", async () => {
  const f = await fixture(), original = await f.receipt(undefined, true);
  const [parent] = await db.insert(issues).values({ companyId: f.companyId, title: "Private ancestor", visibility: "private", createdByUserId: f.userId, responsibleUserId: f.userId }).returning();
  for (const field of ["parentId", "privacyParentIssueId", "privacyRootIssueId"] as const) {
    await db.update(issues).set({ [field]: parent.id }).where(eq(issues.id, original.issue!.id));
    expect((await f.read()).items).toEqual([]);
    await expect(f.read(1, original.row.id)).rejects.toMatchObject({ status: 404 });
    await db.update(issues).set({ [field]: null }).where(eq(issues.id, original.issue!.id));
  }
  await db.update(heartbeatRuns).set({ scopeKind: "company", issueId: null }).where(eq(heartbeatRuns.id, original.run!.id));
  expect((await f.read()).items[0]).toMatchObject({ reportState: "needs_review", reports: [] });
});
it("real HTTP GET is no-store, strict, read-only and denies revoked access", async () => {
  const f = await fixture(); await f.receipt(undefined, true);
  const app = express(); app.use((req, _res, next) => { req.actor = f.actor; next(); }); app.use("/api", mimouseResearchRoutineRoutes(db)); app.use(errorHandler);
  const path = `/api/companies/${f.companyId}/research-routines/${f.routine.id}/history`;
  const before = await db.select().from(activityLog).where(eq(activityLog.companyId, f.companyId));
  const response = await request(app).get(path).expect(200); expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.body.agentDispatched).toBe(false);
  for (const query of ["?limit=0", "?limit=21", "?limit=1.5", "?beforeId=secret", "?offset=10"]) await request(app).get(path + query).expect(400);
  await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.principalId, f.userId));
  await request(app).get(path).expect(403);
  expect(await db.select().from(activityLog).where(eq(activityLog.companyId, f.companyId))).toEqual(before);
  expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.companyId))).toHaveLength(1);
});
it("returns 503, never false empty, when invisible scanning exceeds its budget", async () => {
  const f = await fixture();
  const [hidden] = await db.insert(issues).values({ companyId: f.companyId, title: "Hidden history", visibility: "private", createdByUserId: f.userId, responsibleUserId: f.userId }).returning();
  await db.insert(routineRuns).values(Array.from({ length: 1001 }, () => ({ companyId: f.companyId, routineId: f.routine.id, source: "schedule", status: "issue_created", linkedIssueId: hidden.id })));
  await expect(f.read()).rejects.toMatchObject({ status: 503 });
});
it("a blocked PostgreSQL read gets a bounded 503 and no partial HTTP response", async () => {
  const f = await fixture(); await f.receipt();
  let release!: () => void, locked!: () => void;
  const acquired = new Promise<void>(resolve => { locked = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const transaction = db.transaction(async tx => { await tx.execute(sql`lock table routines in access exclusive mode`); locked(); await hold; });
  await acquired;
  try { await expect(f.read()).rejects.toMatchObject({ status: 503 }); } finally { release(); await transaction; }
  expect((await f.read()).items).toHaveLength(1);
});
it("fails closed on oversized provenance and does not hide traversal exhaustion as an empty page", async () => {
  const f = await fixture(), original = await f.receipt(undefined, true);
  await db.update(candidates).set({ evidence: { ...original.report!.evidence, provenance: { ...original.report!.evidence.provenance!, extra: "x".repeat(3000) } } as NonNullable<typeof original.report>["evidence"] }).where(eq(candidates.id, original.report!.id));
  expect((await f.read()).items[0]).toMatchObject({ reportState: "needs_review", reports: [] });
  let parentId: string | null = null;
  for (let i = 0; i < 129; i++) {
    const [ancestor]: Array<Pick<typeof issues.$inferSelect, "id">> = await db.insert(issues).values({ companyId: f.companyId, title: "Open ancestor", parentId, visibility: "open" }).returning({ id: issues.id });
    parentId = ancestor.id;
  }
  await db.update(issues).set({ parentId }).where(eq(issues.id, original.issue!.id));
  await expect(f.read()).rejects.toMatchObject({ status: 503 });
});
it.each(["actor_flag", "database_role", "privacy_mode_off"])("does not treat %s as authority to disclose private source runs or cursors", async mode => {
  const f = await fixture(), original = await f.receipt(undefined, true);
  if (mode === "actor_flag") f.actor.isInstanceAdmin = true;
  if (mode === "database_role") await db.insert(instanceUserRoles).values({ userId: f.userId, role: "instance_admin" });
  if (mode === "privacy_mode_off") vi.stubEnv("PAPERCLIP_ISSUE_PRIVACY_MODE", "off");
  try {
    await db.update(issues).set({ visibility: "private", createdByUserId: f.userId, responsibleUserId: f.userId }).where(eq(issues.id, original.issue!.id));
    const [privateSource] = await db.select().from(issues).where(eq(issues.id, original.issue!.id));
    expect(privateSource).toMatchObject({ visibility: "private", createdByUserId: f.userId, responsibleUserId: f.userId });
    // The actual owner can read the private task. That still cannot authorize
    // company-open research history, even with an instance-admin bypass input.
    expect(await canActorReadIssuePrivacy(db, f.actor, privateSource)).toBe(true);
    expect((await f.read()).items).toEqual([]);
    await expect(f.read(1, original.row.id)).rejects.toMatchObject({ status: 404 });
    await db.update(issues).set({ visibility: "open" }).where(eq(issues.id, original.issue!.id));
    const [parent] = await db.insert(issues).values({ companyId: f.companyId, title: "Private ancestor", visibility: "private", createdByUserId: f.userId, responsibleUserId: f.userId }).returning();
    await db.update(issues).set({ privacyParentIssueId: parent.id }).where(eq(issues.id, original.issue!.id));
    expect((await f.read()).items).toEqual([]);
    await db.update(projects).set({ visibility: "private", privacyOwnerUserId: f.userId }).where(eq(projects.id, f.project.id));
    await expect(f.read()).rejects.toMatchObject({ status: 404 });
  } finally { vi.unstubAllEnvs(); }
});
