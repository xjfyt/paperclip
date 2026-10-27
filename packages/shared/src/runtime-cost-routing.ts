import { z } from "zod";
import { comparePrivatePromptTestsSchema } from "./mimouse-private-prompt-comparison.js";
import type { PromptApplicationSnapshot } from "./mimouse-prompt-applications.js";

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const generation = z.number().int().min(0).max(2147483646);
const decimalCost = /^(?:0|[1-9]\d{0,16})\.\d{7}$/;
const cost = z.string().regex(decimalCost);
const model = z.string().max(160).regex(/^claude-[a-zA-Z0-9.-]+$/);
export const RUNTIME_COST_ROUTING_VERSION = 2 as const;
export const RUNTIME_COST_ROUTING_DEFAULT_ENABLED = false as const;
export const RUNTIME_COST_ROUTING_SCOPE = "new_projectless_tasks_first_fresh_dispatch" as const;

/** References only. Scores, receipts, target snapshots and permissions are server-owned. */
export const runtimeRoutingCandidateSchema = z.object({
  agentId: uuid, promptId: uuid, applicationId: uuid, applicationGeneration: generation.refine(value => value > 0),
  comparison: comparePrivatePromptTestsSchema,
}).strict();
export type RuntimeRoutingCandidateInput = z.infer<typeof runtimeRoutingCandidateSchema>;
export type RuntimeRoutingCandidate = RuntimeRoutingCandidateInput;
export const runtimeRoutingPolicySchema = z.object({
  datasetId: uuid, datasetHash: hash, minimumPassRate: z.number().finite().min(0).max(1),
  maxEvidenceAgeHours: z.number().int().min(1).max(720),
  candidates: z.array(runtimeRoutingCandidateSchema).min(1).max(20),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.candidates.map(candidate => candidate.agentId)).size !== value.candidates.length
    || value.candidates.some(candidate => candidate.comparison.datasetId !== value.datasetId)) {
    ctx.addIssue({ code: "custom", message: "runtime_routing_pool_mismatch" });
  }
});
export type RuntimeRoutingPolicy = z.infer<typeof runtimeRoutingPolicySchema>;
export const prepareRuntimeRoutingPolicySchema = z.object({
  requestId: uuid, expectedGeneration: generation, policy: runtimeRoutingPolicySchema,
  approvalValidForMinutes: z.number().int().min(10).max(1440).default(60),
}).strict();
export const approveRuntimeRoutingPolicySchema = z.object({
  requestId: uuid, expectedGeneration: generation, approvalDigest: hash,
  confirmBareTextProxy: z.literal(true), confirmHistoricalCostNotQuote: z.literal(true),
  confirmNewTasksOnly: z.literal(true), confirmNoAutomaticRun: z.literal(true),
}).strict();
export const disableRuntimeRoutingPolicySchema = z.object({
  requestId: uuid, expectedGeneration: generation.refine(value => value > 0),
}).strict();
/** Creating a normal, company-visible task is distinct from authorizing its run. */
export const createRuntimeRoutingTaskSchema = z.object({
  requestId: uuid, expectedGeneration: generation.refine(value => value > 0),
  title: z.string().trim().min(1).max(512), description: z.string().max(20000).optional(),
  confirmOrdinaryTaskVisibility: z.literal(true),
}).strict();
export const runRuntimeRoutingTaskSchema = z.object({
  requestId: uuid, confirmExecution: z.literal(true), confirmPossibleCharges: z.literal(true),
}).strict();
export type PrepareRuntimeRoutingPolicy = z.infer<typeof prepareRuntimeRoutingPolicySchema>;
export type ApproveRuntimeRoutingPolicy = z.infer<typeof approveRuntimeRoutingPolicySchema>;
export type DisableRuntimeRoutingPolicy = z.infer<typeof disableRuntimeRoutingPolicySchema>;
export type CreateRuntimeRoutingTask = z.infer<typeof createRuntimeRoutingTaskSchema>;
export type RunRuntimeRoutingTask = z.infer<typeof runRuntimeRoutingTaskSchema>;

