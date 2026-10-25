import { afterEach, expect, it, vi } from "vitest";
import { appCredential, exchangeAppToken, NotificationTokenError, validationSecret } from "../services/mimouse-notifications/app-credentials.js";
import { sealNotificationToken, openNotificationToken } from "../services/mimouse-notifications/token-cache.js";
const application = { appId: "fixture-app", appSecret: "fixture-private-secret" };
const credential = appCredential("wechat_official_account", application)!;
const response = (data: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(data), { status, headers });
const oldKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY;
afterEach(() => { if (oldKey === undefined) delete process.env.PAPERCLIP_SECRETS_MASTER_KEY; else process.env.PAPERCLIP_SECRETS_MASTER_KEY = oldKey; vi.restoreAllMocks(); });
it("keeps static token credentials compatible and validates application credentials without exchanging", () => {
  const old = { accessToken: "static-fixture" }; expect(appCredential("dingtalk_app", old)).toBeNull(); expect(validationSecret("dingtalk_app", old)).toBe(old);
  expect(validationSecret("wechat_official_account", application)).toEqual({ accessToken: "configuration-validation-only" });
  expect(appCredential("wecom_webhook", { url: "fixture" })).toBeNull();
});
it.each([{ accessToken: "x", ...application }, { appId: "x" }, { appId: "x", appKey: "wrong-provider", appSecret: "s" }, { accessToken: "" }, { appId: "x", appSecret: " " }])("rejects incomplete, ambiguous or cross-provider credentials %j", value => {
  expect(() => appCredential("wechat_official_account", value)).toThrow(NotificationTokenError);
});
it("uses the WeChat stable POST without force refresh or credentials in the URL", async () => {
  const transport = vi.fn(async (url, options) => {
    expect(url).toBe("https://api.weixin.qq.com/cgi-bin/stable_token"); expect(options.redirect).toBe("error"); expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(options.body)).toEqual({ grant_type: "client_credential", appid: "fixture-app", secret: "fixture-private-secret", force_refresh: false });
    return response({ access_token: "fixture-token", expires_in: 1234 });
  }) as unknown as typeof fetch;
  const started = Date.now(); const result = await exchangeAppToken(credential, transport); expect(result.token).toBe("fixture-token"); expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(started + 1234000); expect(result.expiresAt.getTime()).toBeLessThan(Date.now() + 1235000);
});
it("uses the separate DingTalk app token contract and preserves its reported lifetime", async () => {
  const transport = vi.fn(async (url, options) => { expect(url).toBe("https://api.dingtalk.com/v1.0/oauth2/accessToken"); expect(JSON.parse(options.body)).toEqual({ appKey: "app-key", appSecret: "app-secret" }); return response({ accessToken: "ding-token", expireIn: 3456 }); }) as unknown as typeof fetch;
  expect((await exchangeAppToken(appCredential("dingtalk_app", { appKey: "app-key", appSecret: "app-secret" })!, transport)).token).toBe("ding-token");
});
it.each([-1, 0, 1.5, "7200", null, 86401])("does not invent an expiry when the provider returns %j", async seconds => {
  await expect(exchangeAppToken(credential, (async () => response({ access_token: "fixture-token", expires_in: seconds })) as typeof fetch)).rejects.toMatchObject({ code: "token_response_invalid", retryable: false });
});
it("waits for a near-expiry stable token instead of sending with it", async () => {
  await expect(exchangeAppToken(credential, (async () => response({ access_token: "fixture-token", expires_in: 5 })) as typeof fetch)).rejects.toMatchObject({ code: "token_near_expiry", retryable: true, retryAfterMs: 6000 });
});
it("classifies credential rejection without exposing the provider payload", async () => {
  await expect(exchangeAppToken(credential, (async () => response({ errcode: 40013, errmsg: application.appSecret })) as typeof fetch)).rejects.toMatchObject({ code: "token_provider_rejected", message: "token_provider_rejected", retryable: false });
});
it.each([429, 503])("permits bounded pre-message retry for HTTP %s", async status => {
  await expect(exchangeAppToken(credential, (async () => response({}, status, { "retry-after": "13" })) as typeof fetch)).rejects.toMatchObject({ retryable: true });
});
it("sanitizes transport errors and rejects oversized responses", async () => {
  await expect(exchangeAppToken(credential, (async () => { throw Error(application.appSecret); }) as typeof fetch)).rejects.toMatchObject({ message: "token_transport_unconfirmed", retryable: true });
  await expect(exchangeAppToken(credential, (async () => new Response("x".repeat(65537))) as typeof fetch)).rejects.toMatchObject({ code: "token_response_too_large" });
});
function row(): Parameters<typeof sealNotificationToken>[0] { return { id: "cache", companyId: "company", secretRef: "secret", secretVersion: 1, kind: "wechat_official_account", identity: credential.identity, tokenMaterial: null, expiresAt: null, revision: 1, lease: null, leaseExpiresAt: null, nextRefreshAt: new Date(), lastCode: null, createdAt: new Date(), updatedAt: new Date() }; }
it("encrypts token material and binds its expiry", async () => {
  process.env.PAPERCLIP_SECRETS_MASTER_KEY = "ab".repeat(32); const value = row(); const expiresAt = new Date(Date.now() + 60000); const material = await sealNotificationToken(value, "secret-token-fixture", expiresAt);
  expect(JSON.stringify(material)).not.toContain("secret-token-fixture"); expect(await openNotificationToken({ ...value, tokenMaterial: material, expiresAt })).toBe("secret-token-fixture");
  await expect(openNotificationToken({ ...value, tokenMaterial: material, expiresAt: new Date(expiresAt.getTime() + 1000) })).rejects.toThrow("token_cache_binding_or_key_invalid");
});
it.each(["id", "companyId", "secretRef", "kind", "identity", "revision", "secretVersion"])("rejects cached material copied across %s", async field => {
  process.env.PAPERCLIP_SECRETS_MASTER_KEY = "ab".repeat(32); const value = row(); const expiresAt = new Date(Date.now() + 60000); const material = await sealNotificationToken(value, "secret-token-fixture", expiresAt);
  await expect(openNotificationToken({ ...value, tokenMaterial: material, expiresAt, [field]: field === "revision" || field === "secretVersion" ? 2 : "another" })).rejects.toThrow("token_cache_binding_or_key_invalid");
});
