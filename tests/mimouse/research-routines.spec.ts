import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { and, eq } = await import(require.resolve("drizzle-orm"));
import { agents, authUsers, companies, companyMemberships, heartbeatRuns, issues, projects, routines, routineRuns, mimouseResearchCandidates as candidates, mimouseResearchPromotions as promotions } from "../../packages/db/src/index.js";
import { createFixtureDb } from "./fixture-db.js";
import { mimouseResearchRoutineRoutes } from "../../server/src/routes/mimouse-research-routines.js";
import { researchRoutineService } from "../../server/src/services/mimouse-research-routines/service.js";
import { researchCandidateService } from "../../server/src/services/mimouse-research/service.js";
import { issueService } from "../../server/src/services/issues.js";
import { accessService } from "../../server/src/services/access.js";
/** DB-only execution fixtures: no runner, scheduler, adapter, model or provider is invoked. */
async function fixture(db: Awaited<ReturnType<typeof createFixtureDb>>, companyId: string) {
  const userId = randomUUID();
  await db.insert(authUsers).values({ id: userId, name: "Research fixture owner", email: `${userId}@fixture.invalid`, createdAt: new Date(), updatedAt: new Date() });
  const [membership] = await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" }).returning();
  await accessService(db).ensureRoleDefaultGrants(companyId, userId, "owner", userId);
  const [agent] = await db.insert(agents).values({ companyId, name: "Inert research fixture", status: "idle", adapterType: "process", adapterConfig: {}, runtimeConfig: {} }).returning();
  const [project] = await db.insert(projects).values({ companyId, name: "Company-open research fixture", visibility: "open" }).returning();
  const [routine] = await db.insert(routines).values({ companyId, title: "Paused fixture", projectId: project.id, status: "paused", assigneeAgentId: agent.id, responsibleUserId: userId }).returning();
  const [routineRun] = await db.insert(routineRuns).values({ companyId, routineId: routine.id, source: "schedule", status: "issue_created", responsibleUserId: userId }).returning();
  const [issue] = await db.insert(issues).values({ companyId, issueNumber: 900000, title: "Inert routine execution fixture", projectId: project.id, status: "in_progress", assigneeAgentId: agent.id,
    responsibleUserId: userId, originKind: "routine_execution", originId: routine.id, originRunId: routineRun.id }).returning();
  const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent.id, scopeKind: "issue", issueId: issue.id, status: "running", responsibleUserId: userId }).returning();
  await db.update(issues).set({ checkoutRunId: run.id, executionRunId: run.id }).where(eq(issues.id, issue.id));
  await db.update(routineRuns).set({ linkedIssueId: issue.id }).where(eq(routineRuns.id, routineRun.id));
  const owner = { type: "board" as const, source: "session" as const, userId };
  const actor = { type: "agent" as const, source: "agent_jwt" as const, companyId, agentId: agent.id, runId: run.id, onBehalfOfUserId: userId };
  const input = { routineRunId: routineRun.id, issueId: issue.id, title: "Structured finding", product: "MiWork", currentState: "Manual", proposedState: "Reviewed", recommendation: "Confirm scope first",
    sources: [{ url: "https://example.invalid/docs", retrievedAt: "2026-10-26T00:00:00Z", evidence: "Fixture assertion; never fetched", product: "MiWork", gap: "No linked report", suggestion: "Add immutable provenance" }] };
  return { owner, actor, input, routine, routineRun, issue, run, membership, project };
}
test("routine report receipts are immutable, company scoped and quarantined without dispatch", async ({ request }) => {
  const companyId = (await (await request.post("/api/companies", { data: { name: "Research routines DB fixture" } })).json()).id as string;
  const db = await createFixtureDb();
  try {
    const f = await fixture(db, companyId), service = researchRoutineService(db);
    await expect(service.bind(companyId, f.routine.id, f.actor, { product: "MiWork", enabled: true })).rejects.toThrow();
    await service.bind(companyId, f.routine.id, f.owner, { product: "MiWork", enabled: true });
    await expect(service.report(companyId, f.routine.id, { ...f.actor, source: "agent_key" }, f.input)).rejects.toThrow("JWT");
    await expect(service.report(companyId, f.routine.id, f.actor, { ...f.input, product: "Other" })).rejects.toThrow();
    const [a, b] = await Promise.all([service.report(companyId, f.routine.id, f.actor, f.input), service.report(companyId, f.routine.id, f.actor, f.input)]);
    expect(a.candidateId).toBe(b.candidateId); expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(a).toMatchObject({ disposition: "quarantined", sourceVerification: "agent_report", agentDispatched: false });
    await expect(service.report(companyId, f.routine.id, f.actor, { ...f.input, recommendation: "Changed replay" })).rejects.toThrow("different");
    const saved = await researchCandidateService(db).get(companyId, a.candidateId);
    expect(saved.evidence).toMatchObject({ evidenceMode: "agent_report", provenance: { companyId, routineId: f.routine.id, routineRunId: f.routineRun.id, issueId: f.issue.id, runId: f.run.id, agentId: f.actor.agentId } });
    expect(await db.select().from(candidates).where(eq(candidates.companyId, companyId))).toHaveLength(1);
    expect(await db.select().from(promotions).where(eq(promotions.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId))).toHaveLength(1);
    expect((await db.select().from(routines).where(eq(routines.id, f.routine.id)))[0].status).toBe("paused");
    await db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, f.run.id));
    await expect(service.report(companyId, f.routine.id, f.actor, f.input)).rejects.toThrow("running");
    await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.id, f.membership.id)));
    await expect(service.bind(companyId, f.routine.id, f.owner, { product: "MiWork", enabled: false })).rejects.toThrow();
  } finally { await db.$client.end({ timeout: 1 }); }
});

