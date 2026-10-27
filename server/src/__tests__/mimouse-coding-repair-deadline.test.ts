import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { agents, agentWakeupRequests as wakes, heartbeatRuns as runs, issues, routineRuns,
  mimouseCodingDeliveries as deliveries, mimouseCodingRepairAttempts as attempts, type Db } from "@paperclipai/db";
import { codingRepairInitialExecutionPending, codingRepairRetryAdmissionBlock, codingRepairRunDeadlineElapsed, isDedicatedCodingRepairRun, repairDeadlineElapsed, repairRunStopEvidence, stopExpiredCodingRepair } from "../services/mimouse-coding/repair-deadline.js";

import { repairAgentConfigHash } from "../services/mimouse-coding/repair-policy.js";

// Query-chain fixture: no provider, real agent, process, database, or external request.
// SQL predicates are inspected separately; this is not a PostgreSQL integration proof.
function fixture() {
  const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), routineId = randomUUID(), routineRunId = randomUUID(), workspaceId = randomUUID(), runId = randomUUID(), wakeId = randomUUID();
  const agent = { id: agentId, companyId, adapterType: "process", adapterConfig: { command: "fixture" }, runtimeConfig: {} };
  const policy = { enabled: true, revision: randomUUID(), headSha: "a".repeat(40), routineId, routineRevisionId: randomUUID(), ownerUserId: "owner", agentId,
    agentConfigHash: repairAgentConfigHash(agent), maxAttempts: 2, maxCostCents: 10, approvedAt: new Date(Date.now() - 120000).toISOString(), expiresAt: new Date(Date.now() - 60000).toISOString() };
  const attempt = { id: randomUUID(), companyId, deliveryId: randomUUID(), routineId, routineRevisionId: policy.routineRevisionId, routineRunId, issueId, requestKey: randomUUID(), state: "dispatched", lease: null, leaseExpiresAt: null,
    snapshot: { policy } } as unknown as typeof attempts.$inferSelect;
  attempt.snapshot.dispatch = { version: 1, issueId, agentId, workspaceId, wakeKey: `${attempt.requestKey}:initial` };
  const issue = { id: issueId, companyId, originKind: "routine_execution", originId: routineId, originRunId: routineRunId, assigneeAgentId: agentId, responsibleUserId: "owner", executionWorkspaceId: workspaceId };
  const routine = { id: routineRunId, companyId, routineId, routineRevisionId: policy.routineRevisionId, linkedIssueId: issueId, source: "api", idempotencyKey: attempt.requestKey };
  const wake = { id: wakeId, companyId, agentId, idempotencyKey: `${attempt.requestKey}:initial`, source: "assignment", triggerDetail: "system", reason: "issue_assigned", requestedByActorType: null, requestedByActorId: null, payload: { issueId, mutation: "create" }, runId: runId as string | null, status: "claimed" };
  const run = { id: runId, companyId, agentId, wakeupRequestId: wakeId, scopeKind: "issue", issueId, responsibleUserId: "owner", retryOfRunId: null, invocationSource: "assignment", triggerDetail: "system", contextSnapshot: { issueId, source: "routine.dispatch", codingRepairAttemptId: attempt.id }, status: "running", startedAt: new Date(), resultJson: {} } as unknown as typeof runs.$inferSelect;
  const delivery: Record<string, unknown> = {}; const predicates: { sql: string; params: unknown[] }[] = [];
  const runRows = [run]; const wakeRows = [wake];
  const state = { otherWake: false, missingWake: false, claimLost: false, onSelect: (() => {}) as (table: unknown) => void };
  function retry(parent = run, missingComment = false) {
    const id = randomUUID(), wakeId = randomUUID(), dueAt = new Date(Date.now() - 1000);
    const reason = missingComment ? "missing_issue_comment" : "transient_failure";
    const scheduled = missingComment ? {} : { scheduledRetryAttempt: 1, scheduledRetryAt: dueAt.toISOString() };
    const context = { issueId, codingRepairAttemptId: attempt.id, retryOfRunId: parent.id, retryReason: reason, wakeReason: reason, ...(missingComment ? { missingIssueCommentForRunId: parent.id } : {}), ...scheduled };
    const child = { ...run, id, retryOfRunId: parent.id, invocationSource: "automation", triggerDetail: "system", wakeupRequestId: wakeId,
      contextSnapshot: context, status: missingComment ? "queued" : "scheduled_retry", startedAt: null, scheduledRetryAt: missingComment ? null : dueAt,
      scheduledRetryAttempt: missingComment ? 0 : 1, scheduledRetryReason: missingComment ? null : reason } as typeof run;
    const receipt = { ...wake, id: wakeId, runId: id, idempotencyKey: null, source: "automation", triggerDetail: "system", requestedByActorType: "system", requestedByActorId: null,
      reason, payload: { issueId, retryOfRunId: parent.id, retryReason: reason, ...scheduled } } as unknown as typeof wake;
    runRows.push(child); wakeRows.push(receipt); return { run: child, wake: receipt };
  }
  const dialect = new PgDialect();
  const db = {
    select: () => ({ from: (table: unknown) => {
      let query = { sql: "", params: [] as unknown[] };
      const chain = { where: (predicate: any) => { query = dialect.sqlToQuery(predicate); predicates.push(query); return chain; }, limit: () => chain, for: () => chain,
        then: (resolve: any, reject: any) => {
          state.onSelect(table);
          const rows = table === agents ? [agent] : table === attempts ? [attempt] : table === issues ? [issue] : table === routineRuns ? [routine] : table === runs ? runRows : table === wakes ? state.missingWake ? [] : wakeRows : [];
          const selected = rows.filter(row => [...query.sql.matchAll(/"[^"]+"\."([^"]+)" (=|<>) \$(\d+)/g)].every(([, column, operator, index]) => {
            const key = column.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
            const value = (row as any)[key]; return operator === "=" ? value === query.params[Number(index) - 1] : value !== query.params[Number(index) - 1];
          }));
          return Promise.resolve(table === wakes && query.sql.includes(" <>") && state.otherWake ? [{ id: "manual" }] : selected).then(resolve, reject);
        } };
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
  return { db, attempt, policy, issue, wake, run, delivery, state, predicates, retry, runRows, wakeRows, agent };
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
  it.each([false, true])("fences authenticated retry lineage (missing comment: %s)", async missingComment => {
    const f = fixture(); f.run.status = "failed"; const child = f.retry(f.run, missingComment); const grandchild = f.retry(child.run);
    expect(await codingRepairRunDeadlineElapsed(f.db, child.run)).toBe(true);
    expect(await codingRepairRunDeadlineElapsed(f.db, grandchild.run)).toBe(true);
    expect(await codingRepairInitialExecutionPending(f.db, f.attempt)).toBe(true);
    const cancel = vi.fn(async (id: string) => {
      const receipt = f.attempt.snapshot.deadline as any;
      expect(receipt.runs.map((row: any) => row.runId)).toEqual([f.run.id, child.run.id, grandchild.run.id]);
      expect(receipt.runs.find((row: any) => row.runId === id)).toMatchObject({ state: "stop_requested", stopRequestedAt: expect.any(String) });
      const target = f.runRows.find(row => row.id === id)!;
      target.status = "cancelled"; target.resultJson = { executionCancellation: { state: "acknowledged" } };
    });
    await stopExpiredCodingRepair(f.db, f.attempt, cancel);
    expect(cancel.mock.calls.map(([id]) => id)).toEqual([child.run.id, grandchild.run.id]);
    expect(f.attempt.state).toBe("deadline_stopped");
    expect(f.attempt.snapshot.deadline).toMatchObject({ scope: "verified_automatic_repair_retries", lineageComplete: true, remoteStopVerified: false, descendantsStopVerified: false });
  });
  it.each(["actor", "source", "parent", "payload_parent", "issue", "owner", "agent", "company", "wake", "reason", "time", "coalesced"])("does not adopt a %s-spoofed automatic successor", async reason => {
    const f = fixture(); const child = f.retry(); const wake = child.wake as any;
    if (reason === "actor") wake.requestedByActorType = "user";
    if (reason === "source") child.run.invocationSource = "on_demand";
    if (reason === "parent") child.run.retryOfRunId = randomUUID();
    if (reason === "payload_parent") wake.payload.retryOfRunId = randomUUID();
    if (reason === "issue") child.run.issueId = randomUUID();
    if (reason === "owner") child.run.responsibleUserId = "other";
    if (reason === "agent") child.run.agentId = randomUUID();
    if (reason === "company") child.run.companyId = randomUUID();
    if (reason === "wake") wake.runId = randomUUID();
    if (reason === "reason") wake.payload.retryReason = "other";
    if (reason === "time") wake.payload.scheduledRetryAt = new Date().toISOString();
    if (reason === "coalesced") f.wakeRows.push({ ...child.wake, id: randomUUID() });
    expect(await codingRepairRunDeadlineElapsed(f.db, child.run)).toBe(false);
    const cancel = vi.fn(async id => { const row = f.runRows.find(row => row.id === id)!; row.status = "succeeded"; });
    await stopExpiredCodingRepair(f.db, f.attempt, cancel);
    expect(cancel.mock.calls.map(([id]) => id)).toEqual([f.run.id]);
    expect(child.run.status).toBe("scheduled_retry");
  });
  it("keeps a changed retry roster unverified after restart without taking over a replacement", async () => {
    const f = fixture(); f.run.status = "failed"; const child = f.retry();
    await stopExpiredCodingRepair(f.db, f.attempt, async () => { throw Error("uncertain"); });
    const before = structuredClone(f.attempt.snapshot.deadline);
    child.wake.id = randomUUID(); child.run.wakeupRequestId = child.wake.id;
    const cancel = vi.fn(); await stopExpiredCodingRepair(f.db, f.attempt, cancel);
    expect(cancel).not.toHaveBeenCalled(); expect(f.attempt.state).toBe("deadline_unverified");
    expect((f.attempt.snapshot.deadline as any).runs).toEqual((before as any).runs);
  });
  it("retries exact child stop intent after unknown outcome and keeps its original time", async () => {
    const f = fixture(); f.run.status = "failed"; const child = f.retry();
    await stopExpiredCodingRepair(f.db, f.attempt, async () => { throw Error("uncertain"); });
    const before = (f.attempt.snapshot.deadline as any).runs[1].stopRequestedAt;
    const cancel = vi.fn(async (_id: string) => { child.run.status = "cancelled"; child.run.resultJson = { executionCancellation: { state: "acknowledged" } }; });
    await stopExpiredCodingRepair(f.db, f.attempt, cancel);
    expect(cancel.mock.calls[0][0]).toBe(child.run.id);
    expect((f.attempt.snapshot.deadline as any).runs[1].stopRequestedAt).toBe(before);
    expect(f.attempt.state).toBe("deadline_stopped");
  });
  it("revalidates later stop targets after an awaited controller and task transfer", async () => {
    const f = fixture(); f.run.status = "failed"; const first = f.retry(), second = f.retry();
    const cancel = vi.fn(async (id: string) => {
      expect(id).toBe(first.run.id); first.run.status = "cancelled";
      f.issue.assigneeAgentId = randomUUID();
    });
    await stopExpiredCodingRepair(f.db, f.attempt, cancel);
    expect(cancel).toHaveBeenCalledTimes(1); expect(second.run.status).toBe("scheduled_retry");
    expect(f.attempt.state).toBe("deadline_unverified");
  });
  it("resumes only the unconfirmed sibling after persisting earlier acknowledgements", async () => {
    const f = fixture(); f.run.status = "failed"; const first = f.retry(), second = f.retry();
    await stopExpiredCodingRepair(f.db, f.attempt, async id => {
      if (id === second.run.id) throw Error("unknown second stop");
      first.run.status = "cancelled"; first.run.resultJson = { executionCancellation: { state: "acknowledged" } };
    });
    expect(f.attempt.state).toBe("deadline_stopping");
    const cancel = vi.fn(async (_id: string) => { second.run.status = "cancelled"; });
    await stopExpiredCodingRepair(f.db, f.attempt, cancel);
    expect(cancel.mock.calls.map(([id]) => id)).toEqual([second.run.id]);
    expect(f.attempt.state).toBe("deadline_stopped"); // Second was never started.
  });
  it("never turns mixed acknowledged and provider-unknown evidence into chain stop proof", async () => {
    const f = fixture(); f.run.status = "failed"; const child = f.retry(); const sibling = f.retry();
    await stopExpiredCodingRepair(f.db, f.attempt, async id => {
      const row = f.runRows.find(row => row.id === id)!; row.status = "cancelled"; row.startedAt = new Date();
      if (id === child.run.id) row.resultJson = { executionCancellation: { state: "acknowledged" } };
    });
    expect(f.attempt.state).toBe("deadline_unverified");
    expect((f.attempt.snapshot.deadline as any).runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ runId: child.run.id, state: "local_stop_verified" }),
      expect.objectContaining({ runId: sibling.run.id, state: "unverified" }),
    ]));
  });
  it("bounds lineage discovery and still stops independently verified targets on overflow", async () => {
    const f = fixture(); for (let i = 0; i < 65; i++) f.retry();
    expect(await codingRepairInitialExecutionPending(f.db, f.attempt)).toBe(true);
    const cancel = vi.fn(async () => { f.run.status = "succeeded"; });
    await stopExpiredCodingRepair(f.db, f.attempt, cancel);
    expect(cancel).toHaveBeenCalledTimes(1); expect(f.attempt.state).toBe("deadline_unverified");
    expect(f.attempt.snapshot.deadline).toMatchObject({ lineageComplete: false });
  });
  it("serializes admission with attempt closure and rechecks actual time after identity reads", async () => {
    const f = fixture(); f.policy.approvedAt = new Date().toISOString(); f.policy.expiresAt = new Date(Date.now() + 60000).toISOString();
    expect(await codingRepairRetryAdmissionBlock(f.db, f.run)).toBeNull();
    expect(await codingRepairRetryAdmissionBlock(f.db, f.run, new Date(f.policy.expiresAt))).toBe("coding_repair_deadline_elapsed");
    f.attempt.state = "completed"; expect(await codingRepairRetryAdmissionBlock(f.db, f.run)).toBe("coding_repair_attempt_closed");
    f.attempt.state = "dispatched";
    f.state.onSelect = table => { if (table === agents) { f.policy.approvedAt = new Date(Date.now() - 120000).toISOString(); f.policy.expiresAt = new Date(Date.now() - 60000).toISOString(); } };
    expect(await codingRepairRetryAdmissionBlock(f.db, f.run)).toBe("coding_repair_deadline_elapsed");
  });
  it("rejects changed native configuration or forged grants for admission, without stop authority", async () => {
    const f = fixture(); f.policy.approvedAt = new Date().toISOString(); f.policy.expiresAt = new Date(Date.now() + 60000).toISOString();
    f.agent.adapterType = "paperclip_runner";
    expect(await codingRepairRetryAdmissionBlock(f.db, f.run)).toBe("coding_repair_agent_configuration_changed");
    const spoof = { ...f.run, id: randomUUID(), contextSnapshot: { codingRepairAttemptId: "forged" } };
    expect(await codingRepairRetryAdmissionBlock(f.db, spoof)).toBe("coding_repair_ownership_unverified");
    expect(await codingRepairRunDeadlineElapsed(f.db, spoof)).toBe(false);
    expect(await codingRepairRetryAdmissionBlock(f.db, { ...f.run, contextSnapshot: {} })).toBeNull();
  });
  it.each(["succeeded", "failed", "timed_out"])("%s is terminal, not a verified deadline stop", status => {
    expect(repairRunStopEvidence({ status, startedAt: new Date(), resultJson: {} })).toBe("execution_terminal");
  });
});
