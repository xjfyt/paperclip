import { api } from "./client";
export interface NotificationEndpoint { id: string; name: string; kind: string; enabled: boolean; config: Record<string, unknown>; secretRef: string; secretVersion: number }
export interface NotificationCenter {
  enabled: boolean; dispatchEnabled?: boolean; connectedEvents: string[]; unconnectedEvents: string[];
  endpoints: NotificationEndpoint[];
  subscriptions: Array<{ id: string; endpointId: string; eventType: string; locale: string; enabled: boolean }>;
  deliveries: Array<{ id: string; endpointId: string; state: string; attempt: number; lastCode: string | null; createdAt: string }>;
}
const base = (companyId: string) => `/companies/${companyId}/notifications`;
export interface NotificationPreview { id: string; state: string; endpointName: string; kind: string; title: string; text: string; target: string | null; secretVersion: number; locale: string; templateData: Record<string, { value: string }> | null }
export const notificationApi = {
  get: (companyId: string) => api.get<NotificationCenter>(base(companyId)),
  create: (companyId: string, data: unknown) => api.post(base(companyId) + "/endpoints", data),
  toggle: (companyId: string, id: string, enabled: boolean) => api.patch(base(companyId) + `/endpoints/${id}`, { enabled }),
  subscribe: (companyId: string, endpointId: string, eventType: string, locale: string) => api.post(base(companyId) + "/subscriptions", { endpointId, eventType, locale }),
  toggleSubscription: (companyId: string, id: string, enabled: boolean) => api.patch(base(companyId) + `/subscriptions/${id}`, { enabled }),
  preview: (companyId: string, id: string) => api.get<NotificationPreview>(base(companyId) + `/deliveries/${id}/preview`),
  retry: (companyId: string, id: string, requestId: string) => api.post(base(companyId) + `/deliveries/${id}/retry`, { requestId, confirmReviewedOutcome: true, acceptDuplicateRisk: true }),
  test: (companyId: string, id: string, data: { requestId: string; confirm: true; title: string; text: string }) => api.post(base(companyId) + `/endpoints/${id}/test`, data),
};