test("private and inherited source boundaries are not copied to the company-admin inbox", async ({ request }) => {
  const companyId = (await (await request.post("/api/companies", { data: { name: "Research privacy DB fixture" } })).json()).id as string;
  const db = await createFixtureDb();
  try {
    const f = await fixture(db, companyId), service = researchRoutineService(db);
    await service.bind(companyId, f.routine.id, f.owner, { product: "MiWork", enabled: true });
    const rejectReport = () => expect(service.report(companyId, f.routine.id, f.actor, f.input)).rejects.toThrow("company-open");
    await db.update(projects).set({ visibility: "private", privacyOwnerUserId: f.owner.userId }).where(eq(projects.id, f.project.id));
    await rejectReport(); // Even its owner cannot declassify a private project by binding/reporting.
    expect(await service.available(companyId, f.owner)).toEqual([]);
    expect(await service.list(companyId, f.owner)).toEqual([]);
    await expect(service.bind(companyId, f.routine.id, f.owner, { product: "MiWork", enabled: true })).rejects.toThrow("company-open");
    await db.update(projects).set({ visibility: "open", privacyOwnerUserId: null }).where(eq(projects.id, f.project.id));
    const otherUserId = randomUUID();
    await db.insert(authUsers).values({ id: otherUserId, name: "Other private owner", email: `${otherUserId}@fixture.invalid`, createdAt: new Date(), updatedAt: new Date() });
    const privateParent = await issueService(db).create(companyId, { title: "Other owner's private source", status: "backlog", visibility: "private", createdByUserId: otherUserId,
      responsibleUserId: otherUserId, actorResponsibleUserId: otherUserId });
    await db.update(issues).set({ privacyParentIssueId: privateParent.id }).where(eq(issues.id, f.issue.id));
    await rejectReport();
    await db.update(issues).set({ privacyParentIssueId: null, parentId: privateParent.id }).where(eq(issues.id, f.issue.id));
    await rejectReport();
    await db.update(issues).set({ parentId: null, privacyRootIssueId: privateParent.id }).where(eq(issues.id, f.issue.id));
    await rejectReport();
    await db.update(issues).set({ privacyRootIssueId: null, visibility: "private" }).where(eq(issues.id, f.issue.id));
    await rejectReport();
    await db.update(routines).set({ parentIssueId: privateParent.id }).where(eq(routines.id, f.routine.id));
    await expect(service.bind(companyId, f.routine.id, f.owner, { product: "MiWork", enabled: true })).rejects.toThrow("company-open");
    expect(await db.select().from(candidates).where(eq(candidates.companyId, companyId))).toHaveLength(0);
  } finally { await db.$client.end({ timeout: 1 }); }
});
test("existing issue creation preserves open routine context and inherited private context without dispatch", async ({ request }) => {
  const companyId = (await (await request.post("/api/companies", { data: { name: "Research issue-default DB fixture" } })).json()).id as string;
  const db = await createFixtureDb();
  try {
    const f = await fixture(db, companyId), service = researchRoutineService(db);
    // Same issueService creation path used by routine dispatch, but backlog and
    // no assignment/wakeup: this test never invokes routine.run or a provider.
    const base = { title: "Routine-shaped creation fixture", status: "backlog" as const, projectId: f.project.id,
      responsibleUserId: f.owner.userId, trustExplicitResponsibleUserId: true, originKind: "routine_execution", originId: f.routine.id, originRunId: f.routineRun.id };
    const open = await issueService(db).create(companyId, base);
    expect(open.visibility).toBe("open"); expect(open.privacyRootIssueId).toBeNull();
    const parent = await issueService(db).create(companyId, { title: "Private source", status: "backlog", visibility: "private", createdByUserId: f.owner.userId, responsibleUserId: f.owner.userId, actorResponsibleUserId: f.owner.userId });
    const inherited = await issueService(db).create(companyId, { ...base, parentId: parent.id });
    expect(inherited.visibility).toBe("private");
    await db.update(routines).set({ projectId: null, parentIssueId: null }).where(eq(routines.id, f.routine.id));
    await service.bind(companyId, f.routine.id, f.owner, { product: "MiWork", enabled: false });
    await expect(service.bind(companyId, f.routine.id, f.owner, { product: "MiWork", enabled: true })).rejects.toThrow("Configure a company-open");
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId))).toHaveLength(1);
  } finally { await db.$client.end({ timeout: 1 }); }
});

