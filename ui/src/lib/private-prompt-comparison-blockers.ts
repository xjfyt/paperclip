import type { PrivatePromptComparison } from "@paperclipai/shared/mimouse-private-prompt-comparison";
type Code = PrivatePromptComparison["blockers"][number] | NonNullable<PrivatePromptComparison["results"][number]["blocked"]>;
/** Only server-owned codes have translations; IDs, hashes and unknown text do not. */
export const privateComparisonBlockerLabels: Readonly<Record<Code, string>> = {
  incomplete_or_mismatched_evidence: "blockerIncompleteEvidence",
  candidate_not_all_passed: "blockerCandidateNotAllPassed",
  quality_regressed: "blockerQualityRegressed",
  candidate_cost_unknown: "blockerCandidateCostUnknown",
  baseline_cost_unknown: "blockerBaselineCostUnknown",
  candidate_cost_exceeds_limit: "blockerCandidateCostExceedsLimit",
  missing_run: "blockerMissingRun",
  run_not_succeeded: "blockerRunNotSucceeded",
  unsupported_output_format: "blockerUnsupportedOutputFormat",
  input_snapshot_mismatch: "blockerInputSnapshotMismatch",
  output_missing: "blockerOutputMissing",
  execution_context_unknown: "blockerExecutionContextUnknown",
  execution_context_mismatch: "blockerExecutionContextMismatch",
};
export function privateComparisonBlockerLabel(code: string): string | null {
  return Object.entries(privateComparisonBlockerLabels).find(([known]) => known === code)?.[1] ?? null;
}
