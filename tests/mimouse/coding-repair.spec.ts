import { expect, test, type APIRequestContext } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { agentWakeupRequests, heartbeatRuns, agents, authUsers, budgetPolicies, companies, companyMemberships, costEvents, executionWorkspaces, issues, projects, routineRuns, mimouseCodingDeliveries as deliveries, mimouseCodingRepairAttempts as attempts } from "../../packages/db/src/index.js";
import { createFixtureDb } from "./fixture-db.js";
import { secretService } from "../../server/src/services/secrets.js";
import { instanceSettingsService } from "../../server/src/services/instance-settings.js";
import { routineService } from "../../server/src/services/routines.js";
import { codingService } from "../../server/src/services/mimouse-coding/service.js";
import { codingRepairWorker } from "../../server/src/services/mimouse-coding/repair-worker.js";
import { createHeartbeatRetries, type HeartbeatRetryDependencies } from "../../server/src/services/heartbeat/retries.js";
import { codingRepairRunDeadlineElapsed } from "../../server/src/services/mimouse-coding/repair-deadline.js";
import { codingRepairService } from "../../server/src/services/mimouse-coding/repairs.js";
import { createRoutineSchema } from "../../packages/shared/src/validators/routine.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq, sql } = await import(require.resolve("drizzle-orm"));
const exec = promisify(execFile);
let oldFlag: string | undefined;
test.beforeEach(() => { oldFlag = process.env.PAPERCLIP_CODING_REPAIR_ENABLED; process.env.PAPERCLIP_CODING_REPAIR_ENABLED = "true"; });
test.afterEach(() => { if (oldFlag === undefined) delete process.env.PAPERCLIP_CODING_REPAIR_ENABLED; else process.env.PAPERCLIP_CODING_REPAIR_ENABLED = oldFlag; });
async function fixture(request: APIRequestContext) {
  const company = await (await request.post("/api/companies", { data: { name: `repair fixture ${Date.now()}` } })).json();
  const original = await (await request.post(`/api/companies/${company.id}/issues`, { data: { title: "Bounded repair source", status: "backlog" } })).json();
  const db = await createFixtureDb(); const settings = instanceSettingsService(db); const previous = (await settings.getExperimental()).enableIsolatedWorkspaces;
  try {
  await settings.updateExperimental({ enableIsolatedWorkspaces: true });
  const root = await mkdtemp(path.join(os.tmpdir(), "coding-repair-fixture-"));
  const git = (...args: string[]) => exec("git", args, { cwd: root });
  await git("init", "-b", "paperclip/repair"); await git("config", "user.name", "Fixture"); await git("config", "user.email", "fixture@example.invalid");
  await writeFile(path.join(root, "check.mjs"), "console.log('fixture only');\n"); await git("add", "."); await git("commit", "-m", "fixture"); const head = (await git("rev-parse", "HEAD")).stdout.trim();
  const owner = randomUUID(); await db.insert(authUsers).values({ id: owner, name: "Fixture owner", email: `${owner}@example.invalid`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: owner, status: "active", membershipRole: "owner" });
  const [project] = await db.insert(projects).values({ companyId: company.id, name: "Repair project" }).returning();
  const [agent] = await db.insert(agents).values({ companyId: company.id, name: "Fixture process", role: "qa", adapterType: "process", adapterConfig: { command: "/usr/bin/true", cwd: root, timeoutSec: 5 }, runtimeConfig: { heartbeat: { enabled: false } }, status: "idle", lifecycleState: "ready" }).returning();
  const [workspace] = await db.insert(executionWorkspaces).values({ companyId: company.id, projectId: project.id, sourceIssueId: original.id, mode: "isolated", strategyType: "git_worktree", name: "repair", providerType: "local_fs", status: "active", branchName: "paperclip/repair", repoUrl: "https://git.example/group/repo.git", cwd: root }).returning();
  await db.update(issues).set({ projectId: project.id, executionWorkspaceId: workspace.id, responsibleUserId: owner, createdByUserId: owner }).where(eq(issues.id, original.id));
  await db.insert(budgetPolicies).values({ companyId: company.id, scopeType: "project", scopeId: project.id, metric: "billed_cents", windowKind: "lifetime", amount: 10000, hardStopEnabled: true, unpricedUsagePolicy: "block" });
  const state = { wakeups: 0, cancellations: [] as string[], cancelUncertain: false, uncertain: false, pipelineId: 10, jobName: "unit-test", reason: "script_failure" };
  const heartbeat = { wakeup: async (agentId: string, opts: any) => {
    state.wakeups++; if (state.uncertain) throw Error("uncertain dispatch");
    const [wake] = await db.insert(agentWakeupRequests).values({ companyId: company.id, agentId, source: opts.source, triggerDetail: opts.triggerDetail, reason: opts.reason, requestedByActorType: opts.requestedByActorType ?? null, requestedByActorId: opts.requestedByActorId ?? null, status: "completed",
      idempotencyKey: opts.idempotencyKey, payload: opts.payload }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: company.id, agentId, scopeKind: "issue", issueId: opts.contextSnapshot.issueId,
      invocationSource: opts.source, triggerDetail: opts.triggerDetail, responsibleUserId: owner, wakeupRequestId: wake.id, status: "succeeded", startedAt: new Date(), finishedAt: new Date(), contextSnapshot: opts.contextSnapshot }).returning();
    await db.update(agentWakeupRequests).set({ runId: run.id }).where(eq(agentWakeupRequests.id, wake.id));
    return run; // Durable fixture receipts only; never execute an adapter.
  }, cancelRun: async (runId: string) => {
    state.cancellations.push(runId);
    if (state.cancelUncertain) throw Error("uncertain fixture cancellation");
    const [run] = await db.update(heartbeatRuns).set({ status: "cancelled", finishedAt: new Date(),
      resultJson: { executionCancellation: { state: "acknowledged", acknowledgedAt: new Date().toISOString() } } })
      .where(eq(heartbeatRuns.id, runId)).returning();
    return run;
  } };
  const routineSvc = routineService(db, { heartbeat });
  const routine = await routineSvc.create(company.id, createRoutineSchema.parse({ projectId: project.id, parentIssueId: original.id, title: "Reviewable coding repair", description: "Run the existing check, make the smallest fix, and return evidence. Never publish.", assigneeAgentId: agent.id, concurrencyPolicy: "always_enqueue" }), { userId: owner });
  const secret = await secretService(db).create(company.id, { name: "repair-fixture", provider: "local_encrypted", value: JSON.stringify({ token: "fixture-not-live" }) });
  const [delivery] = await db.insert(deliveries).values({ companyId: company.id, issueId: original.id, workspaceId: workspace.id, gitlabOrigin: "https://git.example", projectId: 1, secretRef: secret.id, baseSha: head, headSha: head, sourceBranch: "paperclip/repair", targetBranch: "main", mrIid: 1, operationState: "mr_created" }).returning();
  const fake = { mergeRequest: async () => ({ iid: 1, sha: head, state: "opened" }), pipelines: async () => [{ id: state.pipelineId, sha: head, status: "failed" }], pipeline: async () => ({ id: state.pipelineId, sha: head, status: "failed" }), jobs: async () => [{ id: 30, name: state.jobName, stage: "test", status: "failed", failureReason: state.reason, commitSha: head, pipelineId: state.pipelineId }] };
  const deps = { client: (() => fake) as any, heartbeat };
  const coding = codingService(db, deps); const repairs = codingRepairService(db, deps);
  const config = { enabled: true, confirm: true, headSha: head, routineId: routine.id, expectedRoutineRevisionId: routine.latestRevisionId, maxAttempts: 2, maxDurationMinutes: 15, maxCostCents: 100 };
  await coding.sync(company.id, delivery.id); await repairs.configure(company.id, delivery.id, config, owner);
  return { db, owner, company, original, project, agent, workspace, routine, routineSvc, delivery, state, deps, coding, repairs, config,
    cleanup: async () => { await db.update(agents).set({ status: "paused" }).where(eq(agents.id, agent.id)); await db.update(companies).set({ status: "paused" }).where(eq(companies.id, company.id)); await settings.updateExperimental({ enableIsolatedWorkspaces: previous }); await db.$client.end({ timeout: 1 }); } };
  } catch (error) {
    await db.update(companies).set({ status: "paused" }).where(eq(companies.id, company.id));
    await settings.updateExperimental({ enableIsolatedWorkspaces: previous }); await db.$client.end({ timeout: 1 }); throw error;
  }
}

