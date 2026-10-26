import { describe, expect, it } from "vitest";
import { assertResearchReportIdentity, type ResearchReportIdentity } from "./policy.js";
function identity(): ResearchReportIdentity {
  return { companyId: "company", routineId: "routine", routineRunId: "trigger-run", issueId: "task",
    actor: { type: "agent", source: "agent_jwt", companyId: "company", agentId: "agent", runId: "run" },
    routine: { companyId: "company", id: "routine" },
    routineRun: { companyId: "company", id: "trigger-run", routineId: "routine", linkedIssueId: "task", status: "issue_created" },
    issue: { companyId: "company", id: "task", originKind: "routine_execution", originId: "routine", originRunId: "trigger-run", assigneeAgentId: "agent", checkoutRunId: "run", executionRunId: "run" },
    run: { companyId: "company", id: "run", agentId: "agent", issueId: "task", scopeKind: "issue", status: "running" } };
}
describe("research report trusted execution identity", () => {
  it("accepts only matching live JWT/task/routine identities", () => { expect(() => assertResearchReportIdentity(identity())).not.toThrow(); });
  it.each(["agent_key", "board_key", "session", "local_implicit", "none"])("rejects spoofable run-header actor %s", source => {
    const x = identity(); x.actor.source = source; expect(() => assertResearchReportIdentity(x)).toThrow();
  });
  it.each(["routine", "routineRun", "issue", "run", "actor"] as const)("rejects cross-company %s", field => {
    const x = identity(); x[field].companyId = "other"; expect(() => assertResearchReportIdentity(x)).toThrow();
  });
  const mutations: Array<(x: ResearchReportIdentity) => void> = [
    (x: ResearchReportIdentity) => { x.actor.type = "board"; },
    x => { x.actor.agentId = "other"; }, x => { x.actor.runId = "other"; },
    x => { x.routineRun.linkedIssueId = "other"; }, x => { x.routineRun.routineId = "other"; },
    x => { x.routineRun.status = "coalesced"; }, x => { x.routineRun.id = "other"; },
    x => { x.issue.originKind = "manual"; }, x => { x.issue.originId = "other"; }, x => { x.issue.originRunId = "other"; },
    x => { x.issue.assigneeAgentId = "other"; }, x => { x.issue.checkoutRunId = "other"; }, x => { x.issue.executionRunId = "other"; },
    x => { x.issue.checkoutRunId = null; x.issue.executionRunId = null; },
    x => { x.run.agentId = "other"; }, x => { x.run.scopeKind = "company"; }, x => { x.run.issueId = null; },
    x => { x.run.status = "succeeded"; }, x => { x.run.status = "cancelled"; },
  ];
  it.each(mutations)("rejects forged, stale or unrelated execution %#", mutate => {
    const x = identity(); mutate(x); expect(() => assertResearchReportIdentity(x)).toThrow();
  });
});
