import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mock } from "node:test";
import { companySecrets, mimouseNotificationTokens as tokens, mimouseNotificationEndpoints as endpoints, mimouseNotificationSubscriptions as subscriptions, mimouseNotificationDeliveries as deliveries } from "../../packages/db/src/index.js";
import { createFixtureDb } from "./fixture-db.js";
import { secretService } from "../../server/src/services/secrets.js";
import { notificationTokenCache } from "../../server/src/services/mimouse-notifications/token-cache.js";
import { enqueueNotification, notificationOutbox } from "../../server/src/services/mimouse-notifications/outbox.js";
import { buildNotificationRequest, type ChannelSecret } from "../../server/src/services/mimouse-notifications/drivers.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq } = await import(require.resolve("drizzle-orm"));
const future = () => new Date(Date.now() + 3600000);
test.beforeEach(async () => { const db = await createFixtureDb(); try { await db.update(endpoints).set({ enabled: false }); } finally { await db.$client.end({ timeout: 1 }); } });
async function fixture(request: APIRequestContext, credentials: ChannelSecret = { appId: "fixture-app", appSecret: "fixture-private-app-secret" }, kind: "wechat_official_account" | "dingtalk_app" = "wechat_official_account") {
  const company = await (await request.post("/api/companies", { data: { name: `token fixture ${randomUUID()}` } })).json(); const db = await createFixtureDb();
  try {
    const service = secretService(db); const secret = await service.create(company.id, { name: "app-credential-fixture", provider: "local_encrypted", value: JSON.stringify(credentials) });
    const scope = { companyId: company.id, secretRef: secret.id, secretVersion: 1, kind };
    const result = await request.post(`/api/companies/${company.id}/notifications/endpoints`, { data: { name: "fixture-app-channel", kind: scope.kind, config: kind === "dingtalk_app" ? { target: `fixture-group-${company.id}`, robotCode: "fixture-robot" } : { target: `fixture-openid-${company.id}`, templateId: "fixture-template", templateData: { first: { value: "{{text}}" } } }, secretRef: secret.id, secretVersion: 1 } });
    expect(result.ok(), await result.text()).toBe(true); const endpoint = await result.json(); expect(endpoint).toMatchObject({ enabled: false, liveVerified: false, configurationValid: true });
    const [subscription] = await db.insert(subscriptions).values({ companyId: company.id, endpointId: endpoint.id, eventType: "approval.requested" }).returning();
    await db.update(endpoints).set({ enabled: true }).where(eq(endpoints.id, endpoint.id));
    const enqueue = async () => { const eventId = randomUUID(); await db.transaction(tx => enqueueNotification(tx, { companyId: company.id, eventId, type: "approval.requested", resourceId: randomUUID() })); return (await db.select().from(deliveries).where(eq(deliveries.eventId, eventId)))[0]; };
    return { db, service, secret, scope, company, credentials, endpoint, subscription, enqueue, cleanup: async () => { await db.update(endpoints).set({ enabled: false }).where(eq(endpoints.id, endpoint.id)); await db.$client.end({ timeout: 1 }); } };
  } catch (error) { await db.$client.end({ timeout: 1 }); throw error; }
}

test("application configuration is local-only; concurrent refresh is single-flight and survives a new connection", async ({ request }) => {
  const f = await fixture(request);
  try {
    expect(await f.db.select().from(tokens).where(eq(tokens.companyId, f.company.id))).toHaveLength(0);
    let entered!: () => void, release!: () => void; const started = new Promise<void>(r => { entered = r; }); const blocked = new Promise<void>(r => { release = r; }); let calls = 0;
    const exchange = async () => { calls++; entered(); await blocked; return { token: "private-issued-fixture", expiresAt: future() }; };
    const first = notificationTokenCache(f.db, { exchange }).resolve(f.scope, f.credentials); await started;
    await expect(notificationTokenCache(f.db, { exchange }).resolve(f.scope, f.credentials)).rejects.toMatchObject({ code: "token_refresh_busy", busy: true });
    release(); expect(await first).toEqual({ accessToken: "private-issued-fixture" }); expect(calls).toBe(1);
    const another = await createFixtureDb(); try { expect(await notificationTokenCache(another, { exchange: async () => { throw Error("must reuse encrypted cache"); } }).resolve(f.scope, f.credentials)).toEqual({ accessToken: "private-issued-fixture" }); } finally { await another.$client.end({ timeout: 1 }); }
    const saved = await f.db.select().from(tokens).where(eq(tokens.companyId, f.company.id)); expect(saved).toHaveLength(1); expect(JSON.stringify(saved)).not.toContain("private-issued-fixture"); expect(JSON.stringify(saved)).not.toContain(f.credentials.appSecret);
    const view = await (await request.get(`/api/companies/${f.company.id}/notifications`)).json(); expect(JSON.stringify(view)).not.toContain("tokenMaterial"); expect(JSON.stringify(view)).not.toContain("private-issued-fixture");
  } finally { await f.cleanup(); }
});

