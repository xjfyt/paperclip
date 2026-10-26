import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { activityLog, authUsers, companies, companyMemberships, mimousePrompts as prompts,
  mimousePromptRevisions as revisions, mimousePromptReceipts as receipts, type Db } from "@paperclipai/db";
import { createPromptRevisionSchema, selectPromptRevisionSchema, type CreatePromptRevision, type SelectPromptRevision,
  type PromptRegistryHead, type PromptRevision, type PromptSelectionReceipt } from "@paperclipai/shared/mimouse-prompt-registry";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const head = (row: typeof prompts.$inferSelect): PromptRegistryHead => ({ ...row, runtimeApplied: false });
const revision = (row: typeof revisions.$inferSelect): PromptRevision => ({ id: row.id, companyId: row.companyId,
  promptId: row.promptId, contentHash: row.contentHash, actorUserId: row.actorUserId, createdAt: row.createdAt.toISOString() });
const receipt = (row: typeof receipts.$inferSelect): PromptSelectionReceipt => ({ id: row.id, companyId: row.companyId,
  promptId: row.promptId, action: row.action, previousReceiptId: row.previousReceiptId, beforeRevisionId: row.beforeRevisionId,
  selectedRevisionId: row.selectedRevisionId, rollbackOfReceiptId: row.rollbackOfReceiptId, actorUserId: row.actorUserId,
  createdAt: row.createdAt.toISOString(), runtimeApplied: false });
