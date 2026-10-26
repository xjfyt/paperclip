import { and, eq } from "drizzle-orm";
import { heartbeatRuns, issues, type Db } from "@paperclipai/db";
import { issueService, type IssuePostCommitAction } from "../issues.js";
import type { ActivityPublication } from "../activity-log.js";
import { assertPrivatePromptHarness } from "./profile.js";
import type { PrivatePromptRow, PrivatePromptTx } from "./service.js";

/** Server-owned harness lifecycle, never a general completion authority. The row
 * lock plus the existing issue service preserve cancellation/reassignment races. */
export async function completePrivatePromptHarness(db: Db, tx: PrivatePromptTx, binding: PrivatePromptRow,
  runId: string, publications: ActivityPublication[], actions: IssuePostCommitAction[]) {
  const [issue] = await tx.select().from(issues).where(and(eq(issues.id, binding.issueId!), eq(issues.companyId, binding.companyId))).for("update");
  const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.companyId, binding.companyId))).for("share");
  if (!issue || !run || run.status !== "running" || run.agentId !== binding.agentId || binding.heartbeatRunId !== run.id || run.wakeupRequestId !== binding.wakeupRequestId ||
      issue.assigneeUserId !== null ||
      !["todo", "in_progress"].includes(issue.status) || issue.executionRunId !== runId ||
      (issue.checkoutRunId !== null && issue.checkoutRunId !== runId)) return false;
  // A user edit wins. Do not turn a changed resource into an unrelated done task.
  try { assertPrivatePromptHarness(issue, binding); } catch { return false; }
  await issueService(db).update(issue.id, { status: "done", companyGuard: binding.companyId,
    actorAgentId: binding.agentId, actorRunId: runId }, tx, publications, actions);
  return true;
}