test("an expired refresh lease is recoverable and its late token cannot overwrite the new owner", async ({ request }) => {
  const f = await fixture(request);
  try {
    let entered!: () => void, release!: () => void; const started = new Promise<void>(r => { entered = r; }); const blocked = new Promise<void>(r => { release = r; });
    const old = notificationTokenCache(f.db, { exchange: async () => { entered(); await blocked; return { token: "late-token", expiresAt: future() }; } }).resolve(f.scope, f.credentials); await started;
    await f.db.update(tokens).set({ leaseExpiresAt: new Date(0) }).where(eq(tokens.companyId, f.company.id));
    const fresh = notificationTokenCache(f.db, { exchange: async () => ({ token: "new-owner-token", expiresAt: future() }) }); expect(await fresh.resolve(f.scope, f.credentials)).toEqual({ accessToken: "new-owner-token" });
    const rejected = expect(old).rejects.toMatchObject({ code: "token_refresh_lease_lost" }); release(); await rejected;
    expect(await fresh.resolve(f.scope, f.credentials)).toEqual({ accessToken: "new-owner-token" }); expect((await f.db.select().from(tokens).where(eq(tokens.companyId, f.company.id)))[0].revision).toBe(2);
  } finally { await f.cleanup(); }
});

test("cache scope enforces company and immutable secret version, while rotation gets a separate entry", async ({ request }) => {
  const f = await fixture(request);
  try {
    let calls = 0; const cache = notificationTokenCache(f.db, { exchange: async () => ({ token: `token-${++calls}`, expiresAt: future() }) });
    expect(await cache.resolve(f.scope, f.credentials)).toEqual({ accessToken: "token-1" });
    await expect(cache.resolve({ ...f.scope, companyId: randomUUID() }, f.credentials)).rejects.toMatchObject({ code: "token_secret_inactive_or_wrong_company" });
    const changed = { ...f.credentials, appSecret: "rotated-fixture" };
    await expect(cache.resolve(f.scope, changed)).rejects.toMatchObject({ code: "token_immutable_credential_changed" }); expect(calls).toBe(1);
    await f.service.rotate(f.secret.id, { value: JSON.stringify(changed), expectedLatestVersion: 1 });
    expect(await cache.resolve({ ...f.scope, secretVersion: 2 }, changed)).toEqual({ accessToken: "token-2" });
    const original = JSON.parse(await f.service.resolveSecretValue(f.company.id, f.secret.id, 1)); expect(await cache.resolve(f.scope, original)).toEqual({ accessToken: "token-1" });
    await f.db.update(companySecrets).set({ status: "deleted", deletedAt: new Date() }).where(eq(companySecrets.id, f.secret.id));
    await expect(cache.resolve(f.scope, f.credentials)).rejects.toMatchObject({ code: "token_secret_inactive_or_wrong_company" }); expect(calls).toBe(2);
  } finally { await f.cleanup(); }
});

