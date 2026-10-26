import { api } from "./client";
import type { SaveRoutingPolicy, CreateRoutingPreview, RoutingPolicyRecord, RoutingPreviewRecord } from "@paperclipai/shared/cost-routing-preview";
const root = (id: string) => `/companies/${encodeURIComponent(id)}/cost-routing`;
export const costRoutingPreviewApi = {
  current: (id: string, signal?: AbortSignal) => api.get<RoutingPolicyRecord | null>(`${root(id)}/policy`, { signal, cache: "no-store" }),
  save: (id: string, body: SaveRoutingPolicy) => api.post<RoutingPolicyRecord>(`${root(id)}/policy`, body),
  preview: (id: string, body: CreateRoutingPreview) => api.post<RoutingPreviewRecord>(`${root(id)}/previews`, body),
};
