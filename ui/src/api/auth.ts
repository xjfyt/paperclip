import { oidcNavigationUrl, safeOidcReturnPath } from "../lib/oidc-navigation";
import {
  authSessionSchema,
  currentUserProfileSchema,
  type AuthSession,
  type CurrentUserProfile,
  type UpdateCurrentUserProfile,
} from "@paperclipai/shared";
import { redactUrlSecrets } from "@/lib/redact-url-secrets";
import { tenantSessionRecovery } from "@/lib/tenant-session-recovery";
import { readApiJson } from "./response";

type AuthErrorBody =
  | {
    code?: string;
    message?: string;
    error?: string | { code?: string; message?: string };
  }
  | null;

export interface SignOutResult {
  success: true;
  redirectTo?: string;
  url?: string;
  redirect?: boolean;
}

export class AuthApiError extends Error {
  status: number;
  code: string | null;
  body: unknown;

  constructor(message: string, status: number, body: unknown, code: string | null = null) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function toSession(value: unknown): AuthSession | null {
  const direct = authSessionSchema.safeParse(value);
  if (direct.success) return direct.data;

  if (!value || typeof value !== "object") return null;
  const nested = authSessionSchema.safeParse((value as Record<string, unknown>).data);
  return nested.success ? nested.data : null;
}

function extractAuthError(payload: AuthErrorBody, status: number) {
  const nested =
    payload?.error && typeof payload.error === "object"
      ? payload.error
      : null;
  const code =
    typeof nested?.code === "string"
      ? nested.code
      : typeof payload?.code === "string"
        ? payload.code
        : null;
  const message =
    typeof nested?.message === "string" && nested.message.trim().length > 0
      ? nested.message
      : typeof payload?.message === "string" && payload.message.trim().length > 0
        ? payload.message
        : typeof payload?.error === "string" && payload.error.trim().length > 0
          ? payload.error
          : `Request failed: ${status}`;

  return new AuthApiError(message, status, payload, code);
}

// Rich diagnostics for auth requests. Network-layer failures (Safari
// "Load failed" / Chrome "Failed to fetch") throw a TypeError *before* any
// HTTP response, so they are indistinguishable from a bad password in the UI
// unless we log the resolved request URL + origin here. See PAP-13466.
function resolveAuthUrl(path: string) {
  const relative = `/api/auth${path}`;
  try {
    return new URL(relative, window.location.origin).href;
  } catch {
    return relative;
  }
}

function logAuthNetworkFailure(method: string, path: string, error: unknown) {
  // eslint-disable-next-line no-console
  console.error("[auth] request failed at the network layer (no HTTP response)", {
    method,
    requestUrl: resolveAuthUrl(path),
    pageOrigin: typeof window !== "undefined" ? window.location.origin : "(no window)",
    pageHref: typeof window !== "undefined" ? redactUrlSecrets(window.location.href) : "(no window)",
    credentials: "include",
    online: typeof navigator !== "undefined" ? navigator.onLine : "(no navigator)",
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error),
    error,
    hint:
      "This means the browser never got a response from the server. Common causes: " +
      "the page origin differs from the API host (mixed http/https, wrong hostname/port, " +
      "or a proxy/tunnel that only forwards the page but not /api), an SSL error, or the " +
      "connection was reset. A wrong password would instead return HTTP 401, not this.",
  });
}

function logAuthHttpError(method: string, path: string, status: number, statusText: string, body: unknown) {
  // eslint-disable-next-line no-console
  console.error("[auth] request returned an error status", {
    method,
    requestUrl: resolveAuthUrl(path),
    status,
    statusText,
    body,
  });
}

async function authPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`/api/auth${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (networkError) {
    logAuthNetworkFailure("POST", path, networkError);
    throw networkError;
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const recovery = tenantSessionRecovery.recoverIfNeeded(res.status, payload);
    if (recovery) return recovery;
    logAuthHttpError("POST", path, res.status, res.statusText, payload);
    throw extractAuthError(payload as AuthErrorBody, res.status);
  }
  return payload;
}

async function authPatch<T>(path: string, body: Record<string, unknown>, parse: (value: unknown) => T): Promise<T> {
  const res = await fetch(`/api/auth${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const recovery = tenantSessionRecovery.recoverIfNeeded(res.status, payload);
    if (recovery) return recovery;
    throw extractAuthError(payload as AuthErrorBody, res.status);
  }
  return parse(payload);
}

export const authApi = {
  capabilities: async (): Promise<{ password: boolean; providers: Array<{ id: string; name: string }> }> => {
    const response = await fetch("/api/instance/auth-capabilities", { credentials: "include" });
    if (!response.ok) throw new Error("Unable to load authentication capabilities");
    return response.json();
  },
  signInCasdoor: async (callbackURL: string, link = false): Promise<string> => {
    const result = await authPost(link ? "/link-social" : "/sign-in/social", {
      provider: "casdoor", callbackURL: safeOidcReturnPath(callbackURL), disableRedirect: true,
    });
    const url = oidcNavigationUrl((result as { url?: unknown } | null)?.url);
    if (!url) throw new Error("Invalid authentication redirect");
    return url;
  },
  getSession: async (): Promise<AuthSession | null> => {
    const res = await fetch("/api/auth/get-session", {
      credentials: "include",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await readApiJson(res);
    if (!res.ok) {
      const recovery = tenantSessionRecovery.recoverIfNeeded(res.status, payload);
      if (recovery) return recovery;
      if (res.status === 401) return null;
      throw extractAuthError(payload as AuthErrorBody, res.status);
    }
    const session = toSession(payload) ?? (payload && typeof payload === "object"
      ? toSession((payload as Record<string, unknown>).data) : null);
    const scopeKey = res.headers.get("X-Paperclip-Session-Scope");
    return session && scopeKey && /^[a-f0-9]{64}$/.test(scopeKey)
      ? { ...session, session: { ...session.session, scopeKey } }
      : session;
  },

  signInEmail: async (input: { email: string; password: string }) => {
    await authPost("/sign-in/email", input);
  },

  signUpEmail: async (input: { name: string; email: string; password: string }) => {
    await authPost("/sign-up/email", input);
  },

  getProfile: async (): Promise<CurrentUserProfile> => {
    const res = await fetch("/api/auth/profile", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const recovery = tenantSessionRecovery.recoverIfNeeded(res.status, payload);
      if (recovery) return recovery;
      throw new Error((payload as { error?: string } | null)?.error ?? `Failed to load profile (${res.status})`);
    }
    return currentUserProfileSchema.parse(payload);
  },

  updateProfile: async (input: UpdateCurrentUserProfile): Promise<CurrentUserProfile> =>
    authPatch("/profile", input, (payload) => currentUserProfileSchema.parse(payload)),

  signOut: async (): Promise<SignOutResult> => {
    const payload = await authPost("/sign-out", {});
    // A successful HTTP response alone is not confirmation that local logout
    // completed (for example, a proxy may have returned an unrelated body).
    if (!payload || typeof payload !== "object" || (payload as Record<string, unknown>).success !== true) {
      throw new Error("Local sign-out was not confirmed");
    }

    const result = payload as Record<string, unknown>;
    return {
      success: true,
      ...(oidcNavigationUrl(result.url) ? { url: oidcNavigationUrl(result.url)! } : {}),
      ...(typeof result.redirect === "boolean" ? { redirect: result.redirect } : {}),
      ...(typeof result.redirectTo === "string" ? { redirectTo: result.redirectTo } : {}),
    };
  },
};
