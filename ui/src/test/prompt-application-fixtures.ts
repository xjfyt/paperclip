import type { PromptApplicationRecord, PromptApplicationReceipt, PromptApplicationDispatchReceipt } from "@paperclipai/shared/mimouse-prompt-applications";
import { comparisonId as id, comparisonInput, comparisonReport } from "./private-prompt-comparison-fixtures";
export { comparisonId as applicationId } from "./private-prompt-comparison-fixtures";
export const applicationEvidence = { comparison: comparisonInput, report: comparisonReport() };
export function applicationRecord(patch: Partial<PromptApplicationRecord> = {}): PromptApplicationRecord {
  return { id: id(20), requestId: id(21), companyId: id(1), promptId: id(7), revisionId: comparisonInput.candidateRevisionId, revisionHash: "a".repeat(64), agentId: id(9), actorUserId: "user", expectedGeneration: 0, approvalDigest: "f".repeat(64), comparison: comparisonInput, reportHash: "e".repeat(64),
    snapshot: { schemaVersion: 1, adapterType: "claude_local", engine: "cli", slot: "claude_cli_literal_supplement_v1", model: "claude-test", environmentId: id(22), targetDigest: "a".repeat(64), implementationDigest: "b".repeat(64), credentials: [{ secretId: id(23), version: 1 }], scope: "new_projectless_tasks_first_fresh_dispatch", completeContextCaptured: false, ordinaryToolsQualityProven: false },
    approvalExpiresAt: "2099-10-26T12:00:00.000Z", createdAt: "2026-10-26T12:00:00.000Z", currentGeneration: 0, configured: false, configuredAt: null, dispatchedCount: 0, executionStarted: false, ...patch };
}
export function applicationReceipt(patch: Partial<PromptApplicationReceipt> = {}): PromptApplicationReceipt {
  return { id: id(24), requestId: id(25), applicationId: id(20), agentId: id(9), action: "configure", generation: 1, createdAt: "2026-10-26T12:01:00.000Z", executionStarted: false, ...patch };
}
export function applicationDispatch(patch: Partial<PromptApplicationDispatchReceipt> = {}): PromptApplicationDispatchReceipt {
  return { id: id(26), applicationId: id(20), agentId: id(9), runId: id(27), issueId: id(28), generation: 1, state: "dispatched", configuredAt: "2026-10-26T12:01:00.000Z", preparedAt: "2026-10-26T12:02:00.000Z", dispatchedAt: "2026-10-26T12:03:00.000Z", promptHash: "c".repeat(64), effectiveContextHash: "d".repeat(64), providerConsumed: false, inputDisposition: "unconfirmed", ...patch };
}
