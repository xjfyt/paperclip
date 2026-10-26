import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, boolean, integer, index, uniqueIndex, check, foreignKey, jsonb } from "drizzle-orm/pg-core";
import { issues } from "./issues.js";
import { companies } from "./companies.js";
/** Company-private imported evidence, not upstream product-feedback export. */
export const mimouseFeedbackInbox = pgTable("mimouse_feedback_inbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  sourceKind: text("source_kind").notNull(), sourceInstance: text("source_instance").notNull(), externalId: text("external_id").notNull(),
  ingestionMode: text("ingestion_mode").notNull().default("manual_import"),
  sourceUrl: text("source_url"),
  contentDigest: text("content_digest").notNull(), candidateKey: text("candidate_key").notNull(),
  title: text("title").notNull(), body: text("body").notNull(), product: text("product").notNull(), softwareVersion: text("software_version").notNull(),
  commitSha: text("commit_sha"), traceId: text("trace_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  actorId: text("actor_id").notNull(), redacted: boolean("redacted").notNull(), redactionVersion: integer("redaction_version").notNull().default(1),
  status: text("status").notNull().default("candidate"),
}, t => ({
  companyIdentity: uniqueIndex("mimouse_feedback_company_identity").on(t.companyId, t.id),
  sourceEvent: uniqueIndex("mimouse_feedback_source_event").on(t.companyId, t.sourceKind, t.sourceInstance, t.externalId),
  page: index("mimouse_feedback_page").on(t.companyId, t.createdAt, t.id),
  candidates: index("mimouse_feedback_candidates").on(t.companyId, t.candidateKey, t.createdAt),
  shape: check("mimouse_feedback_shape", sql`${t.ingestionMode} IN ('manual_import','provider_fetch') AND ${t.status}='candidate' AND ${t.redactionVersion}=1 AND ${t.sourceKind} IN ('manual','application_log','langfuse','wecom_smart_bot') AND length(${t.title}) BETWEEN 1 AND 240 AND length(${t.body}) BETWEEN 1 AND 32000`),
}));

/** Immutable human confirmation and the task created in the same transaction. */
export const mimouseFeedbackPromotions = pgTable("mimouse_feedback_promotions", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id),
  feedbackId: uuid("feedback_id").notNull(), requestId: uuid("request_id").notNull(), requestDigest: text("request_digest").notNull(),
  issueId: uuid("issue_id").notNull(), actorUserId: text("actor_user_id").notNull(),
  review: jsonb("review").$type<{ title: string; reproduction: string; expectedBehavior: string; fixProposal: string; acceptanceCriteria: string[] }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  feedback: foreignKey({ columns: [t.companyId, t.feedbackId], foreignColumns: [mimouseFeedbackInbox.companyId, mimouseFeedbackInbox.id], name: "mimouse_feedback_promotion_source_fk" }),
  issue: foreignKey({ columns: [t.companyId, t.issueId], foreignColumns: [issues.companyId, issues.id], name: "mimouse_feedback_promotion_issue_fk" }),
  oneIssue: uniqueIndex("mimouse_feedback_promotion_once").on(t.companyId, t.feedbackId),
  request: uniqueIndex("mimouse_feedback_promotion_request").on(t.companyId, t.requestId),
}));
