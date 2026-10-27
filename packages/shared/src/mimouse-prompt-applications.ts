import { z } from "zod";
import { comparePrivatePromptTestsSchema, type ComparePrivatePromptTests } from "./mimouse-private-prompt-comparison.js";
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const PROMPT_APPLICATION_SLOT = "claude_cli_literal_supplement_v1" as const;
export const preparePromptApplicationSchema = z.object({
  requestId: uuid, agentId: uuid, expectedGeneration: z.number().int().nonnegative(),
  comparison: comparePrivatePromptTestsSchema, approvalValidForMinutes: z.number().int().min(10).max(1440).default(60),
}).strict();
export const approvePromptApplicationSchema = z.object({
  requestId: uuid, expectedGeneration: z.number().int().nonnegative(), approvalDigest: digest,
  confirmOrdinaryVisibility: z.literal(true), confirmBareComparisonNotToolQuality: z.literal(true),
  confirmNewTasksOnly: z.literal(true), confirmNoAutomaticRun: z.literal(true),
}).strict();
export const rollbackPromptApplicationSchema = z.object({
  requestId: uuid, expectedGeneration: z.number().int().positive(),
}).strict();
export type PreparePromptApplication = z.infer<typeof preparePromptApplicationSchema>;
export type ApprovePromptApplication = z.infer<typeof approvePromptApplicationSchema>;
export type RollbackPromptApplication = z.infer<typeof rollbackPromptApplicationSchema>;
export interface PromptApplicationSnapshot {
  schemaVersion: 1; adapterType: "claude_local"; engine: "cli"; slot: typeof PROMPT_APPLICATION_SLOT;
  model: string; environmentId: string; targetDigest: string; implementationDigest: string;
  credentials: Array<{ secretId: string; version: number }>;
  workspacePolicy: "configured_cwd_with_managed_agent_home_v1";
  scope: "new_projectless_tasks_first_fresh_dispatch";
  completeContextCaptured: false; ordinaryToolsQualityProven: false;
}
export interface PromptApplicationRecord {
  id: string; requestId: string; companyId: string; promptId: string; revisionId: string; revisionHash: string;
  agentId: string; actorUserId: string; expectedGeneration: number; approvalDigest: string;
  comparison: ComparePrivatePromptTests; reportHash: string; snapshot: PromptApplicationSnapshot;
  approvalExpiresAt: string; createdAt: string;
  currentGeneration: number; configured: boolean; configuredAt: string | null;
  dispatchedCount: number; executionStarted: false;
}
export interface PromptApplicationReceipt {
  id: string; requestId: string; applicationId: string; agentId: string; action: "configure" | "rollback";
  generation: number; createdAt: string; executionStarted: false;
}
export interface PromptApplicationDispatchReceipt {
  id: string; applicationId: string; agentId: string; runId: string; issueId: string; generation: number;
  state: "prepared" | "dispatched"; configuredAt: string; preparedAt: string;
  dispatchedAt: string | null; promptHash: string | null; effectiveContextHash: string;
  providerConsumed: false;
  inputDisposition: "unconfirmed" | "not_applied_before_input";
}

export const promptApplicationRequestQuerySchema = z.object({
  applicationId: uuid.optional(), action: z.enum(["approve", "rollback"]).optional(), expectedGeneration: z.coerce.number().int().nonnegative().optional(),
}).strict().refine(value => Object.keys(value).length === 0 || value.applicationId !== undefined && value.action !== undefined && value.expectedGeneration !== undefined);
export type PromptApplicationRequestQuery = z.infer<typeof promptApplicationRequestQuerySchema>;
export interface PromptApplicationRequestClosure {
  outcome: "not_applied_closed"; requestId: string; action: "approve" | "rollback"; applicationId: string; agentId: string;
  expectedGeneration: number; currentGeneration: number; reason: "generation_advanced" | "approval_expired";
}
