import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, foreignKey, index } from "drizzle-orm/pg-core";
import { mimouseFeedbackPromotions } from "./mimouse_feedback.js";
import { mimouseCodingDeliveries } from "./mimouse_coding.js";
/** Immutable human attestations; never machine execution or current release authority. */
export const mimouseFeedbackVerifications = pgTable("mimouse_feedback_verifications", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(),
  feedbackId: uuid("feedback_id").notNull(), issueId: uuid("issue_id").notNull(),
  reproductionDeliveryId: uuid("reproduction_delivery_id").notNull(), regressionDeliveryId: uuid("regression_delivery_id").notNull(),
  requestId: uuid("request_id").notNull(), requestDigest: text("request_digest").notNull(),
  previewDigest: text("preview_digest").notNull(), actorUserId: text("actor_user_id").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  promotion: foreignKey({ columns: [t.companyId, t.feedbackId, t.issueId], foreignColumns: [mimouseFeedbackPromotions.companyId, mimouseFeedbackPromotions.feedbackId, mimouseFeedbackPromotions.issueId], name: "mimouse_feedback_verification_promotion_fk" }),
  reproduction: foreignKey({ columns: [t.companyId, t.reproductionDeliveryId, t.issueId], foreignColumns: [mimouseCodingDeliveries.companyId, mimouseCodingDeliveries.id, mimouseCodingDeliveries.issueId], name: "mimouse_feedback_verification_reproduction_fk" }),
  regression: foreignKey({ columns: [t.companyId, t.regressionDeliveryId, t.issueId], foreignColumns: [mimouseCodingDeliveries.companyId, mimouseCodingDeliveries.id, mimouseCodingDeliveries.issueId], name: "mimouse_feedback_verification_regression_fk" }),
  request: uniqueIndex("mimouse_feedback_verification_request").on(t.companyId, t.requestId),
  history: index("mimouse_feedback_verification_history").on(t.companyId, t.feedbackId, t.createdAt, t.id),
}));
