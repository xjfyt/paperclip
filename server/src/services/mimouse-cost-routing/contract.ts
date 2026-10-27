import type { heartbeatRuns, issues } from "@paperclipai/db";
import type { RuntimeRoutingBindingRow } from "./store.js";
import { privateConfigDigest } from "../mimouse-private-prompt-tests/profile.js";
/** Bind task text and authorization scope, not mutable queue ownership bookkeeping. */
export function runtimeRoutingTaskDigest(issue: typeof issues.$inferSelect) {
  return privateConfigDigest({ title: issue.title, description: issue.description, priority: issue.priority, reviewPolicy: issue.reviewPolicy, sourceTrust: issue.sourceTrust,
    executionWorkspacePreference: issue.executionWorkspacePreference, parentId: issue.parentId,
    projectId: issue.projectId, projectWorkspaceId: issue.projectWorkspaceId, assigneeAgentId: issue.assigneeAgentId,
    assigneeUserId: issue.assigneeUserId, responsibleUserId: issue.responsibleUserId, createdByUserId: issue.createdByUserId,
    visibility: issue.visibility, privacyParentIssueId: issue.privacyParentIssueId, goalId: issue.goalId, workMode: issue.workMode,
    harnessKind: issue.harnessKind, originKind: issue.originKind, originId: issue.originId,
    assigneeAdapterOverrides: issue.assigneeAdapterOverrides, executionWorkspaceSettings: issue.executionWorkspaceSettings,
    executionPolicy: issue.executionPolicy });
}
export function runtimeRoutingIssueMatches(issue: typeof issues.$inferSelect, row: RuntimeRoutingBindingRow) {
  return issue.companyId === row.companyId && issue.id === row.issueId && !issue.projectId && !issue.parentId &&
    !issue.conversationAgentId && !issue.conversationUserId && !issue.harnessKind && issue.workMode === "standard" &&
    issue.visibility === "open" && issue.assigneeAgentId === row.selectedAgentId && !issue.assigneeUserId &&
    issue.originKind === "runtime_cost_routing" && issue.originId === row.id &&
    ["backlog", "todo", "in_progress"].includes(issue.status) && runtimeRoutingTaskDigest(issue) === row.taskDigest;
}
export function runtimeRoutingRunMatches(row: RuntimeRoutingBindingRow, run: typeof heartbeatRuns.$inferSelect, issueId: string | null) {
  return row.companyId === run.companyId && row.runId === run.id && row.selectedAgentId === run.agentId && row.issueId === run.issueId && row.issueId === issueId &&
    row.state === "run_claimed" && !!row.dispatchActorSessionId && !!row.dispatchActorUserId && run.runtimeMode === "legacy" && !run.retryOfRunId && !run.scheduledRetryReason &&
    !run.contextSnapshot?.aiRouterSelection && !run.contextSnapshot?.aiConnection && !run.contextSnapshot?.routineId;
}
