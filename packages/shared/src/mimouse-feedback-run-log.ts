import { z } from "zod";
import type { FeedbackInboxItem } from "./mimouse-feedback.js";
export const RUN_LOG_SOURCE_INSTANCE = "internal.run-log.v1";
export const feedbackRunLogSelectionSchema = z.object({
  runId: z.string().uuid(), eventSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
export const feedbackRunLogImportSchema = feedbackRunLogSelectionSchema.extend({
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true),
}).strict();
export const feedbackRunLogReferenceSchema = feedbackRunLogSelectionSchema.extend({
  contractVersion: z.literal("feedback-run-log-reference-v1"), companyId: z.string().uuid(),
  eventId: z.string().regex(/^[1-9][0-9]*$/), runCreatedAt: z.string().datetime(), eventCreatedAt: z.string().datetime(),
  referenceDigest: z.string().regex(/^[a-f0-9]{64}$/), softwareVersion: z.literal("unknown"), commitSha: z.null(),
  reproduction: z.literal("not_performed"), contentIncluded: z.literal(false),
}).strict();
export type FeedbackRunLogSelection = z.infer<typeof feedbackRunLogSelectionSchema>;
export type FeedbackRunLogImport = z.infer<typeof feedbackRunLogImportSchema>;
export type FeedbackRunLogReference = z.infer<typeof feedbackRunLogReferenceSchema>;
export interface FeedbackRunLogPreview { reference: FeedbackRunLogReference; previewDigest: string }
export interface FeedbackRunLogImportReceipt { item: FeedbackInboxItem; duplicate: boolean }
