import { z } from "zod";
/** Cursors name a currently visible receipt; timestamps never round-trip through JS. */
export const researchHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(10),
  beforeId: z.string().uuid().optional(),
}).strict();
export type ResearchHistoryQuery = z.infer<typeof researchHistoryQuerySchema>;
export interface ResearchHistoryAttempt {
  id: string; status: string; createdAt: string; startedAt: string | null; finishedAt: string | null;
}
export interface ResearchHistoryReceipt {
  candidateId: string; runId: string; receivedAt: string; evidenceHash: string;
  sourceVerification: "agent_report"; disposition: "quarantined";
}
export interface ResearchHistoryItem {
  id: string; status: string; createdAt: string; triggeredAt: string; completedAt: string | null;
  issueId: string | null; attempts: ResearchHistoryAttempt[];
  reports: ResearchHistoryReceipt[];
  reportState: "received" | "not_received" | "needs_review" | "coalesced";
  /** Neither receipt nor stored execution status independently verifies sources. */
  externalSourcesVerified: false; agentDispatched: false;
}
export interface ResearchHistoryPage {
  companyId: string; routineId: string; items: ResearchHistoryItem[];
  nextBeforeId: string | null; externalSourcesVerified: false; agentDispatched: false;
}
