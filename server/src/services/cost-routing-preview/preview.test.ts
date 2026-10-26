import { describe, expect, it } from "vitest";
import { routingPolicySchema } from "@paperclipai/shared/cost-routing-preview";
import type { EvaluationReport } from "@paperclipai/shared/mimouse-evaluation";
import { evaluateRoutingPreview, type RoutingEvidence } from "./evaluate.js";
import { qualifyRoutingCapture, type RoutingCaptureCase } from "./proof.js";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const h = "a".repeat(64), now = new Date("2026-10-26T00:00:00Z");
function fixture(): RoutingCaptureCase[] {
  return [{ companyId: id(1), agentId: id(2), adapterType: "qoder_cn", caseId: id(3), skillRunId: id(4), issueId: id(5), configHash: h, executionContextHash: h,
    costs: [{ id: id(6), companyId: id(1), agentId: id(2), heartbeatRunId: id(7), model: "test-model", provider: "test-provider",
      billingType: "metered_api", costStatus: "reported", costCents: "100.0000000" }],
    heartbeats: [{ id: id(7), companyId: id(1), agentId: id(2), issueId: id(5), dispatchedAdapterType: "qoder_cn", status: "succeeded", costAccountingPending: false,
      costAccountedAt: now, finishedAt: now, usageJson: { accountingReceiptId: id(8), accountingReceiptReady: true } }],
    receipts: [{ id: id(8), companyId: id(1), runId: id(7), receiptHash: h, complete: true, receiptJson: {
      schema: "paperclip/accounting-receipt/v1", adapterType: "qoder_cn", companyId: id(1), runId: id(7), receipt: { complete: true, usageBasis: "per_run",
        model: "test-model", provider: "test-provider", billingType: "api", costStatus: "reported", costUsd: 1, pricingProvenance: { source: "provider_reported" } } } }] }];
}
function setup() {
  const proof = qualifyRoutingCapture(id(1), fixture())!;
  const policy = routingPolicySchema.parse({ datasetId: id(9), datasetHash: h, minimumPassRate: 1, maxEvidenceAgeHours: 24,
    requiredCapabilities: [], candidates: [{ agentId: id(2), provider: "test-provider", model: "test-model", reportId: id(10), reportHash: h, executionContextHash: h }] });
  const summary = { versionId: id(11), cases: 1, passed: 1, blocked: 0, knownCostCents: 100, unknownCostCases: 0, totalCostCents: 100 };
  const report: EvaluationReport = { schemaVersion: 1, companyId: id(1), skillId: id(12), datasetId: id(9), datasetHash: h,
    scorer: "exact_text_v1", costBasis: "recorded_issue_ledger_snapshot", baseline: summary, candidate: summary, passCountDelta: 0,
    blockers: [], eligibleForHumanReview: true, results: [{ versionId: id(11), caseId: id(3), runId: id(4), outputHash: h, passed: true, blocked: null }],
    executionStarted: false, promoted: false, reportHash: h };
  const evidence: RoutingEvidence[] = [{ agentId: id(2), available: true, adapterType: "qoder_cn", configuredModel: "test-model",
    report, createdAt: now.toISOString(), executionContextHashes: [h], configHash: h, routingEvidenceV1: proof }];
  return { policy, evidence, proof };
}
describe("routing capture boundary", () => {
  it("captures explicit backend USD diagnostics without certifying execution context", () => {
    expect(qualifyRoutingCapture(id(1), fixture())).toMatchObject({ currency: "USD", unit: "cent", costCents: "100.0000000", agentId: id(2), executionContextVerification: "unverified_test_creation_snapshot" });
  });
  it.each(["missing", "multiple", "unpriced", "foreign", "agent", "unaccounted", "pending", "extra_run", "adapter", "dispatch_adapter", "model", "credits", "currency", "partial", "amount"])("blocks %s evidence", kind => {
    const rows = fixture(), row = rows[0]!;
    const part = (row.receipts[0]!.receiptJson as { receipt: Record<string, unknown> }).receipt;
    if (kind === "missing") row.costs = [];
    if (kind === "multiple") row.costs.push({ ...row.costs[0]! });
    if (kind === "unpriced") row.costs[0]!.costStatus = "unpriced";
    if (kind === "foreign") row.receipts[0]!.companyId = id(99);
    if (kind === "agent") row.heartbeats[0]!.agentId = id(99);
    if (kind === "unaccounted") row.heartbeats[0]!.costAccountedAt = null;
    if (kind === "extra_run") row.heartbeats.push({ ...row.heartbeats[0]!, id: id(99), costAccountedAt: null });
    if (kind === "pending") row.heartbeats[0]!.costAccountingPending = true;
    if (kind === "dispatch_adapter") row.heartbeats[0]!.dispatchedAdapterType = "changed_before_dispatch";
    if (kind === "adapter") (row.receipts[0]!.receiptJson as Record<string, unknown>).adapterType = "different_adapter";
    if (kind === "model") part.model = "other";
    if (kind === "credits") { delete part.costUsd; part.credits = 1; }
    if (kind === "currency") part.currency = "CNY";
    if (kind === "partial") part.complete = false;
    if (kind === "amount") part.costUsd = 0;
    expect(qualifyRoutingCapture(id(1), rows)).toBeNull();
  });
});
describe("policy preview", () => {
  it("keeps valid USD costs diagnostic until actual dispatch context is bound", () => {
    const { policy, evidence } = setup();
    expect(evaluateRoutingPreview(id(1), 1, policy, evidence, true, now)).toMatchObject({ outcome: "blocked",
      selectedAgentId: null, executionStarted: false, budgetReserved: false, dispatchAuthority: false });
  });
  it("blocks config changed after test creation and restored before preview", () => {
    const { policy, evidence, proof } = setup();
    // Creation and current config match, while actual dispatch used another
    // instruction/runtime context. There is no run-bound proof of equivalence.
    expect(evidence[0]!.configHash).toBe(proof.configHash);
    const result = evaluateRoutingPreview(id(1), 1, policy, evidence, true, now);
    expect(result.candidates[0]!.blockers).toContain("execution_context_unverified");
    expect(result.selectedAgentId).toBeNull();
  });
  it("rejects invented client price/score/evidence fields", () => {
    const { policy } = setup();
    for (const key of ["price", "score", "routingEvidenceV1"]) expect(routingPolicySchema.safeParse({ ...policy, [key]: 0 }).success).toBe(false);
  });
  it.each(["legacy", "stale", "future", "mixed_future", "context", "coverage", "quality", "capability", "model", "company"])("blocks %s candidate", kind => {
    const { policy, evidence, proof } = setup();
    if (kind === "legacy") evidence[0]!.routingEvidenceV1 = null;
    if (kind === "stale") proof.oldestFinishedAt = "2026-09-01T00:00:00Z";
    if (kind === "mixed_future") proof.newestFinishedAt = "2027-01-01T00:00:00Z";
    if (kind === "future") proof.oldestFinishedAt = "2027-01-01T00:00:00Z";
    if (kind === "context") evidence[0]!.configHash = "b".repeat(64);
    if (kind === "coverage") proof.cases[0]!.skillRunId = id(99);
    if (kind === "quality") evidence[0]!.report!.candidate.passed = 0;
    if (kind === "capability") policy.requiredCapabilities = ["confirmedCancellation"];
    if (kind === "dispatch_adapter") row.heartbeats[0]!.dispatchedAdapterType = "changed_before_dispatch";
    if (kind === "adapter") (row.receipts[0]!.receiptJson as Record<string, unknown>).adapterType = "different_adapter";
    if (kind === "model") evidence[0]!.configuredModel = "different";
    if (kind === "company") proof.companyId = id(99);
    expect(evaluateRoutingPreview(id(1), 1, policy, evidence, true, now).selectedAgentId).toBeNull();
  });
  it("is deterministic and never selects even matching creation snapshots", () => {
    const { policy, evidence, proof } = setup();
    policy.candidates.unshift({ ...policy.candidates[0]!, agentId: id(20) });
    evidence.push({ ...evidence[0]!, agentId: id(20), routingEvidenceV1: { ...proof, agentId: id(20) } });
    const before = JSON.stringify(policy);
    expect(evaluateRoutingPreview(id(1), 5, policy, evidence, true, now).selectedAgentId).toBeNull();
    expect(JSON.stringify(policy)).toBe(before);
  });
});
