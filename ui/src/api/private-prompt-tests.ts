import type { PreparePrivatePromptTest, ExecutePrivatePromptTest, CancelPrivatePromptTest, PrivatePromptTestRecord, PrivatePromptPreparedWitness, PrivatePromptTestCapabilities } from "@paperclipai/shared/mimouse-private-prompt-tests";
import { requestResponse } from "./client";
import { readApiJson } from "./response";
export function privateObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("private_response_invalid");
  return value as Record<string, unknown>;
}
export function privateString(value: unknown): string { if (typeof value !== "string" || !value) throw Error("private_response_invalid"); return value; }
export function privateUuid(value: unknown): string { const text = privateString(value); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw Error("private_response_invalid"); return text; }
export function privateHash(value: unknown): string { const text = privateString(value); if (!/^[a-f0-9]{64}$/.test(text)) throw Error("private_response_invalid"); return text; }
function date(value: unknown) { const text = privateString(value); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(text) || !Number.isFinite(Date.parse(text))) throw Error("private_response_invalid"); return text; }
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null { return value === null ? null : parse(value); }
function literal<T>(value: unknown, expected: T): T { if (value !== expected) throw Error("private_response_invalid"); return expected; }
const profile = (value: unknown) => literal(value, "claude_cli_bare_api_key_v1" as const);
export type VerifiedPrivatePromptRecord = Omit<PrivatePromptTestRecord, "prepared"> & { prepared: (PrivatePromptPreparedWitness & { runtimeConfigHash?: string }) | null };
export const privatePromptRecordSchema = { parse(raw: unknown): VerifiedPrivatePromptRecord {
  const r = privateObject(raw), status = privateString(r.status);
  if (!["awaiting_confirmation", "pending_harness", "pending_wake", "queued", "prepared", "spawned", "completed", "failed", "unknown", "cancelled"].includes(status)) throw Error("private_response_invalid");
  const row: VerifiedPrivatePromptRecord = {
    id: privateUuid(r.id), companyId: privateUuid(r.companyId), actorUserId: privateString(r.actorUserId), promptId: privateUuid(r.promptId), requestId: privateUuid(r.requestId),
    revisionId: privateUuid(r.revisionId), headReceiptId: nullable(r.headReceiptId, privateUuid), approvalDigest: privateHash(r.approvalDigest), executionProfile: profile(r.executionProfile),
    agentId: privateUuid(r.agentId), datasetId: privateUuid(r.datasetId), caseId: privateUuid(r.caseId), skillVersionId: privateUuid(r.skillVersionId),
    status: status as PrivatePromptTestRecord["status"], issueId: nullable(r.issueId, privateUuid), heartbeatRunId: nullable(r.heartbeatRunId, privateUuid), prepared: null,
    spawnedAt: nullable(r.spawnedAt, date), errorCode: nullable(r.errorCode, privateString), createdAt: date(r.createdAt), updatedAt: date(r.updatedAt), runtimeApplied: literal(r.runtimeApplied, false),
  };
  if (r.prepared !== null) {
    const p = privateObject(r.prepared);
    if (typeof p.promptBytes !== "number" || !Number.isSafeInteger(p.promptBytes) || p.promptBytes < 0) throw Error("private_response_invalid");
    row.prepared = { schemaVersion: literal(p.schemaVersion, 1), testId: privateUuid(p.testId), attemptId: privateUuid(p.attemptId), companyId: privateUuid(p.companyId), issueId: privateUuid(p.issueId), heartbeatRunId: privateUuid(p.heartbeatRunId),
      agentId: privateUuid(p.agentId), revisionId: privateUuid(p.revisionId), headReceiptId: nullable(p.headReceiptId, privateUuid), revisionHash: privateHash(p.revisionHash), promptHash: privateHash(p.promptHash), promptBytes: p.promptBytes,
      implementation: literal(p.implementation, "paperclip.builtin.claude-local.cli.literal.v1"), providerConsumed: literal(p.providerConsumed, false), stdinWritten: literal(p.stdinWritten, false),
      ...(p.runtimeConfigHash === undefined ? {} : { runtimeConfigHash: privateHash(p.runtimeConfigHash) }) };
    if (row.prepared.testId !== row.id || row.prepared.companyId !== row.companyId || row.prepared.agentId !== row.agentId || row.prepared.revisionId !== row.revisionId || row.prepared.headReceiptId !== row.headReceiptId || row.prepared.issueId !== row.issueId || row.prepared.heartbeatRunId !== row.heartbeatRunId) throw Error("private_response_invalid");
  }
  if (["prepared", "spawned", "completed"].includes(row.status) && !row.prepared) throw Error("private_response_invalid");
  if (["spawned", "completed"].includes(row.status) && !row.spawnedAt) throw Error("private_response_invalid");
  return row;
} };
export const privatePromptResponseSchema = { parse(raw: unknown) { const r = privateObject(raw); if (typeof r.duplicate !== "boolean") throw Error("private_response_invalid"); return { item: privatePromptRecordSchema.parse(r.item), duplicate: r.duplicate }; } };
export type VerifiedPrivatePromptDetail = { item: VerifiedPrivatePromptRecord; privateResult: { summary: string | null; resultJson: Record<string, unknown> | null } | null; contentDisposition: "untrusted_inert_text" };
function jsonValue(value: unknown, depth = 0, count = { nodes: 0 }): void {
  if (++count.nodes > 4096 || depth > 16) throw Error("private_response_invalid");
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) { value.forEach(item => jsonValue(item, depth + 1, count)); return; }
  const object = privateObject(value); Object.values(object).forEach(item => jsonValue(item, depth + 1, count));
}
export const privatePromptDetailSchema = { parse(raw: unknown): VerifiedPrivatePromptDetail {
  const r = privateObject(raw), result = r.privateResult === null ? null : privateObject(r.privateResult);
  if (result && result.summary !== null && typeof result.summary !== "string") throw Error("private_response_invalid");
  if (result) { jsonValue(result); if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 128000) throw Error("private_response_invalid"); }
  const item = privatePromptRecordSchema.parse(r.item);
  if (item.status === "completed" && result === null) throw Error("private_response_invalid");
  return { item, privateResult: result ? { summary: result.summary as string | null, resultJson: nullable(result.resultJson, privateObject) } : null, contentDisposition: literal(r.contentDisposition, "untrusted_inert_text") };
} };
const capabilitiesSchema = { parse(raw: unknown): PrivatePromptTestCapabilities { const r = privateObject(raw); if (typeof r.enabled !== "boolean") throw Error("private_response_invalid"); return { enabled: r.enabled, profile: profile(r.profile), privateResults: literal(r.privateResults, true), toolsEnabled: literal(r.toolsEnabled, false), completeContextCaptured: literal(r.completeContextCaptured, false) }; } };
const privatePromptPageSchema = { parse(raw: unknown) { const r = privateObject(raw); if (!Array.isArray(r.items)) throw Error("private_response_invalid"); return { items: r.items.map(privatePromptRecordSchema.parse), nextBeforeId: nullable(r.nextBeforeId, privateUuid) }; } };
/** Runtime validation precedes any UI acknowledgement; never coalesce private GETs. */
export function privatePromptTestsApi(companyId: string, signal: AbortSignal) {
  const root = `/companies/${encodeURIComponent(companyId)}/prompt-registry`;
  async function send<T>(path: string, schema: { parse: (value: unknown) => T }, body?: unknown): Promise<T> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await requestResponse(`${root}${path}`, { method: body === undefined ? "GET" : "POST", signal, cache: "no-store", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = schema.parse(await readApiJson<unknown>(response));
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return value;
  }
  const path = (promptId: string, testId?: string) => `/${encodeURIComponent(promptId)}/tests${testId ? `/${encodeURIComponent(testId)}` : ""}`;
  return {
    capabilities: () => send("/test-capabilities", capabilitiesSchema),
    list: (promptId: string, beforeId?: string | null) => send(`${path(promptId)}${beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : ""}`, privatePromptPageSchema),
    detail: (promptId: string, testId: string) => send(path(promptId, testId), privatePromptDetailSchema),
    prepare: (promptId: string, body: PreparePrivatePromptTest) => send(path(promptId), privatePromptResponseSchema, body),
    execute: (promptId: string, testId: string, body: ExecutePrivatePromptTest) => send(`${path(promptId, testId)}/execute`, privatePromptResponseSchema, body),
    cancel: (promptId: string, testId: string, body: CancelPrivatePromptTest) => send(`${path(promptId, testId)}/cancel`, privatePromptResponseSchema, body),
  };
}
