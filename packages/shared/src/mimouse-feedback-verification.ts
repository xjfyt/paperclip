import { z } from "zod";
const selection = z.object({ deliveryId: z.string().uuid(), checkIndex: z.number().int().min(0).max(99) }).strict();
export const feedbackVerificationPreviewSchema = z.object({ reproduction: selection, regression: selection }).strict();
export const feedbackVerificationConfirmSchema = feedbackVerificationPreviewSchema.extend({
  requestId: z.string().uuid(), previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  confirmReproduction: z.literal(true), confirmFix: z.literal(true), confirmComparableEnvironment: z.literal(true),
}).strict();
export type FeedbackVerificationSelection = z.infer<typeof feedbackVerificationPreviewSchema>;
export type FeedbackVerificationConfirm = z.infer<typeof feedbackVerificationConfirmSchema>;
export interface FeedbackVerificationCheck {
  deliveryId: string; checkIndex: number; commitSha: string; status: "passed" | "failed"; exitCode: number;
  startedAt: string; finishedAt: string; commandDigest: string; logRefDigest: string; checkDigest: string;
  provenance: "operator_supplied";
}
export interface FeedbackVerificationSnapshot {
  contractVersion: "feedback-human-verification-v1";
  companyId: string; feedbackId: string; issueId: string; promotionRequestId: string; promotionDigest: string;
  source: { sourceKind: string; sourceInstance: string; externalId: string; ingestionMode: string;
    product: string; softwareVersion: string; commitSha: string; traceId: string | null; occurredAt: string;
    contentDigest: string; sanitizedSnapshotDigest: string; trust: "quarantined" };
  repository: { projectId: number; originDigest: string; workspaceId: string };
  reproduction: FeedbackVerificationCheck; regression: FeedbackVerificationCheck;
  assessmentBasis: "human_attestation"; machineVerification: "reference_integrity_only";
  environment: "not_machine_verified"; executionStarted: false; issueStatusChanged: false;
}
export interface FeedbackVerificationPreview { snapshot: FeedbackVerificationSnapshot; previewDigest: string; assessment: "awaiting_human_attestation" }
export interface FeedbackVerificationReceipt extends Omit<FeedbackVerificationPreview, "assessment"> {
  assessment: "human_attested";
  id: string; requestId: string; actorUserId: string; createdAt: string; historical: true;
}
export interface FeedbackVerificationOptions {
  checks: FeedbackVerificationCheck[]; hasMore: boolean; scanLimit: 50;
}
export interface FeedbackVerificationHistory { items: FeedbackVerificationReceipt[]; hasMore: boolean }
