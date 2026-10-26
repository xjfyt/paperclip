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
  sourceInstance: string; externalId: string; ingestionMode: "manual_import";
  title: string; text: string; product: string; softwareVersion: string; commitSha: string | null; traceId: string | null;
  occurredAt: string; createdAt: string; actorId: string; redacted: boolean; redactionVersion: 1;
  status: "candidate";
}
export interface FeedbackInboxPage { items: FeedbackInboxItem[]; nextBeforeId: string | null }
