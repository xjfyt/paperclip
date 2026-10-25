import { createHash } from "node:crypto";
import type { ChannelKind, ChannelSecret } from "./drivers.js";

export class NotificationTokenError extends Error {
  constructor(readonly code: string, readonly retryable = false, readonly retryAfterMs = 5000, readonly busy = false) { super(code); this.name = "NotificationTokenError"; }
}
export interface AppCredential { kind: "dingtalk_app" | "wechat_official_account"; clientId: string; clientSecret: string; identity: string }
const text = (value: unknown, limit: number) => typeof value === "string" && value.trim().length > 0 && value.length <= limit;
/** Pure validation. Saving a channel must never exchange a token or send a message. */
export function appCredential(kind: ChannelKind, secret: ChannelSecret): AppCredential | null {
  if (kind !== "dingtalk_app" && kind !== "wechat_official_account") return null;
  if (!secret || typeof secret !== "object" || Array.isArray(secret)) throw new NotificationTokenError("token_credentials_invalid");
  const hasApplicationFields = [secret.appId, secret.appKey, secret.appSecret].some(value => value !== undefined);
  if (secret.accessToken !== undefined) {
    if (hasApplicationFields) throw new NotificationTokenError("token_credentials_ambiguous");
    if (!text(secret.accessToken, 16384)) throw new NotificationTokenError("token_access_token_invalid");
    return null;
  }
  const clientId = kind === "dingtalk_app" ? secret.appKey : secret.appId;
  if (!text(clientId, 512) || !text(secret.appSecret, 8192) || (kind === "dingtalk_app" ? secret.appId !== undefined : secret.appKey !== undefined)) throw new NotificationTokenError("token_application_credentials_missing_or_invalid");
  const identity = createHash("sha256").update(JSON.stringify([kind, clientId, secret.appSecret])).digest("hex");
  return { kind, clientId: clientId!, clientSecret: secret.appSecret!, identity };
}
export function validationSecret(kind: ChannelKind, secret: ChannelSecret): ChannelSecret {
  return appCredential(kind, secret) ? { accessToken: "configuration-validation-only" } : secret;
}
export async function exchangeAppToken(credential: AppCredential, transport: typeof fetch = fetch): Promise<{ token: string; expiresAt: Date }> {
  const wechat = credential.kind === "wechat_official_account";
  const url = wechat ? "https://api.weixin.qq.com/cgi-bin/stable_token" : "https://api.dingtalk.com/v1.0/oauth2/accessToken";
  const body = wechat
    ? { grant_type: "client_credential", appid: credential.clientId, secret: credential.clientSecret, force_refresh: false }
    : { appKey: credential.clientId, appSecret: credential.clientSecret };
  try {
    const response = await transport(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10000) });
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    if (reader) for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 65536) { await reader.cancel(); throw new NotificationTokenError("token_response_too_large"); } chunks.push(chunk.value); }
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      throw new NotificationTokenError("token_http_429", true, Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 1800000) : 60000);
    }
    if (response.status >= 500) throw new NotificationTokenError("token_provider_unavailable", true);
    if (!response.ok) throw new NotificationTokenError("token_provider_rejected");
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new NotificationTokenError("token_response_invalid"); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || (wechat && payload.errcode !== undefined && payload.errcode !== 0)) throw new NotificationTokenError("token_provider_rejected");
    const token = wechat ? payload.access_token : payload.accessToken;
    const seconds = wechat ? payload.expires_in : payload.expireIn;
    if (!text(token, 16384) || typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 86400) throw new NotificationTokenError("token_response_invalid");
    // The provider's remaining lifetime is authoritative; never assume two hours.
    if (seconds <= 30) throw new NotificationTokenError("token_near_expiry", true, (seconds + 1) * 1000);
    return { token: token as string, expiresAt: new Date(Date.now() + seconds * 1000) };
  } catch (error) {
    if (error instanceof NotificationTokenError) throw error;
    // No notification has been sent: retrying this preflight cannot duplicate a message.
    throw new NotificationTokenError("token_transport_unconfirmed", true);
  }
}
