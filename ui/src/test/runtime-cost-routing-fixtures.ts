import type { RuntimeRoutingPolicy, RuntimeRoutingPolicyRecord, RuntimeRoutingBinding, RuntimeRoutingCurrent } from "@paperclipai/shared/runtime-cost-routing";
export const routingId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (letter: string) => letter.repeat(64), now = () => new Date().toISOString();
export function routingPolicy(): RuntimeRoutingPolicy {
  return { datasetId: routingId(2), datasetHash: hash("a"), minimumPassRate: 1, maxEvidenceAgeHours: 24, candidates: [10, 11].map(n => ({
    agentId: routingId(n), promptId: routingId(n + 10), applicationId: routingId(n + 20), applicationGeneration: 1,
    comparison: { datasetId: routingId(2), baselineRevisionId: routingId(n + 30), candidateRevisionId: routingId(n + 40), testIds: [routingId(n + 50), routingId(n + 60)], maxCandidateCostCents: null },
  })) };
}
export function routingRecord(patch: Partial<RuntimeRoutingPolicyRecord> = {}): RuntimeRoutingPolicyRecord {
  const policy = routingPolicy();
  const expiresAt = patch.approvalExpiresAt ?? new Date(patch.approvalClosedAt ? Date.parse(patch.approvalClosedAt) - 60_000 : Date.now() + 3600_000).toISOString();
  const createdAt = new Date(Math.min(Date.now(), Date.parse(expiresAt) - 60_000)).toISOString();
  return { id: routingId(3), requestId: routingId(4), companyId: routingId(1), actorUserId: "owner", expectedGeneration: 0, policy,
    candidates: policy.candidates.map((candidate, index) => ({ candidate, evidence: {
      schemaVersion: 2, companyId: routingId(1), actorUserId: "owner", agentId: candidate.agentId, promptId: candidate.promptId,
      revisionId: candidate.comparison.candidateRevisionId, revisionHash: hash("b"), datasetId: policy.datasetId, datasetHash: policy.datasetHash,
      skillVersionId: routingId(5), skillVersionHash: hash("c"), reportHash: hash("d"), contextHash: hash("e"), profileHash: hash("f"),
      provider: "anthropic", model: `claude-model-${index}`, executionProfile: "claude_cli_bare_api_key_v1", qualityBasis: "bare_text_proxy_v1", scorer: "exact_text_v1",
      passedCases: 1, totalCases: 1, observedCostCents: `${index + 1}.0000000`, costBasis: "settled_per_run_cli_reported_usd", currency: "USD", unit: "cent",
      oldestFinishedAt: now(), newestFinishedAt: now(), cases: [{ caseId: routingId(100), testId: candidate.comparison.testIds[1]!, heartbeatRunId: routingId(110 + index), costEventId: routingId(120 + index), receiptId: routingId(130 + index), receiptHash: hash("a"), executionContextHash: hash("b"), costCents: `${index + 1}.0000000` }],
      completeContextCaptured: false, ordinaryToolsQualityProven: false, futureCostQuoted: false,
    }, target: { schemaVersion: 1, adapterType: "claude_local", engine: "cli", slot: "claude_cli_literal_supplement_v1", model: `claude-model-${index}`,
      environmentId: routingId(140 + index), targetDigest: hash("a"), implementationDigest: hash("b"), credentials: [{ secretId: routingId(150 + index), version: 1 }],
      workspacePolicy: "configured_cwd_with_managed_agent_home_v1", scope: "new_projectless_tasks_first_fresh_dispatch", completeContextCaptured: false, ordinaryToolsQualityProven: false,
    } })), approvalDigest: hash("f"), approvalClosedAt: null, approvalExpiresAt: expiresAt, createdAt, executionStarted: false, ...patch };
}
export function routingHead(active = false, patch: Partial<RuntimeRoutingCurrent> = {}): RuntimeRoutingCurrent {
  return { enabled: true, companyPaused: false, generation: active ? 1 : 0, policyId: active ? routingId(3) : null, configuredAt: active ? now() : null, policy: active ? routingRecord() : null, ...patch };
}
export function routingBinding(patch: Partial<RuntimeRoutingBinding> = {}): RuntimeRoutingBinding {
  return { id: routingId(200), requestId: routingId(201), companyId: routingId(1), issueId: routingId(202), policyId: routingId(3), generation: 1, selectedAgentId: routingId(10), decisionDigest: hash("a"), taskDigest: hash("b"), state: "bound", dispatchRequestId: null, runId: null, createdAt: now(), wakeRequestedAt: null, startRequestedAt: null, providerConsumed: false, futureCostQuoted: false, ...patch };
}
