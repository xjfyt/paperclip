import { generateKeyPairSync, sign } from "node:crypto";
import { betterAuth } from "better-auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { casdoorPlugin } from "../auth/casdoor.js";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const issuer = "https://id.example";
let nonce = "";
let exchangeCount = 0;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function fixtureToken() {
  const body = `${encode({ alg: "RS256", kid: "one" })}.${encode({ iss: issuer, aud: "client", sub: "employee", email: "employee@example.test", email_verified: true, name: "Employee", exp: Math.floor(Date.now() / 1000) + 600, nonce })}`;
  return `${body}.${sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url")}`;
}
function auth() {
  exchangeCount = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/jwks")) return Response.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "one", alg: "RS256", use: "sig" }] });
    if (url.endsWith("/token")) { exchangeCount++; return Response.json({ access_token: "fixture-access", token_type: "Bearer", expires_in: 600, id_token: fixtureToken() }); }
    if (url.endsWith("/discovery")) return Response.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, id_token_signing_alg_values_supported: ["RS256"] });
    throw new Error("Unexpected external request");
  }));
  return betterAuth({
    baseURL: "https://app.example/api/auth", secret: "test-only-casdoor-flow-secret-with-32-chars",
    emailAndPassword: { enabled: true },
    account: { storeStateStrategy: "database", accountLinking: { enabled: true, disableImplicitLinking: true, allowUnlinkingAll: false } },
    plugins: [casdoorPlugin({ discoveryUrl: `${issuer}/discovery`, issuer, clientId: "client", clientSecret: "fixture", loginPolicy: "dual", allowedSubjects: [] })],
  });
}
const cookieHeader = (response: Response) => response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
async function begin(instance: ReturnType<typeof auth>) {
  const response = await instance.handler(new Request("https://app.example/api/auth/sign-in/social", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://app.example" },
    body: JSON.stringify({ provider: "casdoor", callbackURL: "/", disableRedirect: true }),
  }));
  expect(response.status).toBe(200);
  const data = await response.json(); const url = new URL(data.url); nonce = url.searchParams.get("nonce")!;
  expect(url.searchParams.get("code_challenge_method")).toBe("S256"); expect(nonce).toBeTruthy();
  return { state: url.searchParams.get("state")!, cookies: cookieHeader(response) };
}
afterEach(() => vi.unstubAllGlobals());
describe("Casdoor authorization-code flow", () => {
  it("rejects wrong state without exchanging a code", async () => {
    const instance = auth(); const start = await begin(instance);
    const response = await instance.handler(new Request("https://app.example/api/auth/callback/casdoor?code=fixture&state=wrong", { headers: { cookie: start.cookies } }));
    expect(response.headers.get("location")).toContain("error"); expect(exchangeCount).toBe(0);
  });
  it("accepts one valid callback and rejects replay", async () => {
    const instance = auth(); const start = await begin(instance);
    const url = `https://app.example/api/auth/callback/casdoor?code=fixture&state=${encodeURIComponent(start.state)}`;
    const response = await instance.handler(new Request(url, { headers: { cookie: start.cookies } }));
    expect(response.status).toBe(302); expect(response.headers.get("location")).not.toContain("error");
    expect(exchangeCount).toBe(1); expect(cookieHeader(response)).toContain("session_token");
    const replay = await instance.handler(new Request(url, { headers: { cookie: start.cookies } }));
    expect(replay.headers.get("location")).toContain("error"); expect(exchangeCount).toBe(1);
  });
  it("does not implicitly take over an existing same-email password account", async () => {
    const instance = auth();
    const signUp = await instance.handler(new Request("https://app.example/api/auth/sign-up/email", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://app.example" },
      body: JSON.stringify({ email: "employee@example.test", name: "Existing", password: "fixture-password-123456" }),
    }));
    expect(signUp.status).toBe(200);
    const start = await begin(instance);
    const response = await instance.handler(new Request(`https://app.example/api/auth/callback/casdoor?code=fixture&state=${encodeURIComponent(start.state)}`, { headers: { cookie: start.cookies } }));
    expect(response.headers.get("location")).toContain("error");
    expect(cookieHeader(response)).not.toContain("session_token=");
  });

});
