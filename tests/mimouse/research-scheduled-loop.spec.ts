import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  activityLog, agents, authUsers, companyMemberships, heartbeatRuns, issueRelations, issues,
  mimouseResearchCandidates, mimouseResearchPromotions, projects, routineRuns, routines, routineTriggers,
} from "../../packages/db/src/index.js";
import { createFixtureDb } from "./fixture-db.js";
import { createLocalAgentJwt } from "../../server/src/agent-auth-jwt.js";
import { actorMiddleware } from "../../server/src/middleware/auth.js";
import { mimouseResearchRoutineRoutes } from "../../server/src/routes/mimouse-research-routines.js";
import { accessService } from "../../server/src/services/access.js";
import { researchCandidateService } from "../../server/src/services/mimouse-research/service.js";
import { researchRoutineService } from "../../server/src/services/mimouse-research-routines/service.js";
import { routineService } from "../../server/src/services/routines.js";

const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { and, eq, lte } = await import(require.resolve("drizzle-orm"));

/**
 * C2 seam test: real routine scheduling, origin links, JWT middleware, report
 * route and human promotion. Only heartbeat execution is replaced with an
 * inert DB receipt. No adapter, model, source fetch or second cron is invoked.
 * Run on a new disposable fixture DB: the scheduler intentionally scans all
 * companies, so this test refuses to tick if another due schedule is present.
 */
