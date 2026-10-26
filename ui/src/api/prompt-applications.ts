import type { PreparePromptApplication, ApprovePromptApplication, RollbackPromptApplication, PromptApplicationRecord, PromptApplicationReceipt, PromptApplicationDispatchReceipt, PromptApplicationSnapshot } from "@paperclipai/shared/mimouse-prompt-applications";
import { comparePrivatePromptTestsSchema } from "@paperclipai/shared/mimouse-private-prompt-comparison";
import { privateObject, privateString, privateUuid, privateHash } from "./private-prompt-tests";
import { requestResponse } from "./client";
import { readApiJson } from "./response";
const uuid = (raw: unknown) => privateUuid(raw).toLowerCase();
const fail = () => { throw Error("prompt_application_response_invalid"); };
const literal = <T,>(raw: unknown, value: T): T => raw === value ? value : fail();
const bool = (raw: unknown) => typeof raw === "boolean" ? raw : fail();
const integer = (raw: unknown, min = 0) => typeof raw === "number" && Number.isSafeInteger(raw) && raw >= min ? raw : fail();
const date = (raw: unknown) => { const value = privateString(raw); return /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) ? value : fail(); };
const nullable = <T,>(raw: unknown, parse: (value: unknown) => T) => raw === null ? null : parse(raw);
const array = <T,>(raw: unknown, parse: (value: unknown) => T) => Array.isArray(raw) ? raw.map(parse) : fail();
export function applicationKeys(raw: unknown, keys: string[]) {
  const row = privateObject(raw);
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) fail();
  return row;
}
function snapshot(raw: unknown): PromptApplicationSnapshot {
  const r = applicationKeys(raw, ["schemaVersion", "adapterType", "engine", "slot", "model", "environmentId", "targetDigest", "implementationDigest", "credentials", "scope", "completeContextCaptured", "ordinaryToolsQualityProven"]);
  return { schemaVersion: literal(r.schemaVersion, 1), adapterType: literal(r.adapterType, "claude_local"), engine: literal(r.engine, "cli"),
    slot: literal(r.slot, "claude_cli_literal_supplement_v1"), model: privateString(r.model), environmentId: uuid(r.environmentId),
    targetDigest: privateHash(r.targetDigest), implementationDigest: privateHash(r.implementationDigest),
    credentials: array(r.credentials, value => { const c = applicationKeys(value, ["secretId", "version"]); return { secretId: uuid(c.secretId), version: integer(c.version, 1) }; }),
    scope: literal(r.scope, "new_projectless_tasks_first_fresh_dispatch"), completeContextCaptured: literal(r.completeContextCaptured, false), ordinaryToolsQualityProven: literal(r.ordinaryToolsQualityProven, false) };
}
export function parsePromptApplication(raw: unknown): PromptApplicationRecord {
  const r = applicationKeys(raw, ["id", "companyId", "promptId", "requestId", "revisionId", "revisionHash", "agentId", "actorUserId", "expectedGeneration", "approvalDigest", "comparison", "reportHash", "snapshot", "approvalExpiresAt", "createdAt", "currentGeneration", "configured", "configuredAt", "dispatchedCount", "executionStarted"]);
  const row: PromptApplicationRecord = { id: uuid(r.id), companyId: uuid(r.companyId), promptId: uuid(r.promptId), requestId: uuid(r.requestId), revisionId: uuid(r.revisionId), revisionHash: privateHash(r.revisionHash), agentId: uuid(r.agentId), actorUserId: privateString(r.actorUserId), expectedGeneration: integer(r.expectedGeneration), approvalDigest: privateHash(r.approvalDigest), comparison: comparePrivatePromptTestsSchema.parse(r.comparison), reportHash: privateHash(r.reportHash), snapshot: snapshot(r.snapshot), approvalExpiresAt: date(r.approvalExpiresAt), createdAt: date(r.createdAt), currentGeneration: integer(r.currentGeneration), configured: bool(r.configured), configuredAt: nullable(r.configuredAt, date), dispatchedCount: integer(r.dispatchedCount), executionStarted: literal(r.executionStarted, false) };
  if (row.revisionId !== row.comparison.candidateRevisionId || (row.configured && (!row.configuredAt || row.currentGeneration !== row.expectedGeneration + 1))) fail();
  return row;
}
export function parseApplicationReceipt(raw: unknown): PromptApplicationReceipt {
  const r = applicationKeys(raw, ["id", "requestId", "applicationId", "agentId", "action", "generation", "createdAt", "executionStarted"]);
  if (r.action !== "configure" && r.action !== "rollback") fail();
  return { id: uuid(r.id), requestId: uuid(r.requestId), applicationId: uuid(r.applicationId), agentId: uuid(r.agentId), action: r.action as PromptApplicationReceipt["action"], generation: integer(r.generation, 1), createdAt: date(r.createdAt), executionStarted: literal(r.executionStarted, false) };
}
function dispatch(raw: unknown): PromptApplicationDispatchReceipt {
  const r = applicationKeys(raw, ["id", "applicationId", "agentId", "runId", "issueId", "generation", "state", "configuredAt", "preparedAt", "dispatchedAt", "promptHash", "effectiveContextHash", "providerConsumed"]);
  if (r.state !== "prepared" && r.state !== "dispatched") fail();
  const row: PromptApplicationDispatchReceipt = { id: uuid(r.id), applicationId: uuid(r.applicationId), agentId: uuid(r.agentId), runId: uuid(r.runId), issueId: uuid(r.issueId), generation: integer(r.generation, 1), state: r.state as PromptApplicationDispatchReceipt["state"], configuredAt: date(r.configuredAt), preparedAt: date(r.preparedAt), dispatchedAt: nullable(r.dispatchedAt, date), promptHash: nullable(r.promptHash, privateHash), effectiveContextHash: privateHash(r.effectiveContextHash), providerConsumed: literal(r.providerConsumed, false) };
  if (row.state === "dispatched" && (!row.dispatchedAt || !row.promptHash)) fail();
  return row;
}
/** No shared GET cache, execution, retries or storage. All responses are identity-bound. */
export function promptApplicationsApi(companyId: string, userId: string, signal: AbortSignal) {
  const root = `/companies/${encodeURIComponent(companyId)}`;
  const path = (promptId: string) => `/prompt-registry/${uuid(promptId)}/applications`;
  async function send(route: string, body?: unknown) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await requestResponse(`${root}${route}`, { method: body === undefined ? "GET" : "POST", signal, cache: "no-store", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await readApiJson<unknown>(response);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return value;
  }
  function record(raw: unknown, promptId: string, requireOwner = true) {
    const row = parsePromptApplication(raw);
    if (row.companyId !== uuid(companyId) || (requireOwner && row.actorUserId !== userId) || row.promptId !== uuid(promptId)) fail();
    return row;
  }
  async function mutation(promptId: string, applicationId: string, action: "approve" | "rollback", body: ApprovePromptApplication | RollbackPromptApplication) {
    applicationKeys(body, action === "approve" ? ["requestId", "expectedGeneration", "approvalDigest", "confirmOrdinaryVisibility", "confirmBareComparisonNotToolQuality", "confirmNewTasksOnly", "confirmNoAutomaticRun"] : ["requestId", "expectedGeneration"]);
    uuid(body.requestId); integer(body.expectedGeneration, action === "rollback" ? 1 : 0);
    if (action === "approve") { const approved = body as ApprovePromptApplication; privateHash(approved.approvalDigest); for (const key of ["confirmOrdinaryVisibility", "confirmBareComparisonNotToolQuality", "confirmNewTasksOnly", "confirmNoAutomaticRun"] as const) literal(approved[key], true); }
    const r = applicationKeys(await send(`${path(promptId)}/${uuid(applicationId)}/${action}`, body), ["receipt", "duplicate"]), receipt = parseApplicationReceipt(r.receipt);
    if (receipt.applicationId !== uuid(applicationId) || receipt.requestId !== uuid(body.requestId) || receipt.action !== (action === "approve" ? "configure" : "rollback") || receipt.generation !== body.expectedGeneration + 1) fail();
    return { receipt, duplicate: bool(r.duplicate) };
  }
  return {
    async list(promptId: string, beforeId?: string | null) {
      const r = applicationKeys(await send(`${path(promptId)}${beforeId ? `?beforeId=${uuid(beforeId)}` : ""}`), ["enabled", "items", "nextBeforeId"]);
      return { enabled: bool(r.enabled), items: array(r.items, value => record(value, promptId, false)), nextBeforeId: nullable(r.nextBeforeId, uuid) };
    },
    async detail(promptId: string, applicationId: string) {
      const r = applicationKeys(await send(`${path(promptId)}/${uuid(applicationId)}`), ["item", "enabled"]), item = record(r.item, promptId, false);
      if (item.id !== uuid(applicationId)) fail();
      return { item, enabled: bool(r.enabled) };
    },
    async head(agentId: string) {
      const r = applicationKeys(await send(`/prompt-applications/agents/${uuid(agentId)}/head`), ["enabled", "generation", "applicationId", "configuredAt"]);
      return { enabled: bool(r.enabled), generation: integer(r.generation), applicationId: nullable(r.applicationId, uuid), configuredAt: nullable(r.configuredAt, date) };
    },
    async prepare(promptId: string, body: PreparePromptApplication) {
      applicationKeys(body, ["requestId", "agentId", "expectedGeneration", "comparison", "approvalValidForMinutes"]);
      const input = { requestId: uuid(body.requestId), agentId: uuid(body.agentId), expectedGeneration: integer(body.expectedGeneration), comparison: comparePrivatePromptTestsSchema.parse(body.comparison), approvalValidForMinutes: integer(body.approvalValidForMinutes, 10) };
      if (input.approvalValidForMinutes > 1440) fail();
      const r = applicationKeys(await send(path(promptId), input), ["item", "duplicate"]), item = record(r.item, promptId);
      if (item.requestId !== input.requestId || item.agentId !== input.agentId || item.expectedGeneration !== input.expectedGeneration || JSON.stringify(item.comparison) !== JSON.stringify(input.comparison)) fail();
      return { item, duplicate: bool(r.duplicate) };
    },
    approve: (promptId: string, applicationId: string, body: ApprovePromptApplication) => mutation(promptId, applicationId, "approve", body),
    rollback: (promptId: string, applicationId: string, body: RollbackPromptApplication) => mutation(promptId, applicationId, "rollback", body),
    async request(promptId: string, requestId: string) {
      const r = applicationKeys(await send(`${path(promptId)}/requests/${uuid(requestId)}`), ["application", "receipt", "enabled"]);
      const application = nullable(r.application, value => record(value, promptId)), receipt = nullable(r.receipt, parseApplicationReceipt);
      if ((application && application.requestId !== uuid(requestId)) || (receipt && receipt.requestId !== uuid(requestId))) fail();
      return { application, receipt, enabled: bool(r.enabled) };
    },
    async dispatches(promptId: string, applicationId: string, beforeId?: string | null) {
      const r = applicationKeys(await send(`${path(promptId)}/${uuid(applicationId)}/dispatches${beforeId ? `?beforeId=${uuid(beforeId)}` : ""}`), ["items", "nextBeforeId"]), items = array(r.items, dispatch);
      if (items.some(row => row.applicationId !== uuid(applicationId))) fail();
      return { items, nextBeforeId: nullable(r.nextBeforeId, uuid) };
    },
  };
}
export type PromptApplicationHead = Awaited<ReturnType<ReturnType<typeof promptApplicationsApi>["head"]>>;
export type PromptApplicationEvidence = { comparison: import("@paperclipai/shared/mimouse-private-prompt-comparison").ComparePrivatePromptTests; report: import("@paperclipai/shared/mimouse-private-prompt-comparison").PrivatePromptComparison };
