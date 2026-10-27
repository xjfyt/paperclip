import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { agents, agentWakeupRequests as wakes, heartbeatRuns as runs, issues, routineRuns,
  mimouseCodingDeliveries as deliveries, mimouseCodingRepairAttempts as attempts, type Db } from "@paperclipai/db";
import type { CancelRunOptions } from "../heartbeat/run-control.js";
import { repairAgentConfigHash, savedRepairPolicySchema } from "./repair-policy.js";

type Attempt = typeof attempts.$inferSelect;
type Run = typeof runs.$inferSelect;
export type RepairCancelRun = (id: string, reason?: string, options?: CancelRunOptions) => Promise<unknown>;
export type RepairDispatchBinding = { version: 1; issueId: string; agentId: string; wakeKey: string; workspaceId: string };
export type RepairDeadlineReceipt = {
  version: 1; deadlineAt: string; elapsedObservedAt: string;
  state: "pending" | "stop_requested" | "local_stop_verified" | "queued_cancelled" | "queue_terminal" | "execution_terminal" | "unverified";
  runId?: string; stopRequestedAt?: string; stopVerifiedAt?: string; code: string;
  scope: "initial_repair_run_only" | "verified_automatic_repair_retries"; runs?: RepairRunDeadlineReceipt[]; lineageComplete?: boolean; remoteStopVerified: false; descendantsStopVerified: false;
};
type RepairRunDeadlineReceipt = {
  runId: string; wakeId: string; retryOfRunId: string | null;
  state: RepairDeadlineReceipt["state"]; stopRequestedAt?: string; stopVerifiedAt?: string;
};
const MAX_REPAIR_RUNS = 64;
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
  if (!binding || !policy.success || binding.agentId !== policy.data.agentId || policy.data.routineId !== attempt.routineId || policy.data.routineRevisionId !== attempt.routineRevisionId) return null;
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
  if (wake.payload?.issueId !== binding.issueId || wake.payload?.mutation !== "create" || wake.source !== "assignment" ||
      wake.triggerDetail !== "system" || wake.reason !== "issue_assigned" || wake.requestedByActorType !== null || wake.requestedByActorId !== null) return null;
  if (!wake.runId) return { binding, wake, run: null };
  const [run] = await db.select().from(runs).where(and(eq(runs.companyId, attempt.companyId), eq(runs.id, wake.runId), eq(runs.agentId, binding.agentId)));
  if (!run || run.wakeupRequestId !== wake.id || run.scopeKind !== "issue" || run.issueId !== binding.issueId ||
      run.invocationSource !== "assignment" || run.triggerDetail !== "system" || run.responsibleUserId !== policy.data.ownerUserId ||
      run.contextSnapshot?.source !== "routine.dispatch" || run.contextSnapshot?.issueId !== binding.issueId ||
      run.contextSnapshot?.codingRepairAttemptId !== attempt.id) return null;
  // Manual/coalesced work or a transferred task is not owned by this deadline.
  const other = await db.select({ id: wakes.id }).from(wakes).where(and(eq(wakes.companyId, attempt.companyId), eq(wakes.runId, run.id), ne(wakes.id, wake.id))).limit(1);
  if (other.length) return null;
  return { binding, wake, run };
}

