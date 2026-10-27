import { centsToUnits, usdToUnits, unitsToCents } from "@paperclipai/shared/money";
import { runtimeRoutingCandidateEvidenceSchema, type RuntimeRoutingCandidateInput, type RuntimeRoutingCandidateEvidence } from "@paperclipai/shared/runtime-cost-routing";
import { privatePromptApprovalSnapshotSchema } from "@paperclipai/shared/mimouse-private-prompt-tests";
import { comparePrivatePromptEvidence, type PrivateComparisonEvidence } from "../mimouse-private-prompt-tests/compare.js";
import { privateConfigDigest } from "../mimouse-private-prompt-tests/profile.js";
import { qualifyRoutingCapture, type RoutingCaptureCase } from "../cost-routing-preview/proof.js";
import { receiptFingerprint } from "../receipt-fingerprint.js";
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
function requireProof(value: unknown, code: string): asserts value { if (!value) throw Error(`runtime_routing_${code}`); }
const token = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 2_147_483_647;
const timestamp = (v: Date | null | undefined) => v instanceof Date ? v.getTime() : NaN;
export interface RuntimeRoutingEvidenceConstraints { datasetId: string; datasetHash: string; maxEvidenceAgeHours: number; now: Date }
export const runtimeRoutingProfileHash = (approvalSnapshot: unknown, secretValueHash: string) => privateConfigDigest({ approvalSnapshot, secretValueHash });
export interface RuntimeRoutingAccountingCase extends Omit<RoutingCaptureCase, "costs" | "receipts" | "heartbeats"> {
  costs: Array<RoutingCaptureCase["costs"][number] & { issueId: string | null; biller: string; idempotencyKey: string | null;
    reportedCostCents: string | null; pricingProvenance: unknown; inputTokens: number; cachedInputTokens: number; outputTokens: number; occurredAt: Date }>;
  receipts: Array<RoutingCaptureCase["receipts"][number] & { sourceId: string; sequence: number; receivedAt: Date }>;
  heartbeats: Array<RoutingCaptureCase["heartbeats"][number] & { startedAt: Date | null; accountingProjectionVersion: string | null }>;
}
export interface RuntimeRoutingEvidenceSource {
  comparison: PrivateComparisonEvidence;
  candidate: RuntimeRoutingCandidateInput;
  currentProfileHash: string;
  accounting: RuntimeRoutingAccountingCase[];
  wakes: Array<{ id: string; companyId: string; agentId: string; runId: string | null; status: string;
    source: string; reason: string | null; requestedByActorType: string | null; requestedByActorId: string | null; idempotencyKey: string | null }>;
}
/** Historical private trials are only a bare-text quality proxy. This verifier
 * adds independently settled monetary/model proof; old comparison totals alone
 * never qualify. It neither runs a model nor grants ordinary-tool quality. */
