import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { issues, mimouseFeedbackInbox as inbox, mimouseFeedbackPromotions as promotions,
  mimouseCodingDeliveries as deliveries, mimouseFeedbackVerifications as verifications, type Db } from "@paperclipai/db";
import { feedbackVerificationConfirmSchema, feedbackVerificationPreviewSchema,
  type FeedbackVerificationSelection, type FeedbackVerificationConfirm, type FeedbackVerificationCheck,
  type FeedbackVerificationPreview, type FeedbackVerificationSnapshot, type FeedbackVerificationReceipt } from "@paperclipai/shared/mimouse-feedback-verification";
import { conflict, notFound, unprocessable } from "../errors.js";
import { canActorReadIssuePrivacy } from "./authorization.js";
import { assertFeedbackReviewer } from "./mimouse-evaluation/feedback-lineage.js";
import { canonical } from "./mimouse-operations/preview.js";
import { logActivity, publishActivity, type ActivityPublication } from "./activity-log.js";
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Delivery = typeof deliveries.$inferSelect;
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const checkSchema = z.object({ commitSha: sha, command: z.string().min(1).max(2000), exitCode: z.number().int(),
  startedAt: z.string().datetime(), finishedAt: z.string().datetime(), logRef: z.string().min(1).max(2000), status: z.enum(["passed", "failed"]) }).strict();
