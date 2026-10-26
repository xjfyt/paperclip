import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { PrivatePromptApprovalSnapshot, PrivatePromptPreparedWitness, PrivatePromptTestStatus } from "@paperclipai/shared/mimouse-private-prompt-tests";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { agentWakeupRequests } from "./agent_wakeup_requests.js";
import { mimousePromptRevisions, mimousePromptReceipts } from "./mimouse_prompt_registry.js";
import { mimouseEvaluationDatasets } from "./mimouse_evaluation.js";
import { companySkillVersions } from "./company_skills.js";

// Dedicated private storage: never joined into ordinary Skills Studio test runs.
export const mimousePrivatePromptTests = pgTable("mimouse_private_prompt_tests", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  promptId: uuid("prompt_id").notNull(), revisionId: uuid("revision_id").notNull(),
  headReceiptId: uuid("head_receipt_id"), revisionHash: text("revision_hash").notNull(),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest").notNull(),
  actorUserId: text("actor_user_id").notNull(), actorSessionId: text("actor_session_id").notNull(),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "restrict" }),
  datasetId: uuid("dataset_id").notNull(), datasetHash: text("dataset_hash").notNull(), caseId: uuid("case_id").notNull(),
  skillVersionId: uuid("skill_version_id").notNull().references(() => companySkillVersions.id, { onDelete: "restrict" }),
  configDigest: text("config_digest").notNull(),
  approvalSnapshot: jsonb("approval_snapshot").$type<PrivatePromptApprovalSnapshot>(),
  skillVersionHash: text("skill_version_hash").notNull(), secretValueHash: text("secret_value_hash").notNull(),
  status: text("status").$type<PrivatePromptTestStatus>().notNull().default("awaiting_confirmation"),
  issueId: uuid("issue_id").references(() => issues.id, { onDelete: "restrict" }),
  wakeupRequestId: uuid("wakeup_request_id").references(() => agentWakeupRequests.id, { onDelete: "restrict" }),
  heartbeatRunId: uuid("heartbeat_run_id").references(() => heartbeatRuns.id, { onDelete: "restrict" }),
  attemptId: uuid("attempt_id"),
  prepared: jsonb("prepared").$type<PrivatePromptPreparedWitness>(),
  spawnedAt: timestamp("spawned_at", { withTimezone: true }),
  privateResult: jsonb("private_result").$type<{ summary: string | null; resultJson: Record<string, unknown> | null }>(),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  request: uniqueIndex("mimouse_private_prompt_test_request").on(t.companyId, t.requestId),
  issue: uniqueIndex("mimouse_private_prompt_test_issue").on(t.issueId),
  wake: uniqueIndex("mimouse_private_prompt_test_wake").on(t.wakeupRequestId),
  run: uniqueIndex("mimouse_private_prompt_test_run").on(t.heartbeatRunId),
  attempt: uniqueIndex("mimouse_private_prompt_test_attempt").on(t.attemptId),
  revision: foreignKey({ name: "mimouse_private_prompt_test_revision", columns: [t.companyId, t.promptId, t.revisionId], foreignColumns: [mimousePromptRevisions.companyId, mimousePromptRevisions.promptId, mimousePromptRevisions.id] }).onDelete("restrict"),
  receipt: foreignKey({ name: "mimouse_private_prompt_test_receipt", columns: [t.companyId, t.promptId, t.headReceiptId], foreignColumns: [mimousePromptReceipts.companyId, mimousePromptReceipts.promptId, mimousePromptReceipts.id] }).onDelete("restrict"),
  dataset: foreignKey({ name: "mimouse_private_prompt_test_dataset", columns: [t.companyId, t.datasetId], foreignColumns: [mimouseEvaluationDatasets.companyId, mimouseEvaluationDatasets.id] }).onDelete("restrict"),
  state: check("mimouse_private_prompt_test_state", sql`${t.status} IN ('awaiting_confirmation','pending_harness','pending_wake','queued','prepared','spawned','completed','failed','unknown','cancelled')`),
  confirmation: check("mimouse_private_prompt_test_confirmation", sql`${t.status} <> 'awaiting_confirmation' OR (${t.issueId} IS NULL AND ${t.wakeupRequestId} IS NULL AND ${t.heartbeatRunId} IS NULL AND ${t.attemptId} IS NULL AND ${t.prepared} IS NULL AND ${t.privateResult} IS NULL)`),
  witness: check("mimouse_private_prompt_test_witness", sql`${t.status} NOT IN ('prepared','spawned','completed') OR (${t.prepared} IS NOT NULL AND ${t.attemptId} IS NOT NULL AND ${t.heartbeatRunId} IS NOT NULL)`),
  spawned: check("mimouse_private_prompt_test_spawned", sql`${t.status} NOT IN ('spawned','completed') OR ${t.spawnedAt} IS NOT NULL`),
  result: check("mimouse_private_prompt_test_result", sql`${t.status} <> 'completed' OR ${t.privateResult} IS NOT NULL`),
}));
