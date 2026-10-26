import { pgTable, uuid, text, jsonb, integer, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
/** Fixed-window read jobs. Only references to pinned company secret versions. */
export const mimouseLangfusePulls = pgTable("mimouse_langfuse_pulls", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").notNull(), configDigest: text("config_digest").notNull(), actorId: text("actor_id").notNull(),
  config: jsonb("config").$type<{
    origin: string; projectId: string; product: string; from: string; to: string;
    publicKey: { secretId: string; version: number }; secretKey: { secretId: string; version: number };
    api: "observations_v2";
  }>().notNull(),
  cursor: text("cursor"), cursorDigests: jsonb("cursor_digests").$type<string[]>().notNull().default([]), completed: boolean("completed").notNull().default(false),
  pages: integer("pages").notNull().default(0), imported: integer("imported").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ request: uniqueIndex("mimouse_langfuse_pulls_request").on(t.companyId, t.requestId), company: index("mimouse_langfuse_pulls_company").on(t.companyId, t.createdAt) }));
