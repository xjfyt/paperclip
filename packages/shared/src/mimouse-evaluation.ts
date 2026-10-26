import { z } from "zod";
const uuid = z.string().uuid();
/** Input text is loaded from the existing company skill test input, never submitted. */
export const createEvaluationDatasetSchema = z.object({
  requestId: uuid, skillId: uuid, name: z.string().trim().min(1).max(160),
  cases: z.array(z.object({ inputId: uuid, expected: z.string().min(1).max(32000) }).strict()).min(1).max(100),
}).strict().refine(value => new Set(value.cases.map(item => item.inputId)).size === value.cases.length, "Duplicate input")
  .refine(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 500_000, "Dataset too large");
export const createEvaluationComparisonSchema = z.object({
  requestId: uuid, datasetId: uuid, baselineVersionId: uuid, candidateVersionId: uuid,
  runIds: z.array(uuid).max(200), maxCandidateCostCents: z.number().int().safe().nonnegative().nullable(),
}).strict().refine(value => value.baselineVersionId !== value.candidateVersionId, "Distinct versions required")
  .refine(value => new Set(value.runIds).size === value.runIds.length, "Duplicate run");
export type CreateEvaluationDataset = z.infer<typeof createEvaluationDatasetSchema>;
export type CreateEvaluationComparison = z.infer<typeof createEvaluationComparisonSchema>;
export interface EvaluationFixedCase { id: string; input: string; sourceInputSnapshot?: string; expected: string }
export interface EvaluationSummary { versionId: string; cases: number; passed: number; blocked: number; knownCostCents: number; unknownCostCases: number; totalCostCents: number | null }
export interface EvaluationReport {
  schemaVersion: 1; companyId: string; skillId: string; datasetId: string; datasetHash: string; scorer: "exact_text_v1";
  costBasis: "recorded_issue_ledger_snapshot"; baseline: EvaluationSummary; candidate: EvaluationSummary; passCountDelta: number;
  blockers: string[]; eligibleForHumanReview: boolean;
  results: Array<{ caseId: string; versionId: string; runId: string | null; supersededAt?: string | null; outputHash: string | null; passed: boolean; blocked: string | null }>;
  executionStarted: false; promoted: false; reportHash: string;
}
export interface EvaluationDatasetRecord { id: string; companyId: string; skillId: string; name: string; datasetHash: string; cases: EvaluationFixedCase[]; createdAt: string }
export interface EvaluationComparisonRecord { id: string; companyId: string; datasetId: string; report: EvaluationReport; createdAt: string }