export async function qualifyRuntimeRoutingCandidate(source: RuntimeRoutingEvidenceSource, c: RuntimeRoutingEvidenceConstraints): Promise<RuntimeRoutingCandidateEvidence> {
  const { comparison: e, candidate } = source;
  requireProof(Number.isFinite(timestamp(c.now)) && Number.isInteger(c.maxEvidenceAgeHours) && c.maxEvidenceAgeHours >= 1 && c.maxEvidenceAgeHours <= 720, "invalid_freshness");
  requireProof(e.promptId === candidate.promptId && privateConfigDigest(e.input) === privateConfigDigest(candidate.comparison)
    && e.dataset.id === c.datasetId && e.dataset.datasetHash === c.datasetHash && e.tests.every(t => t.agentId === candidate.agentId), "candidate_scope_mismatch");
  // This existing server scorer validates literal prompt hashes, private issue,
  // agent/run/attempt bindings, immutable dataset/skill/revision and exact output.
  const report = await comparePrivatePromptEvidence(e);
  requireProof(report.agentId === candidate.agentId && report.eligibleForHumanReview && report.blockers.length === 0, "quality_evidence_invalid");
  const candidateTests = e.tests.filter(t => t.revisionId === candidate.comparison.candidateRevisionId).sort((a, b) => a.caseId.localeCompare(b.caseId));
  requireProof(candidateTests.length > 0 && candidateTests.length <= 100 && source.accounting.length === candidateTests.length
    && new Set(source.accounting.map(r => r.skillRunId)).size === candidateTests.length, "coverage_mismatch");
  const cases: RuntimeRoutingCandidateEvidence["cases"] = [];
  let total = 0n, oldest = Infinity, newest = -Infinity, profileHash: string | null = null, model: string | null = null;
  for (const row of candidateTests) {
    const snapshot = privatePromptApprovalSnapshotSchema.parse(row.approvalSnapshot);
    const rowProfile = runtimeRoutingProfileHash(snapshot, row.secretValueHash);
    requireProof(rowProfile === source.currentProfileHash && (!profileHash || profileHash === rowProfile), "profile_changed");
    profileHash = rowProfile;
    const accounting = source.accounting.find(r => r.skillRunId === row.id);
    requireProof(accounting && accounting.caseId === row.caseId && accounting.agentId === row.agentId && accounting.issueId === row.issueId
      && accounting.companyId === e.actor.companyId && accounting.adapterType === "claude_local"
      && accounting.configHash === row.configDigest && accounting.executionContextHash === report.contextHash, "accounting_binding_mismatch");
    const proof = qualifyRoutingCapture(e.actor.companyId, [accounting]);
    requireProof(proof && proof.model === snapshot.model && proof.provider === "anthropic", "settled_cost_unverified");
    const run = accounting.heartbeats.find(r => r.id === row.heartbeatRunId)!;
    const cost = accounting.costs[0]!, usage = object(run.usageJson);
    const receipts = accounting.receipts.filter(r => r.runId === run.id);
    requireProof(receipts.length === 1, "receipt_history_ambiguous");
    const receipt = receipts[0]!, envelope = object(receipt.receiptJson), part = object(envelope.receipt);
    requireProof(receipt.receiptHash === receiptFingerprint(envelope) && envelope.id === receipt.id
      && envelope.sourceId === receipt.sourceId && envelope.sequence === receipt.sequence && receipt.sequence === 1
      && usage.accountingReceiptSourceId === receipt.sourceId && usage.accountingReceiptSequence === receipt.sequence
      && envelope.receivedAt === receipt.receivedAt.toISOString(), "receipt_integrity_failed");
    requireProof(part.biller === "anthropic" && object(part.pricingProvenance).version === "claude-cli/private-prompt/v1"
      && cost.biller === "anthropic" && cost.issueId === row.issueId && cost.idempotencyKey === `heartbeat:${run.id}:final`
      && object(cost.pricingProvenance).source === "provider_reported" && object(cost.pricingProvenance).version === "claude-cli/private-prompt/v1"
      && cost.reportedCostCents !== null && centsToUnits(cost.reportedCostCents) === centsToUnits(cost.costCents)
      && usage.model === proof.model && usage.provider === proof.provider && usage.billingType === "metered_api"
      && usage.costStatus === "reported" && run.accountingProjectionVersion === "v2", "reported_provenance_unverified");
    const wake = source.wakes.filter(w => w.id === row.wakeupRequestId);
    requireProof(wake.length === 1 && wake[0].companyId === row.companyId && wake[0].agentId === row.agentId && wake[0].runId === run.id
      && wake[0].status === "completed" && wake[0].source === "on_demand" && wake[0].reason === "private_prompt_test"
      && wake[0].requestedByActorType === "user" && wake[0].requestedByActorId === e.actor.userId
      && wake[0].idempotencyKey === `private-prompt-test:${row.id}`, "wakeup_binding_mismatch");
    const finished = timestamp(run.finishedAt), accounted = timestamp(run.costAccountedAt), received = timestamp(receipt.receivedAt);
    const started = timestamp(run.startedAt), spawned = timestamp(row.spawnedAt), now = c.now.getTime();
    requireProof([finished, accounted, received, started, spawned, timestamp(cost.occurredAt)].every(Number.isFinite)
      && started <= spawned && spawned <= received && received <= finished && finished <= accounted
      && timestamp(cost.occurredAt) === finished && Math.max(finished, accounted, received, spawned) <= now, "evidence_future_or_invalid_time");
    requireProof(now - finished <= c.maxEvidenceAgeHours * 3_600_000, "evidence_stale");
    // A requested/init model, zero-filled token fallback or multiple models is
    // not an actual-model receipt. Compare complete CLI accounting to the journal
    // AND ledger, never to a caller-declared score/currency or current model name.
    const result = object(row.privateResult?.resultJson), byModel = object(result.modelUsage);
    requireProof(Object.keys(byModel).length === 1 && Object.keys(byModel)[0] === proof.model, "actual_model_unverified");
    const detail = object(byModel[proof.model]);
    requireProof(["inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens"].every(k => token(detail[k])), "complete_usage_required");
    const counts = { inputTokens: Number(detail.inputTokens) + Number(detail.cacheCreationInputTokens),
      cachedInputTokens: Number(detail.cacheReadInputTokens), outputTokens: Number(detail.outputTokens) };
    const capturedUsage = object(part.usage);
    requireProof(Object.entries(counts).every(([k, v]) => token(v) && capturedUsage[k] === v && usage[k] === v && cost[k as keyof typeof counts] === v), "usage_ledger_mismatch");
    const reportedUsd = result.total_cost_usd;
    requireProof(typeof reportedUsd === "number" && Number.isFinite(reportedUsd) && reportedUsd >= 0
      && typeof detail.costUSD === "number" && Number.isFinite(detail.costUSD) && detail.costUSD >= 0
      && usdToUnits(reportedUsd) === usdToUnits(detail.costUSD) && usdToUnits(reportedUsd) === centsToUnits(cost.costCents), "cli_cost_ledger_mismatch");
    requireProof(model === null || model === proof.model, "mixed_models"); model = proof.model;
    total += centsToUnits(cost.costCents); oldest = Math.min(oldest, finished); newest = Math.max(newest, finished);
    cases.push({ caseId: row.caseId, testId: row.id, heartbeatRunId: run.id, costEventId: cost.id, receiptId: receipt.id,
      receiptHash: receipt.receiptHash, executionContextHash: report.contextHash, costCents: unitsToCents(centsToUnits(cost.costCents)) });
  }
  return runtimeRoutingCandidateEvidenceSchema.parse({ schemaVersion: 2, companyId: e.actor.companyId, actorUserId: e.actor.userId,
    agentId: candidate.agentId, promptId: e.promptId, revisionId: report.candidate.revisionId, revisionHash: report.candidate.revisionHash,
    datasetId: report.datasetId, datasetHash: report.datasetHash, skillVersionId: report.skillVersionId, skillVersionHash: report.skillVersionHash,
    reportHash: report.reportHash, contextHash: report.contextHash, profileHash, provider: "anthropic", model,
    executionProfile: "claude_cli_bare_api_key_v1", qualityBasis: "bare_text_proxy_v1", scorer: "exact_text_v1",
    passedCases: report.candidate.passed, totalCases: report.candidate.cases, observedCostCents: unitsToCents(total),
    costBasis: "settled_per_run_cli_reported_usd", currency: "USD", unit: "cent", oldestFinishedAt: new Date(oldest).toISOString(),
    newestFinishedAt: new Date(newest).toISOString(), cases, completeContextCaptured: false, ordinaryToolsQualityProven: false, futureCostQuoted: false });
}