/** Only reciprocal server retry receipts extend the initial dispatch grant. */
async function repairExecutionLineage(db: Db, attempt: Attempt) {
  const initial = await initialRun(db, attempt);
  if (!initial) return null;
  const owned = initial.run ? [initial.run] : [];
  let complete = true;
  for (let index = 0; index < owned.length; index++) {
    const parent = owned[index];
    const children = await db.select().from(runs).where(and(eq(runs.companyId, attempt.companyId),
      eq(runs.retryOfRunId, parent.id))).limit(MAX_REPAIR_RUNS + 1);
    if (children.length > MAX_REPAIR_RUNS) return { ...initial, owned, complete: false };
    for (const child of children) {
      // Manual and cross-agent recovery are never adopted, even with a copied marker.
      if (child.invocationSource !== "automation" || child.triggerDetail !== "system" || child.agentId !== initial.binding.agentId) continue;
      const context = object(child.contextSnapshot);
      const [wake] = child.wakeupRequestId ? await db.select().from(wakes).where(and(
        eq(wakes.companyId, attempt.companyId), eq(wakes.id, child.wakeupRequestId), eq(wakes.agentId, child.agentId))) : [];
      const reason = context.retryReason;
      const missingComment = reason === "missing_issue_comment";
      const scheduled = typeof reason === "string" && child.scheduledRetryReason === reason &&
        child.scheduledRetryAttempt > 0 && child.scheduledRetryAt instanceof Date &&
        context.scheduledRetryAttempt === child.scheduledRetryAttempt && context.scheduledRetryAt === child.scheduledRetryAt.toISOString() &&
        wake?.payload?.scheduledRetryAttempt === child.scheduledRetryAttempt && wake?.payload?.scheduledRetryAt === context.scheduledRetryAt;
      const policy = savedRepairPolicySchema.safeParse(attempt.snapshot.policy);
      const valid = policy.success && child.companyId === attempt.companyId && child.scopeKind === "issue" && child.issueId === initial.binding.issueId &&
        child.responsibleUserId === policy.data.ownerUserId && context.issueId === initial.binding.issueId &&
        context.codingRepairAttemptId === attempt.id && child.retryOfRunId === parent.id && context.retryOfRunId === parent.id &&
        wake?.runId === child.id && wake.source === "automation" && wake.triggerDetail === "system" &&
        wake.requestedByActorType === "system" && wake.requestedByActorId === null && wake.payload?.issueId === initial.binding.issueId &&
        wake.payload?.retryOfRunId === parent.id && wake.payload?.retryReason === reason && wake.reason === context.wakeReason &&
        (missingComment && wake.reason === "missing_issue_comment" && context.missingIssueCommentForRunId === parent.id || scheduled);
      const other = valid ? await db.select({ id: wakes.id }).from(wakes).where(and(eq(wakes.companyId, attempt.companyId),
        eq(wakes.runId, child.id), ne(wakes.id, wake!.id))).limit(1) : [];
      if (!valid || other.length || owned.some(run => run.id === child.id) || owned.length >= MAX_REPAIR_RUNS) {
        // Unknown automatic descendants cannot be claimed, nor reported settled.
        complete = false; continue;
      }
      owned.push(child);
    }
  }
  return { ...initial, owned, complete };
}

/** Issue done/blocked is not evidence that its authorized retry chain settled. */
export async function codingRepairInitialExecutionPending(db: Db, attempt: Attempt) {
  if (!repairDispatchBinding(attempt)) return false; // Historical attempts have no stop authority.
  const bound = await repairExecutionLineage(db, attempt);
  if (!bound || !bound.complete) return true;
  if (!bound.run) return !["cancelled", "skipped", "failed"].includes(bound.wake.status);
  return bound.owned.some(run => ["stop_requested", "unverified"].includes(repairRunStopEvidence(run)));
}

async function repairAttemptForRun(db: Db, run: Pick<Run, "companyId" | "contextSnapshot">, lock = false) {
  const id = run.contextSnapshot?.codingRepairAttemptId;
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return null;
  const query = db.select().from(attempts).where(and(eq(attempts.companyId, run.companyId), eq(attempts.id, id)));
  const [attempt] = await (lock ? query.for("update") : query);
  return attempt ?? null;
}

/** Marker is only a fail-closed admission hint, never stop authority. Call inside
 * the successor transaction after its issue lock; the attempt lock serializes
 * admission with deadline claims and terminal repair reconciliation. */
export async function codingRepairRetryAdmissionBlock(db: Db, run: Run, notBefore?: Date): Promise<string | null> {
  if (!isDedicatedCodingRepairRun(run)) return null;
  const attempt = await repairAttemptForRun(db, run, true);
  if (!attempt) return "coding_repair_ownership_unverified";
  if (repairDeadlineElapsed(attempt, Math.max(Date.now(), notBefore?.getTime() ?? 0))) return "coding_repair_deadline_elapsed";
  if (!["dispatching", "dispatched", "indeterminate"].includes(attempt.state)) return "coding_repair_attempt_closed";
  const policy = savedRepairPolicySchema.safeParse(attempt.snapshot.policy);
  const [agent] = await db.select().from(agents).where(and(eq(agents.companyId, attempt.companyId), eq(agents.id, run.agentId)));
  if (!policy.success || !agent || !["qoder_cn", "codex_local", "claude_local", "process"].includes(agent.adapterType) ||
      repairAgentConfigHash(agent) !== policy.data.agentConfigHash) return "coding_repair_agent_configuration_changed";
  const bound = await repairExecutionLineage(db, attempt);
  if (!bound?.complete || !bound.owned.some(row => row.id === run.id)) return "coding_repair_ownership_unverified";
  // Do not admit on the earlier observation if identity/lock reads crossed expiry.
  return repairDeadlineElapsed(attempt, Math.max(Date.now(), notBefore?.getTime() ?? 0)) ? "coding_repair_deadline_elapsed" : null;
}

