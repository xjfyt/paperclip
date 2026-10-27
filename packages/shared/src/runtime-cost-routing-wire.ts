import { z } from "zod";
import { runtimeRoutingPolicySchema, runtimeRoutingCandidateSchema, runtimeRoutingCandidateEvidenceSchema,
  prepareRuntimeRoutingPolicySchema, runtimeRoutingRequestQuerySchema, runtimeRoutingRequestClosureReasons, runtimeRoutingBindingStates } from "./runtime-cost-routing.js";
/** Exact wire allowlists: reject unrecognized raw content before a UI can cache or render it. */
export const runtimeRoutingUuidSchema = z.string().uuid().transform(value => value.toLowerCase());
const uuid = runtimeRoutingUuidSchema;
const hash = z.string().regex(/^[a-f0-9]{64}$/), date = z.string().datetime();
const generation = z.number().int().min(0).max(2147483646);
const target = z.object({ schemaVersion: z.literal(1), adapterType: z.literal("claude_local"), engine: z.literal("cli"),
  slot: z.literal("claude_cli_literal_supplement_v1"), model: z.string().min(1), environmentId: uuid,
  targetDigest: hash, implementationDigest: hash, credentials: z.array(z.object({ secretId: uuid, version: z.number().int().positive() }).strict()),
  workspacePolicy: z.literal("configured_cwd_with_managed_agent_home_v1"), scope: z.literal("new_projectless_tasks_first_fresh_dispatch"),
  completeContextCaptured: z.literal(false), ordinaryToolsQualityProven: z.literal(false), }).strict();
export const runtimePolicyRecordSchema = z.object({ id: uuid, requestId: uuid, companyId: uuid, actorUserId: z.string().min(1), expectedGeneration: generation,
  policy: runtimeRoutingPolicySchema, candidates: z.array(z.object({ candidate: runtimeRoutingCandidateSchema, evidence: runtimeRoutingCandidateEvidenceSchema, target }).strict()).min(1).max(20),
  approvalDigest: hash, approvalExpiresAt: date, approvalClosedAt: date.nullable(), createdAt: date, executionStarted: z.literal(false),
}).strict().superRefine((row, ctx) => {
  if (Date.parse(row.approvalExpiresAt) <= Date.parse(row.createdAt)
    || (row.approvalClosedAt !== null && Date.parse(row.approvalClosedAt) < Date.parse(row.approvalExpiresAt))
    || row.candidates.length !== row.policy.candidates.length || new Set(row.candidates.map(item => item.candidate.agentId)).size !== row.candidates.length || row.candidates.some(item => {
    const { candidate, evidence, target: snapshot } = item;
    return JSON.stringify(candidate) !== JSON.stringify(row.policy.candidates.find(value => value.agentId === candidate.agentId)) || evidence.companyId !== row.companyId || evidence.actorUserId !== row.actorUserId
      || evidence.agentId !== candidate.agentId || evidence.promptId !== candidate.promptId || evidence.revisionId !== candidate.comparison.candidateRevisionId
      || evidence.datasetId !== row.policy.datasetId || evidence.datasetHash !== row.policy.datasetHash || evidence.model !== snapshot.model;
  })) ctx.addIssue({ code: "custom", message: "runtime_routing_response_binding_invalid" });
});
export const runtimeReceiptSchema = z.object({ id: uuid, requestId: uuid, policyId: uuid, action: z.enum(["approve", "disable"]), generation,
  createdAt: date, executionStarted: z.literal(false) }).strict();
export const runtimeBindingSchema = z.object({ id: uuid, requestId: uuid, companyId: uuid, issueId: uuid, policyId: uuid, generation,
  selectedAgentId: uuid, decisionDigest: hash, taskDigest: hash, state: z.enum(runtimeRoutingBindingStates), dispatchRequestId: uuid.nullable(), runId: uuid.nullable(),
  createdAt: date, wakeRequestedAt: date.nullable(), startRequestedAt: date.nullable(), providerConsumed: z.literal(false), futureCostQuoted: z.literal(false), }).strict();
export const runtimeCurrentSchema = z.object({ enabled: z.boolean(), companyPaused: z.boolean(), generation, policyId: uuid.nullable(), configuredAt: date.nullable(), policy: runtimePolicyRecordSchema.nullable() }).strict();
const closureSchema = z.object({ outcome: z.literal("not_applied_closed"), requestId: uuid, action: runtimeRoutingRequestQuerySchema.shape.action,
  reason: z.enum(runtimeRoutingRequestClosureReasons), currentGeneration: generation }).strict();
export const runtimeRequestResultSchema = z.object({ enabled: z.boolean(), companyPaused: z.boolean(), policy: runtimePolicyRecordSchema.nullable(), receipt: runtimeReceiptSchema.nullable(), binding: runtimeBindingSchema.nullable(), closure: closureSchema.nullable() }).strict();
export const runtimePrepareResultSchema = z.object({ item: runtimePolicyRecordSchema, duplicate: z.boolean() }).strict();
export const runtimeReceiptResultSchema = z.object({ receipt: runtimeReceiptSchema, duplicate: z.boolean() }).strict();
export const runtimeBindingResultSchema = z.object({ binding: runtimeBindingSchema, duplicate: z.boolean() }).strict();
export const runtimeBindingReadSchema = z.object({ binding: runtimeBindingSchema }).strict();
export const runtimePolicyReadSchema = z.object({ item: runtimePolicyRecordSchema, enabled: z.boolean(), companyPaused: z.boolean() }).strict();
export type RuntimePolicyRecord = z.infer<typeof runtimePolicyRecordSchema>;
export type RuntimeBinding = z.infer<typeof runtimeBindingSchema>;
export type RuntimeCurrent = z.infer<typeof runtimeCurrentSchema>;

const scope = { version: z.literal(2), companyId: uuid, userId: z.string().min(1), sessionId: z.string().min(1), authEpoch: z.number().int().nonnegative() };
const base = { ...scope, requestId: uuid };
export const routingJournalSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("prepare"), payload: prepareRuntimeRoutingPolicySchema }).strict(),
  z.object({ ...base, action: z.literal("approve"), policyId: uuid, payload: z.object({ requestId: uuid, expectedGeneration: generation, approvalDigest: hash }).strict() }).strict(),
  z.object({ ...base, action: z.literal("disable"), policyId: uuid, payload: z.object({ requestId: uuid, expectedGeneration: generation }).strict() }).strict(),
  z.object({ ...base, action: z.literal("create_task"), policyId: uuid, inputDigest: hash, payload: z.object({ requestId: uuid, expectedGeneration: generation }).strict() }).strict(),
  z.object({ ...base, action: z.literal("run"), bindingId: uuid, payload: z.object({ requestId: uuid }).strict() }).strict(),
]).refine(value => value.requestId === value.payload.requestId, "routing_journal_request_mismatch");
export type RoutingJournal = z.infer<typeof routingJournalSchema>;
export type RoutingScope = Pick<RoutingJournal, "companyId" | "userId" | "sessionId" | "authEpoch">;
export const routingBindingReferenceSchema = z.object({ ...scope, bindingId: uuid }).strict();