test("fresh and rotated cache entries are immediately eligible without resetting an existing cooldown", async ({ request }) => {
  const f = await fixture(request);
  try {
    // Keep the application clock behind the real database default, without
    // sleeping, altering the table default, or weakening the refresh lease.
    const now = Date.now() - 5000;
    mock.timers.enable({ apis: ["Date"], now });
    let calls = 0;
    const cache = notificationTokenCache(f.db, { exchange: async () => ({ token: `clock-token-${++calls}`, expiresAt: future() }) });
    expect(await cache.resolve(f.scope, f.credentials)).toEqual({ accessToken: "clock-token-1" });
    const changed = { ...f.credentials, appSecret: "clock-rotated-fixture" };
    await f.service.rotate(f.secret.id, { value: JSON.stringify(changed), expectedLatestVersion: 1 });
    expect(await cache.resolve({ ...f.scope, secretVersion: 2 }, changed)).toEqual({ accessToken: "clock-token-2" });

    const nextRefreshAt = new Date(now + 60000);
    await f.db.update(tokens).set({ tokenMaterial: null, expiresAt: null, nextRefreshAt }).where(eq(tokens.companyId, f.company.id));
    await expect(cache.resolve(f.scope, f.credentials)).rejects.toMatchObject({ code: "token_refresh_cooldown", busy: true, retryAfterMs: 60000 });
    const saved = await f.db.select().from(tokens).where(eq(tokens.companyId, f.company.id));
    expect(saved).toHaveLength(2);
    expect(saved.every(row => row.nextRefreshAt.getTime() === nextRefreshAt.getTime())).toBe(true);
    expect(calls).toBe(2);
  } finally { mock.timers.reset(); await f.cleanup(); }
});

test("a secret revoked during refresh never yields a sendable token", async ({ request }) => {
  const f = await fixture(request);
  try {
    const cache = notificationTokenCache(f.db, { exchange: async () => { await f.db.update(companySecrets).set({ status: "deleted", deletedAt: new Date() }).where(eq(companySecrets.id, f.secret.id)); return { token: "discard-me", expiresAt: future() }; } });
    await expect(cache.resolve(f.scope, f.credentials)).rejects.toMatchObject({ code: "token_secret_inactive_or_wrong_company" });
    const [saved] = await f.db.select().from(tokens).where(eq(tokens.companyId, f.company.id)); expect(saved.tokenMaterial).toBeNull(); expect(saved.lease).toBeNull();
  } finally { await f.cleanup(); }
});

test("token throttling remains before sending; a later successful exchange delivers once", async ({ request }) => {
  const f = await fixture(request);
  try {
    const delivery = await f.enqueue(); let exchanges = 0, sends = 0;
    const worker = notificationOutbox(f.db, { tokenTransport: (async () => ++exchanges === 1 ? new Response("{}", { status: 429, headers: { "retry-after": "60" } }) : Response.json({ access_token: "fresh-app-token", expires_in: 3600 })) as typeof fetch, send: async (_snapshot, secret) => { expect(secret).toEqual({ accessToken: "fresh-app-token" }); sends++; return { state: "accepted", code: "accepted" }; } });
    expect(await worker.tick()).toBe(true); let saved = (await f.db.select().from(deliveries).where(eq(deliveries.id, delivery.id)))[0]; expect(saved.state).toBe("retryable"); expect(saved.lastCode).toBe("token_http_429"); expect(saved.attempt).toBe(1); expect(sends).toBe(0);
    await f.db.update(tokens).set({ nextRefreshAt: new Date(0) }).where(eq(tokens.companyId, f.company.id)); await f.db.update(deliveries).set({ nextAttemptAt: new Date(0) }).where(eq(deliveries.id, delivery.id));
    expect(await worker.tick()).toBe(true); saved = (await f.db.select().from(deliveries).where(eq(deliveries.id, delivery.id)))[0]; expect(saved.state).toBe("accepted"); expect(sends).toBe(1); expect(exchanges).toBe(2); expect(saved.attempt).toBe(2); expect(await worker.tick()).toBe(false);
  } finally { await f.cleanup(); }
});

test("an unknown notification send is not replayed or refreshed again", async ({ request }) => {
  const f = await fixture(request);
  try {
    const delivery = await f.enqueue(); let exchanges = 0, sends = 0;
    const worker = notificationOutbox(f.db, { tokenTransport: (async () => { exchanges++; return Response.json({ access_token: "app-token", expires_in: 3600 }); }) as typeof fetch, send: async () => { sends++; return { state: "indeterminate", code: "transport_unconfirmed" }; } });
    await worker.tick(); expect((await f.db.select().from(deliveries).where(eq(deliveries.id, delivery.id)))[0].state).toBe("indeterminate"); expect(await worker.tick()).toBe(false); expect(exchanges).toBe(1); expect(sends).toBe(1);
  } finally { await f.cleanup(); }
});

