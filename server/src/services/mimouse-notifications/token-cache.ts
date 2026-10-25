import { randomUUID } from "node:crypto";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { companySecrets, mimouseNotificationTokens as tokens, type Db } from "@paperclipai/db";
import { localEncryptedProvider } from "../../secrets/local-encrypted-provider.js";
import { appCredential, exchangeAppToken, NotificationTokenError } from "./app-credentials.js";
import type { ChannelKind, ChannelSecret } from "./drivers.js";

type Scope = { companyId: string; secretRef: string; secretVersion: number; kind: ChannelKind };
type TokenRow = typeof tokens.$inferSelect;
const binding = (row: TokenRow) => ({ schema: "mimouse-notification-token-v1", id: row.id, companyId: row.companyId, secretRef: row.secretRef, secretVersion: row.secretVersion, kind: row.kind, identity: row.identity, revision: row.revision });
export async function sealNotificationToken(row: TokenRow, token: string, expiresAt: Date) {
  return (await localEncryptedProvider.createVersion({ value: JSON.stringify({ ...binding(row), token, expiresAt: expiresAt.toISOString() }) })).material;
}
export async function openNotificationToken(row: TokenRow): Promise<string> {
  try {
    if (!row.tokenMaterial || !row.expiresAt) throw Error();
    const value = JSON.parse(await localEncryptedProvider.resolveVersion({ material: row.tokenMaterial, externalRef: null }));
    if (Object.entries(binding(row)).some(([key, expected]) => value?.[key] !== expected) || value.expiresAt !== row.expiresAt.toISOString() || typeof value.token !== "string" || !value.token.trim() || value.token.length > 16384) throw Error();
    return value.token;
  } catch { throw new NotificationTokenError("token_cache_binding_or_key_invalid"); }
}

/** Shared by all outbox workers; cache misses are leased, never process-local promises only. */
export function notificationTokenCache(db: Db, deps: { exchange?: typeof exchangeAppToken; transport?: typeof fetch } = {}) {
  const exchange = deps.exchange ?? exchangeAppToken;
  async function secretActive(scope: Scope) {
    const [secret] = await db.select({ id: companySecrets.id }).from(companySecrets).where(and(eq(companySecrets.id, scope.secretRef), eq(companySecrets.companyId, scope.companyId), eq(companySecrets.scope, "company"), eq(companySecrets.status, "active"), isNull(companySecrets.deletedAt)));
    if (!secret) throw new NotificationTokenError("token_secret_inactive_or_wrong_company");
  }
  return {
    resolve: async (scope: Scope, secret: ChannelSecret): Promise<ChannelSecret> => {
      const credential = appCredential(scope.kind, secret); if (!credential) return secret;
      if (!Number.isSafeInteger(scope.secretVersion) || scope.secretVersion < 1) throw new NotificationTokenError("token_secret_version_invalid");
      await secretActive(scope);
      const where = and(eq(tokens.companyId, scope.companyId), eq(tokens.secretRef, scope.secretRef), eq(tokens.secretVersion, scope.secretVersion), eq(tokens.kind, scope.kind));
      await db.insert(tokens).values({ ...scope, identity: credential.identity }).onConflictDoNothing();
      const [cached] = await db.select().from(tokens).where(where);
      if (!cached || cached.identity !== credential.identity) throw new NotificationTokenError("token_immutable_credential_changed");
      const now = Date.now();
      if (cached.expiresAt && cached.expiresAt.getTime() > now + 30000 && cached.tokenMaterial) return { accessToken: await openNotificationToken(cached) };
      if (cached.nextRefreshAt.getTime() > now) throw new NotificationTokenError("token_refresh_cooldown", true, cached.nextRefreshAt.getTime() - now, true);
      const lease = randomUUID();
      const [claimed] = await db.update(tokens).set({ lease, leaseExpiresAt: new Date(now + 30000), revision: sql`${tokens.revision}+1`, tokenMaterial: null, expiresAt: null, updatedAt: new Date() })
        .where(and(where, eq(tokens.identity, credential.identity), lte(tokens.nextRefreshAt, new Date()), or(isNull(tokens.lease), lte(tokens.leaseExpiresAt, new Date())), or(isNull(tokens.expiresAt), lte(tokens.expiresAt, new Date(now + 30000))))).returning();
      if (!claimed) throw new NotificationTokenError("token_refresh_busy", true, 2000, true);
      const currentLease = and(eq(tokens.id, claimed.id), eq(tokens.lease, lease), eq(tokens.revision, claimed.revision), sql`${tokens.leaseExpiresAt}>now()`);
      try {
        const result = await exchange(credential, deps.transport);
        await secretActive(scope);
        if (result.expiresAt.getTime() <= Date.now() + 30000) throw new NotificationTokenError("token_near_expiry", true, 31000);
        const material = await sealNotificationToken(claimed, result.token, result.expiresAt);
        const changed = await db.update(tokens).set({ tokenMaterial: material, expiresAt: result.expiresAt, lease: null, leaseExpiresAt: null, nextRefreshAt: new Date(), lastCode: null, updatedAt: new Date() }).where(currentLease).returning({ id: tokens.id });
        if (!changed.length) throw new NotificationTokenError("token_refresh_lease_lost", true, 2000, true);
        return { accessToken: result.token };
      } catch (error) {
        const failure = error instanceof NotificationTokenError ? error : new NotificationTokenError("token_refresh_failed", true);
        await db.update(tokens).set({ lease: null, leaseExpiresAt: null, nextRefreshAt: new Date(Date.now() + Math.max(1000, Math.min(failure.retryAfterMs, 1800000))), lastCode: failure.code, updatedAt: new Date() }).where(currentLease);
        throw failure;
      }
    },
  };
}
