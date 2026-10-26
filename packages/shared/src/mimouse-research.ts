import { z } from "zod";
const text = (max: number) => z.string().trim().min(1).max(max);
export const researchSourceSchema = z.object({
  url: z.string().max(2048).url().refine(value => { try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; } }, "HTTP(S) reference required"),
  retrievedAt: z.string().datetime({ offset: true }),
  evidence: text(4000),
}).strict();
export const researchCandidateSchema = z.object({
  requestId: z.string().uuid(), title: text(240), product: text(120),
  currentState: text(4000), proposedState: text(4000), recommendation: text(8000),
  sources: z.array(researchSourceSchema).min(1).max(20),
}).strict();
export type ResearchCandidateInput = z.infer<typeof researchCandidateSchema>;
export interface ResearchEvidence extends Omit<ResearchCandidateInput, "requestId" | "sources"> {
  sources: Array<z.infer<typeof researchSourceSchema> & { product?: string; gap?: string; suggestion?: string }>;
  evidenceMode: "manual_import" | "agent_report";
  provenance?: import("./mimouse-research-routines.js").ResearchRoutineProvenance; redacted: boolean; redactionVersion: 1;
}
export interface ResearchCandidate {
  id: string; companyId: string; requestId: string; actorId: string; createdAt: string;
  evidence: ResearchEvidence; evidenceHash: string; status: "candidate";
}
export const researchPromotionSchema = z.object({
  requestId: z.string().uuid(), confirm: z.literal(true), expectedEvidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  title: text(240), scope: text(8000), expectedBenefit: text(4000),
  acceptanceCriteria: z.array(text(1000)).min(1).max(10),
  dependencyIssueIds: z.array(z.string().uuid()).max(20).default([]).refine(ids => new Set(ids).size === ids.length, "Duplicate dependencies"),
}).strict();
export type ResearchPromotionInput = z.infer<typeof researchPromotionSchema>;
export interface ResearchPromotionReceipt {
  requestId: string; candidateId: string; issueId: string; actorUserId: string; evidenceHash: string; createdAt: string;
  initialStatus: "backlog"; initialVisibility: "private"; agentDispatched: false;
}