async function authorize(tx: Tx, companyId: string, userId: string) {
  const [user] = await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.id, userId)).for("share");
  const [member] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
    eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId),
    eq(companyMemberships.principalType, "user"), eq(companyMemberships.status, "active"),
    inArray(companyMemberships.membershipRole, ["owner", "admin"]))).for("share");
  if (!user || !member) throw forbidden("prompt_active_company_administrator_required");
  const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).for("share");
  if (!company || !["active", "paused"].includes(company.status)) throw unprocessable("prompt_available_company_required");
}
async function audit(tx: Tx, companyId: string, userId: string, id: string, action: string) {
  // No prompt text, free-form metadata, request digest or credentials in audit.
  await tx.insert(activityLog).values({ companyId, actorType: "user", actorId: userId,
    action: `prompt_registry.${action}`, entityType: "prompt_registry", entityId: id, details: { runtimeApplied: false } });
}
async function lockRequest(tx: Tx, companyId: string, kind: string, requestId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${companyId}:prompt:${kind}:${requestId}`}, 0))`);
}
function replay(existing: { actorUserId: string; requestDigest: string }, userId: string, digest: string) {
  if (existing.actorUserId !== userId || existing.requestDigest !== digest) throw conflict("prompt_request_identity_conflict");
}
export function promptRegistryService(db: Db) {
  return {
    async list(companyId: string, userId: string, beforeId?: string) {
      return db.transaction(async tx => {
        await authorize(tx, companyId, userId);
        const rows = await tx.select().from(prompts).where(and(eq(prompts.companyId, companyId), beforeId ? lt(prompts.id, beforeId) : undefined)).orderBy(desc(prompts.id)).limit(51);
        return { items: rows.slice(0, 50).map(head), nextBeforeId: rows.length > 50 ? rows[49]!.id : null };
      });
    },
    async history(companyId: string, userId: string, promptId: string, kind: "revisions" | "receipts", beforeId?: string) {
      return db.transaction(async tx => {
        await authorize(tx, companyId, userId);
        const [prompt] = await tx.select().from(prompts).where(and(eq(prompts.companyId, companyId), eq(prompts.id, promptId)));
        if (!prompt) throw notFound("prompt_not_found");
        // Explicit projections in revision responses keep raw content off history/list surfaces.
        if (kind === "revisions") {
          const rows = await tx.select().from(revisions).where(and(eq(revisions.companyId, companyId), eq(revisions.promptId, promptId), beforeId ? lt(revisions.id, beforeId) : undefined)).orderBy(desc(revisions.id)).limit(51);
          return { head: head(prompt), items: rows.slice(0, 50).map(revision), nextBeforeId: rows.length > 50 ? rows[49]!.id : null };
        }
        const rows = await tx.select().from(receipts).where(and(eq(receipts.companyId, companyId), eq(receipts.promptId, promptId), beforeId ? lt(receipts.id, beforeId) : undefined)).orderBy(desc(receipts.id)).limit(51);
        return { head: head(prompt), items: rows.slice(0, 50).map(receipt), nextBeforeId: rows.length > 50 ? rows[49]!.id : null };
      });
    },
    async content(companyId: string, userId: string, promptId: string, revisionId: string) {
      return db.transaction(async tx => {
        await authorize(tx, companyId, userId);
        const [row] = await tx.select().from(revisions).where(and(eq(revisions.companyId, companyId), eq(revisions.promptId, promptId), eq(revisions.id, revisionId)));
        if (!row) throw notFound("prompt_revision_not_found");
        if (hash(row.content) !== row.contentHash) throw conflict("prompt_revision_integrity_failed");
        return { ...revision(row), content: row.content, contentDisposition: "untrusted_inert_text" as const };
      });
    },
    async create(companyId: string, userId: string, raw: CreatePromptRevision) {
      const input = createPromptRevisionSchema.parse(raw), digest = hash(JSON.stringify(input));
      return db.transaction(async tx => {
        await authorize(tx, companyId, userId); await lockRequest(tx, companyId, "revision", input.requestId);
        const [existing] = await tx.select().from(revisions).where(and(eq(revisions.companyId, companyId), eq(revisions.requestId, input.requestId)));
        if (existing) { replay(existing, userId, digest); return { item: revision(existing), duplicate: true }; }
        await tx.insert(prompts).values({ companyId, promptKey: input.promptKey }).onConflictDoNothing();
        const [prompt] = await tx.select().from(prompts).where(and(eq(prompts.companyId, companyId), eq(prompts.promptKey, input.promptKey)));
        if (!prompt) throw conflict("prompt_creation_conflict");
        const [row] = await tx.insert(revisions).values({ companyId, promptId: prompt.id, content: input.content,
          contentHash: hash(input.content), requestId: input.requestId, requestDigest: digest, actorUserId: userId }).returning();
        await audit(tx, companyId, userId, row!.id, "revision_created");
        return { item: revision(row!), duplicate: false };
      });
    },
    async select(companyId: string, userId: string, promptId: string, raw: SelectPromptRevision) {
      const input = selectPromptRevisionSchema.parse(raw), digest = hash(JSON.stringify({ promptId, ...input }));
      return db.transaction(async tx => {
        await authorize(tx, companyId, userId); await lockRequest(tx, companyId, "receipt", input.requestId);
        const [existing] = await tx.select().from(receipts).where(and(eq(receipts.companyId, companyId), eq(receipts.requestId, input.requestId)));
        // Replay returns the historical receipt, NOT a claim about today's head.
        if (existing) { replay(existing, userId, digest); return { item: receipt(existing), duplicate: true }; }
        const [prompt] = await tx.select().from(prompts).where(and(eq(prompts.companyId, companyId), eq(prompts.id, promptId))).for("update");
        if (!prompt) throw notFound("prompt_not_found");
        if (prompt.headReceiptId !== input.expectedHeadReceiptId) throw conflict("prompt_head_changed");
        let target: string | null;
        if (input.action === "promote") target = input.revisionId;
        else {
          // Undo exactly the current receipt. This preserves a linear, inspectable chain,
          // prevents stale rollback, and also allows undoing a rollback explicitly.
          if (input.rollbackOfReceiptId !== prompt.headReceiptId) throw conflict("prompt_rollback_must_reference_head");
          const [prior] = await tx.select().from(receipts).where(and(eq(receipts.companyId, companyId), eq(receipts.promptId, promptId), eq(receipts.id, input.rollbackOfReceiptId)));
          if (!prior) throw notFound("prompt_receipt_not_found"); target = prior.beforeRevisionId;
        }
        if (target === prompt.selectedRevisionId) throw conflict("prompt_selection_unchanged");
        if (target !== null) {
          const [row] = await tx.select().from(revisions).where(and(eq(revisions.companyId, companyId), eq(revisions.promptId, promptId), eq(revisions.id, target)));
          if (!row) throw notFound("prompt_revision_not_found");
          if (hash(row.content) !== row.contentHash) throw conflict("prompt_revision_integrity_failed");
        }
        const [row] = await tx.insert(receipts).values({ companyId, promptId, action: input.action,
          previousReceiptId: prompt.headReceiptId, beforeRevisionId: prompt.selectedRevisionId, selectedRevisionId: target,
          rollbackOfReceiptId: input.action === "rollback" ? input.rollbackOfReceiptId : null,
          requestId: input.requestId, requestDigest: digest, actorUserId: userId }).returning();
        const changed = await tx.update(prompts).set({ selectedRevisionId: target, headReceiptId: row!.id }).where(and(
          eq(prompts.companyId, companyId), eq(prompts.id, promptId),
          input.expectedHeadReceiptId === null ? isNull(prompts.headReceiptId) : eq(prompts.headReceiptId, input.expectedHeadReceiptId))).returning({ id: prompts.id });
        if (changed.length !== 1) throw conflict("prompt_head_changed");
        await audit(tx, companyId, userId, row!.id, input.action);
        return { item: receipt(row!), duplicate: false };
      });
    },
  };
}
