import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import type { Db } from "@paperclipai/db";
import type { FeedbackImportInput } from "@paperclipai/shared";
import { wecomFeedbackService, type WecomLease } from "../mimouse-wecom.js";
import { WECOM_ENDPOINT, WECOM_MAX_FRAME_BYTES, WecomReceiveError, WecomSession,
  parseWecomFrame, projectWecomMessage, type WecomStopReason } from "./protocol.js";

const MAX_QUEUE = 32;
const MAX_RECONNECTS = 3;
type Store = Pick<ReturnType<typeof wecomFeedbackService>, "acquire" | "renew" | "release" | "resolveCredential" | "persist" | "markGap" | "markAuthenticated">;
/** Test injection is never exposed to HTTP routes. No SDK raw-payload logging. */
export type WecomReceiverDependencies = {
  store: Store;
  connect: () => WebSocket;
  workerEnabled: boolean;
};
const connect = () => new WebSocket(WECOM_ENDPOINT, {
  rejectUnauthorized: true, followRedirects: false, maxPayload: WECOM_MAX_FRAME_BYTES,
  handshakeTimeout: 10000, perMessageDeflate: false,
});
const asBuffer = (raw: RawData) => Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

/** One bounded operator-enabled run. No process startup side effects or automatic supervisor. */
export async function runWecomReceiver(db: Db, companyId: string, id: string, signal: AbortSignal,
  testOnly?: WecomReceiverDependencies): Promise<{ stopped: WecomStopReason | "disabled" }> {
  const enabled = testOnly?.workerEnabled ?? process.env.MIMOUSE_WECOM_WORKER_ENABLED === "true";
  if (!enabled || signal.aborted) return { stopped: signal.aborted ? "cancelled" : "disabled" };
  const store = testOnly?.store ?? wecomFeedbackService(db);
  const lease = await store.acquire(companyId, id);
  if (!lease) return { stopped: "disabled" };
  let reason: WecomStopReason = "transport";
  try {
    for (let attempt = 0; attempt <= MAX_RECONNECTS; attempt++) {
      signal.throwIfAborted();
      if (!await store.renew(lease)) throw new WecomReceiveError("revoked");
      const credential = await store.resolveCredential(lease);
      if (!credential.trim()) throw new WecomReceiveError("authentication");
      signal.throwIfAborted();
      if (!await store.renew(lease)) throw new WecomReceiveError("revoked");
      reason = await receiveConnection(lease, credential, store, testOnly?.connect ?? connect, signal);
      if (reason !== "transport") break;
      if (!await store.markGap(lease)) throw new WecomReceiveError("revoked");
      if (attempt === MAX_RECONNECTS) { reason = "budget_exhausted"; break; }
      // No reset on successful authentication: retry budgets are per explicit run.
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, 1000 * 2 ** attempt);
        signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      });
    }
  } catch (error) {
    reason = signal.aborted ? "cancelled" : error instanceof WecomReceiveError ? error.code : "revoked";
  } finally {
    // Fail-closed: release also disables the saved configuration. Explicit re-enable
    // is required after every terminal stop; another supervisor cannot reconnect-war.
    await store.release(lease, reason);
  }
  return { stopped: reason };
}

async function receiveConnection(lease: WecomLease, credential: string, store: Store,
  openSocket: () => WebSocket, signal: AbortSignal): Promise<WecomStopReason> {
  return new Promise(resolve => {
    const controller = new AbortController();
    const session = new WecomSession(lease.config.botId, `aibot_subscribe:${randomUUID()}`);
    let socket: WebSocket;
    let stopped: WecomStopReason | null = null;
    let processing = false, checking = false;
    let pendingPing: string | null = null;
    const queue: FeedbackImportInput[] = [];
    let drain: Promise<void> = Promise.resolve();
    const finish = (reason: WecomStopReason) => {
      if (stopped) return;
      stopped = reason; controller.abort(); queue.length = 0;
      clearTimeout(authTimeout); clearInterval(heartbeat); clearInterval(renewal);
      signal.removeEventListener("abort", cancel);
      socket?.terminate();
      // Never release ownership until the pending persistence transaction has exited.
      void drain.finally(() => resolve(reason));
    };
    const cancel = () => finish("cancelled");
    const authTimeout = setTimeout(() => finish("authentication"), 10000);
    const send = (value: unknown) => {
      if (stopped || socket.readyState !== WebSocket.OPEN) return;
      try { socket.send(JSON.stringify(value), error => { if (error) finish("transport"); }); }
      catch { finish("transport"); }
    };
    const heartbeat = setInterval(() => {
      if (!session.authenticated || stopped) return;
      if (pendingPing) { finish("transport"); return; }
      pendingPing = `ping:${randomUUID()}`;
      send({ cmd: "ping", headers: { req_id: pendingPing } });
    }, 20000);
    const renewal = setInterval(() => {
      if (checking || stopped) return;
      checking = true;
      void store.renew(lease).then(ok => { if (!ok) finish("revoked"); }, () => finish("revoked"))
        .finally(() => { checking = false; });
    }, 5000);
    const consume = () => {
      if (processing || stopped) return;
      processing = true;
      drain = (async () => {
        while (!stopped && queue.length) {
          const item = queue.shift()!;
          controller.signal.throwIfAborted();
          if (!await store.renew(lease)) { finish("revoked"); return; }
          controller.signal.throwIfAborted();
          await store.persist(lease, item, controller.signal, credential);
        }
      })().catch(() => { if (!stopped) finish("revoked"); }).finally(() => { processing = false; });
    };
    try { socket = openSocket(); }
    catch { finish("transport"); return; }
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    socket.on("open", () => {
      if (stopped) return;
      send({ cmd: "aibot_subscribe", headers: { req_id: session.authRequestId },
        body: { bot_id: lease.config.botId, secret: credential } });
    });
    socket.on("message", (raw: RawData, binary: boolean) => {
      if (stopped) return;
      try {
        const frame = parseWecomFrame(asBuffer(raw), binary);
        if (!frame.cmd && pendingPing && frame.headers?.req_id === pendingPing && frame.errcode === 0) pendingPing = null;
        const action = session.accept(frame);
        if (action === "authenticated") {
          clearTimeout(authTimeout);
          void store.markAuthenticated(lease).then(ok => { if (!ok) finish("revoked"); }, () => finish("revoked"));
          return;
        }
        if (action !== "message") return;
        const item = projectWecomMessage(lease.config, frame.body, new Date(), credential);
        if (!item) return;
        if (queue.length >= MAX_QUEUE) { finish("overflow"); return; }
        queue.push(item); consume();
      } catch (error) { finish(error instanceof WecomReceiveError ? error.code : "protocol"); }
    });
    socket.on("error", () => finish("transport"));
    socket.on("close", () => finish("transport"));
  });
}