/** Internal producer output, never a policy input or a provider invoice/price quote. */
export const runtimeRoutingCandidateEvidenceSchema = z.object({
  schemaVersion: z.literal(2), companyId: uuid, actorUserId: z.string().min(1).max(256), agentId: uuid,
  promptId: uuid, revisionId: uuid, revisionHash: hash, datasetId: uuid, datasetHash: hash,
  skillVersionId: uuid, skillVersionHash: hash, reportHash: hash, contextHash: hash, profileHash: hash,
  provider: z.literal("anthropic"), model, executionProfile: z.literal("claude_cli_bare_api_key_v1"),
  qualityBasis: z.literal("bare_text_proxy_v1"), scorer: z.literal("exact_text_v1"),
  passedCases: z.number().int().min(0).max(1000), totalCases: z.number().int().min(1).max(1000),
  observedCostCents: cost, costBasis: z.literal("settled_per_run_cli_reported_usd"),
  currency: z.literal("USD"), unit: z.literal("cent"),
  oldestFinishedAt: z.string().datetime(), newestFinishedAt: z.string().datetime(),
  cases: z.array(z.object({
    caseId: uuid, testId: uuid, heartbeatRunId: uuid, costEventId: uuid, receiptId: uuid,
    receiptHash: hash, executionContextHash: hash, costCents: cost,
  }).strict()).min(1).max(1000),
  completeContextCaptured: z.literal(false), ordinaryToolsQualityProven: z.literal(false), futureCostQuoted: z.literal(false),
}).strict().superRefine((value, ctx) => {
  const unique = (key: "caseId" | "testId" | "heartbeatRunId" | "costEventId" | "receiptId") =>
    new Set(value.cases.map(row => row[key])).size === value.cases.length;
  // Regex failures are nonfatal Zod issues: never feed malformed input to BigInt.
  if (![value.observedCostCents, ...value.cases.map(row => row.costCents)].every(amount => decimalCost.test(amount))) return;
  const units = (amount: string) => BigInt(amount.replace(".", ""));
  if (value.passedCases > value.totalCases || value.cases.length !== value.totalCases
    || !(["caseId", "testId", "heartbeatRunId", "costEventId", "receiptId"] as const).every(unique)
    || Date.parse(value.oldestFinishedAt) > Date.parse(value.newestFinishedAt)
    || value.cases.reduce((sum, row) => sum + units(row.costCents), 0n) !== units(value.observedCostCents)) {
    ctx.addIssue({ code: "custom", message: "runtime_routing_evidence_inconsistent" });
  }
});
export type RuntimeRoutingCandidateEvidence = z.infer<typeof runtimeRoutingCandidateEvidenceSchema>;
export interface RuntimeRoutingCandidateSnapshot {
  candidate: RuntimeRoutingCandidateInput;
  evidence: RuntimeRoutingCandidateEvidence;
  target: PromptApplicationSnapshot;
}
export interface RuntimeRoutingPolicyRecord {
  id: string; requestId: string; companyId: string; actorUserId: string; expectedGeneration: number;
  policy: RuntimeRoutingPolicy; candidates: RuntimeRoutingCandidateSnapshot[]; approvalDigest: string;
  approvalExpiresAt: string; createdAt: string; executionStarted: false;
}
export interface RuntimeRoutingReceipt {
  id: string; requestId: string; policyId: string; action: "approve" | "disable";
  generation: number; createdAt: string; executionStarted: false;
}
export const runtimeRoutingBindingStates = ["bound", "wake_pending", "run_claimed", "start_requested"] as const;
export type RuntimeRoutingBindingState = typeof runtimeRoutingBindingStates[number];
/** Metadata only. start_requested is not proof that the provider consumed input. */
export interface RuntimeRoutingBinding {
  id: string; requestId: string; companyId: string; issueId: string; policyId: string; generation: number;
  selectedAgentId: string; decisionDigest: string; taskDigest: string; state: RuntimeRoutingBindingState;
  dispatchRequestId: string | null; runId: string | null; createdAt: string;
  wakeRequestedAt: string | null; startRequestedAt: string | null;
  providerConsumed: false; futureCostQuoted: false;
}
export interface RuntimeRoutingCurrent {
  enabled: boolean; companyPaused: boolean; generation: number; policyId: string | null;
  configuredAt: string | null; policy: RuntimeRoutingPolicyRecord | null;
}
export const runtimeRoutingRequestQuerySchema = z.object({
  action: z.enum(["prepare", "approve", "disable", "create_task", "run"]),
  expectedGeneration: z.coerce.number().int().min(0).max(2147483646).optional(),
  policyId: uuid.optional(), bindingId: uuid.optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.action === "run") !== (value.bindingId !== undefined)
    || (value.action === "approve") !== (value.policyId !== undefined)
    || (value.action !== "run") !== (value.expectedGeneration !== undefined)) {
    ctx.addIssue({ code: "custom", message: "runtime_routing_request_scope_required" });
  }
});
export type RuntimeRoutingRequestQuery = z.infer<typeof runtimeRoutingRequestQuerySchema>;
/** Readback closes only on persisted monotone facts, never a clock-only expiry. */
export const runtimeRoutingRequestClosureReasons = ["generation_advanced", "binding_already_claimed"] as const;
export interface RuntimeRoutingRequestClosure {
  outcome: "not_applied_closed"; requestId: string; action: RuntimeRoutingRequestQuery["action"];
  reason: typeof runtimeRoutingRequestClosureReasons[number];
  currentGeneration: number;
}
/** All-null is UNKNOWN, not proof of failure; readback never wakes or replays. */
export interface RuntimeRoutingRequestResult {
  enabled: boolean; companyPaused: boolean; policy: RuntimeRoutingPolicyRecord | null;
  receipt: RuntimeRoutingReceipt | null; binding: RuntimeRoutingBinding | null;
  closure: RuntimeRoutingRequestClosure | null;
}
