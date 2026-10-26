import { readApiJson } from "./response";
import { api, requestResponse } from "./client";
import type { SaveRoutingPolicy, CreateRoutingPreview, RoutingPolicyRecord, RoutingPreviewRecord } from "@paperclipai/shared/cost-routing-preview";
const root = (id: string) => `/companies/${encodeURIComponent(id)}/cost-routing`;
export const costRoutingPreviewApi = {
  // Private identity-scoped reads must bypass the URL-only in-flight GET map.
  // cache:no-store alone does not prevent joining a previous session's fetch.
  current: async (id: string, signal?: AbortSignal) => readApiJson<RoutingPolicyRecord | null>(
    await requestResponse(`${root(id)}/policy`, { method: "GET", signal, cache: "no-store" }),
  ),
  save: (id: string, body: SaveRoutingPolicy) => api.post<RoutingPolicyRecord>(`${root(id)}/policy`, body),
  preview: (id: string, body: CreateRoutingPreview) => api.post<RoutingPreviewRecord>(`${root(id)}/previews`, body),
};
