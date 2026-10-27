import { expect, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { activityLog, agentWakeupRequests, heartbeatRuns, issueRecoveryActions, issues, type Db } from "@paperclipai/db";
import { issueRecoveryActionService } from "../issue-recovery-actions.js";
import { recoveryService } from "../recovery/service.js";

/** Real lifecycle regression after the one inert controlled run succeeds. No
 * wake is allowed, and an old automatic action is retired rather than retried. */
export async function verifyRuntimeRoutingRecoverySuppression(db: Db, issue: typeof issues.$inferSelect, run: typeof heartbeatRuns.$inferSelect) {
  const active = () => db.select().from(issueRecoveryActions).where(and(eq(issueRecoveryActions.companyId, issue.companyId),
    eq(issueRecoveryActions.sourceIssueId, issue.id), inArray(issueRecoveryActions.status, ["active", "escalated"])));
  const wakes = () => db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, issue.companyId),
    eq(agentWakeupRequests.reason, "issue_disposition_repair"), sql`${agentWakeupRequests.payload}->>'issueId' = ${issue.id}`));
  expect(await active()).toHaveLength(0); expect(await wakes()).toHaveLength(0);
  const enqueue = vi.fn(async () => null), recovery = recoveryService(db, { enqueueWakeup: enqueue });
  expect(await recovery.reconcileLegacyContinuation(run.id)).toBe("skipped");
  const actions = issueRecoveryActionService(db);
  const old = await actions.upsertSourceScoped({ companyId: issue.companyId, sourceIssueId: issue.id,
    kind: "deliberate_wait_without_target", cause: "deliberate_wait_without_target", ownerType: "agent", ownerAgentId: run.agentId,
    fingerprint: `old-runtime-routing:${run.id}`, attemptCount: 0, maxAttempts: 5, nextAction: "Old automatic repair awaiting its first attempt",
    wakePolicy: { type: "bounded_owner_disposition_repair", retryAgentId: run.agentId, attempt: 0, maxAttempts: 5 } });
  await recovery.reconcileStrandedAssignedIssues({ issueCreatedAtGte: issue.createdAt });
  const [cancelled] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, old.id));
  expect(cancelled).toMatchObject({ status: "cancelled", outcome: "cancelled", attemptCount: 0, resolutionNote: "runtime_routing_explicit_dispatch_required" });
  expect(cancelled.resolvedAt).not.toBeNull();
  await recovery.reconcileStrandedAssignedIssues({ issueCreatedAtGte: issue.createdAt });
  expect((await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, old.id)))[0]).toEqual(cancelled);
  expect(await db.select().from(activityLog).where(and(eq(activityLog.entityId, old.id), eq(activityLog.action, "runtime_cost_routing.automatic_recovery_suppressed")))).toHaveLength(1);
  expect(await active()).toHaveLength(0); expect(await wakes()).toHaveLength(0); expect(enqueue).not.toHaveBeenCalled();
  // A person's independent board action must not be auto-resolved merely
  // because its source task belongs to the explicit-only routing lane.
  const board = await actions.upsertSourceScoped({ companyId: issue.companyId, sourceIssueId: issue.id,
    kind: "deliberate_wait_without_target", cause: "deliberate_wait_without_target", ownerType: "board", fingerprint: `manual:${run.id}`,
    attemptCount: 0, nextAction: "Human decision required", wakePolicy: { type: "manual_only" } });
  await recovery.reconcileStrandedAssignedIssues({ issueCreatedAtGte: issue.createdAt });
  expect((await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, board.id)))[0]).toMatchObject({ status: "active", ownerType: "board" });
  await actions.resolveActiveForIssue({ companyId: issue.companyId, sourceIssueId: issue.id, actionId: board.id,
    status: "cancelled", outcome: "cancelled", resolutionNote: "Owned fixture explicit cleanup" });
  expect(enqueue).not.toHaveBeenCalled(); expect(await wakes()).toHaveLength(0);
  expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id)))[0].status).toBe("succeeded");
}