test("bounded repair uses one real routine task, preserves workspace, and enforces repeated failure and attempt limits", async ({ request }) => {
  const f = await fixture(request);
  try {
    const [a, b] = await Promise.all([f.repairs.reserve(f.company.id, f.delivery.id), f.repairs.reserve(f.company.id, f.delivery.id)]); expect(a.id).toBe(b.id);
    expect((await f.db.select().from(attempts).where(eq(attempts.deliveryId, f.delivery.id)))).toHaveLength(1);
    const result = await f.repairs.dispatch(f.company.id, a.id); expect(result?.status).toBe("issue_created"); expect(f.state.wakeups).toBe(1);
    const [child] = await f.db.select().from(issues).where(eq(issues.id, result!.linkedIssueId!)); expect(child.parentId).toBe(f.original.id); expect(child.executionWorkspaceId).toBe(f.workspace.id); expect(child.responsibleUserId).toBe(f.owner);
    expect(child.description).toContain("untrusted diagnostic data"); expect(child.description).toContain(f.delivery.headSha);
    expect(await f.repairs.dispatch(f.company.id, a.id)).toBeNull(); expect(f.state.wakeups).toBe(1);
    await f.db.update(issues).set({ status: "done" }).where(eq(issues.id, child.id)); await codingRepairService(f.db, f.deps).reconcile(f.company.id, a.id);
    expect((await f.coding.load(f.company.id, f.delivery.id)).repairStatus).toBe("awaiting_review");
    f.state.pipelineId++; await f.coding.sync(f.company.id, f.delivery.id);
    await expect(f.repairs.reserve(f.company.id, f.delivery.id)).rejects.toThrow("repair_repeated_failure");
    f.state.pipelineId++; f.state.jobName = "different-test"; await f.coding.sync(f.company.id, f.delivery.id); await f.repairs.configure(f.company.id, f.delivery.id, f.config, f.owner);
    const second = await f.repairs.reserve(f.company.id, f.delivery.id); expect(second.attempt).toBe(2);
    await expect(f.repairs.configure(f.company.id, f.delivery.id, f.config, f.owner)).rejects.toThrow("repair_routine_or_attempt_limit_invalid"); expect(f.state.wakeups).toBe(1);
  } finally { await f.cleanup(); }
});