/** Ordinary/manual runs are untouched; copied markers cannot authorize a stop. */
export async function codingRepairRunDeadlineElapsed(db: Db, run: Pick<Run, "id" | "companyId" | "contextSnapshot">) {
  const attempt = await repairAttemptForRun(db, run);
  if (!attempt || !repairDeadlineElapsed(attempt)) return false;
  const bound = await repairExecutionLineage(db, attempt);
  return bound?.owned.some(row => row.id === run.id) ?? false;
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
    ...(Array.isArray(previous.runs) ? { runs: previous.runs as RepairRunDeadlineReceipt[] } : {}),
    ...(previous.scope === "verified_automatic_repair_retries" ? { scope: previous.scope } : {}),
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
    const bound = await repairExecutionLineage(db, attempt);
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
    const previousRuns = Array.isArray(previous.runs) ? previous.runs.map(object) : [];
    const targets: RepairRunDeadlineReceipt[] = bound.owned.map(run => {
      const prior = previousRuns.find(row => row.runId === run.id);
      const state = repairRunStopEvidence(run);
      return { runId: run.id, wakeId: run.wakeupRequestId!, retryOfRunId: run.retryOfRunId ?? null, state,
        ...(typeof prior?.stopRequestedAt === "string" ? { stopRequestedAt: prior.stopRequestedAt } : {}),
        ...(["local_stop_verified", "queued_cancelled"].includes(state) && typeof prior?.stopVerifiedAt === "string" ? { stopVerifiedAt: prior.stopVerifiedAt } : {}),
      };
    });
    if (previousRuns.length && (previousRuns.length !== targets.length || previousRuns.some(prior =>
      !targets.some(target => target.runId === prior.runId && target.wakeId === prior.wakeId && target.retryOfRunId === prior.retryOfRunId)))) {
      receipt = { ...receipt, state: "unverified", code: "repair_deadline_ownership_unverified" };
      await save("deadline_unverified"); return true;
    }
    receipt.runs = targets;
    receipt.lineageComplete = bound.complete;
    receipt.scope = targets.length > 1 ? "verified_automatic_repair_retries" : "initial_repair_run_only";
    // Freeze every exact target before the first side effect, including siblings.
    const persistIntent = () => db.update(attempts).set({ snapshot: { ...attempt.snapshot, deadline: receipt } })
      .where(and(eq(attempts.id, attempt.id), eq(attempts.lease, lease))).returning({ id: attempts.id });
    if (!(await persistIntent()).length) return true;
    for (const target of targets) {
      if (target.state === "stop_requested") {
        // Earlier cancellation may have awaited a controller for a while.
        // Revalidate authority before each later target, never reuse that read
        // across a task transfer or a changed wake/parent identity.
        const current = await repairExecutionLineage(db, attempt);
        const owned = current?.owned.find(row => row.id === target.runId && row.wakeupRequestId === target.wakeId &&
          (row.retryOfRunId ?? null) === target.retryOfRunId);
        if (!owned) {
          target.state = "unverified"; receipt.lineageComplete = false;
          if (!(await persistIntent()).length) return true;
          continue;
        }
        receipt.lineageComplete = receipt.lineageComplete && current!.complete && current!.owned.length === targets.length;
        target.state = repairRunStopEvidence(owned);
      }
      if (target.state === "stop_requested") {
        if (!cancelRun) {
          receipt.code = "repair_deadline_cancel_unavailable";
          await save("deadline_stopping"); return true;
        }
        target.stopRequestedAt ??= now.toISOString();
        receipt = { ...receipt, state: "stop_requested", stopRequestedAt: receipt.stopRequestedAt ?? target.stopRequestedAt, code: "repair_deadline_stop_requested" };
        if (!(await persistIntent()).length) return true;
        await cancelRun(target.runId, "Coding repair deadline elapsed", { errorCode: "coding_repair_deadline_elapsed", suppressImmediateRecovery: true,
          resultJson: { codingRepairDeadline: { attemptId: attempt.id, scope: receipt.scope } } });
      }
      const [settled] = await db.select().from(runs).where(and(eq(runs.companyId, attempt.companyId), eq(runs.id, target.runId)));
      target.state = settled ? repairRunStopEvidence(settled) : "unverified";
      if (target.state === "local_stop_verified" || target.state === "queued_cancelled") target.stopVerifiedAt = new Date().toISOString();
      if (!(await persistIntent()).length) return true;
    }
    receipt.state = targets.some(row => row.state === "stop_requested") ? "stop_requested"
      : !receipt.lineageComplete || targets.some(row => row.state === "unverified") ? "unverified"
      : targets.some(row => row.state === "local_stop_verified") ? "local_stop_verified"
      : targets.some(row => row.state === "queued_cancelled") ? "queued_cancelled" : "execution_terminal";
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
