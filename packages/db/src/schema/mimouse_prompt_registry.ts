import { pgTable, uuid, text, timestamp, uniqueIndex, foreignKey, check, type AnyPgColumn, type PgTableExtraConfig } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";
export const mimousePrompts = pgTable("mimouse_prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  promptKey: text("prompt_key").notNull(),
  selectedRevisionId: uuid("selected_revision_id"), headReceiptId: uuid("head_receipt_id"),
}, (t): PgTableExtraConfig => ({
  format: check("mimouse_prompt_key_format", sql`${t.promptKey} ~ '^[a-z][a-z0-9_-]{0,79}$'`),
  selected: foreignKey({ name: "mimouse_prompt_selected_scope", columns: [t.companyId, t.id, t.selectedRevisionId], foreignColumns: [mimousePromptRevisions.companyId, mimousePromptRevisions.promptId, mimousePromptRevisions.id] }),
  head: foreignKey({ name: "mimouse_prompt_head_scope", columns: [t.companyId, t.id, t.headReceiptId], foreignColumns: [mimousePromptReceipts.companyId, mimousePromptReceipts.promptId, mimousePromptReceipts.id] }),
  key: uniqueIndex("mimouse_prompt_key").on(t.companyId, t.promptKey), identity: uniqueIndex("mimouse_prompt_identity").on(t.companyId, t.id) }));
export const mimousePromptRevisions = pgTable("mimouse_prompt_revisions", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), promptId: uuid("prompt_id").notNull(),
  content: text("content").notNull(), contentHash: text("content_hash").notNull(),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest").notNull(), actorUserId: text("actor_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t): PgTableExtraConfig => ({ request: uniqueIndex("mimouse_prompt_revision_request").on(t.companyId, t.requestId),
  size: check("mimouse_prompt_content_size", sql`octet_length(${t.content}) BETWEEN 1 AND 128000`),
  hash: check("mimouse_prompt_content_hash", sql`${t.contentHash} ~ '^[a-f0-9]{64}$'`),
  identity: uniqueIndex("mimouse_prompt_revision_identity").on(t.companyId, t.promptId, t.id),
  prompt: foreignKey({ columns: [t.companyId, t.promptId], foreignColumns: [mimousePrompts.companyId, mimousePrompts.id] }).onDelete("restrict") }));
export const mimousePromptReceipts = pgTable("mimouse_prompt_receipts", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), promptId: uuid("prompt_id").notNull(),
  action: text("action").$type<"promote" | "rollback">().notNull(), previousReceiptId: uuid("previous_receipt_id").references((): AnyPgColumn => mimousePromptReceipts.id),
  beforeRevisionId: uuid("before_revision_id"), selectedRevisionId: uuid("selected_revision_id"),
  rollbackOfReceiptId: uuid("rollback_of_receipt_id").references((): AnyPgColumn => mimousePromptReceipts.id),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest").notNull(), actorUserId: text("actor_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t): PgTableExtraConfig => ({ request: uniqueIndex("mimouse_prompt_receipt_request").on(t.companyId, t.requestId),
  previousScope: foreignKey({ name: "mimouse_prompt_previous_scope", columns: [t.companyId, t.promptId, t.previousReceiptId], foreignColumns: [t.companyId, t.promptId, t.id] }),
  rollbackScope: foreignKey({ name: "mimouse_prompt_rollback_scope", columns: [t.companyId, t.promptId, t.rollbackOfReceiptId], foreignColumns: [t.companyId, t.promptId, t.id] }),
  transition: check("mimouse_prompt_transition", sql`${t.beforeRevisionId} IS DISTINCT FROM ${t.selectedRevisionId}`),
  action: check("mimouse_prompt_action", sql`(${t.action} = 'promote' AND ${t.selectedRevisionId} IS NOT NULL AND ${t.rollbackOfReceiptId} IS NULL) OR (${t.action} = 'rollback' AND ${t.rollbackOfReceiptId} IS NOT NULL AND ${t.previousReceiptId} IS NOT NULL AND ${t.rollbackOfReceiptId} = ${t.previousReceiptId})`),
  identity: uniqueIndex("mimouse_prompt_receipt_identity").on(t.companyId, t.promptId, t.id),
  prompt: foreignKey({ columns: [t.companyId, t.promptId], foreignColumns: [mimousePrompts.companyId, mimousePrompts.id] }).onDelete("restrict"),
  before: foreignKey({ columns: [t.companyId, t.promptId, t.beforeRevisionId], foreignColumns: [mimousePromptRevisions.companyId, mimousePromptRevisions.promptId, mimousePromptRevisions.id] }),
  selected: foreignKey({ columns: [t.companyId, t.promptId, t.selectedRevisionId], foreignColumns: [mimousePromptRevisions.companyId, mimousePromptRevisions.promptId, mimousePromptRevisions.id] }),
}));