test("a changed routine revision fails before any repair wakeup, including the core pinned entry", async ({ request }) => {
  const f = await fixture(request);
  try {
    const attempt = await f.repairs.reserve(f.company.id, f.delivery.id);
    await f.routineSvc.update(f.routine.id, { description: "Changed after authorization", baseRevisionId: f.routine.latestRevisionId }, { userId: f.owner });
    expect(await f.repairs.dispatch(f.company.id, attempt.id)).toBeNull(); expect(f.state.wakeups).toBe(0);
    expect((await f.db.select().from(attempts).where(eq(attempts.id, attempt.id)))[0].state).toBe("blocked");
    await expect(f.routineSvc.runPipelineStageEntryRoutine(f.routine.id, { source: "api", expectedRevisionId: f.routine.latestRevisionId!, idempotencyKey: "stale-pin", projectId: f.project.id, executionWorkspaceId: f.workspace.id }, { userId: f.owner })).rejects.toThrow("Routine revision changed");
    expect(f.state.wakeups).toBe(0); expect(await f.db.select().from(routineRuns).where(eq(routineRuns.routineId, f.routine.id))).toHaveLength(0);
  } finally { await f.cleanup(); }
});

test("unknown routine dispatch is only reconciled, never dispatched again after restart", async ({ request }) => {
  const f = await fixture(request);
  try {
    const attempt = await f.repairs.reserve(f.company.id, f.delivery.id); f.state.uncertain = true;
    expect(await f.repairs.dispatch(f.company.id, attempt.id)).toBeNull(); expect(f.state.wakeups).toBe(1);
    const restarted = codingRepairService(f.db, f.deps); await restarted.reconcile(f.company.id, attempt.id); await restarted.dispatch(f.company.id, attempt.id);
    expect(f.state.wakeups).toBe(1); expect((await f.db.select().from(attempts).where(eq(attempts.id, attempt.id)))[0].state).toBe("indeterminate");
  } finally { await f.cleanup(); }
});

