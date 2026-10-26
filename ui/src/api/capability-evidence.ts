import { api } from "./client";
import type { AppendCapabilityEvidence, CapabilityEvidenceEvent } from "@paperclipai/shared/capability-evidence";
export const capabilityEvidenceApi = {
  list: (companyId: string, afterRevision = 0, signal?: AbortSignal) => api.get<{ events: CapabilityEvidenceEvent[]; nextRevision: number | null }>(
    `/companies/${encodeURIComponent(companyId)}/capability-evidence?afterRevision=${afterRevision}`, { signal, cache: "no-store" },
  ),
  append: (companyId: string, input: AppendCapabilityEvidence) => api.post<CapabilityEvidenceEvent>(
    `/companies/${encodeURIComponent(companyId)}/capability-evidence`, input,
  ),
};
