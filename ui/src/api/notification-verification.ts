import { api, requestResponse } from "./client";
import { readApiJson } from "./response";
import type { NotificationVerificationDto } from "@paperclipai/shared/notification-verification";
import type { AppendNotificationEvidence, NotificationEvidenceEvent, NotificationEvidencePage } from "@paperclipai/shared/notification-evidence";
const base = (companyId: string, endpointId: string) => `/companies/${encodeURIComponent(companyId)}/notifications/endpoints/${encodeURIComponent(endpointId)}/verification`;
async function read<T>(path: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const value = await readApiJson<T>(await requestResponse(path, { method: "GET", signal, cache: "no-store" }));
  signal.throwIfAborted(); return value;
}
export const notificationVerificationApi = {
  get: (company: string, endpoint: string, signal: AbortSignal) => read<NotificationVerificationDto>(base(company, endpoint), signal),
  list: (company: string, endpoint: string, after: number, signal: AbortSignal) => read<NotificationEvidencePage>(`${base(company, endpoint)}/evidence?afterRevision=${after}`, signal),
  append: (company: string, endpoint: string, input: AppendNotificationEvidence) => api.post<NotificationEvidenceEvent>(`${base(company, endpoint)}/evidence`, input),
};
