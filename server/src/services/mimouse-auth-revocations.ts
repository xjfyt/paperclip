import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { authSessions, authUsers, boardApiKeys, instanceUserRoles, mimouseAuthRevocations, type Db } from "@paperclipai/db";
import { revokeLocalAuthSchema, type AuthRevocationDto, type RevokeLocalAuthInput } from "@paperclipai/shared";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
function dto(row: typeof mimouseAuthRevocations.$inferSelect): AuthRevocationDto {
  return { ...row, reason: row.reason as AuthRevocationDto["reason"], cutoffAt: row.cutoffAt.toISOString(), createdAt: row.createdAt.toISOString() };
}
async function requireAdmin(db: Db | Tx, actorUserId: string) {
  const [role] = await db.select({ id: instanceUserRoles.id }).from(instanceUserRoles).where(and(eq(instanceUserRoles.userId, actorUserId), eq(instanceUserRoles.role, "instance_admin"))).limit(1);
  if (!role) throw forbidden("Instance admin required");
}
export function mimouseAuthRevocationService(db: Db) {
  return {
    async list(actorUserId: string, targetUserId: string) {
      await requireAdmin(db, actorUserId);
      return (await db.select().from(mimouseAuthRevocations).where(eq(mimouseAuthRevocations.targetUserId, targetUserId)).orderBy(desc(mimouseAuthRevocations.createdAt)).limit(50)).map(dto);
    },
    async revoke(actorUserId: string, targetUserId: string, raw: RevokeLocalAuthInput) {
      const input = revokeLocalAuthSchema.parse(raw);
      if (input.confirmUserId !== targetUserId) throw badRequest("Confirm the exact target user ID");
      return db.transaction(async tx => {
        await requireAdmin(tx, actorUserId);
        // A request retry returns the original receipt, never revokes a later session.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`mimouse-auth-revoke-request:${input.requestId}`}, 0))`);
        const [prior] = await tx.select().from(mimouseAuthRevocations).where(eq(mimouseAuthRevocations.requestId, input.requestId)).limit(1);
        if (prior) {
          if (prior.actorUserId !== actorUserId || prior.targetUserId !== targetUserId || prior.reason !== input.reason) throw conflict("Revocation request ID already used with different input");
          return dto(prior);
        }
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`mimouse-auth-revoke-user:${targetUserId}`}, 0))`);
        const [target] = await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.id, targetUserId)).limit(1);
        if (!target) throw notFound("User not found");
        // Database time, not a caller-supplied cutoff. This is a point-in-time
        // revocation, NOT a ban or a promise to cancel already-running work.
        const time = await tx.execute(sql`select clock_timestamp() as cutoff`);
        const cutoffAt = new Date(String(time[0].cutoff));
        const sessions = await tx.update(authSessions).set({ expiresAt: cutoffAt, updatedAt: cutoffAt }).where(and(eq(authSessions.userId, targetUserId), lte(authSessions.createdAt, cutoffAt), gt(authSessions.expiresAt, cutoffAt))).returning({ id: authSessions.id });
        const keys = await tx.update(boardApiKeys).set({ revokedAt: cutoffAt }).where(and(eq(boardApiKeys.userId, targetUserId), lte(boardApiKeys.createdAt, cutoffAt), isNull(boardApiKeys.revokedAt))).returning({ id: boardApiKeys.id });
        const [receipt] = await tx.insert(mimouseAuthRevocations).values({ requestId: input.requestId, actorUserId, targetUserId, reason: input.reason, cutoffAt, sessionsRevoked: sessions.length, boardKeysRevoked: keys.length }).returning();
        return dto(receipt);
      });
    },
  };
}
