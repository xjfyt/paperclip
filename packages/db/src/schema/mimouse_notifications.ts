import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, uniqueIndex, index, foreignKey, check } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { companySecrets } from "./company_secrets.js";

export const mimouseNotificationEndpoints = pgTable("mimouse_notification_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  secretRef: uuid("secret_ref").notNull().references(() => companySecrets.id),
  secretVersion: integer("secret_version").notNull(),
  targetKey: text("target_key").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  configVersion: integer("config_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ companyIdentity: uniqueIndex("mimouse_notification_endpoint_company_identity").on(t.companyId, t.id), versionCheck: check("mimouse_notification_secret_version_positive", sql`${t.secretVersion} > 0`) }));

export const mimouseNotificationSubscriptions = pgTable("mimouse_notification_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  endpointId: uuid("endpoint_id").notNull(),
  eventType: text("event_type").notNull(),
  locale: text("locale").notNull().default("en"),
  policy: jsonb("policy").$type<{ minimumSeverity: "info" | "warning" | "critical"; mergeWindowSeconds: number }>().notNull().default({ minimumSeverity: "info", mergeWindowSeconds: 0 }),
  enabled: boolean("enabled").notNull().default(true),
}, t => ({ endpoint: foreignKey({ columns: [t.companyId, t.endpointId], foreignColumns: [mimouseNotificationEndpoints.companyId, mimouseNotificationEndpoints.id] }).onDelete("cascade"), identity: uniqueIndex("mimouse_notification_subscription_company_identity").on(t.companyId, t.id), unique: uniqueIndex("mimouse_notification_subscription_unique").on(t.companyId, t.endpointId, t.eventType) }));

export const mimouseNotificationDeliveries = pgTable("mimouse_notification_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull(),
  subscriptionId: uuid("subscription_id").notNull(),
  endpointId: uuid("endpoint_id").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  state: text("state").notNull().default("pending"),
  mergeKey: text("merge_key"),
  mergeUntil: timestamp("merge_until", { withTimezone: true }),
  mergedInto: uuid("merged_into"),
  attempt: integer("attempt").notNull().default(0),
  lease: uuid("lease"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lastCode: text("last_code"),
  receipt: text("receipt"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  subscription: foreignKey({ columns: [t.companyId, t.subscriptionId], foreignColumns: [mimouseNotificationSubscriptions.companyId, mimouseNotificationSubscriptions.id] }),
  endpoint: foreignKey({ columns: [t.companyId, t.endpointId], foreignColumns: [mimouseNotificationEndpoints.companyId, mimouseNotificationEndpoints.id] }),
  unique: uniqueIndex("mimouse_notification_delivery_unique").on(t.companyId, t.eventId, t.subscriptionId),
  companyIdentity: uniqueIndex("mimouse_notification_delivery_company_identity").on(t.companyId, t.id),
  mergedLeader: foreignKey({ columns: [t.companyId, t.mergedInto], foreignColumns: [t.companyId, t.id] }),
  mergeWindow: index("mimouse_notification_delivery_merge_window").on(t.companyId, t.mergeKey, t.mergeUntil),
  mergeShape: check("mimouse_notification_delivery_merge_shape", sql`(${t.mergedInto} IS NULL OR (${t.state}='merged' AND ${t.mergedInto}<>${t.id})) AND (${t.state}<>'merged' OR ${t.mergedInto} IS NOT NULL)`),
  pending: index("mimouse_notification_delivery_pending").on(t.state, t.nextAttemptAt),
  stateCheck: check("mimouse_notification_delivery_state", sql`${t.state} IN ('pending','claimed','sending','accepted','rejected','retryable','indeterminate','paused','filtered','merged')`),
}));

export const mimouseNotificationRateLimits = pgTable("mimouse_notification_rate_limits", {
  targetKey: text("target_key").primaryKey(),
  nextAllowedAt: timestamp("next_allowed_at", { withTimezone: true }).notNull().defaultNow(),
});


// Private cache only: never exposed through generic secret bindings or settings responses.
export const mimouseNotificationTokens = pgTable("mimouse_notification_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  secretRef: uuid("secret_ref").notNull().references(() => companySecrets.id, { onDelete: "cascade" }),
  secretVersion: integer("secret_version").notNull(), kind: text("kind").notNull(), identity: text("identity").notNull(),
  tokenMaterial: jsonb("token_material").$type<Record<string, unknown>>(), expiresAt: timestamp("expires_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(0), lease: uuid("lease"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  nextRefreshAt: timestamp("next_refresh_at", { withTimezone: true }).notNull().defaultNow(), lastCode: text("last_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  scope: uniqueIndex("mimouse_notification_token_scope").on(t.companyId, t.secretRef, t.secretVersion, t.kind),
  shape: check("mimouse_notification_token_shape", sql`${t.secretVersion}>0 AND ${t.revision}>=0 AND ${t.kind} IN ('dingtalk_app','wechat_official_account') AND ((${t.tokenMaterial} IS NULL AND ${t.expiresAt} IS NULL) OR (${t.tokenMaterial} IS NOT NULL AND ${t.expiresAt} IS NOT NULL))`),
}));

// Configuration history contains immutable references, never secret values.
export const mimouseNotificationRevisions = pgTable("mimouse_notification_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  endpointId: uuid("endpoint_id").notNull(),
  configVersion: integer("config_version").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  actorId: text("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  endpoint: foreignKey({ columns: [t.companyId, t.endpointId], foreignColumns: [mimouseNotificationEndpoints.companyId, mimouseNotificationEndpoints.id] }).onDelete("cascade"),
  version: uniqueIndex("mimouse_notification_revision_version").on(t.companyId, t.endpointId, t.configVersion),
  positive: check("mimouse_notification_revision_positive", sql`${t.configVersion}>0`),
}));

/** Operator observations never overwrite the transport result or replay a message. */
export const mimouseNotificationReviews = pgTable("mimouse_notification_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  deliveryId: uuid("delivery_id").notNull(),
  requestId: uuid("request_id").notNull(),
  outcome: text("outcome").notNull(),
  evidence: text("evidence").notNull(),
  actorId: text("actor_id").notNull(),
  observedState: text("observed_state").notNull(),
  observedAttempt: integer("observed_attempt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  delivery: foreignKey({ columns: [t.companyId, t.deliveryId], foreignColumns: [mimouseNotificationDeliveries.companyId, mimouseNotificationDeliveries.id] }).onDelete("cascade"),
  request: uniqueIndex("mimouse_notification_review_request").on(t.companyId, t.deliveryId, t.requestId),
  shape: check("mimouse_notification_review_shape", sql`${t.outcome} IN ('accepted','not_accepted','unknown') AND ${t.observedAttempt}>=0 AND ${t.observedState} IN ('accepted','rejected','indeterminate')`),
}));
