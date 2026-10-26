import { createHash } from "node:crypto";
import { z } from "zod";
import { guardedRemoteHttpFetch } from "../remote-http-fetch.js";
import { prepareFeedbackImport } from "../mimouse-feedback.js";

const identity = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const secret = z.object({ secretId: z.string().uuid(), version: z.number().int().positive() }).strict();
export const langfuseConfigSchema = z.object({
  origin: z.string().max(300).url().refine(value => {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/";
  }, "A public HTTPS origin without credentials, path or query is required").transform(value => new URL(value).origin),
  projectId: identity, product: z.string().trim().min(1).max(120),
  from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }),
  publicKey: secret, secretKey: secret, api: z.literal("observations_v2"),
}).strict().refine(value => {
  const width = Date.parse(value.to) - Date.parse(value.from);
  return width > 0 && width <= 24 * 60 * 60 * 1000;
}, "Choose a fixed window of at most 24 hours");
export type LangfuseConfig = z.infer<typeof langfuseConfigSchema>;
export class LangfuseReadError extends Error {
  constructor(readonly code: "unsupported" | "authentication" | "rate_limited" | "provider_unavailable" | "invalid_response" | "cancelled" | "transport", readonly retryAfterSeconds?: number) {
    super(`Langfuse read failed: ${code}`);
  }
}
const observation = z.object({
  id: identity, traceId: identity, projectId: identity, startTime: z.string().datetime({ offset: true }),
  name: z.string().max(10000).nullable().optional(), statusMessage: z.string().max(64000).nullable().optional(),
  version: z.string().max(10000).nullable().optional(), release: z.string().max(10000).nullable().optional(),
  level: z.string().max(40).optional(),
});
const pageSchema = z.object({ data: z.array(observation).max(50), meta: z.object({ cursor: z.string().min(1).max(8192).nullable().optional() }) });
export type LangfuseTransport = (url: URL, init: RequestInit) => Promise<Response>;
const transport: LangfuseTransport = (url, init) => guardedRemoteHttpFetch(url, init, {
  allowPrivateNetwork: false, connectTimeoutMs: 5000, responseTimeoutMs: 15000,
  error: () => new LangfuseReadError("transport"),
});
async function boundedJson(response: Response, signal: AbortSignal) {
  if (!response.body) throw new LangfuseReadError("invalid_response");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 1024 * 1024) throw new LangfuseReadError("invalid_response");
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); }
}
/** Only read allowlisted observation fields. Never request input/output, metadata or raw logs. */
export async function readLangfusePage(config: LangfuseConfig, cursor: string | null,
  keys: { publicKey: string; secretKey: string }, signal?: AbortSignal, fetchPage: LangfuseTransport = transport) {
  config = langfuseConfigSchema.parse(config);
  const deadline = AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]);
  try {
    deadline.throwIfAborted();
    if (!keys.publicKey || !keys.secretKey || keys.publicKey.includes(":")) throw new LangfuseReadError("authentication");
    const url = new URL("/api/public/v2/observations", config.origin);
    url.search = new URLSearchParams({ fromStartTime: config.from, toStartTime: config.to, limit: "50", fields: "core,basic,trace_context", ...(cursor ? { cursor } : {}) }).toString();
    const response = await fetchPage(url, { method: "GET", redirect: "manual", signal: deadline,
      headers: { Authorization: `Basic ${Buffer.from(`${keys.publicKey}:${keys.secretKey}`).toString("base64")}`, Accept: "application/json" } });
    if (!response.ok) {
      await response.body?.cancel();
      const retry = Number(response.headers.get("retry-after"));
      throw new LangfuseReadError(response.status === 401 || response.status === 403 ? "authentication" :
        response.status === 404 || response.status === 405 || response.status === 410 ? "unsupported" :
        response.status === 429 ? "rate_limited" : "provider_unavailable",
        response.status === 429 && Number.isFinite(retry) && retry > 0 ? Math.min(Math.ceil(retry), 86400) : undefined);
    }
    const parsed = pageSchema.safeParse(await boundedJson(response, deadline));
    if (!parsed.success) throw new LangfuseReadError("invalid_response");
    const page = parsed.data;
    if (page.meta.cursor && (page.meta.cursor === cursor || !page.data.length)) throw new LangfuseReadError("invalid_response");
    const sourceInstance = `lf:${createHash("sha256").update(`${config.origin}/${config.projectId}`).digest("hex")}`;
    const cleanKnownSecrets = (value: string) => [keys.publicKey, keys.secretKey].reduce((text, key) => text.split(key).join("[REDACTED]"), value);
    const items = page.data.map(row => {
      if (row.projectId !== config.projectId || Date.parse(row.startTime) < Date.parse(config.from) || Date.parse(row.startTime) >= Date.parse(config.to)) throw new LangfuseReadError("invalid_response");
      if ([row.id, row.traceId, row.projectId].some(value => cleanKnownSecrets(value) !== value)) throw new LangfuseReadError("invalid_response");
      const sourceUrl = `${config.origin}/project/${encodeURIComponent(config.projectId)}/traces/${encodeURIComponent(row.traceId)}`;
      const input = prepareFeedbackImport({ sourceKind: "langfuse", sourceInstance, externalId: `${row.traceId.length}:${row.traceId}:${row.id}`,
        title: cleanKnownSecrets(row.name || "Langfuse observation").slice(0, 240),
        text: cleanKnownSecrets(row.statusMessage || `Observation ${row.id}; level ${row.level || "unknown"}. No input/output collected.`).slice(0, 32000),
        product: cleanKnownSecrets(config.product), softwareVersion: cleanKnownSecrets(row.version || "").slice(0, 120),
        commitSha: row.release && cleanKnownSecrets(row.release) === row.release && /^[a-f0-9]{40}$/.test(row.release) ? row.release : null, traceId: row.traceId, occurredAt: row.startTime });
      return { ...input, redacted: input.redacted || [row.name, row.statusMessage, row.version, config.product].some(value => typeof value === "string" && cleanKnownSecrets(value) !== value), ingestionMode: "provider_fetch" as const, sourceUrl };
    });
    deadline.throwIfAborted();
    return { items, cursor: page.meta.cursor ?? null };
  } catch (error) {
    if (deadline.aborted) throw new LangfuseReadError("cancelled");
    if (error instanceof LangfuseReadError) throw error;
    throw new LangfuseReadError("invalid_response");
  }
}