test("revoked ownership and disabled repair approval prevent dispatch without invoking a routine", async ({ request }) => {
  const f = await fixture(request);
  try {
    const attempt = await f.repairs.reserve(f.company.id, f.delivery.id);
    await f.repairs.configure(f.company.id, f.delivery.id, { enabled: false, confirm: true, headSha: f.delivery.headSha }, f.owner);
    await f.repairs.dispatch(f.company.id, attempt.id); expect(f.state.wakeups).toBe(0);
    await f.db.update(companyMemberships).set({ status: "inactive" }).where(eq(companyMemberships.principalId, f.owner));
    await expect(f.repairs.configure(f.company.id, f.delivery.id, f.config, f.owner)).rejects.toThrow("repair_owner_authority_unavailable");
  } finally { await f.cleanup(); }
});

test("expired approval and infrastructure failures do not start repair tasks", async ({ request }) => {
  const f = await fixture(request);
  try {
    f.state.reason = "runner_system_failure"; await expect(f.repairs.reserve(f.company.id, f.delivery.id)).rejects.toThrow("repair_environment_requires_operator");
    expect(await f.db.select().from(attempts).where(eq(attempts.deliveryId, f.delivery.id))).toHaveLength(0);
    f.state.reason = "script_failure"; const attempt = await f.repairs.reserve(f.company.id, f.delivery.id);
    const policy = { ...(attempt.snapshot.policy as Record<string, unknown>), approvedAt: new Date(Date.now() - 120000).toISOString(), expiresAt: new Date(Date.now() - 60000).toISOString() };
    await f.db.update(deliveries).set({ repairPolicy: policy }).where(eq(deliveries.id, f.delivery.id));
    await f.db.update(attempts).set({ snapshot: { ...attempt.snapshot, policy } }).where(eq(attempts.id, attempt.id));
    await f.repairs.dispatch(f.company.id, attempt.id); expect(f.state.wakeups).toBe(0);
    expect((await f.db.select().from(attempts).where(eq(attempts.id, attempt.id)))[0].lastCode).toBe("repair_approval_expired_or_disabled");
  } finally { await f.cleanup(); }
});

for (const unpriced of [false, true]) test(`repair dispatch stops after ${unpriced ? "unpriced usage" : "its own cumulative cost limit"}`, async ({ request }) => {
  const f = await fixture(request);
  try {
    const attempt = await f.repairs.reserve(f.company.id, f.delivery.id); const run = await f.repairs.dispatch(f.company.id, attempt.id); expect(run?.linkedIssueId).toBeTruthy();
    await f.db.update(issues).set({ status: "done" }).where(eq(issues.id, run!.linkedIssueId!)); await f.repairs.reconcile(f.company.id, attempt.id);
    await f.db.insert(costEvents).values({ companyId: f.company.id, agentId: f.agent.id, issueId: run!.linkedIssueId!, projectId: f.project.id, provider: "fixture", model: "fixture", costCents: unpriced ? 0 : 101, costStatus: unpriced ? "unpriced" : "reported", billingType: unpriced ? "unknown" : "metered_api", occurredAt: new Date() });
    f.state.pipelineId++; f.state.jobName = "another-check"; await f.coding.sync(f.company.id, f.delivery.id);
    await expect(f.repairs.reserve(f.company.id, f.delivery.id)).rejects.toThrow(unpriced ? "repair_budget_blocked" : "repair_limit"); expect(f.state.wakeups).toBe(1);
  } finally { await f.cleanup(); }
});

