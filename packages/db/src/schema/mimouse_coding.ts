import { pgTable, uuid, text, integer, timestamp, jsonb, unique, index, foreignKey } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { executionWorkspaces } from "./execution_workspaces.js";
import { routines, routineRevisions, routineRuns } from "./routines.js";
import { companySecrets } from "./company_secrets.js";
export const mimouseCodingDeliveries = pgTable("mimouse_coding_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  issueId: uuid("issue_id").notNull().references(() => issues.id), workspaceId: uuid("workspace_id").notNull().references(() => executionWorkspaces.id),
  gitlabOrigin: text("gitlab_origin").notNull(), projectId: integer("project_id").notNull(), secretRef: uuid("secret_ref").notNull().references(() => companySecrets.id),
  baseSha: text("base_sha").notNull(), headSha: text("head_sha").notNull(), sourceBranch: text("source_branch").notNull(), targetBranch: text("target_branch").notNull(),
  reviewReceipt: jsonb("review_receipt").$type<Record<string, unknown>>(),
  reviewedSha: text("reviewed_sha"), reviewerUserId: text("reviewer_user_id"), mrIid: integer("mr_iid"), pipelineId: integer("pipeline_id"),
  operationState: text("operation_state").notNull().default("local"), operationLease: uuid("operation_lease"),
  repairPolicy: jsonb("repair_policy").$type<Record<string, unknown>>(), repairStatus: text("repair_status").notNull().default("disabled"), repairLastCode: text("repair_last_code"),
  syncLease: uuid("sync_lease"), syncLeaseExpiresAt: timestamp("sync_lease_expires_at", { withTimezone: true }),
  nextSyncAt: timestamp("next_sync_at", { withTimezone: true }).defaultNow(), syncLastCode: text("sync_last_code"),
  evidence: jsonb("evidence").$type<Record<string, unknown>[]>().notNull().default([]), remoteEvidence: jsonb("remote_evidence").$type<Record<string, unknown>>().notNull().default({}),
  artifactManifest: jsonb("artifact_manifest").$type<Record<string, unknown>>(), repairAttempts: integer("repair_attempts").notNull().default(0), lastFailureFingerprint: text("last_failure_fingerprint"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ verificationIdentity: unique("mimouse_coding_verification_identity").on(t.companyId, t.id, t.issueId), identity: unique("mimouse_coding_issue_head_unique").on(t.companyId, t.issueId, t.headSha), companyIdentity: unique("mimouse_coding_company_id_unique").on(t.companyId, t.id), polling: index("mimouse_coding_poll_due_idx").on(t.operationState, t.nextSyncAt) }));

export const mimouseCodingRepairAttempts = pgTable("mimouse_coding_repair_attempts", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id), deliveryId: uuid("delivery_id").notNull(),
  attempt: integer("attempt").notNull(), pipelineId: integer("pipeline_id").notNull(), headSha: text("head_sha").notNull(), fingerprint: text("fingerprint").notNull(),
  routineId: uuid("routine_id").notNull().references(() => routines.id), routineRevisionId: uuid("routine_revision_id").notNull().references(() => routineRevisions.id),
  requestKey: text("request_key").notNull(), snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  state: text("state").notNull().default("reserved"), lease: uuid("lease"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  routineRunId: uuid("routine_run_id").references(() => routineRuns.id), issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }), lastCode: text("last_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  deliveryCompany: foreignKey({ columns: [t.companyId, t.deliveryId], foreignColumns: [mimouseCodingDeliveries.companyId, mimouseCodingDeliveries.id], name: "mimouse_repair_delivery_company_fk" }),
  attemptIdentity: unique("mimouse_repair_attempt_unique").on(t.deliveryId, t.attempt),
  pipelineIdentity: unique("mimouse_repair_pipeline_unique").on(t.deliveryId, t.pipelineId),
  requestIdentity: unique("mimouse_repair_request_unique").on(t.companyId, t.requestKey),
  pending: index("mimouse_repair_pending_idx").on(t.state, t.createdAt),
}));
