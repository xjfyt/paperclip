import type { ComparePrivatePromptTests, PrivatePromptComparison } from "@paperclipai/shared/mimouse-private-prompt-comparison";
export const comparisonId = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
export const comparisonInput: ComparePrivatePromptTests = { datasetId: comparisonId(2), baselineRevisionId: comparisonId(3), candidateRevisionId: comparisonId(4), testIds: [comparisonId(5), comparisonId(6)], maxCandidateCostCents: null };
export function comparisonReport(patch: Partial<PrivatePromptComparison> = {}): PrivatePromptComparison {
  const summary = { revisionHash: "a".repeat(64), cases: 1, passed: 1, blocked: 0, knownCostCents: 1, unknownCostCases: 0, totalCostCents: 1 };
  return { schemaVersion: 1, companyId: comparisonId(1), actorUserId: "user", promptId: comparisonId(7),
    datasetId: comparisonInput.datasetId, datasetHash: "a".repeat(64), skillVersionId: comparisonId(8), skillVersionHash: "b".repeat(64), agentId: comparisonId(9), contextHash: "c".repeat(64),
    baseline: { ...summary, revisionId: comparisonInput.baselineRevisionId }, candidate: { ...summary, revisionId: comparisonInput.candidateRevisionId },
    results: [comparisonInput.baselineRevisionId, comparisonInput.candidateRevisionId].map((revisionId, index) => ({ revisionId, caseId: comparisonId(10), testId: comparisonInput.testIds[index]!, outputHash: "d".repeat(64), passed: true, blocked: null })),
    blockers: [], eligibleForHumanReview: true, reportHash: "e".repeat(64), readOnly: true, executionStarted: false, promoted: false, runtimeApplied: false,
    completeContextCaptured: false, costBasis: "recorded_issue_ledger_snapshot", ...patch };
}
