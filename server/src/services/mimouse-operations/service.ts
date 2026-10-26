import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { approvals, companies, companyMemberships, mimouseOperationPreviews as previews, type Db } from "@paperclipai/db";
import { createOperationPreviewSchema, requestOperationApprovalSchema, type CreateOperationPreviewInput, type RequestOperationApprovalInput, type OperationPreviewRecord, type OperationReadiness } from "@paperclipai/shared";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { approvalRecords } from "../approvals.js";
import { canonical, operationPreview } from "./preview.js";
import { operationApprovalPayload } from "./approval-payload.js";
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
function publicRecord(row: typeof previews.$inferSelect): OperationPreviewRecord {
  return { id: row.id, companyId: row.companyId, requestId: row.requestId, actorId: row.actorId, preview: row.preview, approvalId: row.approvalId, createdAt: row.createdAt.toISOString() };
}
export function operationPreviewService(db: Db) {
  async function load(companyId: string, id: string) {
    const [row] = await db.select().from(previews).where(and(eq(previews.companyId, companyId), eq(previews.id, id)));
    if (!row) throw notFound("Data preview not found"); return row;
  }
  return {
    async create(companyId: string, raw: CreateOperationPreviewInput, actorId: string) {
      const input = createOperationPreviewSchema.parse(raw), { requestId, ...snapshot } = input;
      const [company] = await db.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId));
      if (company?.status !== "active") throw unprocessable("An active company is required");
      const inputSnapshot = { ...snapshot, companyId };
      let preview;
      try { preview = operationPreview(inputSnapshot); } catch (error) { throw unprocessable(error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : "invalid_data_preview"); }
      const requestDigest = digest(input);
      const [row] = await db.insert(previews).values({ companyId, requestId, requestDigest, actorId, inputSnapshot, preview, previewHash: preview.previewHash })
        .onConflictDoNothing({ target: [previews.companyId, previews.requestId] }).returning();
      if (row) return { item: publicRecord(row), duplicate: false };
      const [existing] = await db.select().from(previews).where(and(eq(previews.companyId, companyId), eq(previews.requestId, requestId)));
      if (!existing || existing.actorId !== actorId || existing.requestDigest !== requestDigest) throw conflict("Preview request already has different input");
      return { item: publicRecord(existing), duplicate: true };
    },
    async list(companyId: string, limit = 50, beforeId?: string) {
      // Validate the company-scoped identity, but never round-trip its
      // timestamptz through JS Date: PostgreSQL retains sub-millisecond digits.
      if (beforeId) await load(companyId, beforeId);
      const rows = await db.select({ id: previews.id, companyId: previews.companyId, actorId: previews.actorId, previewHash: previews.previewHash, approvalId: previews.approvalId, createdAt: previews.createdAt,
        period: sql<string>`${previews.preview}->>'period'`, timeZone: sql<string>`${previews.preview}->>'timeZone'`, counts: sql<Record<string, number>>`${previews.preview}->'counts'` })
        .from(previews).where(and(eq(previews.companyId, companyId), beforeId ? sql`(${previews.createdAt}, ${previews.id}) < (
          select preview_cursor.created_at, preview_cursor.id from ${previews} as preview_cursor
          where preview_cursor.company_id = ${companyId} and preview_cursor.id = ${beforeId}
        )` : undefined))
        .orderBy(desc(previews.createdAt), desc(previews.id)).limit(limit + 1);
      return { items: rows.slice(0, limit), nextBeforeId: rows.length > limit ? rows[limit - 1].id : null };
    },
    async get(companyId: string, id: string) { return publicRecord(await load(companyId, id)); },
    async requestApproval(companyId: string, id: string, actorUserId: string, raw: RequestOperationApprovalInput) {
      const input = requestOperationApprovalSchema.parse(raw);
      return db.transaction(async tx => {
        const [member] = await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actorUserId))).for("share");
        const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
        if (company?.status !== "active" || member?.status !== "active" || !["owner", "admin"].includes(member.membershipRole ?? "")) throw forbidden("An active company administrator must request review");
        const [row] = await tx.select().from(previews).where(and(eq(previews.companyId, companyId), eq(previews.id, id))).for("update");
        if (!row) throw notFound("Data preview not found");
        if (row.previewHash !== input.expectedPreviewHash) throw conflict("Preview confirmation is stale");
        if (!row.preview.counts.insert && !row.preview.counts.update) throw unprocessable("No changed records require approval");
        if (row.approvalId) {
          const [existing] = await tx.select().from(approvals).where(and(eq(approvals.companyId, companyId), eq(approvals.id, row.approvalId)));
          if (!existing || digest(existing.payload) !== row.approvalPayloadHash) throw conflict("Bound approval changed; create and review a new preview");
          return { approvalId: existing.id, status: existing.status, previewHash: row.previewHash, externalWrites: 0 };
        }
        const payload = operationApprovalPayload(row.id, company.issuePrefix, row.preview, input.locale);
        const approval = await approvalRecords(tx as unknown as Db).create(companyId, { type: "request_board_approval", requestedByUserId: actorUserId, payload });
        await tx.update(previews).set({ approvalId: approval.id, approvalPayloadHash: digest(payload) }).where(eq(previews.id, row.id));
        return { approvalId: approval.id, status: approval.status, previewHash: row.previewHash, externalWrites: 0 };
      });
    },
    async readiness(companyId: string, id: string): Promise<OperationReadiness> {
      const row = await load(companyId, id), blockers = ["write_adapter_not_implemented"];
      let approval: OperationReadiness["approval"] = null;
      if (!row.approvalId) blockers.push("approval_not_requested");
      else {
        const [record] = await db.select().from(approvals).where(and(eq(approvals.companyId, companyId), eq(approvals.id, row.approvalId)));
        if (!record || record.type !== "request_board_approval" || digest(record.payload) !== row.approvalPayloadHash) blockers.push("approval_binding_changed");
        else {
          approval = { id: record.id, status: record.status };
          if (record.status !== "approved") blockers.push("approval_not_approved");
          else {
            const [member] = await db.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, record.decidedByUserId ?? "")));
            if (member?.status !== "active" || !["owner", "admin"].includes(member.membershipRole ?? "")) blockers.push("approver_authority_unavailable");
          }
        }
      }
      return { mode: "dry_run_only", writesSupported: false, externalWrites: 0, approval, blockers };
    },
  };
}
