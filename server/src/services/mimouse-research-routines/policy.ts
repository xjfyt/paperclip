import { forbidden } from "../../errors.js";
export interface ResearchReportIdentity {
  companyId: string; routineId: string; routineRunId: string; issueId: string;
  actor: { type: string; source?: string; companyId?: string; agentId?: string; runId?: string };
  routine: { companyId: string; id: string };
  routineRun: { companyId: string; id: string; routineId: string; linkedIssueId: string | null; status: string };
  issue: { companyId: string; id: string; originKind: string; originId: string | null; originRunId: string | null; assigneeAgentId: string | null; checkoutRunId: string | null; executionRunId: string | null };
  run: { companyId: string; id: string; agentId: string; issueId: string | null; scopeKind: string; status: string };
}
/** Pure fail-closed identity check, in addition to the normal task ACL decision. */
export function assertResearchReportIdentity(x: ResearchReportIdentity) {
  const { actor, routine, routineRun, issue, run } = x;
  if (actor.type !== "agent" || actor.source !== "agent_jwt" || !actor.agentId || !actor.runId
    || actor.companyId !== x.companyId || [routine, routineRun, issue, run].some(row => row.companyId !== x.companyId)
    || routine.id !== x.routineId || routineRun.routineId !== x.routineId || routineRun.id !== x.routineRunId
    || routineRun.linkedIssueId !== x.issueId || !["issue_created", "completed"].includes(routineRun.status)
    || issue.id !== x.issueId || issue.originKind !== "routine_execution" || issue.originId !== x.routineId || issue.originRunId !== x.routineRunId
    || issue.assigneeAgentId !== actor.agentId || run.id !== actor.runId || run.agentId !== actor.agentId
    || run.scopeKind !== "issue" || run.issueId !== x.issueId || run.status !== "running"
    || (!issue.checkoutRunId && !issue.executionRunId)
    || (issue.checkoutRunId !== null && issue.checkoutRunId !== run.id)
    || (issue.executionRunId !== null && issue.executionRunId !== run.id)) {
    throw forbidden("Research report requires its authorized running routine task");
  }
}
