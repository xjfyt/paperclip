import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import type WebSocket from "ws";
import { parseWecomFrame, projectWecomMessage, WecomSession, wecomConfigSchema, WECOM_MAX_FRAME_BYTES } from "../services/mimouse-wecom/protocol.js";
vi.mock("../services/mimouse-wecom.js", () => ({ wecomFeedbackService: vi.fn(() => { throw Error("Real storage forbidden"); }) }));
import { runWecomReceiver } from "../services/mimouse-wecom/receiver.js";
const config = wecomConfigSchema.parse({ transport: "long_connection", botId: "bot-a", product: "App",
  secret: { secretId: "11111111-1111-4111-8111-111111111111", version: 2 }, allowedGroupIds: ["group-a"], allowedDirectSenderIds: ["user-a"] });
const message = { msgid: "event-a", aibotid: "bot-a", chattype: "group", chatid: "group-a", from: { userid: "user-b" },
  msgtype: "text", text: { content: "A customer bug" }, create_time: 1792992000 };
const now = new Date("2026-10-26T00:00:00Z");
describe("WeCom receive boundary", () => {
  it("requires explicit scopes, long connection, and pinned references; rejects endpoint overrides", () => {
    expect(wecomConfigSchema.safeParse({ ...config, allowedGroupIds: [], allowedDirectSenderIds: [] }).success).toBe(false);
    expect(wecomConfigSchema.safeParse({ ...config, url: "wss://evil.invalid" }).success).toBe(false);
    expect(wecomConfigSchema.safeParse({ ...config, transport: "callback" }).success).toBe(false);
    expect(wecomConfigSchema.safeParse({ ...config, secret: { ...config.secret, version: "latest" } }).success).toBe(false);
  });
  it("requires exact issued authentication request, errcode zero, then exact configured bot", () => {
    const s = new WecomSession("bot-a", "subscribe-issued");
    expect(s.accept({ cmd: "aibot_msg_callback", body: message })).toBe("ignored");
    expect(s.accept({ headers: { req_id: "subscribe-other" }, errcode: 0 })).toBe("ignored");
    expect(s.authenticated).toBe(false);
    expect(() => s.accept({ headers: { req_id: "subscribe-issued" }, errcode: 1 })).toThrow("authentication");
    expect(s.accept({ headers: { req_id: "subscribe-issued" }, errcode: 0 })).toBe("authenticated");
    expect(s.accept({ cmd: "aibot_msg_callback", body: { ...message, aibotid: "bot-b" } })).toBe("ignored");
    expect(s.accept({ cmd: "aibot_msg_callback", body: message })).toBe("message");
  });
  it("stops on displacement, ignores all other events without granting scope", () => {
    const s = new WecomSession("bot-a", "auth"); s.accept({ headers: { req_id: "auth" }, errcode: 0 });
    expect(s.accept({ cmd: "aibot_event_callback", body: { aibotid: "bot-a", event: { eventtype: "enter_chat" } } })).toBe("ignored");
    expect(() => s.accept({ cmd: "aibot_event_callback", body: { aibotid: "bot-a", event: { eventtype: "disconnected_event" } } })).toThrow("displaced");
  });
  it("projects only text, transcription and mixed text; drops quotes and credentials", () => {
    const projected = projectWecomMessage(config, { ...message, msgtype: "mixed", mixed: { msg_item: [
      { msgtype: "text", text: { content: "bug credential-secret" } }, { msgtype: "image", image: { url: "private-file", aeskey: "private-aes" } }] },
      response_url: "private-response", quote: { text: { content: "private-quote" } }, companyId: "foreign", product: "foreign" }, now, "credential-secret");
    expect(projected).toMatchObject({ product: "App", text: "bug [REDACTED]", sourceKind: "wecom_smart_bot" });
    expect(JSON.stringify(projected)).not.toMatch(/private-|foreign|credential-secret/);
    expect(projectWecomMessage(config, { ...message, msgtype: "voice", voice: { content: "Transcription" } }, now, "")?.text).toBe("Transcription");
    expect(projectWecomMessage(config, { ...message, msgtype: "image" }, now, "")).toBeNull();
  });
  it("enforces group/direct scopes and stable identities without keeping provider IDs", () => {
    expect(projectWecomMessage(config, { ...message, chatid: "other" }, now, "")).toBeNull();
    expect(projectWecomMessage(config, { ...message, chattype: "single" }, now, "")).toBeNull();
    const a = projectWecomMessage(config, message, now, "")!;
    const b = projectWecomMessage(config, { ...message, text: { content: "edited" } }, now, "")!;
    expect(a.externalId).toBe(b.externalId); expect(a.sourceInstance).toBe(b.sourceInstance);
    expect(a.externalId).not.toContain(message.msgid); expect(a.sourceInstance).not.toContain(config.botId);
  });
  it("rejects malformed, binary and oversized frames", () => {
    for (const raw of [Buffer.from("{"), Buffer.alloc(WECOM_MAX_FRAME_BYTES + 1)]) expect(() => parseWecomFrame(raw)).toThrow("protocol");
    expect(() => parseWecomFrame(Buffer.from("{}"), true)).toThrow("protocol");
  });
});
class FakeSocket extends EventEmitter {
  readyState = 1; sent: Record<string, any>[] = [];
  send(raw: string, cb?: (error?: Error) => void) { this.sent.push(JSON.parse(raw)); cb?.(); }
  terminate() { this.readyState = 3; this.emit("close"); }
  frame(frame: unknown) { this.emit("message", Buffer.from(JSON.stringify(frame)), false); }
}
function fixture() {
  const socket = new FakeSocket(), lease = { companyId: "company-a", id: "connection-a", token: "fence", config };
  const store = { acquire: vi.fn(async () => lease), renew: vi.fn(async () => true), release: vi.fn(async () => {}),
    resolveCredential: vi.fn(async () => "test-secret"), markGap: vi.fn(async () => true), markAuthenticated: vi.fn(async () => true), persist: vi.fn(async (_lease: unknown, _item: unknown, _signal?: AbortSignal, _credential?: string) => true) };
  const connect = vi.fn(() => socket as unknown as WebSocket);
  const controller = new AbortController();
  return { socket, store, connect, controller, start: (enabled = true) => runWecomReceiver({} as Db, lease.companyId, lease.id, controller.signal, { store, connect, workerEnabled: enabled }) };
}
async function tick() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
afterEach(() => vi.useRealTimers());
describe("WeCom bounded worker (fake transport only)", () => {
  it("never acquires or connects while the global gate is off", async () => {
    const f = fixture(); expect(await f.start(false)).toEqual({ stopped: "disabled" }); expect(f.store.acquire).not.toHaveBeenCalled(); expect(f.connect).not.toHaveBeenCalled();
  });
  it("does not ACK callbacks or reconnect after displacement", async () => {
    const f = fixture(), done = f.start(); await tick(); f.socket.emit("open");
    const req = f.socket.sent[0].headers.req_id;
    f.socket.frame({ cmd: "aibot_msg_callback", body: message }); expect(f.store.persist).not.toHaveBeenCalled();
    f.socket.frame({ headers: { req_id: req }, errcode: 0 });
    f.socket.frame({ cmd: "aibot_msg_callback", body: message }); await tick();
    expect(f.store.persist).toHaveBeenCalledTimes(1);
    f.socket.frame({ cmd: "aibot_event_callback", body: { aibotid: "bot-a", event: { eventtype: "disconnected_event" } } });
    expect(await done).toEqual({ stopped: "displaced" });
    expect(f.socket.sent.map(x => x.cmd)).toEqual(["aibot_subscribe"]); expect(f.connect).toHaveBeenCalledTimes(1);
  });
  it("cancels queued delivery and releases the fenced lease", async () => {
    const f = fixture(), done = f.start(); await tick(); f.controller.abort();
    expect(await done).toEqual({ stopped: "cancelled" }); expect(f.socket.readyState).toBe(3); expect(f.store.release).toHaveBeenCalledTimes(1);
  });
  it("rechecks revoked authorization before resolving a credential or opening a socket", async () => {
    const f = fixture(); f.store.renew.mockResolvedValue(false);
    expect(await f.start()).toEqual({ stopped: "revoked" }); expect(f.store.resolveCredential).not.toHaveBeenCalled(); expect(f.connect).not.toHaveBeenCalled();
  });
  it("rejects auth failure without retry", async () => {
    const f = fixture(), done = f.start(); await tick(); f.socket.emit("open");
    f.socket.frame({ headers: f.socket.sent[0].headers, errcode: 1 });
    expect(await done).toEqual({ stopped: "authentication" }); expect(f.connect).toHaveBeenCalledTimes(1);
  });
});

