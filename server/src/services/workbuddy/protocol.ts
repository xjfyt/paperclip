export interface WorkBuddyToken { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token?: string; scope: string; open_id: string }
export interface WorkBuddyTask { task_id: string; status: string; name?: string; link?: string; token?: string; expire_at?: number }
export class WorkBuddyProtocolError extends Error {
  constructor(public readonly code: string, public readonly uncertain: boolean) { super(code); }
}
const API = "https://www.workbuddy.cn/openapi/v2";
export function authorizationUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL(`${API}/authorize`);
  url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "user.task.readable user.task.invokable", state }).toString();
  return url.href;
}
export function parseToken(value: unknown): WorkBuddyToken {
  const token = value as Partial<WorkBuddyToken> | null;
  if (!token || typeof token.access_token !== "string" || !token.access_token || token.token_type !== "Bearer" || !Number.isFinite(token.expires_in) || token.expires_in! <= 0 || typeof token.open_id !== "string" || typeof token.scope !== "string") throw new WorkBuddyProtocolError("invalid_token_response", true);
  return token as WorkBuddyToken;
}
export function parseTask(value: unknown): WorkBuddyTask {
  const task = value as Partial<WorkBuddyTask> | null;
  if (!task || typeof task.task_id !== "string" || !task.task_id || typeof task.status !== "string") throw new WorkBuddyProtocolError("invalid_task_response", true);
  return task as WorkBuddyTask;
}
export async function boundedJson(response: Response, max = 1048576): Promise<unknown> {
  const reader = response.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  if (reader) for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > max) { await reader.cancel(); throw new WorkBuddyProtocolError("response_too_large", true); } chunks.push(part.value); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new WorkBuddyProtocolError("invalid_json_response", true); }
}
export function workBuddyClient(transport: typeof fetch = fetch) {
  async function request(path: string, options: RequestInit, sideEffect: boolean) {
    let response: Response;
    try { response = await transport(`${API}${path}`, { ...options, redirect: "error", signal: AbortSignal.timeout(15000) }); }
    catch { throw new WorkBuddyProtocolError("transport_unconfirmed", sideEffect); }
    if (!response.ok) throw new WorkBuddyProtocolError(`http_${response.status}`, sideEffect && response.status >= 500);
    return boundedJson(response);
  }
  return {
    exchange: async (form: Record<string, string>) => parseToken(await request("/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) }, true)),
    create: async (accessToken: string, prompt: string, name?: string) => parseTask(await request("/tasks", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ prompt, ...(name ? { name } : {}) }) }, true)),
    get: async (accessToken: string, taskId: string) => parseTask(await request(`/tasks/${encodeURIComponent(taskId)}`, { headers: { authorization: `Bearer ${accessToken}` } }, false)),
  };
}
export function trustedAcpUrl(raw: string, allowedHosts: readonly string[] = ["acp.workbuddy.cn"]): URL {
  let url: URL; try { url = new URL(raw); } catch { throw new WorkBuddyProtocolError("invalid_acp_url", false); }
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || !allowedHosts.includes(url.hostname)) throw new WorkBuddyProtocolError("untrusted_acp_host", false);
  return url;
}

/** Stateful parser: handles fragmented UTF-8, CRLF, comments and multiline data. */
export class WorkBuddySseParser {
  private decoder = new TextDecoder(); private pending = ""; private data: string[] = [];
  push(chunk: Uint8Array): unknown[] {
    this.pending += this.decoder.decode(chunk, { stream: true });
    if (Buffer.byteLength(this.pending) + this.data.reduce((n, s) => n + Buffer.byteLength(s), 0) > 1048576) throw new WorkBuddyProtocolError("sse_frame_too_large", true);
    const messages: unknown[] = []; let newline: number;
    while ((newline = this.pending.indexOf("\n")) >= 0) {
      const line = this.pending.slice(0, newline).replace(/\r$/, ""); this.pending = this.pending.slice(newline + 1);
      if (line === "") {
        if (this.data.length) { try { messages.push(JSON.parse(this.data.join("\n"))); } catch { throw new WorkBuddyProtocolError("invalid_sse_json", true); } this.data = []; }
      } else if (line.startsWith("data:")) this.data.push(line.slice(5).replace(/^ /, ""));
    }
    return messages;
  }
}

