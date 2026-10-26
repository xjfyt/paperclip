import type { VerifiedPrivatePromptRecord } from "@/api/private-prompt-tests";
import type { PrivatePromptJournal } from "@/lib/private-prompt-journal";
export const ids = { company: "11111111-1111-4111-8111-111111111111", prompt: "22222222-2222-4222-8222-222222222222", revision: "33333333-3333-4333-8333-333333333333", test: "44444444-4444-4444-8444-444444444444", ref: "55555555-5555-4555-8555-555555555555", request: "66666666-6666-4666-8666-666666666666", operation: "77777777-7777-4777-8777-777777777777" };
export const record = (patch: Partial<VerifiedPrivatePromptRecord> = {}): VerifiedPrivatePromptRecord => {
  const hasWitness = ["prepared", "spawned", "completed"].includes(patch.status ?? "");
  return ({ id: ids.test, companyId: ids.company, actorUserId: "user", promptId: ids.prompt, requestId: ids.request,
  revisionId: ids.revision, headReceiptId: null, approvalDigest: "a".repeat(64), executionProfile: "claude_cli_bare_api_key_v1", agentId: ids.ref, datasetId: ids.ref, caseId: ids.ref, skillVersionId: ids.ref,
  approvalSnapshot: { schemaVersion: 1, executionProfile: "claude_cli_bare_api_key_v1", adapterType: "claude_local", engine: "cli", model: "claude-sonnet-4-6", configuredCwd: "/fixture/work",
    environment: { source: "agent", id: ids.ref, driver: "local" }, credential: { kind: "pinned_company_secret", secretId: ids.ref, version: 2 }, configDigest: "d".repeat(64), freshSession: true, toolsEnabled: false, paperclipCredentialsEnabled: false, completeContextCaptured: false },
  status: "awaiting_confirmation", issueId: hasWitness ? ids.ref : null, heartbeatRunId: hasWitness ? ids.ref : null,
  prepared: hasWitness ? { schemaVersion: 1, testId: ids.test, attemptId: ids.ref, companyId: ids.company, issueId: ids.ref, heartbeatRunId: ids.ref, agentId: ids.ref, revisionId: ids.revision, headReceiptId: null,
    revisionHash: "a".repeat(64), promptHash: "b".repeat(64), promptBytes: 42, runtimeConfigHash: "c".repeat(64), implementation: "paperclip.builtin.claude-local.cli.literal.v1", providerConsumed: false, stdinWritten: false } : null,
  spawnedAt: ["spawned", "completed"].includes(patch.status ?? "") ? "2026-10-26T00:00:00.000Z" : null, errorCode: null, createdAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-26T00:00:00.000Z", runtimeApplied: false, ...patch }); };
export const marker = (patch: Partial<PrivatePromptJournal> = {}): PrivatePromptJournal => ({ version: 1, companyId: ids.company, userId: "user", originSessionId: "session", operationId: ids.operation,
  promptId: ids.prompt, requestId: ids.request, revisionId: ids.revision, headReceiptId: null, agentId: ids.ref, datasetId: ids.ref, caseId: ids.ref, skillVersionId: ids.ref,
  executionProfile: "claude_cli_bare_api_key_v1", phase: "execute_pending", testId: ids.test, approvalDigest: "a".repeat(64), ...patch });
export const capabilities = { enabled: true, profile: "claude_cli_bare_api_key_v1", toolsEnabled: false, privateResults: true, completeContextCaptured: false };