test("a repair of a private parent remains in the same private subtree", async ({ request }) => {
  const f = await fixture(request);
  try {
    await f.db.update(issues).set({ visibility: "private", privacyRootIssueId: f.original.id }).where(eq(issues.id, f.original.id));
    const attempt = await f.repairs.reserve(f.company.id, f.delivery.id); const run = await f.repairs.dispatch(f.company.id, attempt.id); expect(run?.linkedIssueId).toBeTruthy();
    const [child] = await f.db.select().from(issues).where(eq(issues.id, run!.linkedIssueId!)); expect(child.visibility).toBe("private"); expect(child.privacyRootIssueId).toBe(f.original.id); expect(child.executionWorkspaceId).toBe(f.workspace.id);
  } finally { await f.cleanup(); }
});

test("the automatic repair worker reserves and dispatches one durable routine despite competing workers", async ({ request }) => {
  const f = await fixture(request);
  try {
    const one = codingRepairWorker(f.db, f.deps), two = codingRepairWorker(f.db, f.deps);
    process.env.PAPERCLIP_CODING_REPAIR_ENABLED = "false"; expect(await one.tick(f.company.id)).toBe(false); process.env.PAPERCLIP_CODING_REPAIR_ENABLED = "true";
    await Promise.all([one.tick(f.company.id), two.tick(f.company.id)]);
    await Promise.all([one.tick(f.company.id), two.tick(f.company.id)]);
    const rows = await f.db.select().from(attempts).where(eq(attempts.deliveryId, f.delivery.id)); expect(rows).toHaveLength(1); expect(rows[0].state).toBe("dispatched"); expect(f.state.wakeups).toBe(1);
    const view = await request.get(`/api/companies/${f.company.id}/coding/${f.delivery.id}/repairs`); expect(view.ok()).toBe(true); const body = await view.json(); expect(body.attempts).toHaveLength(1); expect(JSON.stringify(body)).not.toContain("fixture-not-live");
  } finally { await f.cleanup(); }
});

test("repair service and composite foreign key reject another company's delivery without a wakeup", async ({ request }) => {
  const f = await fixture(request);
  try {
    const otherResponse = await request.post("/api/companies", { data: { name: `Other isolated repair company ${randomUUID()}` } });
    expect(otherResponse.ok()).toBe(true); const other = await otherResponse.json();
    await f.db.update(companies).set({ status: "paused" }).where(eq(companies.id, other.id));
    await expect(f.repairs.configure(other.id, f.delivery.id, f.config, f.owner)).rejects.toThrow("delivery_not_found");
    await expect(f.repairs.reserve(other.id, f.delivery.id)).rejects.toThrow("delivery_not_found");
    const attempt = await f.repairs.reserve(f.company.id, f.delivery.id);
    expect(await f.repairs.dispatch(other.id, attempt.id)).toBeNull();
    expect((await f.db.select().from(attempts).where(eq(attempts.id, attempt.id)))[0].state).toBe("reserved");
    await expect(f.db.insert(attempts).values({ ...attempt, id: randomUUID(), companyId: other.id, attempt: 99, pipelineId: 9999, requestKey: randomUUID() })).rejects.toMatchObject({ cause: { code: "23503", constraint_name: "mimouse_repair_delivery_company_fk" } });
    expect(f.state.wakeups).toBe(0);
    expect(await f.db.select().from(attempts).where(eq(attempts.deliveryId, f.delivery.id))).toHaveLength(1);
  } finally { await f.cleanup(); }
});


