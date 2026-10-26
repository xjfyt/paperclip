import { z } from "zod";
const sourceId = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
export const feedbackImportSchema = z.object({
  sourceKind: z.enum(["manual", "application_log", "langfuse", "wecom_smart_bot"]),
  sourceInstance: sourceId, externalId: sourceId,
  title: z.string().trim().min(1).max(240), text: z.string().trim().min(1).max(32000),
  product: z.string().trim().min(1).max(120), softwareVersion: z.string().trim().max(120).default(""),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/).nullable().default(null),
  traceId: sourceId.nullable().default(null), occurredAt: z.string().datetime({ offset: true }),
}).strict();
export type FeedbackImportInput = z.infer<typeof feedbackImportSchema>;
export interface FeedbackInboxItem {
  id: string; companyId: string; sourceKind: FeedbackImportInput["sourceKind"];
  sourceInstance: string; externalId: string; ingestionMode: "manual_import" | "provider_fetch";
  sourceUrl?: string | null; sourceTrust?: { preset: "low_trust_review"; disposition: "quarantined" };
  title: string; text: string; product: string; softwareVersion: string; commitSha: string | null; traceId: string | null;
  occurredAt: string; createdAt: string; actorId: string; redacted: boolean; redactionVersion: 1;
  status: "candidate";
}
export interface FeedbackInboxPage { items: FeedbackInboxItem[]; nextBeforeId: string | null }

export const feedbackPromotionSchema = z.object({
  requestId: z.string().uuid(), confirm: z.literal(true),
  title: z.string().trim().min(1).max(240), reproduction: z.string().trim().min(1).max(8000),
  expectedBehavior: z.string().trim().min(1).max(4000), fixProposal: z.string().trim().max(8000).default(""),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1000)).min(1).max(10),
}).strict();
export type FeedbackPromotionInput = z.infer<typeof feedbackPromotionSchema>;
export interface FeedbackPromotionReceipt {
  requestId: string; feedbackId: string; issueId: string; actorUserId: string; createdAt: string;
  initialStatus: "backlog"; initialVisibility: "private"; agentDispatched: false;
}

/** Observed references are not verified trace/commit links or proof of reproduction. */
export interface FeedbackEvidence {
  feedbackId: string; sourceKind: FeedbackInboxItem["sourceKind"]; sourceInstance: string; externalId: string;
  product: string; softwareVersion: string; commitSha: string | null; traceId: string | null; occurredAt: string;
  fingerprint: string | null; excerpts: { line: number; text: string }[];
  checklist: { versionReference: boolean; commitReference: boolean; traceReference: boolean; errorStackExcerpt: boolean;
    reproduction: "not_performed"; expectedBehavior: "requires_review"; regressionTest: "requires_review" };
}
export interface FeedbackEvidencePage {
  algorithmVersion: "redacted-error-stack-v1"; autoMerged: false; source: FeedbackEvidence; items: FeedbackEvidence[];
  scanned: number; scanLimit: number; nextBeforeId: string | null;
}
