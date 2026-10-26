import { createHash } from "node:crypto";
import { z } from "zod";
import type { FeedbackImportInput } from "@paperclipai/shared";

export const WECOM_ENDPOINT = "wss://openws.work.weixin.qq.com";
export const WECOM_MAX_FRAME_BYTES = 128 * 1024;
const identity = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:@-]*$/);
export const wecomConfigSchema = z.object({
  transport: z.literal("long_connection"), botId: identity,
  product: z.string().trim().min(1).max(120),
  secret: z.object({ secretId: z.string().uuid(), version: z.number().int().positive() }).strict(),
  allowedGroupIds: z.array(identity).max(100), allowedDirectSenderIds: z.array(identity).max(100),
}).strict().refine(c => c.allowedGroupIds.length + c.allowedDirectSenderIds.length > 0,
  "At least one explicit group or direct sender is required");
export type WecomConfig = z.infer<typeof wecomConfigSchema>;
export type WecomStopReason = "cancelled" | "displaced" | "authentication" | "revoked" | "budget_exhausted" | "protocol" | "overflow" | "transport";
export class WecomReceiveError extends Error {
  constructor(readonly code: WecomStopReason) { super(`WeCom receive stopped: ${code}`); }
}
const record = z.record(z.string(), z.unknown());
export const wecomFrameSchema = z.object({
  cmd: z.string().max(64).optional(), headers: z.object({ req_id: z.string().max(200) }).optional(),
  errcode: z.number().optional(), body: record.optional(),
});
export type WecomFrame = z.infer<typeof wecomFrameSchema>;
export function parseWecomFrame(bytes: Buffer, binary = false): WecomFrame {
  if (binary || bytes.byteLength > WECOM_MAX_FRAME_BYTES) throw new WecomReceiveError("protocol");
  try { return wecomFrameSchema.parse(JSON.parse(bytes.toString("utf8"))); }
  catch { throw new WecomReceiveError("protocol"); }
}
export function wecomBotHash(botId: string) { return createHash("sha256").update(botId).digest("hex"); }
const text = z.object({ content: z.string().max(32000) });
const message = z.object({
  msgid: identity, aibotid: identity, chattype: z.enum(["single", "group"]), chatid: identity.optional(),
  from: z.object({ userid: identity }), create_time: z.number().int().nonnegative().max(8640000000000).optional(),
  msgtype: z.enum(["text", "voice", "mixed"]), text: text.optional(), voice: text.optional(),
  mixed: z.object({ msg_item: z.array(z.object({ msgtype: z.string(), text: text.optional() })).max(100) }).optional(),
});
/** Projection only: quote/response_url/media URLs/aeskeys never leave this boundary. */
export function projectWecomMessage(config: WecomConfig, body: unknown, receivedAt: Date, secret: string): FeedbackImportInput | null {
  const parsed = message.safeParse(body);
  if (!parsed.success) return null;
  const m = parsed.data;
  if (m.aibotid !== config.botId) return null;
  if (m.chattype === "group" ? !m.chatid || !config.allowedGroupIds.includes(m.chatid) : !config.allowedDirectSenderIds.includes(m.from.userid)) return null;
  const content = m.msgtype === "text" ? m.text?.content : m.msgtype === "voice" ? m.voice?.content :
    m.mixed?.msg_item.filter(i => i.msgtype === "text").map(i => i.text?.content ?? "").join("\n");
  if (!content?.trim()) return null;
  // Known credential material is removed even if a sender happens to repeat it.
  const clean = (value: string) => secret ? value.split(secret).join("[REDACTED]") : value;
  return {
    sourceKind: "wecom_smart_bot", sourceInstance: `wecom:${wecomBotHash(config.botId)}`,
    externalId: createHash("sha256").update(m.msgid).digest("hex"),
    title: "WeCom inbound feedback", text: clean(content).slice(0, 32000), product: clean(config.product),
    softwareVersion: "", commitSha: null, traceId: null,
    occurredAt: m.create_time === undefined ? receivedAt.toISOString() : new Date(m.create_time * 1000).toISOString(),
  };
}
/** No callback ACK exists here. aibot_respond_msg is a customer reply, never sent. */
export class WecomSession {
  authenticated = false;
  constructor(readonly botId: string, readonly authRequestId: string) {}
  accept(frame: WecomFrame): "authenticated" | "message" | "ignored" {
    if (!frame.cmd && frame.headers?.req_id === this.authRequestId) {
      if (frame.errcode !== 0) throw new WecomReceiveError("authentication");
      this.authenticated = true; return "authenticated";
    }
    if (!this.authenticated) return "ignored";
    if (frame.cmd !== "aibot_msg_callback" && frame.cmd !== "aibot_event_callback") return "ignored";
    if (frame.body?.aibotid !== this.botId) return "ignored";
    if (frame.cmd === "aibot_event_callback") {
      const event = record.safeParse(frame.body.event);
      if (event.success && event.data.eventtype === "disconnected_event") throw new WecomReceiveError("displaced");
      return "ignored"; // Events grant no scope and are not feedback messages.
    }
    return "message";
  }
}
