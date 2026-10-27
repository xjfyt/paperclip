// Inert contract/schema checks; no database, CLI, provider, wake or network calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as contract from "../packages/shared/src/runtime-cost-routing.ts";
import { routingPolicySchema } from "../packages/shared/src/cost-routing-preview.ts";
import { runtimeRoutingPolicies, runtimeRoutingHeads, runtimeRoutingReceipts, runtimeRoutingBindings } from "../packages/db/src/schema/runtime_cost_routing.ts";
import { agentWakeupRequests } from "../packages/db/src/schema/agent_wakeup_requests.ts";
const require = createRequire(new URL("../packages/db/package.json", import.meta.url));
const { getTableConfig, PgDialect } = require("drizzle-orm/pg-core");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "a".repeat(64);
const candidate = { agentId: id(1), promptId: id(2), applicationId: id(3), applicationGeneration: 1,
  comparison: { datasetId: id(4), baselineRevisionId: id(5), candidateRevisionId: id(6), testIds: [id(7), id(8)], maxCandidateCostCents: null } };
const policy = { datasetId: id(4), datasetHash: hash, minimumPassRate: 1, maxEvidenceAgeHours: 24, candidates: [candidate] };
const prepared = { requestId: id(9), expectedGeneration: 0, policy };
const evidence = { schemaVersion: 2, companyId: id(10), actorUserId: "owner", agentId: id(1), promptId: id(2),
  revisionId: id(6), revisionHash: hash, datasetId: id(4), datasetHash: hash, skillVersionId: id(11), skillVersionHash: hash,
  reportHash: hash, contextHash: hash, profileHash: hash, provider: "anthropic", model: "claude-sonnet-4-20250514",
  executionProfile: "claude_cli_bare_api_key_v1", qualityBasis: "bare_text_proxy_v1", scorer: "exact_text_v1",
  passedCases: 1, totalCases: 1, observedCostCents: "0.0000001", costBasis: "settled_per_run_cli_reported_usd", currency: "USD", unit: "cent",
  oldestFinishedAt: "2026-10-27T00:00:00.000Z", newestFinishedAt: "2026-10-27T00:00:00.000Z",
  cases: [{ caseId: id(12), testId: id(8), heartbeatRunId: id(13), costEventId: id(14), receiptId: id(15), receiptHash: hash, executionContextHash: hash, costCents: "0.0000001" }],
  completeContextCaptured: false, ordinaryToolsQualityProven: false, futureCostQuoted: false };
const ok = (schema, value) => assert.equal(schema.safeParse(value).success, true);
const bad = (schema, value) => assert.equal(schema.safeParse(value).success, false);

