import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { casdoorPlugin, type CasdoorConfig } from "../auth/casdoor.js";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "fixture", use: "sig", alg: "RS256" };
const config: CasdoorConfig = {
  discoveryUrl: "https://id.example/.well-known/openid-configuration", issuer: "https://id.example",
  clientId: "test-client", clientSecret: "fixture-secret", loginPolicy: "dual", allowedSubjects: [],
};
const payload = () => ({ iss: config.issuer, aud: config.clientId, sub: "employee-1", email: "employee@example.test", email_verified: true, name: "Employee", nonce: "nonce-1", exp: Math.floor(Date.now() / 1000) + 300 });
function token(claims = payload(), key = privateKey) {
  const data = [Buffer.from(JSON.stringify({ alg: "RS256", kid: "fixture" })).toString("base64url"), Buffer.from(JSON.stringify(claims)).toString("base64url")].join(".");
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), key).toString("base64url")}`;
}
async function provider(overrides: Partial<CasdoorConfig> = {}, discovery: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/jwks")) return Response.json({ keys: [jwk] });
    return Response.json({ issuer: config.issuer, authorization_endpoint: "https://id.example/authorize", token_endpoint: "https://id.example/token", jwks_uri: "https://id.example/jwks", id_token_signing_alg_values_supported: ["RS256"], ...discovery });
  }));
  const plugin = casdoorPlugin({ ...config, ...overrides });
  const result = await plugin.init({ socialProviders: [], logger: { error: vi.fn(), warn: vi.fn() }, baseURL: "https://app.example/api/auth" } as unknown as Parameters<typeof plugin.init>[0]);
  return result.context.socialProviders.find(item => item.id === "casdoor")!;
}
afterEach(() => vi.unstubAllGlobals());
describe("Casdoor real genericOAuth ID-token pipeline", () => {
  it("accepts a correctly signed token and stable subject", async () => {
    const p = await provider();
    const info = await p.getUserInfo({ idToken: token(), accessToken: "fixture", expectedIdTokenNonce: "nonce-1" });
    expect(info?.user.email).toBe("employee@example.test");
    expect(info?.data.sub).toBe("employee-1");
  });
  it.each(["iss", "aud", "nonce", "exp"])("rejects invalid %s", async field => {
    const p = await provider(); const claims = { ...payload(), [field]: field === "exp" ? 1 : "wrong" };
    expect(await p.getUserInfo({ idToken: token(claims), accessToken: "fixture", expectedIdTokenNonce: "nonce-1" })).toBeNull();
  });
  it("rejects forged signature", async () => {
    const p = await provider(); const bad = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(await p.getUserInfo({ idToken: token(payload(), bad.privateKey), expectedIdTokenNonce: "nonce-1" })).toBeNull();
  });
  it("requires an ID token even with an access token", async () => {
    const p = await provider(); expect(await p.getUserInfo({ accessToken: "fixture" })).toBeNull();
  });
  it("enforces deployment admission separately from company membership", async () => {
    const p = await provider({ allowedSubjects: ["other-user"] });
    expect(await p.getUserInfo({ idToken: token(), expectedIdTokenNonce: "nonce-1" })).toBeNull();
  });
  it("fails initialization for unexpected discovery issuer", async () => { await expect(provider({}, { issuer: "https://evil.example" })).rejects.toThrow("issuer mismatch"); });
  it("fails initialization without verification metadata", async () => { await expect(provider({}, { jwks_uri: undefined })).rejects.toThrow(); });
});
