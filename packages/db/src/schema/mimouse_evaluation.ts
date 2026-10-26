import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index, foreignKey } from "drizzle-orm/pg-core";
import type { EvaluationFixedCase, EvaluationReport } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { companySkills, companySkillVersions } from "./company_skills.js";
export const mimouseEvaluationDatasets = pgTable("mimouse_evaluation_datasets", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id),
  skillId: uuid("skill_id").notNull().references(() => companySkills.id, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest").notNull(), name: text("name").notNull(),
  cases: jsonb("cases").$type<EvaluationFixedCase[]>().notNull(), datasetHash: text("dataset_hash").notNull(),
  actorId: text("actor_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ request: uniqueIndex("mimouse_eval_dataset_request").on(t.companyId, t.requestId),
  identity: uniqueIndex("mimouse_eval_dataset_identity").on(t.companyId, t.id), list: index("mimouse_eval_dataset_list").on(t.companyId, t.id) }));
export const mimouseEvaluationComparisons = pgTable("mimouse_evaluation_comparisons", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id),
  datasetId: uuid("dataset_id").notNull(), baselineVersionId: uuid("baseline_version_id").notNull().references(() => companySkillVersions.id, { onDelete: "restrict" }),
  candidateVersionId: uuid("candidate_version_id").notNull().references(() => companySkillVersions.id, { onDelete: "restrict" }),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest").notNull(),
  report: jsonb("report").$type<EvaluationReport>().notNull(),
  evidenceSnapshot: jsonb("evidence_snapshot").$type<Record<string, unknown>>().notNull(),
  actorId: text("actor_id").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ request: uniqueIndex("mimouse_eval_comparison_request").on(t.companyId, t.requestId),
  list: index("mimouse_eval_comparison_list").on(t.companyId, t.id),
  dataset: foreignKey({ columns: [t.companyId, t.datasetId], foreignColumns: [mimouseEvaluationDatasets.companyId, mimouseEvaluationDatasets.id] }).onDelete("restrict") }));