test("v2 is separate, OFF by default, and v1 rejects v2 policy shapes", () => {
  assert.equal(contract.RUNTIME_COST_ROUTING_VERSION, 2);
  assert.equal(contract.RUNTIME_COST_ROUTING_DEFAULT_ENABLED, false);
  assert.equal(contract.RUNTIME_COST_ROUTING_SCOPE, "new_projectless_tasks_first_fresh_dispatch");
  bad(routingPolicySchema, policy);
});
test("prepare accepts explicit references and normalizes UUID identity", () => {
  ok(contract.prepareRuntimeRoutingPolicySchema, prepared);
  assert.equal(contract.prepareRuntimeRoutingPolicySchema.parse(prepared).approvalValidForMinutes, 60);
  const uppercase = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  assert.equal(contract.runtimeRoutingCandidateSchema.parse({ ...candidate, agentId: uppercase }).agentId, uppercase.toLowerCase());
});
test("policy rejects another dataset, duplicate agent, empty pool and stale bounds", () => {
  for (const patch of [{ candidates: [] }, { candidates: [candidate, candidate] }, { datasetId: id(99) },
    { maxEvidenceAgeHours: 0 }, { maxEvidenceAgeHours: 721 }, { minimumPassRate: 1.1 }]) bad(contract.runtimeRoutingPolicySchema, { ...policy, ...patch });
  bad(contract.runtimeRoutingCandidateSchema, { ...candidate, applicationGeneration: 0 });
});
test("request inputs cannot accept supplied evidence, execution or permission expansion", () => {
  for (const field of ["evidence", "costCents", "provider", "model", "runtimeConfig", "permissions", "secret", "target"]) {
    bad(contract.runtimeRoutingCandidateSchema, { ...candidate, [field]: "forged" });
  }
  bad(contract.prepareRuntimeRoutingPolicySchema, { ...prepared, executionStarted: true });
  bad(contract.prepareRuntimeRoutingPolicySchema, { ...prepared, policy: { ...policy, enabled: true } });
});
test("approval requires explicit proxy, quote, scope and no-run acknowledgments", () => {
  const approval = { requestId: id(20), expectedGeneration: 0, approvalDigest: hash, confirmBareTextProxy: true,
    confirmHistoricalCostNotQuote: true, confirmNewTasksOnly: true, confirmNoAutomaticRun: true };
  ok(contract.approveRuntimeRoutingPolicySchema, approval);
  for (const key of Object.keys(approval).filter(key => key.startsWith("confirm"))) {
    const missing = { ...approval }; delete missing[key]; bad(contract.approveRuntimeRoutingPolicySchema, missing);
    bad(contract.approveRuntimeRoutingPolicySchema, { ...approval, [key]: false });
  }
  bad(contract.approveRuntimeRoutingPolicySchema, { ...approval, expectedGeneration: 2147483647 });
});
test("task creation and run are separate, bounded and explicitly confirmed", () => {
  const task = { requestId: id(21), expectedGeneration: 1, title: "A new task", confirmOrdinaryTaskVisibility: true };
  ok(contract.createRuntimeRoutingTaskSchema, task);
  for (const field of ["projectId", "parentId", "agentId", "adapterConfig", "sessionId", "executionWorkspaceId", "retry", "wake"]) {
    bad(contract.createRuntimeRoutingTaskSchema, { ...task, [field]: "unapproved" });
  }
  bad(contract.createRuntimeRoutingTaskSchema, { ...task, title: "  " });
  bad(contract.createRuntimeRoutingTaskSchema, { ...task, description: "x".repeat(20001) });
  bad(contract.runRuntimeRoutingTaskSchema, { requestId: id(22) });
  ok(contract.runRuntimeRoutingTaskSchema, { requestId: id(22), confirmExecution: true, confirmPossibleCharges: true });
  bad(contract.disableRuntimeRoutingPolicySchema, { requestId: id(23), expectedGeneration: 0 });
});
test("settled CLI cost metadata keeps narrow quality and future-quote claims false", () => {
  ok(contract.runtimeRoutingCandidateEvidenceSchema, evidence);
  for (const field of ["completeContextCaptured", "ordinaryToolsQualityProven", "futureCostQuoted"]) {
    bad(contract.runtimeRoutingCandidateEvidenceSchema, { ...evidence, [field]: true });
  }
  for (const patch of [{ schemaVersion: 1 }, { provider: "openai" }, { costBasis: "recorded_issue_ledger_snapshot" },
    { qualityBasis: "ordinary_tools" }, { prompt: "private content" }, { totalCostCents: 1 }, { model: "../wrapper" }]) {
    bad(contract.runtimeRoutingCandidateEvidenceSchema, { ...evidence, ...patch });
  }
});
test("fixed precision cost validation never throws on malformed metadata", () => {
  for (const amount of ["1", "1.2", "-1.0000000", "NaN", "1e9", "01.0000000", "0.00000001", "x", "123456789012345678.0000000"]) {
    bad(contract.runtimeRoutingCandidateEvidenceSchema, { ...evidence, observedCostCents: amount });
    bad(contract.runtimeRoutingCandidateEvidenceSchema, { ...evidence, cases: [{ ...evidence.cases[0], costCents: amount }] });
  }
  bad(contract.runtimeRoutingCandidateEvidenceSchema, { ...evidence, observedCostCents: "0.0000002" });
  const cases = [evidence.cases[0], { ...evidence.cases[0], caseId: id(32), testId: id(33), heartbeatRunId: id(34), costEventId: id(35), receiptId: id(36) }];
  ok(contract.runtimeRoutingCandidateEvidenceSchema, { ...evidence, totalCases: 2, cases, observedCostCents: "0.0000002" });
});
test("evidence coverage, identity uniqueness and chronology cannot be omitted", () => {
  bad(contract.runtimeRoutingCandidateEvidenceSchema, { ...evidence, passedCases: 2 });
  bad(contract.runtimeRoutingCandidateEvidenceSchema, { ...evidence, totalCases: 2 });
  bad(contract.runtimeRoutingCandidateEvidenceSchema, { ...evidence, oldestFinishedAt: "2026-10-28T00:00:00.000Z" });
  const unique = { ...evidence.cases[0], caseId: id(32), testId: id(33), heartbeatRunId: id(34), costEventId: id(35), receiptId: id(36) };
  for (const key of ["caseId", "testId", "heartbeatRunId", "costEventId", "receiptId"]) {
    bad(contract.runtimeRoutingCandidateEvidenceSchema, { ...evidence, totalCases: 2, observedCostCents: "0.0000002",
      cases: [evidence.cases[0], { ...unique, [key]: evidence.cases[0][key] }] });
  }
});
test("readback accepts metadata only and requires action-specific scope", () => {
  ok(contract.runtimeRoutingRequestQuerySchema, { action: "approve", policyId: id(40), expectedGeneration: "0" });
  ok(contract.runtimeRoutingRequestQuerySchema, { action: "run", bindingId: id(41) });
  ok(contract.runtimeRoutingRequestQuerySchema, { action: "create_task", expectedGeneration: 1 });
  for (const value of [{}, { action: "run" }, { action: "approve", expectedGeneration: 0 },
    { action: "run", bindingId: id(41), expectedGeneration: 0 }, { action: "disable", expectedGeneration: 1, title: "private" }]) {
    bad(contract.runtimeRoutingRequestQuerySchema, value);
  }
});
test("schema carries scoped FKs, request uniqueness and closed binding states without a database", () => {
  const configs = [runtimeRoutingPolicies, runtimeRoutingHeads, runtimeRoutingReceipts, runtimeRoutingBindings].map(getTableConfig);
  assert.deepEqual(configs.map(c => c.name), ["runtime_routing_policies", "runtime_routing_heads", "runtime_routing_receipts", "runtime_routing_bindings"]);
  assert.equal(configs[1].columns.find(c => c.name === "generation").default, 0);
  assert.equal(configs[1].columns.find(c => c.name === "policy_id").notNull, false);
  assert.equal(configs[3].foreignKeys.length, 4);
  const checks = new Map(configs[3].checks.map(c => [c.name, new PgDialect().sqlToQuery(c.value).sql]));
  for (const name of ["hashes", "generation", "dispatch_shape", "state", "chronology"]) assert.ok(checks.has(`runtime_routing_binding_${name}`));
  for (const state of contract.runtimeRoutingBindingStates) assert.ok(checks.get("runtime_routing_binding_state").includes(`'${state}'`));
  for (const name of ["request", "dispatch", "issue", "run"]) assert.ok(configs[3].indexes.some(i => i.config.name === `runtime_routing_binding_${name}`));
  const fence = getTableConfig(agentWakeupRequests).indexes.find(i => i.config.name === "agent_wakeup_requests_runtime_cost_routing_uq");
  assert.equal(fence.config.unique, true);
  const where = new PgDialect().sqlToQuery(fence.config.where).sql;
  assert.match(where, /runtime-cost-routing:%/); assert.doesNotMatch(where, /status/);
});
