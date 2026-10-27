import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { activityLog, heartbeatRuns, issueRecoveryActions, issues, type Db } from "@paperclipai/db";
import { runtimeRoutingBindings as bindings } from "@paperclipai/db/schema/runtime_cost_routing";
const reason = "runtime_routing_explicit_dispatch_required";
/** Durable routing identity survives OFF/disable, success, and missing bindings. */
export async function isRuntimeRoutingRun(db: Db, run: Pick<typeof heartbeatRuns.$inferSelect, "id" | "companyId" | "issueId" | "nativeIssueId" | "contextSnapshot">) {
  const [binding] = await db.select({ id: bindings.id }).from(bindings).where(and(eq(bindings.companyId, run.companyId), eq(bindings.runId, run.id))).limit(1);
  if (binding) return true;
  const ids = [...new Set([run.issueId, run.nativeIssueId, run.contextSnapshot?.issueId, run.contextSnapshot?.taskId]
    .filter((id): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))];
  if (!ids.length) return false;
  const [issue] = await db.select({ id: issues.id }).from(issues).where(and(eq(issues.companyId, run.companyId), inArray(issues.id, ids), eq(issues.originKind, "runtime_cost_routing"))).limit(1);
  return !!issue;
}
export function isRuntimeRoutingAutomaticDispositionRepair(action: Pick<typeof issueRecoveryActions.$inferSelect,
  "status" | "kind" | "cause" | "ownerType" | "ownerAgentId" | "ownerUserId" | "recoveryIssueId" | "wakePolicy">, selectedAgentId: string) {
  return ["active", "escalated"].includes(action.status) && action.kind === "deliberate_wait_without_target" &&
    action.cause === "deliberate_wait_without_target" && action.ownerType === "agent" && action.ownerUserId === null && action.recoveryIssueId === null &&
    action.ownerAgentId === selectedAgentId && action.wakePolicy?.type === "bounded_owner_disposition_repair" && action.wakePolicy.retryAgentId === selectedAgentId;
}
/** Stop automatic repair before creation/scheduling; retire only an old matching
 * automatic action. Human/board recovery decisions and all execution stay intact. */
export async function suppressRuntimeRoutingAutomaticRecovery(db: Db, companyId: string, issueId: string) {
  return db.transaction(async tx => {
    const [issue] = await tx.select({ origin: issues.originKind }).from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, issueId))).for("share");
    const [binding] = await tx.select({ id: bindings.id, selectedAgentId: bindings.selectedAgentId }).from(bindings).where(and(eq(bindings.companyId, companyId), eq(bindings.issueId, issueId))).for("share");
    if (!binding && issue?.origin !== "runtime_cost_routing") return false;
    if (!binding) return true; // Missing binding still suppresses, but cannot attest an old repair owner.
    const automaticScope = and(eq(issueRecoveryActions.companyId, companyId),
      eq(issueRecoveryActions.sourceIssueId, issueId), inArray(issueRecoveryActions.status, ["active", "escalated"]),
      eq(issueRecoveryActions.kind, "deliberate_wait_without_target"), eq(issueRecoveryActions.cause, "deliberate_wait_without_target"),
      eq(issueRecoveryActions.ownerType, "agent"), isNull(issueRecoveryActions.ownerUserId), isNull(issueRecoveryActions.recoveryIssueId),
      eq(issueRecoveryActions.ownerAgentId, binding.selectedAgentId), sql`${issueRecoveryActions.wakePolicy}->>'type' = 'bounded_owner_disposition_repair'`,
      sql`${issueRecoveryActions.wakePolicy}->>'retryAgentId' = ${binding.selectedAgentId}`);
    const [action] = await tx.select().from(issueRecoveryActions).where(automaticScope).for("update");
    if (action && isRuntimeRoutingAutomaticDispositionRepair(action, binding.selectedAgentId)) {
      // Keep the row lock through the conventional terminal transition: a concurrent
      // board takeover cannot be silently overwritten using an earlier snapshot.
      const now = new Date();
      const [cancelled] = await tx.update(issueRecoveryActions).set({ status: "cancelled", outcome: "cancelled", resolutionNote: reason,
        resolvedAt: now, updatedAt: now }).where(and(automaticScope, eq(issueRecoveryActions.id, action.id), eq(issueRecoveryActions.fingerprint, action.fingerprint))).returning({ id: issueRecoveryActions.id });
      if (cancelled) await tx.insert(activityLog).values({ companyId, actorType: "system", actorId: "recovery",
        action: "runtime_cost_routing.automatic_recovery_suppressed", entityType: "issue_recovery_action", entityId: action.id,
        details: { sourceIssueId: issueId, reason, executionStarted: false, pastEffectsReverted: false } });
    }
    return true;
  });
}
