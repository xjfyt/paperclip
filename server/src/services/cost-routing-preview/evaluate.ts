import { createHash } from "node:crypto";
import { compareCents } from "@paperclipai/shared/money";
import { routingEvidenceV1Schema } from "@paperclipai/shared/cost-routing-preview";
import type { EvaluationReport } from "@paperclipai/shared/mimouse-evaluation";
import { capabilityBaseline } from "@paperclipai/shared/capability-evidence";
import type { RoutingPolicy, RoutingPreview, RoutingBlocker } from "@paperclipai/shared/cost-routing-preview";
export interface RoutingEvidence {
  agentId: string; available: boolean; adapterType: string; configuredModel: string | null;
  report: EvaluationReport | null; createdAt: string | null; executionContextHashes: string[]; configHash: string | null; routingEvidenceV1: unknown;
}
/** Nonbinding recommendation from exact, server-captured accounting evidence only.
 * Manual capability attestations never qualify a required capability. */
export function evaluateRoutingPreview(companyId: string, revision: number, policy: RoutingPolicy,
  evidence: RoutingEvidence[], companyActive: boolean, now: Date): RoutingPreview {
  const result: RoutingPreview = { schemaVersion: 1, companyId, policyRevision: revision, evaluatedAt: now.toISOString(),
    outcome: "blocked", selectedAgentId: null, reason: "trusted_routing_evidence_unavailable",
    executionStarted: false, budgetReserved: false, dispatchAuthority: false,
    candidates: [...policy.candidates].sort((a, b) => a.agentId < b.agentId ? -1 : 1).map(candidate => {
      const source = evidence.find(item => item.agentId === candidate.agentId);
      const blockers: RoutingBlocker[] = [];
      if (!companyActive) blockers.push("company_inactive");
      if (!source?.available) blockers.push("agent_unavailable");
      if (!source?.configuredModel || source.configuredModel !== candidate.model) blockers.push("configured_model_mismatch");
      const report = source?.report;
      let observedPassRate: number | null = null;
      if (!report) blockers.push("report_missing");
      else {
        if (report.companyId !== companyId || report.reportHash !== candidate.reportHash) blockers.push("report_pin_mismatch");
        if (report.datasetId !== policy.datasetId || report.datasetHash !== policy.datasetHash) blockers.push("dataset_mismatch");
        const parsedProof = routingEvidenceV1Schema.safeParse(source!.routingEvidenceV1);
        const captured = Date.parse(parsedProof.success ? parsedProof.data.oldestFinishedAt : source!.createdAt ?? "");
        if (!Number.isFinite(captured) || now.getTime() - captured > policy.maxEvidenceAgeHours * 3600000) blockers.push("evidence_stale");
        if (captured > now.getTime() || (parsedProof.success && Date.parse(parsedProof.data.newestFinishedAt) > now.getTime())) blockers.push("evidence_future");
        const summary = report.candidate;
        if (summary.cases > 0 && Number.isInteger(summary.cases) && Number.isInteger(summary.passed)
          && summary.passed >= 0 && summary.passed <= summary.cases) observedPassRate = summary.passed / summary.cases;
        if (observedPassRate === null || observedPassRate < policy.minimumPassRate) blockers.push("quality_below_threshold");
        if (!report.eligibleForHumanReview || report.blockers.length || summary.blocked
          || report.scorer !== "exact_text_v1" || report.schemaVersion !== 1) blockers.push("report_not_qualifying");
        if (!source!.executionContextHashes.length || source!.executionContextHashes.some(hash => hash !== candidate.executionContextHash)) blockers.push("execution_context_mismatch");
        if (summary.totalCostCents === null || !Number.isFinite(summary.totalCostCents) || summary.totalCostCents < 0
          || summary.unknownCostCases > 0) blockers.push("cost_unknown");
      }
      // Never relabel ledger cents/credits as USD, or claim a model was tested merely
      // because the current agent config happens to use the same model identifier.
      const proof = routingEvidenceV1Schema.safeParse(source?.routingEvidenceV1);
      if (!proof.success) blockers.push("agent_model_mapping_unverified", "cost_currency_unit_unverified");
      else {
        const value = proof.data;
        if (value.companyId !== companyId || value.agentId !== candidate.agentId || value.model !== candidate.model || value.provider !== candidate.provider) blockers.push("agent_model_mapping_unverified");
        if (value.configHash !== source?.configHash || value.cases.some(c => c.executionContextHash !== candidate.executionContextHash)) blockers.push("evidence_context_changed");
        const results = report?.results.filter(r => r.versionId === report.candidate.versionId) ?? [];
        if (value.cases.length !== report?.candidate.cases || value.cases.length !== results.length
          || new Set(value.cases.map(c => c.caseId)).size !== value.cases.length
          || value.cases.some(c => !results.some(r => r.caseId === c.caseId && r.runId === c.skillRunId && !r.blocked && !r.supersededAt))) blockers.push("evidence_coverage_mismatch");
      }
      for (const capability of policy.requiredCapabilities) {
        const baseline = capabilityBaseline(source?.adapterType ?? "", capability);
        blockers.push(baseline === "unsupported" ? "capability_unsupported" : "capability_unverified");
      }
      return { agentId: candidate.agentId, reportId: candidate.reportId, blockers: [...new Set(blockers)], observedPassRate, evidenceHash: proof.success ? createHash("sha256").update(JSON.stringify(proof.data)).digest("hex") : null,
        comparableCost: proof.success && !blockers.length ? { currency: "USD" as const, unit: "cent" as const, amount: proof.data.costCents } : null };
    }) };
  const eligible = result.candidates.filter(c => c.comparableCost && !c.blockers.length);
  eligible.sort((a, b) => compareCents(a.comparableCost!.amount, b.comparableCost!.amount) || (a.agentId < b.agentId ? -1 : 1));
  if (eligible.length) { result.outcome = "recommended_for_review"; result.selectedAgentId = eligible[0]!.agentId; result.reason = "lowest_recorded_qualifying_cost"; }
  return result;
}
