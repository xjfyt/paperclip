import { comparePrivatePromptTestsSchema, privatePromptComparisonSchema, type ComparePrivatePromptTests, type PrivatePromptComparison } from "@paperclipai/shared/mimouse-private-prompt-comparison";
import { requestResponse } from "./client";
import { readApiJson } from "./response";

/** Validate the complete private identity before exposing any comparison in UI. */
export function verifyPrivatePromptComparison(raw: unknown, companyId: string, userId: string, promptId: string, rawInput: ComparePrivatePromptTests): PrivatePromptComparison {
  const input = comparePrivatePromptTestsSchema.parse(rawInput);
  const report = privatePromptComparisonSchema.parse(raw);
  const exceedsLimit = input.maxCandidateCostCents !== null && report.candidate.totalCostCents !== null && report.candidate.totalCostCents > input.maxCandidateCostCents;
  if (report.blockers.includes("candidate_cost_exceeds_limit") !== exceedsLimit) throw Error("private_comparison_cost_limit_invalid");
  const rows = report.results, ids = rows.flatMap(row => row.testId === null ? [] : [row.testId]);
  if (report.companyId !== companyId.toLowerCase() || report.actorUserId !== userId || report.promptId !== promptId.toLowerCase() || report.datasetId !== input.datasetId ||
      report.baseline.revisionId !== input.baselineRevisionId || report.candidate.revisionId !== input.candidateRevisionId ||
      ids.length !== input.testIds.length || new Set(ids).size !== ids.length || ids.some(id => !input.testIds.includes(id)) ||
      rows.some(row => ![input.baselineRevisionId, input.candidateRevisionId].includes(row.revisionId)) ||
      new Set(rows.map(row => JSON.stringify([row.caseId, row.revisionId]))).size !== rows.length ||
      (report.eligibleForHumanReview && (report.blockers.length > 0 || report.baseline.unknownCostCases > 0 || report.candidate.unknownCostCases > 0 ||
        report.candidate.totalCostCents === null || (input.maxCandidateCostCents !== null && report.candidate.totalCostCents > input.maxCandidateCostCents)))) {
    throw Error("private_comparison_binding_invalid");
  }
  for (const summary of [report.baseline, report.candidate]) {
    const side = rows.filter(row => row.revisionId === summary.revisionId);
    if (side.length !== summary.cases || summary.cases < 1 || summary.passed !== side.filter(row => row.passed).length ||
        summary.blocked !== side.filter(row => row.blocked !== null).length || summary.unknownCostCases > summary.cases ||
        (summary.totalCostCents === null) !== (summary.unknownCostCases > 0) ||
        (summary.totalCostCents !== null && summary.totalCostCents !== summary.knownCostCents) ||
        side.some(row => (row.passed && (row.blocked !== null || row.testId === null || row.outputHash === null)) ||
          ((row.testId === null) !== (row.blocked === "missing_run")))) throw Error("private_comparison_summary_invalid");
  }
  const baselineCases = rows.filter(row => row.revisionId === report.baseline.revisionId).map(row => row.caseId).sort();
  const candidateCases = rows.filter(row => row.revisionId === report.candidate.revisionId).map(row => row.caseId).sort();
  if (JSON.stringify(baselineCases) !== JSON.stringify(candidateCases) ||
      (report.eligibleForHumanReview && (report.baseline.blocked > 0 || report.candidate.blocked > 0 || report.candidate.passed !== report.candidate.cases))) {
    throw Error("private_comparison_matrix_invalid");
  }
  return report;
}
/** No list/detail calls, URL coalescing, browser persistence, execution or retry. */
export function privatePromptComparisonApi(companyId: string, userId: string, signal: AbortSignal) {
  return { async compare(promptId: string, raw: ComparePrivatePromptTests) {
    const input = comparePrivatePromptTestsSchema.parse(raw);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await requestResponse(`/companies/${encodeURIComponent(companyId)}/prompt-registry/${encodeURIComponent(promptId)}/comparison`, {
      method: "POST", body: JSON.stringify(input), cache: "no-store", signal,
    });
    const report = verifyPrivatePromptComparison(await readApiJson<unknown>(response), companyId, userId, promptId, input);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return report;
  } };
}