test("scheduled routine report reaches one reviewed private task through real origin links and signed HTTP", async ({ request }) => {
  const response = await request.post("/api/companies", { data: { name: "Scheduled research C2 fixture" } });
  expect(response.status(), await response.text()).toBe(201);
  const companyId = (await response.json()).id as string;
  const db = await createFixtureDb();
  const previousJwtSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
  let routineId: string | undefined;
  let agentId: string | undefined;
  try {
    const userId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "Research C2 reviewer", email: `${userId}@fixture.invalid`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
    await accessService(db).ensureRoleDefaultGrants(companyId, userId, "owner", userId);
    const [agent] = await db.insert(agents).values({ companyId, name: "Inert scheduled research boundary", status: "idle", adapterType: "process",
      adapterConfig: {}, runtimeConfig: { heartbeat: { enabled: false } } }).returning();
    agentId = agent.id;
    const [project] = await db.insert(projects).values({ companyId, name: "Company-open C2 sources", visibility: "open", status: "in_progress" }).returning();
    const owner = { type: "board" as const, source: "session" as const, userId };
    const wakeups: Array<{ agentId: string; issueId: string; runId: string }> = [];
    const scheduler = routineService(db, {
      runtimeEnv: {},
      heartbeat: {
        wakeup: async (wakeupAgentId, options) => {
          // Fail rather than invoke an unrelated company's real execution.
          expect(wakeupAgentId).toBe(agent.id);
          expect(options.contextSnapshot?.source).toBe("routine.dispatch");
          expect(options.requestedByActorType).toBe("system");
          const issueId = options.payload?.issueId;
          expect(typeof issueId).toBe("string");
          if (typeof issueId !== "string") throw new Error("Routine omitted its execution issue");
          const [issue] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId)));
          expect(issue).toMatchObject({ companyId, originKind: "routine_execution", originId: routineId, responsibleUserId: userId });
          // This is the only simulated execution state. Scheduler-created
          // routineRun, issue and their provenance are never hand-inserted.
          const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent.id, scopeKind: "issue", issueId,
            status: "running", startedAt: new Date(), responsibleUserId: userId, invocationSource: options.source,
            triggerDetail: options.triggerDetail, contextSnapshot: { ...options.contextSnapshot, issueId } }).returning();
          await db.update(issues).set({ executionRunId: run.id, executionLockedAt: new Date() }).where(eq(issues.id, issueId));
          wakeups.push({ agentId: agent.id, issueId, runId: run.id });
          return { id: run.id };
        },
      },
    });
    const routine = await scheduler.create(companyId, {
      projectId: project.id, goalId: null, parentIssueId: null, title: "Scheduled research fixture",
      description: "C2 only: submit the labelled fixture evidence; never fetch a URL or invoke a model.",
      assigneeAgentId: agent.id, priority: "medium", status: "paused", concurrencyPolicy: "coalesce_if_active", catchUpPolicy: "skip_missed",
    }, { userId });
    routineId = routine.id;
    const { trigger } = await scheduler.createTrigger(routine.id, { kind: "schedule", cronExpression: "0 9 * * *", timezone: "Asia/Shanghai", enabled: true }, { userId });
    // Future nextRunAt keeps the API server's wall-clock scheduler away from
    // this fixture; only the injected scheduler receives this future clock.
    const dueAt = new Date("2099-01-01T01:00:00.000Z");
    expect(Date.now()).toBeLessThan(dueAt.getTime());
    await db.update(routineTriggers).set({ nextRunAt: dueAt }).where(eq(routineTriggers.id, trigger.id));
    async function assertOnlyFixtureSchedule() {
      const due = await db.select({ id: routineTriggers.id }).from(routineTriggers).innerJoin(routines, eq(routines.id, routineTriggers.routineId))
        .where(and(eq(routineTriggers.kind, "schedule"), eq(routineTriggers.enabled, true), eq(routineTriggers.archived, false),
          eq(routines.status, "active"), lte(routineTriggers.nextRunAt, dueAt)));
      expect(due.filter(row => row.id !== trigger.id), "Refusing to tick another fixture's schedule; use a fresh isolated DB").toEqual([]);
    }
    await assertOnlyFixtureSchedule();
    expect(await scheduler.tickScheduledTriggers(dueAt)).toEqual({ triggered: 0 });
    expect(wakeups).toHaveLength(0);
    const research = researchRoutineService(db);
    await research.bind(companyId, routine.id, owner, { product: "Fixture product", enabled: false });
    await scheduler.update(routine.id, { status: "active" }, { userId });
    await assertOnlyFixtureSchedule();
    expect(await scheduler.tickScheduledTriggers(dueAt)).toEqual({ triggered: 1 });
    // Same scheduled instant is claimed once; restart of the service object
    // is unnecessary because the ownership is persisted in nextRunAt.
    await assertOnlyFixtureSchedule();
    expect(await scheduler.tickScheduledTriggers(dueAt)).toEqual({ triggered: 0 });
    expect(wakeups).toHaveLength(1);
    const [{ issueId, runId }] = wakeups;
    const [scheduled] = await db.select().from(routineRuns).where(and(eq(routineRuns.companyId, companyId), eq(routineRuns.routineId, routine.id)));
    expect(scheduled).toMatchObject({ source: "schedule", status: "issue_created", triggerId: trigger.id, linkedIssueId: issueId });
    const [execution] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(execution).toMatchObject({ originKind: "routine_execution", originId: routine.id, originRunId: scheduled.id,
      visibility: "open", projectId: project.id, assigneeAgentId: agent.id, executionRunId: runId });
    const [advanced] = await db.select().from(routineTriggers).where(eq(routineTriggers.id, trigger.id));
    expect(advanced.nextRunAt?.toISOString()).toBe("2099-01-02T01:00:00.000Z");

    // This process owns only a synthetic signing key; the running API server
    // is not reconfigured. Exercise the real middleware on a local test app.
    process.env.PAPERCLIP_AGENT_JWT_SECRET = `research-c2-${randomUUID()}`;
    const token = createLocalAgentJwt(agent.id, companyId, "process", runId, userId);
    expect(token).not.toBeNull();
    const { default: express } = await import(require.resolve("express"));
    const { default: supertest } = await import(require.resolve("supertest"));
    const app = express(); app.use(express.json());
    app.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
    app.use("/api", mimouseResearchRoutineRoutes(db));
    app.use((error: { status?: number; message?: string }, _req: unknown, res: { status(code: number): { json(body: unknown): void } }, _next: unknown) => {
      res.status(error.status ?? 500).json({ error: error.message });
    });
    const http = supertest(app), path = `/api/companies/${companyId}/research-routines/${routine.id}/reports`;
    const report = { routineRunId: scheduled.id, issueId, title: "Labelled C2 source report", product: "Fixture product",
      currentState: "Manual review", proposedState: "Traceable reviewed task", recommendation: "Review this fixture, not external claims",
      sources: [{ url: "https://example.invalid/research-c2", retrievedAt: new Date().toISOString(), product: "Fixture product",
        evidence: "Synthetic C2 evidence; this URL was never fetched", gap: "No linked reviewed task", suggestion: "Confirm scope and dependency" }] };
    const send = (body = report) => http.post(path).set("Authorization", `Bearer ${token}`).send(body);
    expect((await send()).status).toBe(403); // Explicit report acceptance is still disabled.
    expect(await db.select().from(mimouseResearchCandidates).where(eq(mimouseResearchCandidates.companyId, companyId))).toHaveLength(0);
    await research.bind(companyId, routine.id, owner, { product: "Fixture product", enabled: true });
    expect((await http.post(path).set("Authorization", `Bearer ${token}`).set("X-Paperclip-Run-Id", randomUUID()).send(report)).status).toBe(422);
    expect((await send({ ...report, routineRunId: randomUUID() })).status).toBe(404);
    const first = await send(); expect(first.status, JSON.stringify(first.body)).toBe(201);
    const replay = await send(); expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body.candidateId).toBe(first.body.candidateId);
    expect((await send({ ...report, recommendation: "Changed replay" })).status).toBe(409);
    const candidates = researchCandidateService(db);
    const candidate = await candidates.get(companyId, first.body.candidateId);
    expect(candidate.evidence).toMatchObject({ evidenceMode: "agent_report", provenance: { companyId, routineId: routine.id,
      routineRunId: scheduled.id, issueId, runId, agentId: agent.id, sourceVerification: "agent_report", disposition: "quarantined" } });
    expect(await db.select().from(mimouseResearchPromotions).where(eq(mimouseResearchPromotions.companyId, companyId))).toHaveLength(0);
    const review = { requestId: randomUUID(), confirm: true as const, expectedEvidenceHash: candidate.evidenceHash,
      title: "Human-reviewed C2 development candidate", scope: "Implement only the reviewed fixture gap",
      expectedBenefit: "Reduce manual coordination (unverified hypothesis)", acceptanceCriteria: ["Retain the source reference", "Honor the prerequisite"], dependencyIssueIds: [issueId] };
    const promoted = await candidates.promote(companyId, candidate.id, userId, review);
    expect(await candidates.promote(companyId, candidate.id, userId, review)).toEqual(promoted);
    const [task] = await db.select().from(issues).where(eq(issues.id, promoted.issueId));
    expect(task).toMatchObject({ visibility: "private", status: "backlog", responsibleUserId: userId, assigneeAgentId: null,
      assigneeUserId: null, sourceTrust: { preset: "low_trust_review", disposition: "quarantined" } });
    for (const value of [candidate.evidenceHash, scheduled.id, runId, review.scope, review.expectedBenefit, ...review.acceptanceCriteria]) expect(task.description).toContain(value);
    expect(await db.select().from(issueRelations).where(and(eq(issueRelations.issueId, issueId), eq(issueRelations.relatedIssueId, task.id), eq(issueRelations.type, "blocks")))).toHaveLength(1);
    expect(await db.select().from(mimouseResearchPromotions).where(eq(mimouseResearchPromotions.companyId, companyId))).toHaveLength(1);
    expect(await db.select().from(mimouseResearchCandidates).where(eq(mimouseResearchCandidates.companyId, companyId))).toHaveLength(1);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId))).toHaveLength(1);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.companyId, companyId), eq(activityLog.action, "research.report_received")))).toHaveLength(1);
    expect(wakeups).toHaveLength(1); // Human confirmation never dispatches development.
    await db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, runId));
    expect((await send()).status).toBe(403); // Terminal run cannot replay a report write.
  } finally {
    if (previousJwtSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET;
    else process.env.PAPERCLIP_AGENT_JWT_SECRET = previousJwtSecret;
    try {
      if (routineId) {
        await db.update(routineTriggers).set({ enabled: false }).where(eq(routineTriggers.routineId, routineId));
        await db.update(routines).set({ status: "paused" }).where(eq(routines.id, routineId));
      }
      if (agentId) await db.update(agents).set({ status: "paused" }).where(eq(agents.id, agentId));
      await db.update(heartbeatRuns).set({ status: "cancelled", finishedAt: new Date() }).where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.status, "running")));
    } finally { await db.$client.end({ timeout: 1 }); }
  }
});
