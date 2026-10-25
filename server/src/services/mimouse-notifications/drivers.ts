import { createHmac } from "node:crypto";

export type ChannelKind = "wecom_webhook" | "feishu_webhook" | "dingtalk_webhook_legacy" | "dingtalk_app" | "wechat_official_account";
export interface NotificationSnapshot {
  kind: ChannelKind;
  brand?: "feishu" | "lark";
  title: string;
  text: string;
  detailUrl?: string;
  target?: string;
  robotCode?: string;
  templateId?: string;
  templateData?: Record<string, { value: string }>;
}
export interface ChannelSecret { url?: string; signingSecret?: string; accessToken?: string }
export type DeliveryResult = { state: "accepted" | "rejected" | "retryable" | "indeterminate"; code: string; receipt?: string; retryAfterMs?: number };
export const feishuSignature = (secret: string, seconds: number) => createHmac("sha256", `${seconds}\n${secret}`).update("").digest("base64");
export const dingtalkSignature = (secret: string, millis: number) => createHmac("sha256", secret).update(`${millis}\n${secret}`).digest("base64");

function webhookUrl(kind: ChannelKind, brand: string | undefined, raw: string | undefined): URL {
  if (!raw) throw Error("missing_webhook");
  let url: URL; try { url = new URL(raw); } catch { throw Error("invalid_webhook"); }
  const host = kind === "wecom_webhook" ? "qyapi.weixin.qq.com" : kind === "feishu_webhook" ? brand === "lark" ? "open.larksuite.com" : "open.feishu.cn" : "oapi.dingtalk.com";
  const prefix = kind === "wecom_webhook" ? "/cgi-bin/webhook/send" : kind === "feishu_webhook" ? "/open-apis/bot/v2/hook/" : "/robot/send";
  if (url.protocol !== "https:" || url.hostname !== host || url.port || url.username || url.password || url.hash || !url.pathname.startsWith(prefix)) throw Error("invalid_webhook_destination");
  return url;
}
function required(value: string | undefined, code: string): string { if (!value?.trim()) throw Error(code); return value; }
function safeDetails(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let url: URL; try { url = new URL(raw); } catch { throw Error("invalid_detail_url"); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error("invalid_detail_url");
  return url.href;
}
export function buildNotificationRequest(snapshot: NotificationSnapshot, secret: ChannelSecret, now = Date.now()) {
  if (!snapshot.title.trim() || !snapshot.text.trim()) throw Error("empty_message");
  const detail = safeDetails(snapshot.detailUrl);
  const text = snapshot.text + (detail ? `\n${detail}` : "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  let url: URL; let body: unknown;
  switch (snapshot.kind) {
    case "wecom_webhook":
      url = webhookUrl(snapshot.kind, undefined, secret.url);
      body = { msgtype: "markdown", markdown: { content: text } }; break;
    case "feishu_webhook": {
      url = webhookUrl(snapshot.kind, snapshot.brand, secret.url);
      const timestamp = Math.floor(now / 1000);
      body = { msg_type: "text", content: { text }, ...(secret.signingSecret ? { timestamp: String(timestamp), sign: feishuSignature(secret.signingSecret, timestamp) } : {}) }; break;
    }
    case "dingtalk_webhook_legacy":
      url = webhookUrl(snapshot.kind, undefined, secret.url);
      if (secret.signingSecret) { url.searchParams.set("timestamp", String(now)); url.searchParams.set("sign", dingtalkSignature(secret.signingSecret, now)); }
      body = { msgtype: "markdown", markdown: { title: snapshot.title, text }, at: { isAtAll: false } }; break;
    case "dingtalk_app":
      url = new URL("https://api.dingtalk.com/v1.0/robot/groupMessages/send");
      headers["x-acs-dingtalk-access-token"] = required(secret.accessToken, "missing_access_token");
      body = { robotCode: required(snapshot.robotCode, "missing_robot_code"), openConversationId: required(snapshot.target, "missing_target"), msgKey: "sampleMarkdown", msgParam: JSON.stringify({ title: snapshot.title, text }) }; break;
    case "wechat_official_account":
      url = new URL("https://api.weixin.qq.com/cgi-bin/message/template/send");
      url.searchParams.set("access_token", required(secret.accessToken, "missing_access_token"));
      if (!snapshot.templateData || !Object.keys(snapshot.templateData).length || Object.values(snapshot.templateData).some(value => !value || typeof value.value !== "string")) throw Error("missing_template_fields");
      body = { touser: required(snapshot.target, "missing_openid"), template_id: required(snapshot.templateId, "missing_template_id"), data: snapshot.templateData, ...(detail ? { url: detail } : {}) }; break;
    default: throw Error("unsupported_channel");
  }
  const serialized = JSON.stringify(body);
  const maxBytes = snapshot.kind === "feishu_webhook" ? 20 * 1024 : snapshot.kind === "wecom_webhook" ? 4096 : 20 * 1024;
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) throw Error("message_too_large");
  return { url, headers, body: serialized };
}
export function classifyNotificationResponse(kind: ChannelKind, status: number, payload: unknown, retryAfter?: string | null): DeliveryResult {
  if (status === 429) {
    const seconds = Number(retryAfter);
    return { state: "retryable", code: "http_429", retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 1800000) : 60000 };
  }
  if (status >= 500) return { state: "indeterminate", code: `http_${status}` };
  if (status < 200 || status >= 300) return { state: "rejected", code: `http_${status}` };
  if (!payload || typeof payload !== "object") return { state: "indeterminate", code: "invalid_response" };
  const data = payload as Record<string, unknown>;
  if (kind === "dingtalk_app") return typeof data.processQueryKey === "string" && data.processQueryKey ? { state: "accepted", code: "accepted", receipt: data.processQueryKey } : { state: "rejected", code: "missing_process_query_key" };
  const field = kind === "feishu_webhook" ? "code" : "errcode";
  if (typeof data[field] !== "number") return { state: "indeterminate", code: "missing_business_code" };
  if (data[field] !== 0) return { state: "rejected", code: `provider_${data[field]}` };
  if (kind === "wechat_official_account" && typeof data.msgid !== "number" && typeof data.msgid !== "string") return { state: "indeterminate", code: "missing_message_id" };
  return { state: "accepted", code: "accepted", ...(data.msgid !== undefined ? { receipt: String(data.msgid) } : {}) };
}
/** Network ambiguity never becomes an automatic replay. Never return vendor payloads or secret URLs. */
export async function sendNotification(snapshot: NotificationSnapshot, secret: ChannelSecret, transport: typeof fetch = fetch): Promise<DeliveryResult> {
  let request: ReturnType<typeof buildNotificationRequest>;
  try { request = buildNotificationRequest(snapshot, secret); }
  catch (error) { return { state: "rejected", code: error instanceof Error ? error.message : "invalid_configuration" }; }
  try {
    const response = await transport(request.url, { method: "POST", headers: request.headers, body: request.body, redirect: "error", signal: AbortSignal.timeout(10000) });
    // Bound untrusted provider output before parsing; no raw response is persisted.
    const reader = response.body?.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
    if (reader) for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 65536) { await reader.cancel(); return { state: "indeterminate", code: "response_too_large" }; } chunks.push(chunk.value); }
    let payload: unknown = null; try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* classifies as unknown, not success */ }
    return classifyNotificationResponse(snapshot.kind, response.status, payload, response.headers.get("retry-after"));
  } catch { return { state: "indeterminate", code: "transport_unconfirmed" }; }
}
