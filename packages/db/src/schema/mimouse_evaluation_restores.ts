import { pgTable, uuid, text, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";
import { companySkills, companySkillVersions } from "./company_skills.js";
import { mimouseEvaluationComparisons } from "./mimouse_evaluation.js";
export const mimouseEvaluationRestores = pgTable("mimouse_evaluation_restores", {
  id: uuid("id").primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id),
  skillId: uuid("skill_id").notNull().references(() => companySkills.id, { onDelete: "restrict" }),
  reportId: uuid("report_id").notNull().references(() => mimouseEvaluationComparisons.id, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest").notNull(), action: text("action").$type<"activate" | "rollback">().notNull(), rollbackOf: uuid("rollback_of"),
  status: text("status").$type<"prepared" | "applied" | "compensated">().notNull().default("prepared"),
  resolution: text("resolution").$type<"apply" | "compensate">().notNull().default("apply"),
  beforeVersionId: uuid("before_version_id").notNull().references(() => companySkillVersions.id),
  targetVersionId: uuid("target_version_id").notNull().references(() => companySkillVersions.id),
  beforeHash: text("before_hash").notNull(), targetHash: text("target_hash").notNull(), operationHash: text("operation_hash").notNull(),
  beforeName: text("before_name").notNull(), beforeDescription: text("before_description"), targetName: text("target_name").notNull(), targetDescription: text("target_description"),
  sourceDirectory: text("source_directory").notNull(), actorUserId: text("actor_user_id").notNull(), completedByUserId: text("completed_by_user_id"), errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), completedAt: timestamp("completed_at", { withTimezone: true }),
}, t => ({ request: uniqueIndex("mimouse_eval_restore_request").on(t.companyId, t.requestId),
  active: uniqueIndex("mimouse_eval_restore_pending").on(t.companyId, t.skillId).where(sql`${t.status} = 'prepared'`),
  list: index("mimouse_eval_restore_list").on(t.companyId, t.id),
  shape: check("mimouse_eval_restore_shape", sql`${t.status} in ('prepared','applied','compensated') and ${t.resolution} in ('apply','compensate') and ${t.action} in ('activate','rollback') and length(${t.operationHash})=64 and length(${t.beforeHash})=64 and length(${t.targetHash})=64 and ((${t.status}='prepared' and ${t.completedAt} is null) or (${t.status}<>'prepared' and ${t.completedAt} is not null))`),
}));