test("deadline survives task done, worker disable, and uncertain stop restart without touching a later user run", async ({ request }) => {
  const f = await fixture(request);
  try {
    const attempt = await f.repairs.reserve(f.company.id, f.delivery.id); const result = await f.repairs.dispatch(f.company.id, attempt.id);
    const [run] = await f.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.issueId, result!.linkedIssueId!));
    await f.db.update(heartbeatRuns).set({ status: "running", finishedAt: null }).where(eq(heartbeatRuns.id, run.id));
    await f.db.update(issues).set({ status: "done" }).where(eq(issues.id, result!.linkedIssueId!));
    await f.repairs.reconcile(f.company.id, attempt.id);
    expect((await f.db.select().from(attempts).where(eq(attempts.id, attempt.id)))[0].state).toBe("dispatched");
    const [current] = await f.db.select().from(attempts).where(eq(attempts.id, attempt.id));
    const policy = { ...current.snapshot.policy as Record<string, unknown>, approvedAt: new Date(Date.now() - 120000).toISOString(), expiresAt: new Date(Date.now() - 60000).toISOString() };
    await f.db.update(attempts).set({ snapshot: { ...current.snapshot, policy }, updatedAt: new Date(Date.now() - 60000) }).where(eq(attempts.id, attempt.id));
    process.env.PAPERCLIP_CODING_REPAIR_ENABLED = "false"; f.state.cancelUncertain = true;
    await codingRepairWorker(f.db, f.deps).tick(f.company.id);
    const [pending] = await f.db.select().from(attempts).where(eq(attempts.id, attempt.id));
    expect(pending.state).toBe("deadline_stopping"); expect(pending.snapshot.deadline).toMatchObject({ runId: run.id, state: "stop_requested", remoteStopVerified: false });
    const [manual] = await f.db.insert(heartbeatRuns).values({ companyId: f.company.id, agentId: f.agent.id, scopeKind: "issue", issueId: result!.linkedIssueId!, status: "scheduled_retry", scheduledRetryAt: new Date(Date.now() + 86400000), contextSnapshot: { issueId: result!.linkedIssueId!, source: "fixture.manual" } }).returning();
    f.state.cancelUncertain = false;
    await codingRepairService(f.db, f.deps).reconcile(f.company.id, attempt.id);
    expect(f.state.cancellations).toEqual([run.id, run.id]); expect(f.state.wakeups).toBe(1);
    expect((await f.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, manual.id)))[0].status).toBe("scheduled_retry");
    const [stopped] = await f.db.select().from(attempts).where(eq(attempts.id, attempt.id));
    expect(stopped.state).toBe("deadline_stopped"); expect(stopped.snapshot.deadline).toMatchObject({ state: "local_stop_verified", runId: run.id, descendantsStopVerified: false });
    const view = await request.get(`/api/companies/${f.company.id}/coding/${f.delivery.id}/repairs`);
    expect((await view.json()).attempts[0].deadline).toMatchObject({ state: "local_stop_verified", scope: "initial_repair_run_only" });
    await f.db.update(heartbeatRuns).set({ status: "cancelled", finishedAt: new Date() }).where(eq(heartbeatRuns.id, manual.id));
  } finally { await f.cleanup(); }
});


