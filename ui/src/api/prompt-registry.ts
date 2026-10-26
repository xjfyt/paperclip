import type { CreatePromptRevision, SelectPromptRevision, PromptRegistryHead, PromptRevision, PromptSelectionReceipt } from "@paperclipai/shared/mimouse-prompt-registry";
import { requestResponse } from "./client";
import { readApiJson } from "./response";
export type PromptPage<T> = { items: T[]; nextBeforeId: string | null };
export type PromptDetail = PromptRevision & { content: string; contentDisposition: "untrusted_inert_text" };
/** Never use api.get: its URL-only inflight map can join observers across sessions. */
export function promptRegistryApi(companyId: string, signal: AbortSignal) {
  const root = `/companies/${encodeURIComponent(companyId)}/prompt-registry`;
  async function send<T>(path: string, body?: unknown): Promise<T> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await requestResponse(`${root}${path}`, { method: body === undefined ? "GET" : "POST", signal, cache: "no-store", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await readApiJson<T>(response);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return result;
  }
  const cursor = (id?: string | null) => id ? `?beforeId=${encodeURIComponent(id)}` : "";
  return {
    list: (beforeId?: string | null) => send<PromptPage<PromptRegistryHead>>(cursor(beforeId)),
    revisions: (id: string, beforeId?: string | null) => send<PromptPage<PromptRevision> & { head: PromptRegistryHead }>(`/${id}/revisions${cursor(beforeId)}`),
    receipts: (id: string, beforeId?: string | null) => send<PromptPage<PromptSelectionReceipt> & { head: PromptRegistryHead }>(`/${id}/receipts${cursor(beforeId)}`),
    content: (id: string, revisionId: string) => send<PromptDetail>(`/${id}/revisions/${revisionId}`),
    create: (body: CreatePromptRevision) => send<{ item: PromptRevision; duplicate: boolean }>("/revisions", body),
    select: (id: string, body: SelectPromptRevision) => send<{ item: PromptSelectionReceipt; duplicate: boolean }>(`/${id}/selections`, body),
  };
}
