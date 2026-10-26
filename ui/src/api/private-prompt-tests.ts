import type { CreatePrivatePromptTest, PrivatePromptTestCapabilities, PrivatePromptTestDetail, PrivatePromptTestRecord, PrivatePromptTestResponse } from "@paperclipai/shared/mimouse-private-prompt-tests";
import { requestResponse } from "./client";
import { readApiJson } from "./response";
/** Private session-bound reads deliberately bypass api.get's URL-only coalescing. */
export function privatePromptTestsApi(companyId: string, signal: AbortSignal) {
  const root = `/companies/${encodeURIComponent(companyId)}/prompt-registry`;
  async function send<T>(path: string, body?: CreatePrivatePromptTest): Promise<T> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await requestResponse(`${root}${path}`, { method: body ? "POST" : "GET", signal, cache: "no-store", ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await readApiJson<T>(response);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return value;
  }
  return {
    capabilities: () => send<PrivatePromptTestCapabilities>("/test-capabilities"),
    list: (promptId: string, beforeId?: string | null) => send<{ items: PrivatePromptTestRecord[]; nextBeforeId: string | null }>(`/${encodeURIComponent(promptId)}/tests${beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : ""}`),
    detail: (promptId: string, testId: string) => send<PrivatePromptTestDetail>(`/${encodeURIComponent(promptId)}/tests/${encodeURIComponent(testId)}`),
    create: (promptId: string, body: CreatePrivatePromptTest) => send<PrivatePromptTestResponse>(`/${encodeURIComponent(promptId)}/tests`, body),
  };
}