test("automatic retry chain keeps the absolute deadline and exact stop identities across restart", async ({ request }) => {
  const f = await fixture(request);
  try {
    const attempt = await f.repairs.reserve(f.company.id, f.delivery.id); const result = await f.repairs.dispatch(f.company.id, attempt.id);
    const [initial] = await f.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.issueId, result!.linkedIssueId!));
    const [source] = await f.db.update(heartbeatRuns).set({ status: "failed", errorCode: "process_lost", resultJson: { executionRecovery: { kind: "bootstrap", providerWorkStarted: false } } }).where(eq(heartbeatRuns.id, initial.id)).returning();
    const retries = createHeartbeatRetries(f.db, {
      getAgentInvokability: async () => ({ invokable: true }), resolveSessionBeforeForWakeup: async () => null,
      resolveResponsibleUserIdForRunContext: async () => f.owner, appendRunEvent: async () => {},
    } as unknown as HeartbeatRetryDependencies);
    const scheduled = await retries.scheduleBoundedRetryForRun(source, f.agent, { delayMs: 1000, maxAttempts: 3 });
    expect(scheduled.outcome).toBe("scheduled"); if (scheduled.outcome !== "scheduled") throw Error("fixture retry not created");
    const [child] = await f.db.update(heartbeatRuns).set({ status: "failed", errorCode: "process_lost", resultJson: source.resultJson }).where(eq(heartbeatRuns.id, scheduled.run.id)).returning();
    const second = await retries.scheduleBoundedRetryForRun(child, f.agent, { delayMs: 1000, maxAttempts: 3 });
    expect(second.outcome).toBe("scheduled"); if (second.outcome !== "scheduled") throw Error("second-hop retry not created");
    const [grandchild] = await f.db.update(heartbeatRuns).set({ status: "running", startedAt: new Date() }).where(eq(heartbeatRuns.id, second.run.id)).returning();
    await f.db.update(issues).set({ status: "done" }).where(eq(issues.id, result!.linkedIssueId!));
    await f.repairs.reconcile(f.company.id, attempt.id);
    const [current] = await f.db.select().from(attempts).where(eq(attempts.id, attempt.id));
    expect(current.state).toBe("dispatched");
    const policy = { ...current.snapshot.policy as Record<string, unknown>, approvedAt: new Date(Date.now() - 120000).toISOString(), expiresAt: new Date(Date.now() - 60000).toISOString() };
    await f.db.update(attempts).set({ snapshot: { ...current.snapshot, policy } }).where(eq(attempts.id, attempt.id));
    expect(await codingRepairRunDeadlineElapsed(f.db, grandchild)).toBe(true);
    const denied = await retries.scheduleBoundedRetryForRun(grandchild, f.agent, { delayMs: 1, maxAttempts: 4 });
    expect(denied.outcome).toBe("not_scheduled");
    const [manual] = await f.db.insert(heartbeatRuns).values({ companyId: f.company.id, agentId: f.agent.id, scopeKind: "issue", issueId: child.issueId,
      status: "scheduled_retry", invocationSource: "on_demand", triggerDetail: "manual", retryOfRunId: source.id,
      contextSnapshot: { ...child.contextSnapshot }, scheduledRetryAt: new Date(Date.now() + 86400000) }).returning();
    const untouched: string[] = [manual.id];
    for (const bad of ["forged_actor", "coalesced"]) {
      const id = randomUUID();
      const [originalWake] = await f.db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, scheduled.run.wakeupRequestId!));
      const [wake] = await f.db.insert(agentWakeupRequests).values({ ...originalWake, id: randomUUID(), runId: id,
        requestedByActorType: bad === "forged_actor" ? "user" : "system" }).returning();
      const [unowned] = await f.db.insert(heartbeatRuns).values({ ...scheduled.run, id, wakeupRequestId: wake.id }).returning();
      if (bad === "coalesced") await f.db.insert(agentWakeupRequests).values({ ...wake, id: randomUUID(), requestedByActorType: "user" });
      expect(await codingRepairRunDeadlineElapsed(f.db, unowned)).toBe(false); untouched.push(id);
    }
    f.state.cancelUncertain = true; await f.repairs.reconcile(f.company.id, attempt.id);
    const [pending] = await f.db.select().from(attempts).where(eq(attempts.id, attempt.id));
    expect(pending.state).toBe("deadline_stopping");
    expect(pending.snapshot.deadline).toMatchObject({ scope: "verified_automatic_repair_retries", runs: [
      { runId: source.id, state: "execution_terminal" }, { runId: child.id, state: "execution_terminal" }, { runId: grandchild.id, state: "stop_requested" },
    ] });
    f.state.cancelUncertain = false; await codingRepairService(f.db, f.deps).reconcile(f.company.id, attempt.id);
    expect(f.state.cancellations).toEqual([grandchild.id, grandchild.id]);
    expect((await f.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, manual.id)))[0].status).toBe("scheduled_retry");
    const [stopped] = await f.db.select().from(attempts).where(eq(attempts.id, attempt.id));
    expect(stopped.state).toBe("deadline_unverified");
    expect(stopped.snapshot.deadline).toMatchObject({ lineageComplete: false, remoteStopVerified: false, descendantsStopVerified: false });
    const view = await request.get(`/api/companies/${f.company.id}/coding/${f.delivery.id}/repairs`);
    expect((await view.json()).attempts[0].deadline).toMatchObject({ scope: "verified_automatic_repair_retries", lineageComplete: false,
      runs: [{ runId: source.id }, { runId: child.id }, { runId: grandchild.id, state: "local_stop_verified" }] });
    for (const id of untouched) {
      expect((await f.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, id)))[0].status).toBe("scheduled_retry");
      await f.db.update(heartbeatRuns).set({ status: "cancelled", finishedAt: new Date() }).where(eq(heartbeatRuns.id, id));
    }
  } finally { await f.cleanup(); }
});


