import { describe, expect, it } from "vitest";
import { readCasdoorConfig, casdoorCapabilities } from "../auth/casdoor.js";
const env = {
  PAPERCLIP_OIDC_ENABLED: "true", PAPERCLIP_OIDC_DISCOVERY_URL: "https://id.example/.well-known/openid-configuration",
  PAPERCLIP_OIDC_EXPECTED_ISSUER: "https://id.example", PAPERCLIP_OIDC_CLIENT_ID: "test-client", PAPERCLIP_OIDC_CLIENT_SECRET: "fixture-secret",
};
describe("Casdoor config", () => {
  it("defaults to unchanged password login without OIDC", () => { expect(casdoorCapabilities(readCasdoorConfig({}))).toEqual({ password: true, providers: [] }); });
  it("does not expose secrets or issuer in public capabilities", () => { expect(casdoorCapabilities(readCasdoorConfig(env))).toEqual({ password: true, providers: [{ id: "casdoor", name: "Casdoor" }] }); });
  it("requires enabled provider for sso-only", () => { expect(() => readCasdoorConfig({ PAPERCLIP_OIDC_LOGIN_POLICY: "sso-only" })).toThrow(); });
  it.each(["http://id.example", "https://user:secret@id.example", "file:///tmp/discovery", "javascript:alert(1)"])("rejects unsafe discovery %s", url => { expect(() => readCasdoorConfig({ ...env, PAPERCLIP_OIDC_DISCOVERY_URL: url })).toThrow(); });
  it("requires every deployment input", () => { for (const key of Object.keys(env).filter(k => k !== "PAPERCLIP_OIDC_ENABLED")) expect(() => readCasdoorConfig({ ...env, [key]: "" })).toThrow(); });
  it("rejects a cross-origin post-logout redirect", () => { expect(() => readCasdoorConfig({ ...env, PAPERCLIP_AUTH_PUBLIC_BASE_URL: "https://app.example", PAPERCLIP_OIDC_POST_LOGOUT_URL: "https://evil.example" })).toThrow(); });
  it("allows loopback test IdP and explicit subject admission", () => { expect(readCasdoorConfig({ ...env, PAPERCLIP_OIDC_DISCOVERY_URL: "http://127.0.0.1:4000/.well-known/openid-configuration", PAPERCLIP_OIDC_ALLOWED_SUBJECTS: "a, b" })?.allowedSubjects).toEqual(["a", "b"]); });
});
