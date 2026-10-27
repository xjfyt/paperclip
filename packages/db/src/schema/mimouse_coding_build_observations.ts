import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { MimouseBuildObservationSummary } from "@paperclipai/shared/mimouse-build-observations";
import { companies } from "./companies.js";
import { mimouseCodingDeliveries } from "./mimouse_coding.js";

/** Mutable lease bookkeeping; no remote evidence is stored before final CAS. */
export const mimouseCodingBuildObservationRequests = pgTable("mimouse_coding_build_observation_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  deliveryId: uuid("delivery_id").notNull(), requestId: uuid("request_id").notNull(),
  actorUserId: text("actor_user_id").notNull(), actorSessionId: text("actor_session_id").notNull(),
  requestDigest: text("request_digest").notNull(), snapshotDigest: text("snapshot_digest").notNull(),
  profileId: text("profile_id").notNull(), jobId: bigint("job_id", { mode: "number" }).notNull(),
  state: text("state").$type<"running" | "terminal">().notNull().default("running"),
  attemptCount: integer("attempt_count").notNull().default(1), leaseToken: uuid("lease_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  retryUntil: timestamp("retry_until", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  request: uniqueIndex("mimouse_build_observation_request_unique").on(t.companyId, t.requestId),
  receiptScope: uniqueIndex("mimouse_build_observation_request_scope").on(t.companyId, t.deliveryId, t.requestId),
  quota: index("mimouse_build_observation_request_quota").on(t.companyId, t.createdAt),
  delivery: foreignKey({ name: "mimouse_build_observation_request_delivery_fk", columns: [t.companyId, t.deliveryId],
    foreignColumns: [mimouseCodingDeliveries.companyId, mimouseCodingDeliveries.id] }).onDelete("cascade"),
  hashes: check("mimouse_build_observation_request_hashes", sql`${t.requestDigest} ~ '^[a-f0-9]{64}$' AND ${t.snapshotDigest} ~ '^[a-f0-9]{64}$'`),
  identity: check("mimouse_build_observation_request_identity", sql`${t.jobId} BETWEEN 1 AND 9007199254740991 AND ${t.profileId} ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$'`),
  state: check("mimouse_build_observation_request_state", sql`(${t.state} = 'running' AND ${t.leaseToken} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL) OR (${t.state} = 'terminal' AND ${t.leaseToken} IS NULL AND ${t.leaseExpiresAt} IS NULL)`),
  bounds: check("mimouse_build_observation_request_bounds", sql`${t.attemptCount} BETWEEN 1 AND 2 AND ${t.retryUntil} > ${t.createdAt} AND (${t.leaseExpiresAt} IS NULL OR ${t.leaseExpiresAt} <= ${t.retryUntil})`),
}));

/** Immutable historical observations, not admission receipts. UPDATE is guarded in migration 0360. */
export const mimouseCodingBuildObservationReceipts = pgTable("mimouse_coding_build_observation_receipts", {
  id: uuid("id").primaryKey().defaultRandom(), companyId: uuid("company_id").notNull(),
  deliveryId: uuid("delivery_id").notNull(), requestId: uuid("request_id").notNull(),
  status: text("status").$type<"observed" | "blocked">().notNull(), diagnostic: text("diagnostic").notNull(),
  admission: text("admission").$type<"blocked">().notNull().default("blocked"),
  result: jsonb("result").$type<MimouseBuildObservationSummary>().notNull(),
  snapshotDigest: text("snapshot_digest").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  request: uniqueIndex("mimouse_build_observation_receipt_unique").on(t.companyId, t.requestId),
  history: index("mimouse_build_observation_receipt_history").on(t.companyId, t.deliveryId, t.createdAt, t.id),
  scope: foreignKey({ name: "mimouse_build_observation_receipt_request_fk", columns: [t.companyId, t.deliveryId, t.requestId],
    foreignColumns: [mimouseCodingBuildObservationRequests.companyId, mimouseCodingBuildObservationRequests.deliveryId,
      mimouseCodingBuildObservationRequests.requestId] }).onDelete("cascade"),
  state: check("mimouse_build_observation_receipt_state", sql`${t.status} IN ('observed','blocked') AND ${t.admission} = 'blocked'`),
  hashes: check("mimouse_build_observation_receipt_hashes", sql`${t.snapshotDigest} ~ '^[a-f0-9]{64}$'`),
  projection: check("mimouse_build_observation_receipt_projection", sql`jsonb_typeof(${t.result}) = 'object' AND (${t.result}->>'admission') IS NOT DISTINCT FROM 'blocked' AND octet_length(${t.result}::text) <= 16384 AND ${t.diagnostic} ~ '^[a-z][a-z0-9_]{0,99}$'`),
}));