/** Never return command text, log paths/URLs, credentials, stdout or stderr. */
export function verificationCheck(row: Delivery, checkIndex: number, now = Date.now()): FeedbackVerificationCheck | null {
  const parsed = checkSchema.safeParse(row.evidence?.[checkIndex]);
  if (!parsed.success || !sha.safeParse(row.headSha).success) return null;
  const check = parsed.data, start = Date.parse(check.startedAt), end = Date.parse(check.finishedAt);
  if (check.commitSha !== row.headSha || !check.command.trim() || !check.logRef.trim()
    || end < start || end > now || (check.status === "passed" ? check.exitCode !== 0 : check.exitCode === 0)) return null;
  return { deliveryId: row.id, checkIndex, commitSha: check.commitSha, status: check.status, exitCode: check.exitCode,
    startedAt: check.startedAt, finishedAt: check.finishedAt, commandDigest: digest(check.command), logRefDigest: digest(check.logRef),
    checkDigest: digest(check), provenance: "operator_supplied" };
}
export function verificationPreviewDigest(snapshot: FeedbackVerificationSnapshot, actorUserId: string) {
  return digest({ purpose: "feedback_human_verification_v1", actorUserId, snapshot });
}
function receipt(row: typeof verifications.$inferSelect): FeedbackVerificationReceipt {
  return { id: row.id, requestId: row.requestId, actorUserId: row.actorUserId, createdAt: row.createdAt.toISOString(),
    previewDigest: row.previewDigest, snapshot: row.snapshot as unknown as FeedbackVerificationSnapshot, historical: true, assessment: "human_attested" };
}
async function context(tx: Tx, companyId: string, feedbackId: string, actorUserId: string) {
  await assertFeedbackReviewer(tx, companyId, actorUserId);
  const [source] = await tx.select().from(inbox).where(and(eq(inbox.companyId, companyId), eq(inbox.id, feedbackId))).for("share");
  const [promotion] = await tx.select().from(promotions).where(and(eq(promotions.companyId, companyId), eq(promotions.feedbackId, feedbackId))).for("share");
  if (!source || source.companyId !== companyId || source.id !== feedbackId || !promotion || promotion.companyId !== companyId || promotion.feedbackId !== feedbackId) throw notFound("Confirmed feedback task not accessible");
  const [issue] = await tx.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, promotion.issueId))).for("share");
  if (!issue || issue.companyId !== companyId || issue.id !== promotion.issueId
    || !await canActorReadIssuePrivacy(tx, { type: "board", source: "session", userId: actorUserId }, issue)) throw notFound("Confirmed feedback task not accessible");
  return { source, promotion, issue };
}
async function preview(tx: Tx, companyId: string, actorUserId: string, ctx: Awaited<ReturnType<typeof context>>, input: FeedbackVerificationSelection): Promise<FeedbackVerificationPreview> {
  const selected: Delivery[] = [];
  // Stable lock order also makes reversed selections safe under concurrent review.
  for (const id of [...new Set([input.reproduction.deliveryId, input.regression.deliveryId])].sort()) {
    const [row] = await tx.select().from(deliveries).where(and(eq(deliveries.companyId, companyId), eq(deliveries.issueId, ctx.issue.id), eq(deliveries.id, id))).for("share");
    if (!row || row.id !== id || row.companyId !== companyId || row.issueId !== ctx.issue.id) throw notFound("Feedback coding evidence not accessible");
    selected.push(row);
  }
  const before = selected.find(row => row.id === input.reproduction.deliveryId)!, after = selected.find(row => row.id === input.regression.deliveryId)!;
  const reproduction = verificationCheck(before, input.reproduction.checkIndex), regression = verificationCheck(after, input.regression.checkIndex);
  const { source, promotion, issue } = ctx;
  if (source.redactionVersion !== 1 || source.status !== "candidate" || !sha.safeParse(source.commitSha).success) throw unprocessable("Feedback needs a fixed source commit and supported redaction");
  if (!reproduction || !regression || reproduction.status !== "failed" || regression.status !== "passed") throw unprocessable("A valid failed reproduction and passed regression receipt are required");
  if (before.headSha !== source.commitSha || after.baseSha !== before.headSha || after.headSha === before.headSha
    || before.workspaceId !== after.workspaceId || before.gitlabOrigin !== after.gitlabOrigin || before.projectId !== after.projectId
    || reproduction.commandDigest !== regression.commandDigest || Date.parse(reproduction.finishedAt) > Date.parse(regression.startedAt)) throw unprocessable("Evidence must bind the source commit to a later fix and the same recorded check");
  const snapshot: FeedbackVerificationSnapshot = {
    contractVersion: "feedback-human-verification-v1",
    companyId, feedbackId: source.id, issueId: issue.id, promotionRequestId: promotion.requestId,
    promotionDigest: digest({ requestId: promotion.requestId, issueId: promotion.issueId, actorUserId: promotion.actorUserId, review: promotion.review }),
    source: { sourceKind: source.sourceKind, sourceInstance: source.sourceInstance, externalId: source.externalId, ingestionMode: source.ingestionMode,
      product: source.product, softwareVersion: source.softwareVersion, commitSha: source.commitSha!, traceId: source.traceId,
      occurredAt: source.occurredAt.toISOString(), contentDigest: source.contentDigest,
      sanitizedSnapshotDigest: digest({ title: source.title, body: source.body, sourceUrl: source.sourceUrl, redacted: source.redacted }), trust: "quarantined" },
    repository: { projectId: before.projectId, originDigest: digest(before.gitlabOrigin), workspaceId: before.workspaceId },
    reproduction, regression, assessmentBasis: "human_attestation", machineVerification: "reference_integrity_only",
    environment: "not_machine_verified", executionStarted: false, issueStatusChanged: false,
  };
  return { snapshot, previewDigest: verificationPreviewDigest(snapshot, actorUserId), assessment: "awaiting_human_attestation" };
}
export function feedbackVerificationService(db: Db) {
  return {
    async options(companyId: string, feedbackId: string, actorUserId: string) {
      return db.transaction(async tx => {
        const ctx = await context(tx, companyId, feedbackId, actorUserId);
        const rows = await tx.select().from(deliveries).where(and(eq(deliveries.companyId, companyId), eq(deliveries.issueId, ctx.issue.id))).orderBy(desc(deliveries.createdAt), desc(deliveries.id)).limit(51);
        return { checks: rows.slice(0, 50).filter(row => row.companyId === companyId && row.issueId === ctx.issue.id).flatMap(row =>
          row.evidence.slice(0, 100).map((_, i) => verificationCheck(row, i)).filter((check): check is FeedbackVerificationCheck => Boolean(check))), hasMore: rows.length > 50, scanLimit: 50 as const };
      });
    },
    async history(companyId: string, feedbackId: string, actorUserId: string) {
      return db.transaction(async tx => {
        const ctx = await context(tx, companyId, feedbackId, actorUserId);
        const rows = await tx.select().from(verifications).where(and(eq(verifications.companyId, companyId), eq(verifications.feedbackId, feedbackId), eq(verifications.issueId, ctx.issue.id))).orderBy(desc(verifications.createdAt), desc(verifications.id)).limit(21);
        return { items: rows.slice(0, 20).map(receipt), hasMore: rows.length > 20 };
      });
    },
    async preview(companyId: string, feedbackId: string, actorUserId: string, raw: FeedbackVerificationSelection) {
      const input = feedbackVerificationPreviewSchema.parse(raw);
      return db.transaction(async tx => preview(tx, companyId, actorUserId, await context(tx, companyId, feedbackId, actorUserId), input));
    },
    async confirm(companyId: string, feedbackId: string, actorUserId: string, raw: FeedbackVerificationConfirm) {
      const input = feedbackVerificationConfirmSchema.parse(raw), requestDigest = digest({ feedbackId, input });
      const publications: ActivityPublication[] = [];
      const result = await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`feedback-verification:${companyId}:${input.requestId}`},0))`);
        const ctx = await context(tx, companyId, feedbackId, actorUserId);
        const [prior] = await tx.select().from(verifications).where(and(eq(verifications.companyId, companyId), eq(verifications.requestId, input.requestId)));
        if (prior) {
          if (prior.actorUserId !== actorUserId || prior.feedbackId !== feedbackId || prior.requestDigest !== requestDigest) throw conflict("Verification request already has different confirmation");
          if (!await canActorReadIssuePrivacy(tx, { type: "board", source: "session", userId: actorUserId }, ctx.issue)) throw notFound("Confirmed feedback task not accessible");
          return receipt(prior);
        }
        const current = await preview(tx, companyId, actorUserId, ctx, input);
        if (current.previewDigest !== input.previewDigest) throw conflict("Feedback evidence changed; preview and confirm again");
        // Grants/project audiences can change without updating the locked issue row.
        // Recheck immediately before the write, also on idempotent replay above.
        if (!await canActorReadIssuePrivacy(tx, { type: "board", source: "session", userId: actorUserId }, ctx.issue)) throw notFound("Confirmed feedback task not accessible");
        const [row] = await tx.insert(verifications).values({ companyId, feedbackId, issueId: ctx.issue.id,
          reproductionDeliveryId: input.reproduction.deliveryId, regressionDeliveryId: input.regression.deliveryId,
          requestId: input.requestId, requestDigest, previewDigest: current.previewDigest, actorUserId,
          snapshot: current.snapshot as unknown as Record<string, unknown> }).returning();
        await logActivity(tx as unknown as Db, { companyId, actorType: "user", actorId: actorUserId,
          action: "feedback.verification.attested", entityType: "issue", entityId: ctx.issue.id, details: null }, publications);
        return receipt(row);
      });
      publications.forEach(publishActivity);
      return result;
    },
  };
}
