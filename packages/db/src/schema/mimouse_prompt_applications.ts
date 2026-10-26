import { pgTable, uuid, text, timestamp, integer, jsonb, uniqueIndex, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { ComparePrivatePromptTests } from "@paperclipai/shared/mimouse-private-prompt-comparison";
import type { PromptApplicationSnapshot } from "@paperclipai/shared/mimouse-prompt-applications";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issues } from "./issues.js";
import { mimousePromptRevisions } from "./mimouse_prompt_registry.js";
export const mimousePromptApplications = pgTable("mimouse_prompt_applications", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id),
  promptId: uuid("prompt_id").notNull(), revisionId: uuid("revision_id").notNull(), revisionHash: text("revision_hash").notNull(),
  agentId: uuid("agent_id").notNull(), actorUserId: text("actor_user_id").notNull(), actorSessionId: text("actor_session_id").notNull(),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest").notNull(),
  expectedGeneration: integer("expected_generation").notNull(), approvalDigest: text("approval_digest").notNull(),
  comparison: jsonb("comparison").$type<ComparePrivatePromptTests>().notNull(), reportHash: text("report_hash").notNull(),
  snapshot: jsonb("snapshot").$type<PromptApplicationSnapshot>().notNull(),
  approvalExpiresAt: timestamp("approval_expires_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  request: uniqueIndex("mimouse_prompt_application_request").on(t.companyId, t.requestId),
  identity: uniqueIndex("mimouse_prompt_application_identity").on(t.companyId, t.agentId, t.id),
  agent: foreignKey({ columns: [t.companyId, t.agentId], foreignColumns: [agents.companyId, agents.id] }).onDelete("restrict"),
  revision: foreignKey({ columns: [t.companyId, t.promptId, t.revisionId], foreignColumns: [mimousePromptRevisions.companyId, mimousePromptRevisions.promptId, mimousePromptRevisions.id] }).onDelete("restrict"),
  generation: check("mimouse_prompt_application_generation", sql`${t.expectedGeneration} >= 0`),
  hashes: check("mimouse_prompt_application_hashes", sql`${t.revisionHash} ~ '^[a-f0-9]{64}$' AND ${t.requestDigest} ~ '^[a-f0-9]{64}$' AND ${t.approvalDigest} ~ '^[a-f0-9]{64}$' AND ${t.reportHash} ~ '^[a-f0-9]{64}$'`),
  expiry: check("mimouse_prompt_application_expiry", sql`${t.approvalExpiresAt} > ${t.createdAt}`),
}));
export const mimousePromptApplicationHeads = pgTable("mimouse_prompt_application_heads", {
  companyId: uuid("company_id").notNull(), agentId: uuid("agent_id").primaryKey(),
  generation: integer("generation").notNull().default(0), applicationId: uuid("application_id"),
  configuredAt: timestamp("configured_at", { withTimezone: true }),
}, t => ({
  agent: foreignKey({ columns: [t.companyId, t.agentId], foreignColumns: [agents.companyId, agents.id] }).onDelete("restrict"),
  application: foreignKey({ columns: [t.companyId, t.agentId, t.applicationId], foreignColumns: [mimousePromptApplications.companyId, mimousePromptApplications.agentId, mimousePromptApplications.id] }).onDelete("restrict"),
  generation: check("mimouse_prompt_application_head_generation", sql`${t.generation} >= 0 AND ((${t.applicationId} IS NULL AND ${t.configuredAt} IS NULL) OR (${t.applicationId} IS NOT NULL AND ${t.configuredAt} IS NOT NULL AND ${t.generation} > 0))`),
  receipt: foreignKey({ name: "mimouse_prompt_application_head_receipt", columns: [t.companyId, t.agentId, t.applicationId, t.generation], foreignColumns: [mimousePromptApplicationReceipts.companyId, mimousePromptApplicationReceipts.agentId, mimousePromptApplicationReceipts.applicationId, mimousePromptApplicationReceipts.generation] }).onDelete("restrict"),
}));
export const mimousePromptApplicationReceipts = pgTable("mimouse_prompt_application_receipts", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), agentId: uuid("agent_id").notNull(), applicationId: uuid("application_id").notNull(),
  action: text("action").$type<"configure" | "rollback">().notNull(), generation: integer("generation").notNull(),
  actorUserId: text("actor_user_id").notNull(), actorSessionId: text("actor_session_id").notNull(),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  request: uniqueIndex("mimouse_prompt_application_receipt_request").on(t.companyId, t.requestId),
  generation: uniqueIndex("mimouse_prompt_application_receipt_generation").on(t.companyId, t.agentId, t.generation),
  scope: uniqueIndex("mimouse_prompt_application_receipt_scope").on(t.companyId, t.agentId, t.applicationId, t.generation),
  digest: check("mimouse_prompt_application_receipt_digest", sql`${t.requestDigest} ~ '^[a-f0-9]{64}$'`),
  application: foreignKey({ columns: [t.companyId, t.agentId, t.applicationId], foreignColumns: [mimousePromptApplications.companyId, mimousePromptApplications.agentId, mimousePromptApplications.id] }).onDelete("restrict"),
  action: check("mimouse_prompt_application_receipt_action", sql`${t.action} IN ('configure','rollback') AND ${t.generation} > 0`),
}));
export const mimousePromptApplicationDispatches = pgTable("mimouse_prompt_application_dispatches", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), agentId: uuid("agent_id").notNull(), applicationId: uuid("application_id").notNull(),
  runId: uuid("run_id").notNull(),
  issueId: uuid("issue_id").notNull(), generation: integer("generation").notNull(),
  state: text("state").$type<"prepared" | "dispatched">().notNull().default("prepared"),
  configuredAt: timestamp("configured_at", { withTimezone: true }).notNull(),
  preparedAt: timestamp("prepared_at", { withTimezone: true }).notNull().defaultNow(),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }), promptHash: text("prompt_hash"),
  effectiveContextHash: text("effective_context_hash").notNull(),
}, t => ({
  run: uniqueIndex("mimouse_prompt_application_dispatch_run").on(t.runId),
  runScope: foreignKey({ name: "mimouse_prompt_application_dispatch_run_scope", columns: [t.companyId, t.agentId, t.runId], foreignColumns: [heartbeatRuns.companyId, heartbeatRuns.agentId, heartbeatRuns.id] }).onDelete("restrict"),
  issueScope: foreignKey({ name: "mimouse_prompt_application_dispatch_issue_scope", columns: [t.companyId, t.issueId], foreignColumns: [issues.companyId, issues.id] }).onDelete("restrict"),
  receipt: foreignKey({ name: "mimouse_prompt_application_dispatch_receipt", columns: [t.companyId, t.agentId, t.applicationId, t.generation], foreignColumns: [mimousePromptApplicationReceipts.companyId, mimousePromptApplicationReceipts.agentId, mimousePromptApplicationReceipts.applicationId, mimousePromptApplicationReceipts.generation] }).onDelete("restrict"),
  witness: check("mimouse_prompt_application_dispatch_witness", sql`${t.generation} > 0 AND ${t.effectiveContextHash} ~ '^[a-f0-9]{64}$' AND (${t.promptHash} IS NULL OR ${t.promptHash} ~ '^[a-f0-9]{64}$') AND ${t.preparedAt} >= ${t.configuredAt} AND (${t.dispatchedAt} IS NULL OR ${t.dispatchedAt} >= ${t.preparedAt})`),
  issue: uniqueIndex("mimouse_prompt_application_dispatch_issue").on(t.issueId),
  application: foreignKey({ columns: [t.companyId, t.agentId, t.applicationId], foreignColumns: [mimousePromptApplications.companyId, mimousePromptApplications.agentId, mimousePromptApplications.id] }).onDelete("restrict"),
  state: check("mimouse_prompt_application_dispatch_state", sql`${t.state} IN ('prepared','dispatched') AND (${t.state} <> 'dispatched' OR (${t.promptHash} IS NOT NULL AND ${t.dispatchedAt} IS NOT NULL))`),
}));