export async function runWorkBuddyAcp(input: { link: string; token: string; taskId: string; prompt: string; allowedHosts?: string[]; signal?: AbortSignal; onText: (text: string) => Promise<void>; onPermissionDenied?: () => Promise<void>; beforePrompt: () => Promise<void> }, transport: typeof fetch = fetch) {
  const url = trustedAcpUrl(input.link, input.allowedHosts);
  const controller = new AbortController(); const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300000), ...(input.signal ? [input.signal] : [])]);
  const incoming = await transport(url, { headers: { authorization: `Bearer ${input.token}`, accept: "text/event-stream" }, redirect: "error", signal });
  const connectionId = incoming.headers.get("Acp-Connection-Id");
  if (!incoming.ok || !connectionId || !incoming.body) { controller.abort(); throw new WorkBuddyProtocolError("acp_connection_failed", false); }
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  let nextId = 1; let terminalError: Error | null = null; let permissionDenied = false;
  async function post(message: unknown) {
    const response = await transport(url, { method: "POST", headers: { authorization: `Bearer ${input.token}`, "content-type": "application/json", "Acp-Connection-Id": connectionId! }, body: JSON.stringify(message), redirect: "error", signal });
    if (!response.ok) throw new WorkBuddyProtocolError(`acp_post_${response.status}`, true);
    await response.body?.cancel();
  }
  function rpc(method: string, params: unknown): Promise<Record<string, unknown>> {
    if (terminalError) return Promise.reject(terminalError);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      void post({ jsonrpc: "2.0", id, method, params }).catch(error => { pending.delete(id); reject(error); });
    });
  }
  const reader = incoming.body.getReader(); const parser = new WorkBuddySseParser();
  const reading = (async () => {
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) throw new WorkBuddyProtocolError("acp_stream_disconnected", true);
        bytes += chunk.value.byteLength; if (bytes > 8 * 1024 * 1024) throw new WorkBuddyProtocolError("acp_stream_budget_exceeded", true);
        for (const item of parser.push(chunk.value)) {
          const message = item as { jsonrpc?: string; id?: number | string; method?: string; params?: Record<string, any>; result?: Record<string, unknown>; error?: unknown };
          if (message.jsonrpc !== "2.0") throw new WorkBuddyProtocolError("invalid_rpc_envelope", true);
          if (message.method === "session/request_permission" && message.id !== undefined) {
            permissionDenied = true;
            await post({ jsonrpc: "2.0", id: message.id, result: { outcome: { outcome: "cancelled" } } });
            await input.onPermissionDenied?.();
          } else if (message.method && message.id !== undefined) {
            await post({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Client capability unavailable" } });
          } else if (!message.method && typeof message.id === "number" && pending.has(message.id)) {
            const waiting = pending.get(message.id)!; pending.delete(message.id);
            if (message.error || !message.result) waiting.reject(new WorkBuddyProtocolError("acp_rpc_error", true)); else waiting.resolve(message.result);
          } else if (message.method === "session/update" && message.params?.sessionId === input.taskId && message.params.update?.sessionUpdate === "agent_message_chunk") {
            const content = message.params.update.content;
            if (content?.type === "text" && typeof content.text === "string") await input.onText(content.text);
          }
        }
      }
    } catch (error) {
      terminalError = error instanceof WorkBuddyProtocolError ? error : new WorkBuddyProtocolError("acp_stream_unconfirmed", true);
      for (const waiting of pending.values()) waiting.reject(terminalError); pending.clear();
    }
  })();
  try {
    await rpc("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } });
    await rpc("session/load", { sessionId: input.taskId, cwd: "/workspace", mcpServers: [] });
    // Persist prompt dispatch BEFORE its side effect; a crash never repeats it.
    await input.beforePrompt();
    const result = await rpc("session/prompt", { sessionId: input.taskId, prompt: [{ type: "text", text: input.prompt }] });
    return { stopReason: typeof result.stopReason === "string" ? result.stopReason : "unknown", permissionDenied, businessCompleted: false as const };
  } finally { controller.abort(); await reader.cancel().catch(() => {}); await reading; }
}
