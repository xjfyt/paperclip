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
export type PrivatePromptTestStatus = "pending_harness" | "pending_wake" | "queued" | "prepared" | "spawned" | "completed" | "failed" | "unknown" | "cancelled";
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
export interface PrivatePromptTestRecord {
  id: string; promptId: string; revisionId: string; agentId: string;
  datasetId: string; caseId: string; skillVersionId: string;
  status: PrivatePromptTestStatus; issueId: string | null; heartbeatRunId: string | null;
  prepared: PrivatePromptPreparedWitness | null; spawnedAt: string | null;
  errorCode: string | null; createdAt: string; updatedAt: string;
  runtimeApplied: false;
}

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
