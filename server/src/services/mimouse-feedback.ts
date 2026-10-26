import { createHash } from "node:crypto";
import { and, desc, eq, lt, ne, or } from "drizzle-orm";
import { mimouseFeedbackInbox as inbox, type Db } from "@paperclipai/db";
import { feedbackImportSchema, type FeedbackImportInput, type FeedbackInboxItem } from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";
import { createFeedbackRedactionState, sanitizeFeedbackText } from "./feedback-redaction.js";
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
  return {
    async import(companyId: string, raw: FeedbackImportInput, actorId: string) {
      const input = prepareFeedbackImport(raw);
      const [inserted] = await db.insert(inbox).values({ ...input, companyId, actorId }).onConflictDoNothing({ target: [inbox.companyId, inbox.sourceKind, inbox.sourceInstance, inbox.externalId] }).returning();
      if (inserted) return { item: publicItem(inserted), duplicate: false };
      const [existing] = await db.select().from(inbox).where(and(eq(inbox.companyId, companyId), eq(inbox.sourceKind, input.sourceKind), eq(inbox.sourceInstance, input.sourceInstance), eq(inbox.externalId, input.externalId)));
      if (!existing || existing.contentDigest !== input.contentDigest) throw conflict("Source event identity already has different content");
      return { item: publicItem(existing), duplicate: true };
    },
    async list(companyId: string, limit = 50, beforeId?: string) {
      const before = beforeId ? await load(companyId, beforeId) : null;
      const rows = await db.select().from(inbox).where(and(eq(inbox.companyId, companyId), before ? or(lt(inbox.createdAt, before.createdAt), and(eq(inbox.createdAt, before.createdAt), lt(inbox.id, before.id))) : undefined))
        .orderBy(desc(inbox.createdAt), desc(inbox.id)).limit(limit + 1);
      const page = rows.slice(0, limit); return { items: page.map(publicItem), nextBeforeId: rows.length > limit ? page.at(-1)!.id : null };
    },
    async get(companyId: string, id: string) { return publicItem(await load(companyId, id)); },
    async candidates(companyId: string, id: string) {
      const row = await load(companyId, id);
      const matches = await db.select().from(inbox).where(and(eq(inbox.companyId, companyId), eq(inbox.candidateKey, row.candidateKey), ne(inbox.id, id)))
        .orderBy(desc(inbox.createdAt), desc(inbox.id)).limit(21);
      return { method: "same_product_version_normalized_title" as const, autoMerged: false as const, items: matches.slice(0, 20).map(publicItem), hasMore: matches.length > 20 };
    },
  };
}
