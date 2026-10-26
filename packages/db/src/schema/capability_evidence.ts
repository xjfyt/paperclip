import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import type { CapabilityReceipt, AppendCapabilityEvidence } from "@paperclipai/shared/capability-evidence";

export const capabilityEvidence = pgTable("capability_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  revision: integer("revision").notNull(),
  idempotencyKey: uuid("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  action: text("action").$type<AppendCapabilityEvidence["action"]>().notNull(),
  targetId: uuid("target_id").references((): AnyPgColumn => capabilityEvidence.id),
  receipt: jsonb("receipt").$type<CapabilityReceipt>(),
  reason: text("reason").$type<AppendCapabilityEvidence["reason"]>().notNull(),
  reviewerId: text("reviewer_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  revisionPositive: check("capability_evidence_revision_positive", sql`${table.revision} > 0`),
  actionValid: check("capability_evidence_action_valid", sql`${table.action} in ('record','revoke','supersede')`),
  eventShape: check("capability_evidence_event_shape", sql`(${table.action} = 'record' and ${table.receipt} is not null and ${table.targetId} is null) or (${table.action} = 'supersede' and ${table.receipt} is not null and ${table.targetId} is not null) or (${table.action} = 'revoke' and ${table.receipt} is null and ${table.targetId} is not null)`),
  revisionUnique: uniqueIndex("capability_evidence_company_revision").on(table.companyId, table.revision),
  idempotencyUnique: uniqueIndex("capability_evidence_company_idempotency").on(table.companyId, table.idempotencyKey),
}));
