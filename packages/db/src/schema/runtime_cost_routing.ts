import { sql } from "drizzle-orm";
import { check, foreignKey, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { RuntimeRoutingBindingState, RuntimeRoutingCandidateSnapshot, RuntimeRoutingPolicy } from "@paperclipai/shared/runtime-cost-routing";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

/** Separate from v1 preview: an immutable, human-reviewable v2 proposal. */
export const runtimeRoutingPolicies = pgTable("runtime_routing_policies", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest").notNull(),
  actorUserId: text("actor_user_id").notNull(), actorSessionId: text("actor_session_id").notNull(),
  expectedGeneration: integer("expected_generation").notNull(), policy: jsonb("policy").$type<RuntimeRoutingPolicy>().notNull(),
  candidates: jsonb("candidates").$type<RuntimeRoutingCandidateSnapshot[]>().notNull(), approvalDigest: text("approval_digest").notNull(),
  approvalExpiresAt: timestamp("approval_expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  scope: uniqueIndex("runtime_routing_policy_scope").on(t.companyId, t.id),
  request: uniqueIndex("runtime_routing_policy_request").on(t.companyId, t.requestId),
  generation: check("runtime_routing_policy_generation", sql`${t.expectedGeneration} >= 0 AND ${t.expectedGeneration} < 2147483647`),
  hashes: check("runtime_routing_policy_hashes", sql`${t.requestDigest} ~ '^[a-f0-9]{64}$' AND ${t.approvalDigest} ~ '^[a-f0-9]{64}$'`),
  expiry: check("runtime_routing_policy_expiry", sql`${t.approvalExpiresAt} > ${t.createdAt}`),
  pool: check("runtime_routing_policy_pool", sql`jsonb_typeof(${t.candidates}) = 'array' AND jsonb_array_length(${t.candidates}) BETWEEN 1 AND 20`),
}));
export const runtimeRoutingReceipts = pgTable("runtime_routing_receipts", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), policyId: uuid("policy_id").notNull(),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest").notNull(),
  actorUserId: text("actor_user_id").notNull(), actorSessionId: text("actor_session_id").notNull(),
  action: text("action").$type<"approve" | "disable">().notNull(), generation: integer("generation").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  request: uniqueIndex("runtime_routing_receipt_request").on(t.companyId, t.requestId),
  generation: uniqueIndex("runtime_routing_receipt_generation").on(t.companyId, t.generation),
  scope: uniqueIndex("runtime_routing_receipt_scope").on(t.companyId, t.policyId, t.generation),
  policy: foreignKey({ name: "runtime_routing_receipt_policy_fk", columns: [t.companyId, t.policyId], foreignColumns: [runtimeRoutingPolicies.companyId, runtimeRoutingPolicies.id] }).onDelete("restrict"),
  action: check("runtime_routing_receipt_action", sql`${t.action} IN ('approve','disable') AND ${t.generation} > 0`),
  digest: check("runtime_routing_receipt_digest", sql`${t.requestDigest} ~ '^[a-f0-9]{64}$'`),
}));
/** Missing row or null policyId is OFF. Approval/disable never requests a wake. */
export const runtimeRoutingHeads = pgTable("runtime_routing_heads", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id),
  generation: integer("generation").notNull().default(0), policyId: uuid("policy_id"),
  configuredAt: timestamp("configured_at", { withTimezone: true }),
}, t => ({
  receipt: foreignKey({ name: "runtime_routing_head_receipt_fk", columns: [t.companyId, t.policyId, t.generation], foreignColumns: [runtimeRoutingReceipts.companyId, runtimeRoutingReceipts.policyId, runtimeRoutingReceipts.generation] }).onDelete("restrict"),
  state: check("runtime_routing_head_state", sql`${t.generation} >= 0 AND ((${t.policyId} IS NULL AND ${t.configuredAt} IS NULL) OR (${t.policyId} IS NOT NULL AND ${t.configuredAt} IS NOT NULL AND ${t.generation} > 0))`),
}));
/** The selection is committed with a new ordinary projectless issue, before wake. */
export const runtimeRoutingBindings = pgTable("runtime_routing_bindings", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(), issueId: uuid("issue_id").notNull(),
  policyId: uuid("policy_id").notNull(), generation: integer("generation").notNull(),
  selectedAgentId: uuid("selected_agent_id").notNull(), selectedCandidateSnapshot: jsonb("selected_candidate_snapshot").$type<RuntimeRoutingCandidateSnapshot>().notNull(),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest").notNull(),
  actorUserId: text("actor_user_id").notNull(), actorSessionId: text("actor_session_id").notNull(),
  decisionDigest: text("decision_digest").notNull(), taskDigest: text("task_digest").notNull(),
  state: text("state").$type<RuntimeRoutingBindingState>().notNull().default("bound"),
  dispatchRequestId: uuid("dispatch_request_id"), dispatchRequestDigest: text("dispatch_request_digest"),
  dispatchActorUserId: text("dispatch_actor_user_id"), dispatchActorSessionId: text("dispatch_actor_session_id"),
  wakeRequestedAt: timestamp("wake_requested_at", { withTimezone: true }), runId: uuid("run_id"),
  startRequestedAt: timestamp("start_requested_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  scope: uniqueIndex("runtime_routing_binding_scope").on(t.companyId, t.id),
  request: uniqueIndex("runtime_routing_binding_request").on(t.companyId, t.requestId),
  dispatch: uniqueIndex("runtime_routing_binding_dispatch").on(t.companyId, t.dispatchRequestId),
  issue: uniqueIndex("runtime_routing_binding_issue").on(t.issueId), run: uniqueIndex("runtime_routing_binding_run").on(t.runId),
  issueScope: foreignKey({ name: "runtime_routing_binding_issue_fk", columns: [t.companyId, t.issueId], foreignColumns: [issues.companyId, issues.id] }).onDelete("restrict"),
  agent: foreignKey({ name: "runtime_routing_binding_agent_fk", columns: [t.companyId, t.selectedAgentId], foreignColumns: [agents.companyId, agents.id] }).onDelete("restrict"),
  receipt: foreignKey({ name: "runtime_routing_binding_receipt_fk", columns: [t.companyId, t.policyId, t.generation], foreignColumns: [runtimeRoutingReceipts.companyId, runtimeRoutingReceipts.policyId, runtimeRoutingReceipts.generation] }).onDelete("restrict"),
  runScope: foreignKey({ name: "runtime_routing_binding_run_fk", columns: [t.companyId, t.selectedAgentId, t.runId], foreignColumns: [heartbeatRuns.companyId, heartbeatRuns.agentId, heartbeatRuns.id] }).onDelete("restrict"),
  hashes: check("runtime_routing_binding_hashes", sql`${t.requestDigest} ~ '^[a-f0-9]{64}$' AND ${t.decisionDigest} ~ '^[a-f0-9]{64}$' AND ${t.taskDigest} ~ '^[a-f0-9]{64}$' AND (${t.dispatchRequestDigest} IS NULL OR ${t.dispatchRequestDigest} ~ '^[a-f0-9]{64}$')`),
  generation: check("runtime_routing_binding_generation", sql`${t.generation} > 0`),
  dispatchShape: check("runtime_routing_binding_dispatch_shape", sql`(${t.dispatchRequestId} IS NULL AND ${t.dispatchRequestDigest} IS NULL AND ${t.dispatchActorUserId} IS NULL AND ${t.dispatchActorSessionId} IS NULL AND ${t.wakeRequestedAt} IS NULL) OR (${t.dispatchRequestId} IS NOT NULL AND ${t.dispatchRequestDigest} IS NOT NULL AND ${t.dispatchActorUserId} IS NOT NULL AND ${t.dispatchActorSessionId} IS NOT NULL AND ${t.wakeRequestedAt} IS NOT NULL)`),
  state: check("runtime_routing_binding_state", sql`(${t.state} = 'bound' AND ${t.dispatchRequestId} IS NULL AND ${t.runId} IS NULL AND ${t.startRequestedAt} IS NULL) OR (${t.state} = 'wake_pending' AND ${t.dispatchRequestId} IS NOT NULL AND ${t.runId} IS NULL AND ${t.startRequestedAt} IS NULL) OR (${t.state} = 'run_claimed' AND ${t.dispatchRequestId} IS NOT NULL AND ${t.runId} IS NOT NULL AND ${t.startRequestedAt} IS NULL) OR (${t.state} = 'start_requested' AND ${t.dispatchRequestId} IS NOT NULL AND ${t.runId} IS NOT NULL AND ${t.startRequestedAt} IS NOT NULL)`),
  chronology: check("runtime_routing_binding_chronology", sql`(${t.wakeRequestedAt} IS NULL OR ${t.wakeRequestedAt} >= ${t.createdAt}) AND (${t.startRequestedAt} IS NULL OR ${t.startRequestedAt} >= ${t.wakeRequestedAt})`),
}));