test("paused companies allow administrator research reads but never binding or report writes", async ({ request }) => {
  const companyId = (await (await request.post("/api/companies", { data: { name: "Paused research read fixture" } })).json()).id as string;
  const foreignId = (await (await request.post("/api/companies", { data: { name: "Foreign research read fixture" } })).json()).id as string;
  const db = await createFixtureDb();
  try {
    const f = await fixture(db, companyId), service = researchRoutineService(db);
    await service.bind(companyId, f.routine.id, f.owner, { product: "MiWork", enabled: true });
    // Exercise real routes + real DB role/privacy checks. This deliberately
    // supplies a test-only actor context; it does not claim to test login/JWT signing.
    const { default: express } = await import(require.resolve("express"));
    const { default: supertest } = await import(require.resolve("supertest"));
    let actor: Express.Request["actor"] = { ...f.owner, companyIds: [companyId] };
    const app = express(); app.use(express.json());
    app.use((req: { actor: Express.Request["actor"] }, _res: unknown, next: () => void) => { req.actor = actor; next(); });
    app.use("/api", mimouseResearchRoutineRoutes(db));
    app.use((error: { status?: number; message?: string }, _req: unknown, res: { status(code: number): { json(body: unknown): void } }, _next: () => void) => {
      res.status(error.status ?? 500).json({ error: error.message });
    });
    const http = supertest(app), path = `/api/companies/${companyId}/research-routines`;
    await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
    for (const suffix of ["", "/available"]) {
      const result = await http.get(path + suffix); expect(result.status).toBe(200); expect(result.body).toHaveLength(1);
    }
    expect((await http.put(`${path}/${f.routine.id}`).send({ product: "MiWork", enabled: false })).status).toBe(403);
    expect((await http.get(path)).body[0].enabled).toBe(true);
    actor = { ...f.actor, onBehalfOfMemberships: [{ companyId, membershipRole: "owner", status: "active" }] };
    const report = await http.post(`${path}/${f.routine.id}/reports`).send(f.input);
    expect(report.status).toBe(403); expect(report.body.error).toBe("Active company required");
    actor = { ...f.owner, companyIds: [companyId] };
    await db.update(companyMemberships).set({ membershipRole: "viewer" }).where(eq(companyMemberships.id, f.membership.id));
    for (const suffix of ["", "/available"]) expect((await http.get(path + suffix)).status).toBe(403);
    await db.update(companyMemberships).set({ membershipRole: "admin" }).where(eq(companyMemberships.id, f.membership.id));
    for (const suffix of ["", "/available"]) expect((await http.get(path + suffix)).status).toBe(200);
    for (const suffix of ["", "/available"]) expect((await http.get(`/api/companies/${foreignId}/research-routines${suffix}`)).status).toBe(403);
    await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.id, f.membership.id));
    for (const suffix of ["", "/available"]) expect((await http.get(path + suffix)).status).toBe(403);
    await db.update(companyMemberships).set({ status: "active" }).where(eq(companyMemberships.id, f.membership.id));
    await expect(service.list(foreignId, f.owner)).rejects.toMatchObject({ status: 403 });
    await expect(service.available(randomUUID(), f.owner)).rejects.toMatchObject({ status: 403 });
    actor = { ...f.owner, companyIds: [companyId], source: "local_implicit" };
    expect((await http.get(path)).status).toBe(403);
    actor = { ...f.owner, companyIds: [companyId] };
    await db.update(companies).set({ status: "archived" }).where(eq(companies.id, companyId));
    for (const suffix of ["", "/available"]) expect((await http.get(path + suffix)).status).toBe(403);
    expect(await db.select().from(candidates).where(eq(candidates.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId))).toHaveLength(1);
    expect((await db.select().from(routines).where(eq(routines.id, f.routine.id)))[0].status).toBe("paused");
  } finally { await db.$client.end({ timeout: 1 }); }
});
