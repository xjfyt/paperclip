import { z } from "zod";
const uuid = z.string().uuid().transform(value => value.toLowerCase()), hash = z.string().regex(/^[a-f0-9]{64}$/);
/** Explicit historical IDs only: no execution, inferred latest run or supplied scores. */
export const comparePrivatePromptTestsSchema = z.object({
  datasetId: uuid, baselineRevisionId: uuid, candidateRevisionId: uuid,
  testIds: z.array(uuid).min(1).max(2000),
  maxCandidateCostCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
}).strict().refine(value => value.baselineRevisionId !== value.candidateRevisionId, "distinct_revisions_required")
  .refine(value => new Set(value.testIds).size === value.testIds.length, "duplicate_test_ids");
export type ComparePrivatePromptTests = z.infer<typeof comparePrivatePromptTestsSchema>;
const count = z.number().int().nonnegative().max(2000), cost = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const summary = z.object({ revisionId: uuid, revisionHash: hash, cases: count, passed: count, blocked: count,
  knownCostCents: cost, unknownCostCases: count, totalCostCents: cost.nullable() }).strict();
export const privatePromptCaseBlockSchema = z.enum(["missing_run", "run_not_succeeded", "unsupported_output_format",
  "input_snapshot_mismatch", "output_missing", "execution_context_unknown", "execution_context_mismatch"]);
export const privatePromptComparisonSchema = z.object({
  schemaVersion: z.literal(1), companyId: uuid, actorUserId: z.string().min(1), promptId: uuid,
  datasetId: uuid, datasetHash: hash, skillVersionId: uuid, skillVersionHash: hash, agentId: uuid, contextHash: hash,
  baseline: summary, candidate: summary,
  results: z.array(z.object({ caseId: uuid, revisionId: uuid, testId: uuid.nullable(), outputHash: hash.nullable(),
    passed: z.boolean(), blocked: privatePromptCaseBlockSchema.nullable() }).strict()).max(2000),
  blockers: z.array(z.enum(["incomplete_or_mismatched_evidence", "candidate_not_all_passed", "quality_regressed",
    "candidate_cost_unknown", "baseline_cost_unknown", "candidate_cost_exceeds_limit"])),
  eligibleForHumanReview: z.boolean(), reportHash: hash,
  readOnly: z.literal(true), executionStarted: z.literal(false), promoted: z.literal(false), runtimeApplied: z.literal(false),
  completeContextCaptured: z.literal(false), costBasis: z.literal("recorded_issue_ledger_snapshot"),
}).strict().superRefine((report, ctx) => {
  const fail = () => ctx.addIssue({ code: "custom", message: "private_comparison_inconsistent_report" });
  if (report.baseline.revisionId === report.candidate.revisionId || report.baseline.cases < 1 ||
      report.baseline.cases !== report.candidate.cases || report.results.length !== report.baseline.cases * 2 ||
      new Set(report.blockers).size !== report.blockers.length) fail();
  const testIds = report.results.flatMap(r => r.testId ? [r.testId] : []);
  if (new Set(testIds).size !== testIds.length) fail();
  const caseSets: Set<string>[] = [];
  for (const side of [report.baseline, report.candidate]) {
    const rows = report.results.filter(r => r.revisionId === side.revisionId), cases = new Set(rows.map(r => r.caseId));
    caseSets.push(cases);
    if (rows.length !== side.cases || cases.size !== side.cases || rows.filter(r => r.passed).length !== side.passed ||
        rows.filter(r => r.blocked !== null).length !== side.blocked || side.unknownCostCases > side.cases ||
        (side.unknownCostCases > 0 ? side.totalCostCents !== null : side.totalCostCents !== side.knownCostCents)) fail();
  }
  if ([...caseSets[0]].some(id => !caseSets[1].has(id)) || report.results.some(r =>
    ![report.baseline.revisionId, report.candidate.revisionId].includes(r.revisionId) ||
    (r.passed && (r.blocked !== null || r.testId === null || r.outputHash === null)) ||
    ((r.testId === null) !== (r.blocked === "missing_run")) || (r.testId === null && r.outputHash !== null))) fail();
  const incomplete = report.baseline.blocked > 0 || report.candidate.blocked > 0;
  if (incomplete !== report.blockers.includes("incomplete_or_mismatched_evidence") ||
      (report.baseline.totalCostCents === null) !== report.blockers.includes("baseline_cost_unknown") ||
      (report.candidate.totalCostCents === null) !== report.blockers.includes("candidate_cost_unknown") ||
      (report.candidate.passed !== report.candidate.cases) !== report.blockers.includes("candidate_not_all_passed") ||
      (report.candidate.passed < report.baseline.passed) !== report.blockers.includes("quality_regressed") ||
      report.eligibleForHumanReview !== (report.blockers.length === 0)) fail();
});
export type PrivatePromptComparison = z.infer<typeof privatePromptComparisonSchema>;
