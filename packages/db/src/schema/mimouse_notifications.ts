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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ companyIdentity: uniqueIndex("mimouse_notification_endpoint_company_identity").on(t.companyId, t.id), versionCheck: check("mimouse_notification_secret_version_positive", sql`${t.secretVersion} > 0`) }));

export const mimouseNotificationSubscriptions = pgTable("mimouse_notification_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  endpointId: uuid("endpoint_id").notNull(),
  eventType: text("event_type").notNull(),
  locale: text("locale").notNull().default("en"),
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
  pending: index("mimouse_notification_delivery_pending").on(t.state, t.nextAttemptAt),
  stateCheck: check("mimouse_notification_delivery_state", sql`${t.state} IN ('pending','claimed','sending','accepted','rejected','retryable','indeterminate','paused')`),
}));

export const mimouseNotificationRateLimits = pgTable("mimouse_notification_rate_limits", {
  targetKey: text("target_key").primaryKey(),
  nextAllowedAt: timestamp("next_allowed_at", { withTimezone: true }).notNull().defaultNow(),
});
