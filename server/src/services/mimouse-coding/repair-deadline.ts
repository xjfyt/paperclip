import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { agentWakeupRequests as wakes, heartbeatRuns as runs, issues, routineRuns,
  mimouseCodingDeliveries as deliveries, mimouseCodingRepairAttempts as attempts, type Db } from "@paperclipai/db";
import type { CancelRunOptions } from "../heartbeat/run-control.js";
import { savedRepairPolicySchema } from "./repair-policy.js";

type Attempt = typeof attempts.$inferSelect;
type Run = typeof runs.$inferSelect;
export type RepairCancelRun = (id: string, reason?: string, options?: CancelRunOptions) => Promise<unknown>;
export type RepairDispatchBinding = { version: 1; issueId: string; agentId: string; wakeKey: string; workspaceId: string };
export type RepairDeadlineReceipt = {
  version: 1; deadlineAt: string; elapsedObservedAt: string;
  state: "pending" | "stop_requested" | "local_stop_verified" | "queued_cancelled" | "queue_terminal" | "execution_terminal" | "unverified";
  runId?: string; stopRequestedAt?: string; stopVerifiedAt?: string; code: string;
  scope: "initial_repair_run_only"; remoteStopVerified: false; descendantsStopVerified: false;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const active = ["queued", "running", "scheduled_retry"];
/** Conservative isolation only; a marker never grants cancellation authority. */
export function isDedicatedCodingRepairRun(run: { contextSnapshot: Record<string, unknown> | null } | null | undefined) {
  return typeof run?.contextSnapshot?.codingRepairAttemptId === "string";
}
export function repairDispatchBinding(attempt: Attempt): RepairDispatchBinding | null {
  const value = object(attempt.snapshot.dispatch);
  return value.version === 1 && typeof value.issueId === "string" && typeof value.agentId === "string" &&
    typeof value.workspaceId === "string" && value.wakeKey === `${attempt.requestKey}:initial`
    ? value as RepairDispatchBinding : null;
}
export function repairDeadlineElapsed(attempt: Attempt, now = Date.now()) {
  const policy = savedRepairPolicySchema.safeParse(attempt.snapshot.policy);
  return !policy.success || Date.parse(policy.data.expiresAt) <= now;
}
export function repairRunStopEvidence(run: Pick<Run, "status" | "startedAt" | "resultJson">): RepairDeadlineReceipt["state"] {
  if (active.includes(run.status)) return "stop_requested";
  if (run.status === "cancelled" && object(run.resultJson?.executionCancellation).state === "acknowledged") return "local_stop_verified";
  if (run.status === "cancelled" && !run.startedAt) return "queued_cancelled";
  // A terminal database status is not provider-stop evidence, especially after restart.
  if (["succeeded", "failed", "timed_out"].includes(run.status)) return "execution_terminal";
  return "unverified";
}
async function initialRun(db: Db, attempt: Attempt) {
  const binding = repairDispatchBinding(attempt);
  const policy = savedRepairPolicySchema.safeParse(attempt.snapshot.policy);
  if (!binding || !policy.success || binding.agentId !== policy.data.agentId) return null;
  const [issue] = await db.select().from(issues).where(and(eq(issues.companyId, attempt.companyId), eq(issues.id, binding.issueId)));
  const [routine] = await db.select().from(routineRuns).where(and(eq(routineRuns.companyId, attempt.companyId),
    eq(routineRuns.routineId, attempt.routineId), eq(routineRuns.idempotencyKey, attempt.requestKey), eq(routineRuns.source, "api")));
  if (!issue || !routine || issue.originKind !== "routine_execution" || issue.originId !== attempt.routineId || issue.originRunId !== routine.id ||
      routine.routineRevisionId !== attempt.routineRevisionId || (routine.linkedIssueId && routine.linkedIssueId !== issue.id) ||
      issue.assigneeAgentId !== binding.agentId || issue.responsibleUserId !== policy.data.ownerUserId ||
      issue.executionWorkspaceId !== binding.workspaceId || (attempt.issueId && attempt.issueId !== issue.id) ||
      (attempt.routineRunId && attempt.routineRunId !== routine.id)) return null;
  const receipts = await db.select().from(wakes).where(and(eq(wakes.companyId, attempt.companyId),
    eq(wakes.agentId, binding.agentId), eq(wakes.idempotencyKey, binding.wakeKey))).limit(2);
  if (receipts.length !== 1) return null;
  const wake = receipts[0];
  if (wake.payload?.issueId !== binding.issueId) return null;
  if (!wake.runId) return { binding, wake, run: null };
  const [run] = await db.select().from(runs).where(and(eq(runs.companyId, attempt.companyId), eq(runs.id, wake.runId), eq(runs.agentId, binding.agentId)));
  if (!run || run.wakeupRequestId !== wake.id || (run.issueId && run.issueId !== binding.issueId) || run.contextSnapshot?.issueId !== binding.issueId ||
      run.contextSnapshot?.codingRepairAttemptId !== attempt.id) return null;
  // Manual/coalesced work or a transferred task is not owned by this deadline.
  const other = await db.select({ id: wakes.id }).from(wakes).where(and(eq(wakes.companyId, attempt.companyId), eq(wakes.runId, run.id), ne(wakes.id, wake.id))).limit(1);
  if (other.length) return null;
  return { binding, wake, run };
}

/** Issue done/blocked is not evidence that its original execution has settled. */
export async function codingRepairInitialExecutionPending(db: Db, attempt: Attempt) {
  if (!repairDispatchBinding(attempt)) return false; // Historical attempts have no stop authority.
  const bound = await initialRun(db, attempt);
  if (!bound) return true;
  if (!bound.run) return !["cancelled", "skipped", "failed"].includes(bound.wake.status);
  return ["stop_requested", "unverified"].includes(repairRunStopEvidence(bound.run));
}

/** Only the original, durable routine wake is fenced; ordinary task/manual runs are untouched. */
export async function codingRepairRunDeadlineElapsed(db: Db, run: Pick<Run, "id" | "companyId" | "contextSnapshot">) {
  const id = run.contextSnapshot?.codingRepairAttemptId;
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return false;
  const [attempt] = await db.select().from(attempts).where(and(eq(attempts.companyId, run.companyId), eq(attempts.id, id)));
  if (!attempt || !repairDeadlineElapsed(attempt)) return false;
  const bound = await initialRun(db, attempt);
  return bound?.run?.id === run.id;
}

/** Persist intent before cancellation. Restart may only retry the very same run. */
export async function stopExpiredCodingRepair(db: Db, source: Attempt, cancelRun?: RepairCancelRun) {
  if (!repairDeadlineElapsed(source)) return false;
  const lease = randomUUID(); const now = new Date();
  const [attempt] = await db.update(attempts).set({ state: "deadline_stopping", lease,
    leaseExpiresAt: new Date(now.getTime() + 120000), updatedAt: now }).where(and(
    eq(attempts.companyId, source.companyId), eq(attempts.id, source.id),
    inArray(attempts.state, ["dispatched", "indeterminate", "deadline_stopping"]),
    or(isNull(attempts.lease), lte(attempts.leaseExpiresAt, now)),
  )).returning();
  if (!attempt) return true;
  const previous = object(attempt.snapshot.deadline);
  const policy = savedRepairPolicySchema.safeParse(attempt.snapshot.policy);
  let receipt: RepairDeadlineReceipt = { version: 1, deadlineAt: policy.success ? policy.data.expiresAt : "invalid",
    elapsedObservedAt: typeof previous.elapsedObservedAt === "string" ? previous.elapsedObservedAt : now.toISOString(),
    state: "pending", code: "repair_deadline_elapsed", scope: "initial_repair_run_only", remoteStopVerified: false, descendantsStopVerified: false,
    ...(typeof previous.runId === "string" ? { runId: previous.runId } : {}),
    ...(typeof previous.stopRequestedAt === "string" ? { stopRequestedAt: previous.stopRequestedAt } : {}),
  };
  async function save(state: string) {
    return db.transaction(async tx => {
      const changed = await tx.update(attempts).set({ state, snapshot: { ...attempt.snapshot, deadline: receipt }, lastCode: receipt.code,
        lease: null, leaseExpiresAt: null, updatedAt: new Date() }).where(and(eq(attempts.id, attempt.id), eq(attempts.lease, lease))).returning({ id: attempts.id });
      if (changed.length) await tx.update(deliveries).set({ repairStatus: "needs_human", repairLastCode: receipt.code }).where(and(eq(deliveries.companyId, attempt.companyId), eq(deliveries.id, attempt.deliveryId)));
    });
  }
  try {
    const bound = await initialRun(db, attempt);
    if (!bound || (receipt.runId && bound.run?.id !== receipt.runId)) {
      receipt = { ...receipt, state: "unverified", code: "repair_deadline_ownership_unverified" };
      await save("deadline_unverified"); return true;
    }
    if (!bound.run) {
      if (["skipped", "failed"].includes(bound.wake.status)) {
        receipt = { ...receipt, state: "queue_terminal", code: "repair_deadline_queue_terminal" };
        await save("deadline_stopped"); return true;
      }
      const alreadyCancelled = bound.wake.status === "cancelled";
      const cancelled = alreadyCancelled ? [{ id: bound.wake.id }] : await db.update(wakes).set({ status: "cancelled", finishedAt: now, updatedAt: now, error: "Coding repair deadline elapsed" }).where(and(
        eq(wakes.id, bound.wake.id), eq(wakes.companyId, attempt.companyId), isNull(wakes.runId), inArray(wakes.status, ["queued", "deferred_issue_execution"]),
      )).returning({ id: wakes.id });
      receipt = { ...receipt, state: cancelled.length ? "queued_cancelled" : "pending", code: cancelled.length ? "repair_deadline_queue_cancelled" : "repair_deadline_queue_reconcile" };
      await save(cancelled.length ? "deadline_stopped" : "deadline_stopping"); return true;
    }
    receipt.runId = bound.run.id;
    if (active.includes(bound.run.status)) {
      if (!cancelRun) {
        receipt.code = "repair_deadline_cancel_unavailable";
        await save("deadline_stopping"); return true;
      }
      receipt = { ...receipt, state: "stop_requested", stopRequestedAt: receipt.stopRequestedAt ?? now.toISOString(), code: "repair_deadline_stop_requested" };
      const claimed = await db.update(attempts).set({ snapshot: { ...attempt.snapshot, deadline: receipt } })
        .where(and(eq(attempts.id, attempt.id), eq(attempts.lease, lease))).returning({ id: attempts.id });
      if (!claimed.length) return true;
      await cancelRun(bound.run.id, "Coding repair deadline elapsed", { errorCode: "coding_repair_deadline_elapsed", suppressImmediateRecovery: true,
        resultJson: { codingRepairDeadline: { attemptId: attempt.id, scope: "initial_repair_run_only" } } });
    }
    const [settled] = await db.select().from(runs).where(and(eq(runs.companyId, attempt.companyId), eq(runs.id, bound.run.id)));
    receipt.state = settled ? repairRunStopEvidence(settled) : "unverified";
    if (receipt.state === "local_stop_verified" || receipt.state === "queued_cancelled") receipt.stopVerifiedAt = new Date().toISOString();
    receipt.code = `repair_deadline_${receipt.state}`;
    await save(receipt.state === "stop_requested" ? "deadline_stopping" : receipt.state === "unverified" ? "deadline_unverified" : "deadline_stopped");
  } catch {
    // A thrown cancel is unknown, not stopped. Keep its exact run identity for retry.
    receipt.code = "repair_deadline_stop_unconfirmed";
    await save("deadline_stopping");
  }
  return true;
}