for (const closure of ["deadline", "completed"] as const) {
  test(`retry admission cannot pass concurrent ${closure} reconciliation`, async ({ request }) => {
    const f = await fixture(request); let release: (() => void) | undefined; let holder: Promise<unknown> | undefined; let pending: Promise<unknown> | undefined;
    try {
      const attempt = await f.repairs.reserve(f.company.id, f.delivery.id); const result = await f.repairs.dispatch(f.company.id, attempt.id);
      const [initial] = await f.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.issueId, result!.linkedIssueId!));
      const [source] = await f.db.update(heartbeatRuns).set({ status: "failed", errorCode: "process_lost", resultJson: { executionRecovery: { kind: "bootstrap", providerWorkStarted: false } } }).where(eq(heartbeatRuns.id, initial.id)).returning();
      let acquired!: (pid: number) => void;
      const ready = new Promise<number>(resolve => { acquired = resolve; });
      const wait = new Promise<void>(resolve => { release = resolve; });
      await f.db.update(issues).set({ status: "done" }).where(eq(issues.id, result!.linkedIssueId!));
      holder = f.db.transaction(async tx => {
        await tx.select().from(issues).where(eq(issues.id, result!.linkedIssueId!)).for("update");
        const [backend] = await tx.execute(sql`select pg_backend_pid()::int as pid`); acquired(Number(backend.pid));
        await wait;
      });
      const pid = await ready;
      const retries = createHeartbeatRetries(f.db, {
        getAgentInvokability: async () => ({ invokable: true }), resolveSessionBeforeForWakeup: async () => null,
        resolveResponsibleUserIdForRunContext: async () => f.owner, appendRunEvent: async () => {},
      } as unknown as HeartbeatRetryDependencies);
      pending = retries.scheduleBoundedRetryForRun(source, f.agent, { delayMs: 1 });
      void pending.catch(() => {});
      await expect.poll(async () => {
        const [row] = await f.db.execute(sql`select count(*)::int as waiting from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`);
        return Number(row.waiting);
      }, { timeout: 10000 }).toBeGreaterThan(0);
      if (closure === "deadline") {
        const [current] = await f.db.select().from(attempts).where(eq(attempts.id, attempt.id));
        const policy = { ...current.snapshot.policy as Record<string, unknown>, approvedAt: new Date(Date.now() - 120000).toISOString(), expiresAt: new Date(Date.now() - 60000).toISOString() };
        await f.db.update(attempts).set({ snapshot: { ...current.snapshot, policy } }).where(eq(attempts.id, attempt.id));
      }
      await f.repairs.reconcile(f.company.id, attempt.id);
      expect((await f.db.select().from(attempts).where(eq(attempts.id, attempt.id)))[0].state).toBe(closure === "deadline" ? "deadline_stopped" : "completed");
      release(); await holder;
      expect(await pending).toMatchObject({ outcome: "not_scheduled", errorCode: "coding_repair_retry_blocked" });
      expect(await f.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.retryOfRunId, source.id))).toHaveLength(0);
    } finally { release?.(); await holder; await pending?.catch(() => {}); await f.cleanup(); }
  });
}
