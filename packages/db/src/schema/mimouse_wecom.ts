import { pgTable, uuid, text, jsonb, boolean, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
/** Global bot reservation prevents cross-company ownership and concurrent workers. */
export const mimouseWecomConnections = pgTable("mimouse_wecom_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  botHash: text("bot_hash").notNull(),
  config: jsonb("config").$type<{
    botId: string; product: string; transport: "long_connection";
    allowedGroupIds: string[]; allowedDirectSenderIds: string[];
    secret: { secretId: string; version: number };
  }>().notNull(),
  enabled: boolean("enabled").notNull().default(false),
  state: text("state").notNull().default("disabled"),
  leaseToken: uuid("lease_token"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  gapDetected: boolean("gap_detected").notNull().default(false),
  imported: integer("imported").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ bot: uniqueIndex("mimouse_wecom_global_bot").on(t.botHash), company: index("mimouse_wecom_company").on(t.companyId, t.createdAt) }));
