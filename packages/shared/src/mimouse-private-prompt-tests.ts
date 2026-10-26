import { z } from "zod";
const uuid = z.string().uuid();
/** A test is a separate, explicitly billable operation, never a registry selection. */
export const createPrivatePromptTestSchema = z.object({
  requestId: uuid,
  revisionId: uuid,
  expectedHeadReceiptId: uuid.nullable(),
  agentId: uuid,
  datasetId: uuid,
  caseId: uuid,
  skillVersionId: uuid,
  executionProfile: z.literal("claude_cli_bare_api_key_v1"),
  confirmRestrictedProfile: z.literal(true),
  confirmExecution: z.literal(true),
  confirmPossibleCharges: z.literal(true),
}).strict();
export type CreatePrivatePromptTest = z.infer<typeof createPrivatePromptTestSchema>;
/** Metadata-only snapshot preparation. This endpoint cannot dispatch execution. */
export const preparePrivatePromptTestSchema = createPrivatePromptTestSchema.omit({
  confirmRestrictedProfile: true, confirmExecution: true, confirmPossibleCharges: true,
});
export type PreparePrivatePromptTest = z.infer<typeof preparePrivatePromptTestSchema>;
export const executePrivatePromptTestSchema = z.object({
  approvalDigest: z.string().regex(/^[a-f0-9]{64}$/),
  executionProfile: z.literal("claude_cli_bare_api_key_v1"),
  confirmRestrictedProfile: z.literal(true), confirmExecution: z.literal(true), confirmPossibleCharges: z.literal(true),
}).strict();
export type ExecutePrivatePromptTest = z.infer<typeof executePrivatePromptTestSchema>;
export const cancelPrivatePromptTestSchema = executePrivatePromptTestSchema.pick({ approvalDigest: true });
export type CancelPrivatePromptTest = z.infer<typeof cancelPrivatePromptTestSchema>;

export type PrivatePromptTestStatus = "awaiting_confirmation" | "pending_harness" | "pending_wake" | "queued" | "prepared" | "spawned" | "completed" | "failed" | "unknown" | "cancelled";
export interface PrivatePromptPreparedWitness {
  schemaVersion: 1;
  testId: string; attemptId: string; companyId: string; issueId: string; heartbeatRunId: string;
  agentId: string; revisionId: string; headReceiptId: string | null;
  revisionHash: string; promptHash: string; promptBytes: number;
  runtimeConfigHash: string;
  implementation: "paperclip.builtin.claude-local.cli.literal.v1";
  providerConsumed: false;
  stdinWritten: false;
}
/** Server-owned, non-secret preparation summary; not a complete execution context. */
export const privatePromptApprovalSnapshotSchema = z.object({
  schemaVersion: z.literal(1), executionProfile: z.literal("claude_cli_bare_api_key_v1"),
  adapterType: z.literal("claude_local"), engine: z.literal("cli"),
  model: z.string().max(256).regex(/^claude-[a-zA-Z0-9.-]+$/), configuredCwd: z.string().min(1).max(4096).nullable(),
  environment: z.object({ source: z.enum(["agent", "instance", "implicit"]), id: uuid, driver: z.literal("local") }).strict(),
  credential: z.object({ kind: z.literal("pinned_company_secret"), secretId: uuid, version: z.number().int().positive() }).strict(),
  configDigest: z.string().regex(/^[a-f0-9]{64}$/),
  freshSession: z.literal(true), toolsEnabled: z.literal(false), paperclipCredentialsEnabled: z.literal(false),
  completeContextCaptured: z.literal(false),
}).strict();
export type PrivatePromptApprovalSnapshot = z.infer<typeof privatePromptApprovalSnapshotSchema>;
export interface PrivatePromptTestRecord {
  id: string; companyId: string; actorUserId: string; promptId: string; revisionId: string; agentId: string;
  requestId: string; headReceiptId: string | null; approvalDigest: string;
  executionProfile: "claude_cli_bare_api_key_v1";
  approvalSnapshot: PrivatePromptApprovalSnapshot | null;
  datasetId: string; caseId: string; skillVersionId: string;
  status: PrivatePromptTestStatus; issueId: string | null; heartbeatRunId: string | null;
  prepared: PrivatePromptPreparedWitness | null; spawnedAt: string | null;
  errorCode: string | null; createdAt: string; updatedAt: string;
  runtimeApplied: false;
}

/** execute never restarts queued/prepared/spawned/completed/failed/unknown/cancelled.
 * Only awaiting_confirmation can be admitted; pending_harness/pending_wake may
 * recover the same uniquely fenced intent. A late execute cannot undo cancel. */
export interface PrivatePromptTestResponse {
  item: PrivatePromptTestRecord;
  duplicate: boolean;
}
export interface PrivatePromptTestDetail {
  item: PrivatePromptTestRecord;
  privateResult: { summary: string | null; resultJson: Record<string, unknown> | null } | null;
  contentDisposition: "untrusted_inert_text";
}
export interface PrivatePromptTestCapabilities {
  enabled: boolean;
  profile: "claude_cli_bare_api_key_v1";
  privateResults: true;
  toolsEnabled: false;
  completeContextCaptured: false;
}
