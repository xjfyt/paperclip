import { afterEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { companySecrets, type Db } from "@paperclipai/db";
import { appCredential } from "../services/mimouse-notifications/app-credentials.js";
import { notificationTokenCache, type sealNotificationToken } from "../services/mimouse-notifications/token-cache.js";

const credentials = { appId: "fixture-app", appSecret: "fixture-secret" };
const scope = { companyId: "company", secretRef: "secret", secretVersion: 1, kind: "wechat_official_account" as const };
const now = Date.parse("2026-10-27T00:00:00.123Z");
const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY;
type TokenRow = Parameters<typeof sealNotificationToken>[0];

afterEach(() => {
  vi.useRealTimers();
  if (oldKey === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY;
  else process.env.PAPERCLIP_SECRETS_MASTER_KEY = oldKey;
});

// Model the relevant PostgreSQL boundary: storage retains microseconds while
// timestamp decoding into Date truncates them. This is not a database fixture.
function fixture(existingRefreshAt?: Date) {
  let stored: TokenRow | undefined;
  let refreshMicros = BigInt(now) * 1000n + 999n;
  const initialRow = (nextRefreshAt: Date): TokenRow => ({
    id: "cache", ...scope, identity: appCredential(scope.kind, credentials)!.identity,
    tokenMaterial: null, expiresAt: null, revision: 0, lease: null,
    leaseExpiresAt: null, nextRefreshAt, lastCode: null,
    createdAt: new Date(now), updatedAt: new Date(now),
  });
  if (existingRefreshAt) stored = initialRow(existingRefreshAt);
  const insert = vi.fn((values: Partial<TokenRow>) => ({
    onConflictDoNothing: async () => {
      if (stored) return;
      if (values.nextRefreshAt) refreshMicros = BigInt(values.nextRefreshAt.getTime()) * 1000n;
      stored = initialRow(new Date(Number(refreshMicros / 1000n)));
    },
  }));
  const update = vi.fn((values: Partial<TokenRow>) => ({
    where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => ({
      returning: async () => {
        if (!stored) throw Error("Missing cache row");
        if (values.lease) {
          const query = new PgDialect().sqlToQuery(condition);
          const cutoff = query.sql.match(/"next_refresh_at" <= \$(\d+)/);
          expect(cutoff).not.toBeNull();
          const cutoffMicros = BigInt(new Date(query.params[Number(cutoff![1]) - 1] as string).getTime()) * 1000n;
          if (refreshMicros > cutoffMicros) return [];
          stored = { ...stored, lease: values.lease, leaseExpiresAt: values.leaseExpiresAt!, revision: stored.revision + 1 };
        } else {
          stored = { ...stored, ...values };
        }
        return [stored];
      },
    }),
  }));
  const db = {
    select: () => ({ from: (table: unknown) => ({ where: async () => table === companySecrets ? [{ id: scope.secretRef }] : [stored] }) }),
    insert: () => ({ values: insert }),
    update: () => ({ set: update }),
  } as unknown as Db;
  return { db, insert, update, stored: () => stored };
}

it("claims a new cache row within the same millisecond despite a microsecond database default", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  process.env.PAPERCLIP_SECRETS_MASTER_KEY = "ab".repeat(32);
  const f = fixture();
  const exchange = vi.fn(async () => ({ token: "issued-token", expiresAt: new Date(now + 3600000) }));
  expect(await notificationTokenCache(f.db, { exchange }).resolve(scope, credentials)).toEqual({ accessToken: "issued-token" });
  expect(exchange).toHaveBeenCalledTimes(1);
  expect(f.stored()).toMatchObject({ revision: 1, lease: null });
  expect(f.insert.mock.calls[0][0].nextRefreshAt!.getTime()).toBeLessThanOrEqual(now);
});

it("does not reset an existing cooldown on an insert conflict or exchange early", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  const nextRefreshAt = new Date(now + 60000);
  const f = fixture(nextRefreshAt); const exchange = vi.fn();
  await expect(notificationTokenCache(f.db, { exchange }).resolve(scope, credentials)).rejects.toMatchObject({
    code: "token_refresh_cooldown", retryable: true, busy: true, retryAfterMs: 60000,
  });
  expect(f.stored()!.nextRefreshAt).toEqual(nextRefreshAt);
  expect(f.update).not.toHaveBeenCalled(); expect(exchange).not.toHaveBeenCalled();
});