it("stops queue overflow without replying and aborts in-flight persistence", async () => {
  const f = fixture(); let release!: () => void;
  f.store.persist.mockImplementation(async () => { await new Promise<void>(resolve => { release = resolve; }); return true; });
  const done = f.start(); await tick(); f.socket.emit("open");
  f.socket.frame({ headers: f.socket.sent[0].headers, errcode: 0 });
  f.socket.frame({ cmd: "aibot_msg_callback", body: message }); await tick();
  for (let i = 0; i < 33; i++) f.socket.frame({ cmd: "aibot_msg_callback", body: { ...message, msgid: `event-${i}` } });
  expect(f.socket.readyState).toBe(3);
  expect(f.store.persist.mock.calls[0][2]?.aborted).toBe(true);
  release(); expect(await done).toEqual({ stopped: "overflow" });
  expect(f.store.persist).toHaveBeenCalledTimes(1); expect(f.socket.sent).toHaveLength(1);
});
it("caps reconnects per run and records gaps even before terminal exhaustion", async () => {
  vi.useFakeTimers(); const f = fixture();
  f.connect.mockImplementation(() => { throw Error("network unavailable"); });
  const done = f.start(); await tick();
  await vi.runAllTimersAsync();
  expect(await done).toEqual({ stopped: "budget_exhausted" });
  expect(f.connect).toHaveBeenCalledTimes(4); expect(f.store.markGap).toHaveBeenCalledTimes(4);
});

it("closes an active fake connection when company pause makes renewal fail", async () => {
  vi.useFakeTimers(); const f = fixture(), done = f.start(); await tick(); f.socket.emit("open");
  f.socket.frame({ headers: f.socket.sent[0].headers, errcode: 0 });
  f.store.renew.mockResolvedValue(false);
  await vi.advanceTimersByTimeAsync(5000);
  expect(await done).toEqual({ stopped: "revoked" }); expect(f.socket.readyState).toBe(3);
  expect(f.store.persist).not.toHaveBeenCalled(); expect(f.connect).toHaveBeenCalledTimes(1);
});
