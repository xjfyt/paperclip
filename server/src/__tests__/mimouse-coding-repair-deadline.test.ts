import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { agentWakeupRequests as wakes, heartbeatRuns as runs, issues, routineRuns,
  mimouseCodingDeliveries as deliveries, mimouseCodingRepairAttempts as attempts, type Db } from "@paperclipai/db";
import { codingRepairInitialExecutionPending, codingRepairRunDeadlineElapsed, isDedicatedCodingRepairRun, repairDeadlineElapsed, repairRunStopEvidence, stopExpiredCodingRepair } from "../services/mimouse-coding/repair-deadline.js";

// Query-chain fixture: no provider, real agent, process, database, or external request.
// SQL predicates are inspected separately; this is not a PostgreSQL integration proof.
function fixture() {
  const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), routineId = randomUUID(), routineRunId = randomUUID(), workspaceId = randomUUID(), runId = randomUUID(), wakeId = randomUUID();
  const policy = { enabled: true, revision: randomUUID(), headSha: "a".repeat(40), routineId, routineRevisionId: randomUUID(), ownerUserId: "owner", agentId,
    agentConfigHash: "a".repeat(64), maxAttempts: 2, maxCostCents: 10, approvedAt: new Date(Date.now() - 120000).toISOString(), expiresAt: new Date(Date.now() - 60000).toISOString() };
  const attempt = { id: randomUUID(), companyId, deliveryId: randomUUID(), routineId, routineRevisionId: policy.routineRevisionId, routineRunId, issueId, requestKey: randomUUID(), state: "dispatched", lease: null, leaseExpiresAt: null,
    snapshot: { policy } } as unknown as typeof attempts.$inferSelect;
  attempt.snapshot.dispatch = { version: 1, issueId, agentId, workspaceId, wakeKey: `${attempt.requestKey}:initial` };
  const issue = { id: issueId, companyId, originKind: "routine_execution", originId: routineId, originRunId: routineRunId, assigneeAgentId: agentId, responsibleUserId: "owner", executionWorkspaceId: workspaceId };
  const routine = { id: routineRunId, companyId, routineId, routineRevisionId: policy.routineRevisionId, linkedIssueId: issueId, source: "api", idempotencyKey: attempt.requestKey };
  const wake = { id: wakeId, companyId, agentId, idempotencyKey: `${attempt.requestKey}:initial`, payload: { issueId }, runId: runId as string | null, status: "claimed" };
  const run = { id: runId, companyId, agentId, wakeupRequestId: wakeId, contextSnapshot: { issueId, codingRepairAttemptId: attempt.id }, status: "running", startedAt: new Date(), resultJson: {} } as unknown as typeof runs.$inferSelect;
  const delivery: Record<string, unknown> = {}; const predicates: { sql: string; params: unknown[] }[] = [];
  const state = { otherWake: false, missingWake: false, claimLost: false };
  const dialect = new PgDialect();
  const db = {
    select: () => ({ from: (table: unknown) => {
      let query = { sql: "", params: [] as unknown[] };
      const chain = { where: (predicate: any) => { query = dialect.sqlToQuery(predicate); predicates.push(query); return chain; }, limit: () => chain,
        then: (resolve: any, reject: any) => Promise.resolve(table === attempts ? [attempt] : table === issues ? [issue] : table === routineRuns ? [routine] : table === runs ? [run] : table === wakes ? query.sql.includes(" <>") ? state.otherWake ? [{ id: "manual" }] : [] : state.missingWake ? [] : [wake] : []).then(resolve, reject) };
      return chain;
    } }),
    update: (table: unknown) => ({ set: (patch: any) => ({ where: (predicate: any) => {
      predicates.push(dialect.sqlToQuery(predicate));
      const execute = () => {
        if (table === attempts && patch.state === "deadline_stopping" && patch.lease && (state.claimLost || attempt.lease && attempt.leaseExpiresAt!.getTime() > Date.now())) return [];
        Object.assign(table === attempts ? attempt : table === wakes ? wake : delivery, patch);
        return [table === attempts ? { ...attempt } : { ...wake }];
      };
      return { returning: async () => execute(), then: (resolve: any, reject: any) => Promise.resolve(execute()).then(resolve, reject) };
    } }) }),
    transaction: async (fn: any) => fn(db),
  } as unknown as Db;
  return { db, attempt, policy, issue, wake, run, delivery, state, predicates };
}

