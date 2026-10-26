import { z } from "zod";
import { evidenceCapabilities } from "./capability-evidence.js";
const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const model = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/)
  .refine(value => !/(?:https?:|bearer|secret|password|token|sk-|ghp_)/i.test(value), "Use a non-sensitive model identifier");
export const routingPolicySchema = z.object({
  datasetId: uuid, datasetHash: digest,
  minimumPassRate: z.number().finite().min(0).max(1),
  maxEvidenceAgeHours: z.number().int().min(1).max(720),
  requiredCapabilities: z.array(z.enum(evidenceCapabilities)).max(7),
  candidates: z.array(z.object({ agentId: uuid, provider: model, model, reportId: uuid, reportHash: digest,
    executionContextHash: digest }).strict()).min(1).max(20),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.candidates.map(c => c.agentId)).size !== value.candidates.length
    || new Set(value.requiredCapabilities).size !== value.requiredCapabilities.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate candidate or capability" });
  }
});
export const saveRoutingPolicySchema = z.object({ expectedRevision: z.number().int().min(0).max(2147483646),
  requestId: uuid, policy: routingPolicySchema }).strict();
export const createRoutingPreviewSchema = z.object({ requestId: uuid,
  policyRevision: z.number().int().min(1).max(2147483647) }).strict();
export type RoutingPolicy = z.infer<typeof routingPolicySchema>;
export type SaveRoutingPolicy = z.infer<typeof saveRoutingPolicySchema>;
export type CreateRoutingPreview = z.infer<typeof createRoutingPreviewSchema>;
export const routingBlockers = ["company_inactive", "agent_unavailable", "configured_model_mismatch", "report_missing",
  "report_pin_mismatch", "dataset_mismatch", "evidence_stale", "evidence_future", "quality_below_threshold",
  "report_not_qualifying", "execution_context_mismatch", "agent_model_mapping_unverified",
  "cost_currency_unit_unverified", "cost_unknown", "capability_unsupported", "capability_unverified", "evidence_context_changed", "evidence_coverage_mismatch", "execution_context_unverified"] as const;
export type RoutingBlocker = typeof routingBlockers[number];
export interface RoutingPreview {
  schemaVersion: 1; companyId: string; policyRevision: number; evaluatedAt: string;
  outcome: "blocked"; selectedAgentId: null;
  candidates: Array<{ agentId: string; reportId: string; blockers: RoutingBlocker[];
    observedPassRate: number | null; evidenceHash: string | null; comparableCost: null }>;
  executionStarted: false; budgetReserved: false; dispatchAuthority: false;
  reason: "trusted_routing_evidence_unavailable";
}
export interface RoutingPolicyRecord { revision: number; policy: RoutingPolicy; createdAt: string }
export interface RoutingPreviewRecord { id: string; receiptHash: string; preview: RoutingPreview }
/** Internal, backend-produced evidence. Never accepted by policy/preview requests. */
export const routingEvidenceV1Schema = z.object({
  version: z.literal(1), executionContextVerification: z.literal("unverified_test_creation_snapshot"),
  companyId: uuid, agentId: uuid, adapterType: model, provider: model, model, configHash: digest,
  currency: z.literal("USD"), unit: z.literal("cent"), costCents: z.string().regex(/^\d+\.\d{7}$/),
  basis: z.literal("accounted_per_run_provider_reported_usd"), oldestFinishedAt: z.string().datetime(), newestFinishedAt: z.string().datetime(),
  cases: z.array(z.object({ caseId: uuid, skillRunId: uuid, heartbeatRunId: uuid, costEventId: uuid,
    receiptId: uuid, receiptHash: digest, executionContextHash: digest }).strict()).min(1).max(100),
}).strict();
export type RoutingEvidenceV1 = z.infer<typeof routingEvidenceV1Schema>;