test("the legacy explicit access token bypasses application refresh without changing the delivery contract", async ({ request }) => {
  const f = await fixture(request, { accessToken: "legacy-static-fixture" });
  try {
    const delivery = await f.enqueue(); let sends = 0;
    await notificationOutbox(f.db, { tokenTransport: (async () => { throw Error("must not exchange static token"); }) as typeof fetch, send: async (_snapshot, secret) => { expect(secret.accessToken).toBe("legacy-static-fixture"); sends++; return { state: "accepted", code: "accepted" }; } }).tick();
    expect(sends).toBe(1); expect((await f.db.select().from(deliveries).where(eq(deliveries.id, delivery.id)))[0].state).toBe("accepted"); expect(await f.db.select().from(tokens).where(eq(tokens.companyId, f.company.id))).toHaveLength(0);
  } finally { await f.cleanup(); }
});


test("DingTalk application credentials reach the existing sender only as a token", async ({ request }) => {
  const f = await fixture(request, { appKey: "fixture-ding-app", appSecret: "fixture-ding-secret" }, "dingtalk_app");
  try {
    const delivery = await f.enqueue(); let sends = 0;
    await notificationOutbox(f.db, { tokenTransport: (async (url, options) => {
      expect(String(url)).toBe("https://api.dingtalk.com/v1.0/oauth2/accessToken"); expect(JSON.parse(String(options?.body))).toEqual({ appKey: "fixture-ding-app", appSecret: "fixture-ding-secret" });
      return Response.json({ accessToken: "ding-issued-token", expireIn: 3600 });
    }) as typeof fetch, send: async (snapshot, secret) => {
      expect(secret).toEqual({ accessToken: "ding-issued-token" }); const built = buildNotificationRequest(snapshot, secret);
      expect(built.headers["x-acs-dingtalk-access-token"]).toBe("ding-issued-token"); expect(built.body).not.toContain("fixture-ding-secret"); sends++; return { state: "accepted", code: "accepted" };
    } }).tick();
    expect(sends).toBe(1); expect((await f.db.select().from(deliveries).where(eq(deliveries.id, delivery.id)))[0].state).toBe("accepted");
  } finally { await f.cleanup(); }
});

test("waiting for another token worker does not consume a send attempt", async ({ request }) => {
  const f = await fixture(request);
  try {
    const delivery = await f.enqueue(); let entered!: () => void, release!: () => void; const started = new Promise<void>(r => { entered = r; }); const blocked = new Promise<void>(r => { release = r; }); let sends = 0;
    const refreshing = notificationTokenCache(f.db, { exchange: async () => { entered(); await blocked; return { token: "coalesced-token", expiresAt: future() }; } }).resolve(f.scope, f.credentials); await started;
    const worker = notificationOutbox(f.db, { tokenTransport: (async () => { throw Error("refresh already owns the lease"); }) as typeof fetch, send: async (_snapshot, secret) => { expect(secret.accessToken).toBe("coalesced-token"); sends++; return { state: "accepted", code: "accepted" }; } });
    await worker.tick(); const [waiting] = await f.db.select().from(deliveries).where(eq(deliveries.id, delivery.id)); expect(waiting.state).toBe("retryable"); expect(waiting.attempt).toBe(0); expect(waiting.lastCode).toBe("token_refresh_busy"); expect(sends).toBe(0);
    release(); await refreshing; await f.db.update(deliveries).set({ nextAttemptAt: new Date(0) }).where(eq(deliveries.id, delivery.id)); await worker.tick(); expect(sends).toBe(1);
  } finally { await f.cleanup(); }
});

test("expired token retry windows stop before exchanging or sending", async ({ request }) => {
  const f = await fixture(request);
  try {
    const delivery = await f.enqueue(); await f.db.update(deliveries).set({ attempt: 1, createdAt: new Date(Date.now() - 1860000) }).where(eq(deliveries.id, delivery.id)); let calls = 0;
    await notificationOutbox(f.db, { tokenTransport: (async () => { calls++; return Response.json({}); }) as typeof fetch, send: async () => { calls++; return { state: "accepted", code: "accepted" }; } }).tick();
    const [saved] = await f.db.select().from(deliveries).where(eq(deliveries.id, delivery.id)); expect(saved.state).toBe("rejected"); expect(saved.lastCode).toBe("token_retry_window_exhausted"); expect(calls).toBe(0);
  } finally { await f.cleanup(); }
});