describe("bounded coding repair deadline receipts", () => {
  it("wires async preflight before the final synchronous handoff and isolates all coalesce paths", () => {
    const heartbeat = readFileSync(new URL("../services/heartbeat.ts", import.meta.url), "utf8");
    const boundary = heartbeat.slice(heartbeat.indexOf("const dispatchResolvedInteractionContinuationWithAtomicGate ="), heartbeat.indexOf("if (!executionTarget || executionTarget.kind"));
    expect(boundary.indexOf("await reserveRunBudget")).toBeLessThan(boundary.indexOf("await codingRepairRunDeadlineElapsed"));
    expect(boundary.indexOf("await codingRepairRunDeadlineElapsed")).toBeLessThan(boundary.indexOf("return await dispatchResolvedInteractionContinuationAfterAdmission"));
    expect(boundary).toContain("(markDispatchStarted) => {\n            entered = true;\n            return dispatch(markDispatchStarted);");
    const queue = readFileSync(new URL("../services/heartbeat/queue.ts", import.meta.url), "utf8");
    expect(queue).toContain("&& !isDedicatedCodingRepairRun(activeExecutionRun)");
    expect(queue).toContain("isConversation(issue) || isDedicatedCodingRepairRun(activeExecutionRun) ? false");
    expect(queue).toContain("isDedicatedCodingRepairRun(rawCoalescedTarget) ? null : rawCoalescedTarget");
  });
  it("uses the persisted approval expiry, including the exact boundary", () => {
    const f = fixture(); const expires = Date.parse(f.policy.expiresAt);
    expect(repairDeadlineElapsed(f.attempt, expires - 1)).toBe(false);
    expect(repairDeadlineElapsed(f.attempt, expires)).toBe(true);
    f.attempt.snapshot.policy = { ...f.policy, expiresAt: "invalid" };
    expect(repairDeadlineElapsed(f.attempt)).toBe(true);
  });
  it("leaves a valid dispatch window untouched", async () => {
    const f = fixture(); f.policy.approvedAt = new Date().toISOString(); f.policy.expiresAt = new Date(Date.now() + 60000).toISOString(); const cancel = vi.fn();
    expect(await stopExpiredCodingRepair(f.db, f.attempt, cancel)).toBe(false); expect(cancel).not.toHaveBeenCalled(); expect(f.predicates).toHaveLength(0);
  });
  it("persists exact-run stop intent before requesting cancellation and requires acknowledgement", async () => {
    const f = fixture(); const cancel = vi.fn(async (id: string) => {
      expect(id).toBe(f.run.id); expect(f.attempt.snapshot.deadline).toMatchObject({ runId: id, state: "stop_requested", scope: "initial_repair_run_only" });
      f.run.status = "cancelled"; f.run.resultJson = { executionCancellation: { state: "acknowledged" } };
    });
    await stopExpiredCodingRepair(f.db, f.attempt, cancel);
    expect(cancel).toHaveBeenCalledWith(f.run.id, expect.any(String), expect.objectContaining({ suppressImmediateRecovery: true }));
    expect(f.attempt.state).toBe("deadline_stopped"); expect(f.attempt.snapshot.deadline).toMatchObject({ state: "local_stop_verified", remoteStopVerified: false, descendantsStopVerified: false });
    expect(f.delivery.repairStatus).toBe("needs_human");
    expect(f.predicates.filter(p => p.sql.includes('"company_id"')).every(p => p.params.includes(f.attempt.companyId))).toBe(true);
  });
  it("does not equate a cancelled database row with provider termination", async () => {
    const f = fixture(); await stopExpiredCodingRepair(f.db, f.attempt, async () => { f.run.status = "cancelled"; });
    expect(f.attempt.state).toBe("deadline_unverified"); expect(f.attempt.snapshot.deadline).not.toHaveProperty("stopVerifiedAt");
  });
  it("restarts an unknown cancellation only against the persisted exact run", async () => {
    const f = fixture(); const cancel = vi.fn(async () => { throw Error("unknown outcome"); });
    await stopExpiredCodingRepair(f.db, f.attempt, cancel); const first = (f.attempt.snapshot.deadline as any).stopRequestedAt;
    expect(f.attempt.state).toBe("deadline_stopping"); expect(f.attempt.lastCode).toBe("repair_deadline_stop_unconfirmed");
    await stopExpiredCodingRepair(f.db, f.attempt, async id => { expect(id).toBe(f.run.id); f.run.status = "cancelled"; f.run.resultJson = { executionCancellation: { state: "acknowledged" } }; });
    expect(f.attempt.state).toBe("deadline_stopped"); expect((f.attempt.snapshot.deadline as any).stopRequestedAt).toBe(first);
  });
  it("never follows a replacement run after an unknown stop request", async () => {
    const f = fixture(); f.attempt.snapshot.deadline = { runId: randomUUID(), stopRequestedAt: new Date().toISOString() }; const cancel = vi.fn();
    await stopExpiredCodingRepair(f.db, f.attempt, cancel); expect(cancel).not.toHaveBeenCalled(); expect(f.attempt.lastCode).toBe("repair_deadline_ownership_unverified");
  });
  it.each(["assignee", "owner", "workspace", "origin", "manual_wake", "missing_wake", "legacy_binding"])("does not cancel when %s ownership is not proved", async reason => {
    const f = fixture();
    if (reason === "assignee") f.issue.assigneeAgentId = randomUUID();
    if (reason === "owner") f.issue.responsibleUserId = "another";
    if (reason === "workspace") f.issue.executionWorkspaceId = randomUUID();
    if (reason === "origin") f.issue.originRunId = randomUUID();
    if (reason === "manual_wake") f.state.otherWake = true;
    if (reason === "missing_wake") f.state.missingWake = true;
    if (reason === "legacy_binding") delete f.attempt.snapshot.dispatch;
    const cancel = vi.fn(); await stopExpiredCodingRepair(f.db, f.attempt, cancel);
    expect(cancel).not.toHaveBeenCalled(); expect(f.attempt.state).toBe("deadline_unverified");
  });
  it("cancels only the initial pending wake when no run was created", async () => {
    const f = fixture(); f.wake.runId = null; f.wake.status = "deferred_issue_execution"; const cancel = vi.fn();
    await stopExpiredCodingRepair(f.db, f.attempt, cancel);
    expect(cancel).not.toHaveBeenCalled(); expect(f.wake.status).toBe("cancelled"); expect(f.attempt.snapshot.deadline).toMatchObject({ state: "queued_cancelled" });
  });
  it.each(["failed", "skipped"])("converges a %s no-run wake without inventing a provider stop", async status => {
    const f = fixture(); f.wake.runId = null; f.wake.status = status; const cancel = vi.fn();
    await stopExpiredCodingRepair(f.db, f.attempt, cancel); expect(cancel).not.toHaveBeenCalled();
    expect(f.attempt.state).toBe("deadline_stopped"); expect(f.attempt.snapshot.deadline).toMatchObject({ state: "queue_terminal", remoteStopVerified: false });
    expect(f.attempt.snapshot.deadline).not.toHaveProperty("stopVerifiedAt");
  });
  it("retains the run for later control availability rather than declaring it stopped", async () => {
    const f = fixture(); await stopExpiredCodingRepair(f.db, f.attempt);
    expect(f.attempt.state).toBe("deadline_stopping"); expect(f.attempt.lastCode).toBe("repair_deadline_cancel_unavailable");
  });
  it("does not perform a second stop while another lease owns the attempt", async () => {
    const f = fixture(); f.state.claimLost = true; const cancel = vi.fn();
    await stopExpiredCodingRepair(f.db, f.attempt, cancel); expect(cancel).not.toHaveBeenCalled(); expect(f.attempt.state).toBe("dispatched");
  });
  it("does not let task completion hide an active or unverified original execution", async () => {
    const f = fixture(); expect(await codingRepairInitialExecutionPending(f.db, f.attempt)).toBe(true);
    f.run.status = "cancelled"; expect(await codingRepairInitialExecutionPending(f.db, f.attempt)).toBe(true);
    f.run.resultJson = { executionCancellation: { state: "acknowledged" } };
    expect(await codingRepairInitialExecutionPending(f.db, f.attempt)).toBe(false);
    f.run.status = "succeeded"; expect(await codingRepairInitialExecutionPending(f.db, f.attempt)).toBe(false);
  });
  it("keeps both incoming and subsequent work out of the dedicated repair lane", () => {
    expect(isDedicatedCodingRepairRun({ contextSnapshot: { codingRepairAttemptId: randomUUID() } })).toBe(true);
    expect(isDedicatedCodingRepairRun({ contextSnapshot: {} })).toBe(false);
    expect(isDedicatedCodingRepairRun(null)).toBe(false);
    // Marker presence only isolates; cancellation separately verifies the durable wake.
    expect(isDedicatedCodingRepairRun({ contextSnapshot: { codingRepairAttemptId: "untrusted" } })).toBe(true);
  });
  it("fences only the original run, not manual successors or unrelated runs", async () => {
    const f = fixture(); expect(await codingRepairRunDeadlineElapsed(f.db, f.run)).toBe(true);
    expect(await codingRepairRunDeadlineElapsed(f.db, { ...f.run, id: randomUUID() })).toBe(false);
    expect(await codingRepairRunDeadlineElapsed(f.db, { ...f.run, contextSnapshot: {} })).toBe(false);
    f.state.otherWake = true; expect(await codingRepairRunDeadlineElapsed(f.db, f.run)).toBe(false);
  });
  it.each(["succeeded", "failed", "timed_out"])("%s is terminal, not a verified deadline stop", status => {
    expect(repairRunStopEvidence({ status, startedAt: new Date(), resultJson: {} })).toBe("execution_terminal");
  });
});
