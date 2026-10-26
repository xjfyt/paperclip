import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { OperationPreview, OperationPreviewInput } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { approvals } from "./approvals.js";
export const mimouseOperationPreviews = pgTable("mimouse_operation_previews", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest").notNull(),
  inputSnapshot: jsonb("input_snapshot").$type<OperationPreviewInput>().notNull(), preview: jsonb("preview").$type<OperationPreview>().notNull(),
  previewHash: text("preview_hash").notNull(), actorId: text("actor_id").notNull(),
  approvalId: uuid("approval_id").references(() => approvals.id), approvalPayloadHash: text("approval_payload_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  request: uniqueIndex("mimouse_operation_preview_request").on(t.companyId, t.requestId),
  companyIdentity: uniqueIndex("mimouse_operation_preview_company_identity").on(t.companyId, t.id),
  list: index("mimouse_operation_preview_list").on(t.companyId, t.createdAt),
  shape: check("mimouse_operation_preview_shape", sql`length(${t.previewHash})=64 AND length(${t.requestDigest})=64 AND ((${t.approvalId} IS NULL AND ${t.approvalPayloadHash} IS NULL) OR (${t.approvalId} IS NOT NULL AND ${t.approvalPayloadHash} IS NOT NULL AND length(${t.approvalPayloadHash})=64))`),
}));
