import { api } from "./client";
import type { NotificationPolicyDto, NotificationEndpointDto, NotificationRevisionDto, NotificationRevisionInput, NotificationReviewInput, NotificationReviewDto } from "@paperclipai/shared";
export type NotificationEndpoint = NotificationEndpointDto;
export interface NotificationCenter {
  enabled: boolean; dispatchEnabled?: boolean; connectedEvents: string[]; unconnectedEvents: string[];
  endpoints: NotificationEndpoint[];
  subscriptions: Array<{ id: string; endpointId: string; eventType: string; locale: string; enabled: boolean; policyVersion?: number; policy?: NotificationPolicyDto }>;
  deliveries: Array<{ id: string; endpointId: string; state: string; attempt: number; lastCode: string | null; mergedInto?: string | null; mergeUntil?: string | null; createdAt: string }>;
}
const base = (companyId: string) => `/companies/${companyId}/notifications`;
export interface NotificationPreview { id: string; state: string; endpointName: string; kind: string; title: string; text: string; target: string | null; secretVersion: number; locale: string; templateData: Record<string, { value: string }> | null }
export const notificationApi = {
  get: (companyId: string) => api.get<NotificationCenter>(base(companyId)),
  create: (companyId: string, data: unknown) => api.post(base(companyId) + "/endpoints", data),
  revise: (companyId: string, id: string, data: NotificationRevisionInput) => api.post(base(companyId) + `/endpoints/${id}/revisions`, data),
  history: (companyId: string, id: string) => api.get<NotificationRevisionDto[]>(base(companyId) + `/endpoints/${id}/revisions`),
  toggle: (companyId: string, id: string, enabled: boolean, expectedVersion = 1) => api.patch(base(companyId) + `/endpoints/${id}`, { enabled, expectedVersion }),
  subscribe: (companyId: string, endpointId: string, eventType: string, locale: string) => api.post(base(companyId) + "/subscriptions", { endpointId, eventType, locale }),
  toggleSubscription: (companyId: string, id: string, enabled: boolean) => api.patch(base(companyId) + `/subscriptions/${id}`, { enabled }),
  policy: (companyId: string, id: string, policy: NotificationPolicyDto & { expectedVersion: number }) => api.patch(base(companyId) + `/subscriptions/${id}/policy`, policy),
  reviews: (companyId: string, id: string) => api.get<NotificationReviewDto[]>(base(companyId) + `/deliveries/${id}/reviews`),
  review: (companyId: string, id: string, data: NotificationReviewInput) => api.post<NotificationReviewDto>(base(companyId) + `/deliveries/${id}/reviews`, data),
  preview: (companyId: string, id: string) => api.get<NotificationPreview>(base(companyId) + `/deliveries/${id}/preview`),
  retry: (companyId: string, id: string, requestId: string) => api.post(base(companyId) + `/deliveries/${id}/retry`, { requestId, confirmReviewedOutcome: true, acceptDuplicateRisk: true }),
  test: (companyId: string, id: string, data: { requestId: string; confirm: true; title: string; text: string; expectedVersion?: number }) => api.post(base(companyId) + `/endpoints/${id}/test`, data),
};
