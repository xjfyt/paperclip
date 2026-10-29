import { createHash } from "node:crypto";
import { and, desc, eq, lt, ne, or, sql } from "drizzle-orm";
import { mimouseFeedbackInbox as inbox, type Db } from "@paperclipai/db";
import { feedbackImportSchema, type FeedbackImportInput, type FeedbackInboxItem } from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";
import { createFeedbackRedactionState, sanitizeFeedbackText } from "./feedback-redaction.js";
import { feedbackEvidence, feedbackEvidencePage, FEEDBACK_EVIDENCE_SCAN_LIMIT } from "./mimouse-feedback-evidence.js";
import { logActivity, publishActivity, type ActivityPublication } from "./activity-log.js";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Remove URL credentials and query/fragment values before generic redaction.
export function sanitizeImportedFeedbackText(text: string, redaction: ReturnType<typeof createFeedbackRedactionState>, field: string, max: number) {
    const withoutUrlSecrets = text.replace(/https?:\/\/[^\s<>"']+/gi, value => {
      try { const url = new URL(value); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.href; }
      catch { return "[REDACTED_URL]"; }
    });
    if (withoutUrlSecrets !== text) redaction.redactedFields.add(field);
    return sanitizeFeedbackText(withoutUrlSecrets, redaction, field, max).slice(0, max);
}

/** No URL retrieval, model call, command execution, customer reply or export. */
export function prepareFeedbackImport(raw: FeedbackImportInput) {
  const input = feedbackImportSchema.parse(raw), redaction = createFeedbackRedactionState();
  const sanitize = (text: string, field: string, max: number) => sanitizeImportedFeedbackText(text, redaction, field, max);
  const title = sanitize(input.title, "title", 240), body = sanitize(input.text, "text", 32000);
  const product = sanitize(input.product, "product", 120), softwareVersion = sanitize(input.softwareVersion, "softwareVersion", 120);
  const normalized = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  return { sourceKind: input.sourceKind, sourceInstance: input.sourceInstance, externalId: input.externalId,
    // Only the digest of the bounded import is persisted; never original text.
    contentDigest: digest(input), candidateKey: digest([normalized(product), normalized(softwareVersion), normalized(title)]),
    title, body, product, softwareVersion, commitSha: input.commitSha, traceId: input.traceId,
    occurredAt: new Date(input.occurredAt), redacted: redaction.redactedFields.size > 0 };
}
function publicItem(row: typeof inbox.$inferSelect): FeedbackInboxItem {
  return { id: row.id, companyId: row.companyId, sourceKind: row.sourceKind as FeedbackImportInput["sourceKind"],
    sourceInstance: row.sourceInstance, externalId: row.externalId, ingestionMode: row.ingestionMode as FeedbackInboxItem["ingestionMode"],
    sourceUrl: row.sourceUrl, sourceTrust: { preset: "low_trust_review", disposition: "quarantined" },
    title: row.title, text: row.body, product: row.product, softwareVersion: row.softwareVersion, commitSha: row.commitSha, traceId: row.traceId,
    occurredAt: row.occurredAt.toISOString(), createdAt: row.createdAt.toISOString(), actorId: row.actorId,
    redacted: row.redacted, redactionVersion: 1, status: "candidate" };
}
export function feedbackInboxService(db: Db) {
  async function load(companyId: string, id: string) {
    const [row] = await db.select().from(inbox).where(and(eq(inbox.companyId, companyId), eq(inbox.id, id)));
    if (!row) throw notFound("Feedback candidate not found"); return row;
  }
  // Keep PostgreSQL's microsecond precision in the database. A JS Date cursor
  // truncates it and can skip an entire same-millisecond import batch.
  function beforeCursor(companyId: string, beforeId: string) {
    const timestamp = sql`(select cursor_row.created_at from mimouse_feedback_inbox as cursor_row where cursor_row.company_id = ${companyId} and cursor_row.id = ${beforeId})`;
    return or(lt(inbox.createdAt, timestamp), and(eq(inbox.createdAt, timestamp), lt(inbox.id, beforeId)));
  }
  return {
    async import(companyId: string, raw: FeedbackImportInput, actorId: string) {
      const input = prepareFeedbackImport(raw);
      const publications: ActivityPublication[] = [];
      const result = await db.transaction(async tx => {
        const [inserted] = await tx.insert(inbox).values({ ...input, companyId, actorId }).onConflictDoNothing({ target: [inbox.companyId, inbox.sourceKind, inbox.sourceInstance, inbox.externalId] }).returning();
        if (inserted) {
          await logActivity(tx as unknown as Db, { companyId, actorType: "user", actorId,
            action: "feedback.imported", entityType: "feedback", entityId: inserted.id, details: null }, publications);
          return { item: publicItem(inserted), duplicate: false };
        }
        const [existing] = await tx.select().from(inbox).where(and(eq(inbox.companyId, companyId), eq(inbox.sourceKind, input.sourceKind), eq(inbox.sourceInstance, input.sourceInstance), eq(inbox.externalId, input.externalId)));
        if (!existing || existing.contentDigest !== input.contentDigest) throw conflict("Source event identity already has different content");
        return { item: publicItem(existing), duplicate: true };
      });
      publications.forEach(publishActivity);
      return result;
    },
    async list(companyId: string, limit = 50, beforeId?: string) {
      const before = beforeId ? await load(companyId, beforeId) : null;
      const rows = await db.select().from(inbox).where(and(eq(inbox.companyId, companyId), before ? beforeCursor(companyId, before.id) : undefined))
        .orderBy(desc(inbox.createdAt), desc(inbox.id)).limit(limit + 1);
      const page = rows.slice(0, limit); return { items: page.map(publicItem), nextBeforeId: rows.length > limit ? page.at(-1)!.id : null };
    },
    async get(companyId: string, id: string) { return publicItem(await load(companyId, id)); },
    async evidence(companyId: string, id: string, beforeId?: string) {
      const source = publicItem(await load(companyId, id));
      const before = beforeId ? await load(companyId, beforeId) : null;
      if (before && (before.product !== source.product || before.softwareVersion !== source.softwareVersion || before.id === source.id)) throw notFound("Feedback evidence cursor not found");
      if (!feedbackEvidence(source).fingerprint) return feedbackEvidencePage(source, [], null);
      // Cursor and every scanned row remain inside this company. No task/trace fetches.
      const rows = await db.select().from(inbox).where(and(eq(inbox.companyId, companyId), eq(inbox.product, source.product), eq(inbox.softwareVersion, source.softwareVersion), ne(inbox.id, id),
        before ? beforeCursor(companyId, before.id) : undefined))
        .orderBy(desc(inbox.createdAt), desc(inbox.id)).limit(FEEDBACK_EVIDENCE_SCAN_LIMIT + 1);
      const page = rows.slice(0, FEEDBACK_EVIDENCE_SCAN_LIMIT);
      return feedbackEvidencePage(source, page.map(publicItem), rows.length > FEEDBACK_EVIDENCE_SCAN_LIMIT ? page.at(-1)!.id : null);
    },
    async candidates(companyId: string, id: string) {
      const row = await load(companyId, id);
      const matches = await db.select().from(inbox).where(and(eq(inbox.companyId, companyId), eq(inbox.candidateKey, row.candidateKey), ne(inbox.id, id)))
        .orderBy(desc(inbox.createdAt), desc(inbox.id)).limit(21);
      return { method: "same_product_version_normalized_title" as const, autoMerged: false as const, items: matches.slice(0, 20).map(publicItem), hasMore: matches.length > 20 };
    },
  };
}
