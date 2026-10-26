import { createHash } from "node:crypto";
import { runPaperclipEvalMatrix } from "../../vendor/paperclip-eval-kernel/index.js";
import { canonical } from "../mimouse-operations/preview.js";
export interface FixedCase { id: string; input: string; expected: string }
export interface RecordedSkillRun { id: string; companyId: string; skillId: string; versionId: string; caseId: string; inputSnapshot: string; outputSnapshot: string; status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; costCents: number | null; executionContextHash: string | null }
interface Input { companyId: string; skillId: string; datasetId: string; baselineVersionId: string; candidateVersionId: string; cases: FixedCase[]; runs: RecordedSkillRun[]; maxCandidateCostCents: number | null }
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const pair = (versionId: string, caseId: string) => JSON.stringify([versionId, caseId]);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
/** Read-only scoring of server-loaded historical snapshots. This does not
 * execute a skill/model, trust request-supplied scores, or promote a version. */
export async function compareRecordedSkillRuns(input: Input) {
  for (const value of [input.companyId, input.skillId, input.datasetId, input.baselineVersionId, input.candidateVersionId]) if (typeof value !== "string" || !value || value.length > 160) throw Error("invalid_eval_identity");
  if (input.baselineVersionId === input.candidateVersionId) throw Error("distinct_versions_required");
  if (!input.cases.length || input.cases.length > 1000 || input.runs.length > 2000) throw Error("invalid_eval_size");
  if (input.maxCandidateCostCents !== null && (!Number.isSafeInteger(input.maxCandidateCostCents) || input.maxCandidateCostCents < 0)) throw Error("invalid_cost_limit");
  const cases = [...input.cases].sort((a, b) => compare(a.id, b.id)), caseIds = new Set<string>(), runIds = new Set<string>();
  for (const scenario of cases) {
    if (typeof scenario.id !== "string" || !scenario.id || scenario.id.length > 160 || typeof scenario.input !== "string" || !scenario.input || scenario.input.length > 32000 || typeof scenario.expected !== "string" || !scenario.expected || scenario.expected.length > 32000) throw Error("invalid_eval_case");
    if (caseIds.has(scenario.id)) throw Error("duplicate_eval_case"); caseIds.add(scenario.id);
  }
  const records = new Map<string, RecordedSkillRun>();
  for (const run of input.runs) {
    if (typeof run.id !== "string" || !run.id || runIds.has(run.id)) throw Error("duplicate_or_missing_run_id"); runIds.add(run.id);
    if (run.companyId !== input.companyId || run.skillId !== input.skillId || ![input.baselineVersionId, input.candidateVersionId].includes(run.versionId) || !caseIds.has(run.caseId)) throw Error("foreign_eval_evidence");
    if (run.costCents !== null && (!Number.isFinite(run.costCents) || run.costCents < 0)) throw Error("invalid_run_cost");
    if (records.has(pair(run.versionId, run.caseId))) throw Error("ambiguous_case_run"); records.set(pair(run.versionId, run.caseId), run);
  }
  const matrix = await runPaperclipEvalMatrix({
    scenarios: cases.map(scenario => ({ id: scenario.id, input: scenario })),
    candidates: [input.baselineVersionId, input.candidateVersionId].map(id => ({ id, config: { versionId: id } })),
    execute: async ({ scenario, candidate }) => records.get(pair(candidate.id, scenario.id)) ?? null,
    score: ({ scenario, candidate, output }) => {
      const other = records.get(pair(candidate.id === input.baselineVersionId ? input.candidateVersionId : input.baselineVersionId, scenario.id));
      const blocked = !output ? "missing_run" : output.inputSnapshot !== scenario.input.input ? "input_snapshot_mismatch"
        : output.status !== "succeeded" ? "run_not_succeeded" : !output.outputSnapshot ? "output_missing"
        : !output.executionContextHash ? "execution_context_unknown"
        : other?.executionContextHash && output.executionContextHash !== other.executionContextHash ? "execution_context_mismatch" : null;
      return { passed: !blocked && output!.outputSnapshot === scenario.input.expected, blocked };
    },
  });
  function summary(versionId: string) {
    const rows = matrix.filter(row => row.candidateId === versionId), costs = rows.map(row => row.output?.costCents ?? null), knownSubtotal = costs.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    if (!Number.isFinite(knownSubtotal) || knownSubtotal > Number.MAX_SAFE_INTEGER) throw Error("cost_sum_overflow");
    return { versionId, cases: rows.length, passed: rows.filter(row => row.score.passed).length, blocked: rows.filter(row => row.score.blocked).length,
      knownCostCents: knownSubtotal, unknownCostCases: costs.filter(value => value === null).length, totalCostCents: costs.some(value => value === null) ? null : knownSubtotal };
  }
  const baseline = summary(input.baselineVersionId), candidate = summary(input.candidateVersionId);
  const blockers: string[] = [];
  if (baseline.blocked || candidate.blocked) blockers.push("incomplete_or_mismatched_evidence");
  if (candidate.passed !== cases.length) blockers.push("candidate_not_all_passed");
  if (candidate.passed < baseline.passed) blockers.push("quality_regressed");
  if (input.maxCandidateCostCents !== null && (candidate.totalCostCents === null || candidate.totalCostCents > input.maxCandidateCostCents)) blockers.push(candidate.totalCostCents === null ? "candidate_cost_unknown" : "candidate_cost_exceeds_limit");
  const report = { schemaVersion: 1 as const, companyId: input.companyId, skillId: input.skillId, datasetId: input.datasetId, datasetHash: hash(cases), scorer: "exact_text_v1" as const, costBasis: "recorded_issue_ledger_snapshot" as const,
    baseline, candidate, passCountDelta: candidate.passed - baseline.passed, blockers, eligibleForHumanReview: blockers.length === 0,
    results: matrix.map(row => ({ caseId: row.scenarioId, versionId: row.candidateId, runId: row.output?.id ?? null, outputHash: row.output ? hash(row.output.outputSnapshot) : null, ...row.score })),
    executionStarted: false as const, promoted: false as const };
  return { ...report, reportHash: hash(report) };
}
