import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { companies, companyMemberships, companySkillTestInputs, mimouseFeedbackInbox, type Db } from "@paperclipai/db";
import type { EvaluationFeedbackPreview, PreviewEvaluationFeedback } from "@paperclipai/shared/mimouse-evaluation";
import { forbidden, notFound, unprocessable } from "../../errors.js";
import { canonical } from "../mimouse-operations/preview.js";
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Source evidence remains quarantined: this never turns feedback into a prompt. */
export async function assertFeedbackReviewer(tx: Tx, companyId: string, actorId: string) {
  const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).for("share");
  const [member] = await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actorId))).for("share");
  if (company?.status !== "active" || member?.status !== "active" || !["owner", "admin"].includes(member.membershipRole ?? "")) throw forbidden("An active company owner or administrator must review feedback provenance");
}
export function feedbackPreviewDigest(preview: Omit<EvaluationFeedbackPreview, "previewDigest" | "executionStarted">, actorId: string) {
  return createHash("sha256").update(canonical({ purpose: "evaluation_feedback_lineage_v1", actorId, ...preview })).digest("hex");
}
export async function loadFeedbackPreview(tx: Tx, companyId: string, actorId: string, input: PreviewEvaluationFeedback): Promise<EvaluationFeedbackPreview> {
  const [source] = await tx.select().from(mimouseFeedbackInbox).where(and(eq(mimouseFeedbackInbox.companyId, companyId), eq(mimouseFeedbackInbox.id, input.feedbackId))).for("share");
  const [testInput] = await tx.select().from(companySkillTestInputs).where(and(eq(companySkillTestInputs.companyId, companyId), eq(companySkillTestInputs.skillId, input.skillId), eq(companySkillTestInputs.id, input.inputId), isNull(companySkillTestInputs.deletedAt))).for("share");
  if (!source || !testInput) throw notFound("Feedback or skill test input not found");
  // redacted=false means no substitutions, not bypass of the import sanitizer.
  if (source.redactionVersion !== 1 || source.status !== "candidate") throw unprocessable("Unsupported feedback provenance");
  if (!testInput.content.trim() || testInput.content.trim().length > 32000) throw unprocessable("Dataset input exceeds snapshot limits");
  const snapshot = {
    companyId, skillId: input.skillId, inputId: input.inputId, input: testInput.content.trim(), sourceInputSnapshot: testInput.content, expected: input.expected,
    source: { feedbackId: source.id, companyId, sourceKind: source.sourceKind, sourceInstance: source.sourceInstance, externalId: source.externalId,
      product: source.product, softwareVersion: source.softwareVersion, commitSha: source.commitSha, traceId: source.traceId,
      contentDigest: source.contentDigest,
      sanitizedSnapshotDigest: createHash("sha256").update(canonical({ title: source.title, body: source.body, sourceUrl: source.sourceUrl, redacted: source.redacted })).digest("hex"),
      ingestionMode: source.ingestionMode, redactionVersion: source.redactionVersion, occurredAt: source.occurredAt.toISOString(),
      sourceTrust: "quarantined" as const, reproductionStatus: "not_reproduced" as const },
  };
  // No feedback body, title, URL, credentials or mutable private issue content.
  return { ...snapshot, previewDigest: feedbackPreviewDigest(snapshot, actorId), executionStarted: false };
}
