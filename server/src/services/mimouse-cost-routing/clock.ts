import { authSessions, authUsers } from "@paperclipai/db";
import { forbidden } from "../../errors.js";
import { and, eq, gt, sql } from "drizzle-orm";
import type { PrivatePromptIdentity, PrivatePromptTx } from "../mimouse-private-prompt-tests/service.js";
/** One authority clock for leases and durable chronology across app instances. */
export async function runtimeRoutingClock(tx: PrivatePromptTx) {
  const rows = await tx.execute(sql`select clock_timestamp() as routing_now`);
  const value = rows[0]?.routing_now;
  const now = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(now.getTime())) throw new Error("runtime_routing_clock_unavailable");
  return now;
}
/** Recheck time-varying session authority after slow evidence/file validation. */
export async function assertRuntimeRoutingSession(tx: PrivatePromptTx, actor: PrivatePromptIdentity) {
  const [session] = await tx.select({ id: authSessions.id }).from(authSessions).innerJoin(authUsers, eq(authUsers.id, authSessions.userId)).where(and(
    eq(authSessions.id, actor.sessionId), eq(authSessions.userId, actor.userId), gt(authSessions.expiresAt, sql`clock_timestamp()`))).for("share");
  if (!session) throw forbidden("runtime_routing_current_session_required");
}
