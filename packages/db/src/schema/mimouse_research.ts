import { sql } from "drizzle-orm";
import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index, check, foreignKey } from "drizzle-orm/pg-core";
import type { ResearchEvidence } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
export const mimouseResearchCandidates = pgTable("mimouse_research_candidates", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest").notNull(), actorId: text("actor_id").notNull(),
  evidence: jsonb("evidence").$type<ResearchEvidence>().notNull(), evidenceHash: text("evidence_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  identity: uniqueIndex("mimouse_research_company_identity").on(t.companyId, t.id),
  request: uniqueIndex("mimouse_research_request").on(t.companyId, t.requestId),
  page: index("mimouse_research_page").on(t.companyId, t.createdAt, t.id),
  shape: check("mimouse_research_shape", sql`length(${t.requestDigest})=64 AND length(${t.evidenceHash})=64`),
}));
export const mimouseResearchPromotions = pgTable("mimouse_research_promotions", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull().references(() => companies.id),
  candidateId: uuid("candidate_id").notNull(), requestId: uuid("request_id").notNull(), requestDigest: text("request_digest").notNull(),
  issueId: uuid("issue_id").notNull(), actorUserId: text("actor_user_id").notNull(), evidenceHash: text("evidence_hash").notNull(),
  review: jsonb("review").$type<{ title: string; scope: string; expectedBenefit: string; acceptanceCriteria: string[]; dependencyIssueIds: string[] }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  candidate: foreignKey({ columns: [t.companyId, t.candidateId], foreignColumns: [mimouseResearchCandidates.companyId, mimouseResearchCandidates.id], name: "mimouse_research_promotion_candidate_fk" }),
  issue: foreignKey({ columns: [t.companyId, t.issueId], foreignColumns: [issues.companyId, issues.id], name: "mimouse_research_promotion_issue_fk" }),
  once: uniqueIndex("mimouse_research_promotion_once").on(t.companyId, t.candidateId),
  request: uniqueIndex("mimouse_research_promotion_request").on(t.companyId, t.requestId),
}));
