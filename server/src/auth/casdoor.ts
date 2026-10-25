import { genericOAuth } from "better-auth/plugins/generic-oauth";

export interface CasdoorConfig {
  discoveryUrl: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  loginPolicy: "dual" | "sso-only";
  postLogoutUrl?: string;
  allowedSubjects: string[];
}

function secureUrl(value: string, field: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`Invalid ${field}`); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.hash) {
    throw new Error(`${field} requires HTTPS (HTTP allowed only on loopback)`);
  }
  return value;
}

export function readCasdoorConfig(env: NodeJS.ProcessEnv = process.env): CasdoorConfig | null {
  if (env.PAPERCLIP_OIDC_ENABLED !== "true") {
    if (env.PAPERCLIP_OIDC_LOGIN_POLICY === "sso-only") throw new Error("sso-only requires enabled OIDC");
    return null;
  }
  const required = (key: string) => {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Missing ${key}`);
    return value;
  };
  const loginPolicy = env.PAPERCLIP_OIDC_LOGIN_POLICY ?? "dual";
  if (loginPolicy !== "dual" && loginPolicy !== "sso-only") throw new Error("Invalid OIDC login policy");
  const postLogoutUrl = env.PAPERCLIP_OIDC_POST_LOGOUT_URL?.trim();
  const publicBaseUrl = env.PAPERCLIP_AUTH_PUBLIC_BASE_URL?.trim();
  if (postLogoutUrl) {
    secureUrl(postLogoutUrl, "OIDC logout URL");
    if (!publicBaseUrl || new URL(postLogoutUrl).origin !== new URL(publicBaseUrl).origin) {
      throw new Error("OIDC post logout URL must use the configured public app origin");
    }
  }
  return {
    discoveryUrl: secureUrl(required("PAPERCLIP_OIDC_DISCOVERY_URL"), "OIDC discovery URL"),
    issuer: secureUrl(required("PAPERCLIP_OIDC_EXPECTED_ISSUER"), "OIDC issuer"),
    clientId: required("PAPERCLIP_OIDC_CLIENT_ID"),
    clientSecret: required("PAPERCLIP_OIDC_CLIENT_SECRET"),
    loginPolicy,
    postLogoutUrl,
    // Optional deployment-level admission. Company membership remains separate.
    allowedSubjects: (env.PAPERCLIP_OIDC_ALLOWED_SUBJECTS ?? "").split(",").map(value => value.trim()).filter(Boolean),
  };
}

export function casdoorCapabilities(config: CasdoorConfig | null) {
  return {
    password: config?.loginPolicy !== "sso-only",
    providers: config ? [{ id: "casdoor", name: "Casdoor" }] : [],
  };
}

export function casdoorPlugin(config: CasdoorConfig) {
  const plugin = genericOAuth({ config: [{
    providerId: "casdoor",
    name: "Casdoor",
    discoveryUrl: config.discoveryUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    scopes: ["openid", "profile", "email"],
    pkce: true,
    requireIdTokenVerification: true,
    postLogoutRedirectURI: config.postLogoutUrl,
    // The library verifies signature/audience/expiry/nonce before this callback.
    // Its generic fallback permits userinfo without id_token, so explicitly reject that.
    getUserInfo: async (tokens) => {
      if (!tokens.idToken) return null;
      // Payload parsing only: Better Auth verifies the ID token before calling this.
      let claims: Record<string, unknown>;
      try { claims = JSON.parse(Buffer.from(tokens.idToken.split(".")[1] ?? "", "base64url").toString("utf8")); }
      catch { return null; }
      if (!claims || typeof claims !== "object") return null;
      if (claims.iss !== config.issuer || typeof claims.sub !== "string" || !claims.sub) return null;
      if (config.allowedSubjects.length && !config.allowedSubjects.includes(claims.sub)) return null;
      if (typeof claims.email !== "string" || !claims.email) return null;
      return {
        sub: claims.sub, id: claims.sub, email: claims.email,
        emailVerified: claims.email_verified === true,
        name: typeof claims.name === "string" ? claims.name : claims.sub,
        image: typeof claims.picture === "string" ? claims.picture : undefined,
      };
    },
    accountSubject: ({ profile }) => typeof profile.sub === "string" ? profile.sub : "",
    accountIssuer: config.issuer,
  }] });
  const init = plugin.init;
  return {
    ...plugin,
    init: async (...args: Parameters<typeof init>) => {
      const result = await init(...args);
      const provider = result.context.socialProviders.find(item => item.id === "casdoor");
      if (!provider || provider.issuer !== config.issuer) throw new Error("Casdoor discovery issuer mismatch");
      return result;
    },
  };
}
