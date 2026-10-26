import { sql } from "drizzle-orm";
import { check, pgTable, uuid, integer, text, jsonb, timestamp, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import type { RoutingPolicy, RoutingPreview } from "@paperclipai/shared/cost-routing-preview";
export const costRoutingPolicies = pgTable("cost_routing_policies", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id),
  revision: integer("revision").notNull(), requestId: uuid("request_id").notNull(), requestHash: text("request_hash").notNull(),
  policy: jsonb("policy").$type<RoutingPolicy>().notNull(), actorId: text("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ positiveRevision: check("cost_routing_policy_positive_revision", sql`${t.revision} > 0`), revision: uniqueIndex("cost_routing_policy_revision").on(t.companyId, t.revision),
  request: uniqueIndex("cost_routing_policy_request").on(t.companyId, t.requestId) }));
export const costRoutingPreviews = pgTable("cost_routing_previews", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id),
  policyRevision: integer("policy_revision").notNull(), requestId: uuid("request_id").notNull(), requestHash: text("request_hash").notNull(),
  preview: jsonb("preview").$type<RoutingPreview>().notNull(), receiptHash: text("receipt_hash").notNull(),
  actorId: text("actor_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ request: uniqueIndex("cost_routing_preview_request").on(t.companyId, t.requestId),
  policy: foreignKey({ columns: [t.companyId, t.policyRevision], foreignColumns: [costRoutingPolicies.companyId, costRoutingPolicies.revision] }) }));
