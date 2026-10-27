import { describe, expect, it } from "vitest";
import type { RuntimeRoutingCandidateSnapshot } from "@paperclipai/shared/runtime-cost-routing";
import { selectRuntimeRoutingCandidate, runtimeRoutingQualityEligible } from "./selection.js";
import { runtimeRoutingWakeAuthority, runtimeRoutingWakeOptions } from "./wake-authority.js";
import { runtimeRoutingIssueMatches, runtimeRoutingRunMatches, runtimeRoutingTaskDigest, runtimeRoutingPreflightError } from "./contract.js";
import { isPrivateIntegrationHttpRequest, privateIntegrationHttpLogUrl } from "../../middleware/http-log-policy.js";
const candidate = (id: string, cost: string, passedCases = 2, totalCases = 2) => ({ candidate: { agentId: id, applicationId: id }, evidence: { observedCostCents: cost, passedCases, totalCases } }) as RuntimeRoutingCandidateSnapshot;
describe("bounded runtime selection", () => {
  it("chooses only quality-eligible own cost, independent of input order", () => {
    const cheapFail = candidate("a", "0.0000000", 0), cheap = candidate("b", "1.0000001"), expensive = candidate("c", "1.0000002");
    expect(selectRuntimeRoutingCandidate([expensive, cheapFail, cheap], 1)).toBe(cheap);
    expect(selectRuntimeRoutingCandidate([cheap, expensive], 1)).toBe(cheap);
  });
  it("uses exact money beyond Number safe precision", () => {
    const lower = candidate("b", "99999999999999999.9999998"), higher = candidate("a", "99999999999999999.9999999");
    expect(selectRuntimeRoutingCandidate([higher, lower], 1)).toBe(lower);
  });
  it("breaks equal cost by quality then deterministic identity", () => {
    const high = candidate("b", "1.0000000"), low = candidate("a", "1.0000000", 1), stable = candidate("a", "1.0000000");
    expect(selectRuntimeRoutingCandidate([low, high], .5)).toBe(high);
    expect(selectRuntimeRoutingCandidate([high, stable], 1)).toBe(stable);
  });
  it("handles exact decimal thresholds including exponential notation and rejects an empty eligible pool", () => {
    expect(runtimeRoutingQualityEligible(candidate("a", "1.0000000", 1, 10), .1)).toBe(true);
    expect(runtimeRoutingQualityEligible(candidate("a", "1.0000000", 1, 10), .10000001)).toBe(false);
    expect(runtimeRoutingQualityEligible(candidate("a", "1.0000000", 0), 1e-7)).toBe(false);
    expect(() => selectRuntimeRoutingCandidate([candidate("a", "1.0000000", 0)], 1)).toThrow("runtime_routing_no_eligible_candidate");
  });
});
it("wake authority is not serializable or forgeable by payload/config copies", () => {
  const opts = runtimeRoutingWakeOptions({ id: "binding", issueId: "task", actorUserId: "owner" });
  expect(runtimeRoutingWakeAuthority(opts)).toBe("binding");
  expect(runtimeRoutingWakeAuthority({ ...opts })).toBe(null);
  expect(runtimeRoutingWakeAuthority(JSON.parse(JSON.stringify(opts)))).toBe(null);
  expect(opts.idempotencyKey).toBe("runtime-cost-routing:binding");
});
const task = { id: "task", companyId: "company", title: "Approved task", description: "Exact initial work", parentId: null, projectId: null,
  projectWorkspaceId: null, assigneeAgentId: "agent", assigneeUserId: null, responsibleUserId: "owner", createdByUserId: "owner", visibility: "open",
  privacyParentIssueId: null, goalId: null, workMode: "standard", harnessKind: null, originKind: "runtime_cost_routing", originId: "binding",
  assigneeAdapterOverrides: null, executionWorkspaceSettings: null, executionPolicy: null, status: "backlog", conversationAgentId: null, conversationUserId: null } as any;
const binding = { id: "binding", companyId: "company", issueId: "task", selectedAgentId: "agent", taskDigest: runtimeRoutingTaskDigest(task),
  runId: "run", state: "run_claimed", dispatchActorSessionId: "session", dispatchActorUserId: "owner" } as any;
const run = { id: "run", companyId: "company", issueId: "task", agentId: "agent", runtimeMode: "legacy", retryOfRunId: null, scheduledRetryReason: null, contextSnapshot: {} } as any;
it("binds initial content and scope while tolerating ordinary queue status progression", () => {
  expect(runtimeRoutingIssueMatches(task, binding)).toBe(true);
  expect(runtimeRoutingIssueMatches({ ...task, status: "in_progress", executionRunId: "run" }, binding)).toBe(true);
});
it.each([{ title: "Other" }, { description: "Other" }, { parentId: "private-parent" }, { projectId: "project" }, { companyId: "foreign" },
  { assigneeAgentId: "fallback" }, { visibility: "private" }, { harnessKind: "skill_test" }, { status: "done" },
  { priority: "critical" }, { reviewPolicy: { required: true } }, { sourceTrust: { level: "low" } }, { executionWorkspacePreference: "new" },
  { assigneeAdapterOverrides: { model: "other" } }, { executionWorkspaceSettings: { mode: "other" } }, { originId: "other" }])("rejects task drift %j", patch => {
  expect(runtimeRoutingIssueMatches({ ...task, ...patch }, binding)).toBe(false);
});
it("allows the one exact durable first run", () => expect(runtimeRoutingRunMatches(binding, run, "task")).toBe(true));
it.each([{ id: "retry" }, { companyId: "foreign" }, { agentId: "fallback" }, { issueId: "different" }, { runtimeMode: "native" },
  { retryOfRunId: "old" }, { scheduledRetryReason: "transient_failure" }, { contextSnapshot: { aiConnection: {} } },
  { contextSnapshot: { aiRouterSelection: {} } }, { contextSnapshot: { routineId: "routine" } }])("rejects run drift %j", patch => {
  expect(runtimeRoutingRunMatches(binding, { ...run, ...patch }, "task")).toBe(false);
});
it("durable start witness prevents same-run replay after restart", () => {
  expect(runtimeRoutingRunMatches({ ...binding, state: "start_requested" }, run, "task")).toBe(false);
});
it.each([{ dispatchActorSessionId: null }, { dispatchActorSessionId: "" }, { dispatchActorUserId: null }, { dispatchActorUserId: "" }])("rejects missing durable dispatch identity %j", patch => {
  expect(runtimeRoutingRunMatches({ ...binding, ...patch }, run, "task")).toBe(false);
});
it("private runtime policy HTTP paths never log supplied identifiers or query/body text", () => {
  for (const url of ["/api/companies/secret/runtime-cost-routing/prepare?input=secret", "https://host/API/companies/secret/RUNTIME-COST-ROUTING/bindings/secret/run"]) {
    expect(isPrivateIntegrationHttpRequest(url)).toBe(true);
    expect(privateIntegrationHttpLogUrl(url)).toBe("/api/companies/:companyId/runtime-cost-routing/:redacted");
  }
});
it("classifies identified routing preflight failures as nonretryable without leaking diagnostics", () => {
  const error = new Error("private proof or database parameter secret");
  expect(runtimeRoutingPreflightError(error, false)).toBe(error);
  const blocked = runtimeRoutingPreflightError(error, true) as Error & { details: unknown };
  expect(blocked.message).toBe("runtime_routing_execution_preflight_denied");
  expect(blocked.details).toEqual({ code: "prompt_application_blocked" });
  expect(runtimeRoutingPreflightError(blocked, true)).toBe(blocked);
});
