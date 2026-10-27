import { and, eq, or, sql } from "drizzle-orm";
import { agents, agentApiKeys, agentRuntimeState, agentTaskSessions, agentWakeupRequests, activityLog,
  budgetReservations, heartbeatRunEvents, heartbeatRuns, issueExecutionDecisions, issues, issueComments,
  principalPermissionGrants, runtimeRoutingBindings, type Db } from "@paperclipai/db";
import { conflict } from "../errors.js";
import { issueThreadInteractionService } from "./issue-thread-interactions.js";

export async function deleteAgentDependencies(tx: Db, companyId: string, id: string) {
  const [decisionHold] = await tx.select({ id: budgetReservations.id }).from(budgetReservations).where(and(
    eq(budgetReservations.companyId, companyId), eq(budgetReservations.agentId, id),
    eq(budgetReservations.state, "held"), sql`${budgetReservations.decisionInvocationId} is not null`,
  )).limit(1);
  if (decisionHold) throw conflict("Wait for active decisions or resolve their unknown charges in Costs before deleting this agent", {
    code: "agent_decision_accounting_pending",
  });
  // Lifecycle purge holds the agent FOR UPDATE until this transaction ends.
  // Retain every binding state, including selections without a run yet.
  const [routingBinding] = await tx.select({ id: runtimeRoutingBindings.id }).from(runtimeRoutingBindings).where(and(
    eq(runtimeRoutingBindings.companyId, companyId), eq(runtimeRoutingBindings.selectedAgentId, id),
  )).limit(1);
  if (routingBinding) throw conflict("Agent cannot be deleted because runtime routing evidence still references it", {
    code: "agent_runtime_routing_evidence_retained",
  });
  await issueThreadInteractionService(tx).cancelPendingForDeletedAddressee(companyId, id);
  await tx.update(agents).set({ reportsTo: null }).where(eq(agents.reportsTo, id));
  await tx
    .update(issues)
    .set({ assigneeAgentId: null, createdByAgentId: null })
    .where(or(eq(issues.assigneeAgentId, id), eq(issues.createdByAgentId, id)));
  await tx.delete(heartbeatRunEvents).where(eq(heartbeatRunEvents.agentId, id));
  await tx.delete(agentTaskSessions).where(eq(agentTaskSessions.agentId, id));
  await tx.delete(activityLog).where(
    or(
      eq(activityLog.agentId, id),
      sql`${activityLog.runId} in (select ${heartbeatRuns.id} from ${heartbeatRuns} where ${heartbeatRuns.agentId} = ${id})`,
    ),
  );
  await tx.delete(issueExecutionDecisions).where(eq(issueExecutionDecisions.actorAgentId, id));
  await tx.delete(issueComments).where(eq(issueComments.authorAgentId, id));
  await tx.delete(heartbeatRuns).where(eq(heartbeatRuns.agentId, id));
  await tx.delete(agentWakeupRequests).where(eq(agentWakeupRequests.agentId, id));
  await tx.delete(agentApiKeys).where(eq(agentApiKeys.agentId, id));
  await tx.delete(agentRuntimeState).where(eq(agentRuntimeState.agentId, id));
  await tx.delete(principalPermissionGrants).where(and(
    eq(principalPermissionGrants.companyId, companyId),
    eq(principalPermissionGrants.principalType, "agent"),
    eq(principalPermissionGrants.principalId, id),
  ));
}
