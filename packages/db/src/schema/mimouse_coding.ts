import { pgTable, uuid, text, integer, timestamp, jsonb, unique, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { executionWorkspaces } from "./execution_workspaces.js";
import { companySecrets } from "./company_secrets.js";
export const mimouseCodingDeliveries = pgTable("mimouse_coding_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  issueId: uuid("issue_id").notNull().references(() => issues.id), workspaceId: uuid("workspace_id").notNull().references(() => executionWorkspaces.id),
  gitlabOrigin: text("gitlab_origin").notNull(), projectId: integer("project_id").notNull(), secretRef: uuid("secret_ref").notNull().references(() => companySecrets.id),
  baseSha: text("base_sha").notNull(), headSha: text("head_sha").notNull(), sourceBranch: text("source_branch").notNull(), targetBranch: text("target_branch").notNull(),
  reviewedSha: text("reviewed_sha"), reviewerUserId: text("reviewer_user_id"), mrIid: integer("mr_iid"), pipelineId: integer("pipeline_id"),
  operationState: text("operation_state").notNull().default("local"), operationLease: uuid("operation_lease"),
  syncLease: uuid("sync_lease"), syncLeaseExpiresAt: timestamp("sync_lease_expires_at", { withTimezone: true }),
  nextSyncAt: timestamp("next_sync_at", { withTimezone: true }).defaultNow(), syncLastCode: text("sync_last_code"),
  evidence: jsonb("evidence").$type<Record<string, unknown>[]>().notNull().default([]), remoteEvidence: jsonb("remote_evidence").$type<Record<string, unknown>>().notNull().default({}),
  artifactManifest: jsonb("artifact_manifest").$type<Record<string, unknown>>(), repairAttempts: integer("repair_attempts").notNull().default(0), lastFailureFingerprint: text("last_failure_fingerprint"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ identity: unique("mimouse_coding_issue_head_unique").on(t.companyId, t.issueId, t.headSha), polling: index("mimouse_coding_poll_due_idx").on(t.operationState, t.nextSyncAt) }));
