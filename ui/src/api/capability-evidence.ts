import { api, requestResponse } from "./client";
import { readApiJson } from "./response";
import type { AppendCapabilityEvidence, CapabilityEvidenceEvent } from "@paperclipai/shared/capability-evidence";
export const capabilityEvidenceApi = {
  // Authentication can change while another observer retains the old GET.
  // Bypass path-only coalescing, not standard credentials/error handling.
  list: async (companyId: string, afterRevision = 0, signal?: AbortSignal) => readApiJson<{
    events: CapabilityEvidenceEvent[]; nextRevision: number | null; headRevision?: number;
  }>(await requestResponse(
    `/companies/${encodeURIComponent(companyId)}/capability-evidence?afterRevision=${afterRevision}`,
    { method: "GET", signal, cache: "no-store" },
  )),
  append: (companyId: string, input: AppendCapabilityEvidence) => api.post<CapabilityEvidenceEvent>(
    `/companies/${encodeURIComponent(companyId)}/capability-evidence`, input,
  ),
};
