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
  if (!token || typeof token.access_token !== "string" || !token.access_token || token.access_token.length > 65536 || token.token_type !== "Bearer" || !Number.isSafeInteger(token.expires_in) || token.expires_in! <= 0 || typeof token.open_id !== "string" || !token.open_id.trim() || token.open_id.length > 512 || typeof token.scope !== "string" || token.scope.length > 4096 || (token.refresh_token !== undefined && (typeof token.refresh_token !== "string" || !token.refresh_token || token.refresh_token.length > 65536)) || !Number.isFinite(new Date(Date.now() + token.expires_in! * 1000).getTime())) throw new WorkBuddyProtocolError("invalid_token_response", true);
  return token as WorkBuddyToken;
}
export function parseTask(value: unknown): WorkBuddyTask {
  const task = value as Partial<WorkBuddyTask> | null;
  if (!task || typeof task.task_id !== "string" || !task.task_id || task.task_id.length > 200 || typeof task.status !== "string" || !task.status || task.status.length > 100 || (task.link !== undefined && task.link !== null && (typeof task.link !== "string" || task.link.length > 4096)) || (task.token !== undefined && task.token !== null && (typeof task.token !== "string" || task.token.length > 65536))) throw new WorkBuddyProtocolError("invalid_task_response", true);
  return { task_id: task.task_id, status: task.status, ...(typeof task.link === "string" ? { link: task.link } : {}), ...(typeof task.token === "string" ? { token: task.token } : {}), ...(typeof task.name === "string" ? { name: task.name.slice(0, 500) } : {}), ...(typeof task.expire_at === "number" ? { expire_at: task.expire_at } : {}) };
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

/** Read-only recovery of the provider's overview artifact. A documented /acp
 * sandbox URL is required; gateway session URLs are not guessed into hosts. */
export async function fetchWorkBuddyReport(input: { link: string; token: string; taskId: string; allowedHosts?: string[] }, transport: typeof fetch = fetch) {
  const acp = trustedAcpUrl(input.link, input.allowedHosts);
  if (acp.pathname !== "/acp" || acp.search) throw new WorkBuddyProtocolError("artifact_endpoint_unverified", false);
  const records = new Map<string, { text: string; updatedAt: number }>();
  for (let page = 0; page < 10; page++) {
    const url = new URL("/api/session/artifacts", acp.origin);
    url.search = new URLSearchParams({ sessionId: input.taskId, type: "overview", limit: "100", offset: String(page * 100) }).toString();
    let response: Response;
    try { response = await transport(url, { headers: { authorization: `Bearer ${input.token}` }, redirect: "error", signal: AbortSignal.timeout(15000) }); }
    catch { throw new WorkBuddyProtocolError("artifact_read_failed", false); }
    if (!response.ok) throw new WorkBuddyProtocolError(`artifact_http_${response.status}`, false);
    const payload = await boundedJson(response) as { code?: number; data?: { sessionId?: string; artifacts?: Array<{ sessionId?: string; event?: string; artifact?: { type?: string; uri?: string; text?: string; updatedAt?: number } }>; pagination?: { hasMore?: boolean } } };
    if (payload.code !== 0 || payload.data?.sessionId !== input.taskId || !Array.isArray(payload.data.artifacts) || payload.data.artifacts.length > 100) throw new WorkBuddyProtocolError("artifact_identity_or_receipt_invalid", false);
    for (const entry of payload.data.artifacts) {
      const artifact = entry.artifact;
      if (entry.sessionId !== input.taskId || artifact?.type !== "overview" || typeof artifact.uri !== "string" || !/^agent:\/\/\/[A-Za-z0-9_./-]{1,500}$/.test(artifact.uri) || artifact.uri.includes("..")) throw new WorkBuddyProtocolError("artifact_identity_or_receipt_invalid", false);
      if (entry.event === "deleted") { records.delete(artifact.uri); continue; }
      if (!["created", "updated"].includes(entry.event ?? "") || typeof artifact.text !== "string" || Buffer.byteLength(artifact.text) > 1048576) throw new WorkBuddyProtocolError("artifact_content_invalid", false);
      records.set(artifact.uri, { text: artifact.text.split(input.token).join("[REDACTED]"), updatedAt: Number.isFinite(artifact.updatedAt) ? artifact.updatedAt! : 0 });
    }
    if (typeof payload.data.pagination?.hasMore !== "boolean") throw new WorkBuddyProtocolError("artifact_pagination_unverified", false);
    if (!payload.data.pagination.hasMore) {
      const ordered = [...records.entries()].sort((a, b) => b[1].updatedAt - a[1].updatedAt);
      return { report: ordered[0]?.[1].text ?? "", artifactRefs: ordered.map(([uri]) => uri) };
    }
  }
  throw new WorkBuddyProtocolError("artifact_pagination_budget_exceeded", false);
}
