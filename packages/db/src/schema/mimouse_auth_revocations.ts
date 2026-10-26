import { pgTable, uuid, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Instance-wide audit: no session tokens, key hashes, emails or provider secrets. */
export const mimouseAuthRevocations = pgTable("mimouse_auth_revocations", {
  requestId: uuid("request_id").primaryKey(),
  targetUserId: text("target_user_id").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  reason: text("reason").notNull(),
  cutoffAt: timestamp("cutoff_at", { withTimezone: true }).notNull(),
  sessionsRevoked: integer("sessions_revoked").notNull(),
  boardKeysRevoked: integer("board_keys_revoked").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  target: index("mimouse_auth_revocation_target").on(t.targetUserId, t.createdAt),
  shape: check("mimouse_auth_revocation_shape", sql`${t.reason} IN ('offboarding','compromised','administrative') AND ${t.sessionsRevoked} >= 0 AND ${t.boardKeysRevoked} >= 0`),
}));
