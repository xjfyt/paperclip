import type { CompanySecret } from "@paperclipai/shared";
import { requestResponse } from "./client";
import { readApiJson } from "./response";
export interface WecomConnection {
  id: string; companyId: string; product: string; transport: "long_connection";
  enabled: boolean; state: string; gapDetected: boolean; imported: number;
  allowedGroupCount: number; allowedDirectSenderCount: number; createdAt: string; updatedAt: string;
  replaySupported: false; sourceTrust: { preset: "low_trust_review"; disposition: "quarantined" };
}
export interface WecomRegistration {
  transport: "long_connection"; botId: string; product: string;
  allowedGroupIds: string[]; allowedDirectSenderIds: string[]; secret: { secretId: string; version: number };
}
export type WecomSecretOption = { id: string; name: string; version: number };
/** Private reads bypass api.get's URL-only inflight coalescing. No reveal/create secret API. */
export function wecomApi(companyId: string, signal: AbortSignal) {
  const root = `/companies/${encodeURIComponent(companyId)}`;
  async function send<T>(path: string, body?: unknown): Promise<T> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const response = await requestResponse(`${root}${path}`, { signal, cache: "no-store", method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await readApiJson<T>(response);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return value;
  }
  const connections = "/feedback-wecom/connections";
  return {
    list: () => send<WecomConnection[]>(connections),
    secrets: async (): Promise<WecomSecretOption[]> => (await send<CompanySecret[]>("/secrets"))
      .filter(item => item.companyId === companyId && item.scope === "company" && item.status === "active" && item.deletedAt === null && Number.isSafeInteger(item.latestVersion) && item.latestVersion > 0)
      .map(item => ({ id: item.id, name: item.name, version: item.latestVersion })),
    // Backend always registers disabled; enabled is deliberately absent from config.
    register: (body: WecomRegistration) => send<WecomConnection>(connections, body),
    enabled: (id: string, enabled: boolean) => send<WecomConnection>(`${connections}/${encodeURIComponent(id)}/enabled`, { enabled, confirm: true }),
  };
}
