import { describe, expect, it, vi } from "vitest";
import { langfuseConfigSchema, readLangfusePage, type LangfuseConfig } from "../services/mimouse-langfuse/protocol.js";
const config: LangfuseConfig = { origin: "https://cloud.langfuse.com", projectId: "project-1", product: "test-product",
  from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z", api: "observations_v2",
  publicKey: { secretId: "00000000-0000-4000-8000-000000000001", version: 1 },
  secretKey: { secretId: "00000000-0000-4000-8000-000000000002", version: 2 } };
const keys = { publicKey: "pk-fixture", secretKey: "sk-fixture-only" };
const row = { id: "observation-1", traceId: "trace-1", projectId: "project-1", startTime: "2026-10-01T12:00:00Z", name: "Problem", statusMessage: "email test@example.com password=private", version: "v2", release: "a".repeat(40) };
const response = (data = [row], cursor: string | null = null) => new Response(JSON.stringify({ data, meta: { cursor } }));
describe("Langfuse bounded read-only observations v2", () => {
  it("uses GET basic auth and fixed fields, preserves exact identities and redacts before persistence", async () => {
    const fetcher = vi.fn(async () => response());
    const page = await readLangfusePage(config, null, keys, undefined, fetcher);
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/public/v2/observations");
    expect(url.searchParams.get("fields")).toBe("core,basic,trace_context");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("toStartTime")).toBe(config.to);
    expect(init.method).toBe("GET"); expect(init.redirect).toBe("manual");
    expect(init.headers).toMatchObject({ Authorization: `Basic ${Buffer.from(`${keys.publicKey}:${keys.secretKey}`).toString("base64")}` });
    expect(page.items[0]).toMatchObject({ externalId: "7:trace-1:observation-1", traceId: "trace-1", ingestionMode: "provider_fetch", softwareVersion: "v2", commitSha: "a".repeat(40), redacted: true });
    expect(page.items[0].body).not.toContain("test@example.com"); expect(page.items[0].body).not.toContain("private");
    expect(page.items[0].sourceUrl).toBe("https://cloud.langfuse.com/project/project-1/traces/trace-1");
  });
  it("keeps composite source identities collision-free", async () => {
    const first = await readLangfusePage(config, null, keys, undefined, async () => response([{ ...row, traceId: "a:b", id: "c" }]));
    const second = await readLangfusePage(config, null, keys, undefined, async () => response([{ ...row, traceId: "a", id: "b:c" }]));
    expect(first.items[0].externalId).not.toBe(second.items[0].externalId);
  });
  it("returns and resumes opaque cursors with identical bounds", async () => {
    const fetcher = vi.fn(async () => response([row], "next/cursor="));
    expect((await readLangfusePage(config, null, keys, undefined, fetcher)).cursor).toBe("next/cursor=");
    const next = vi.fn(async () => response([], null));
    expect((await readLangfusePage(config, "next/cursor=", keys, undefined, next)).cursor).toBeNull();
    const [url] = next.mock.calls[0] as unknown as [URL];
    expect(url.searchParams.get("cursor")).toBe("next/cursor=");
    expect(url.searchParams.get("fromStartTime")).toBe(config.from);
  });
  it.each([401, 403, 404, 405, 410, 429, 302, 500])("fails closed for HTTP %s without echoing provider body", async status => {
    const code = [401, 403].includes(status) ? "authentication" : [404, 405, 410].includes(status) ? "unsupported" : status === 429 ? "rate_limited" : "provider_unavailable";
    await expect(readLangfusePage(config, null, keys, undefined, async () => new Response("private upstream body", { status, headers: { "retry-after": "12" } }))).rejects.toMatchObject({ code, message: `Langfuse read failed: ${code}` });
  });
  it.each([
    { ...row, projectId: "other-company" }, { ...row, startTime: config.to },
    { ...row, id: "unsafe/id" }, { ...row, traceId: "" },
  ])("rejects wrong project/time/identity rather than silently skipping", async invalid => {
    await expect(readLangfusePage(config, null, keys, undefined, async () => response([invalid]))).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("rejects repeated cursor and empty continuing page", async () => {
    await expect(readLangfusePage(config, "same", keys, undefined, async () => response([row], "same"))).rejects.toMatchObject({ code: "invalid_response" });
    await expect(readLangfusePage(config, null, keys, undefined, async () => response([], "next"))).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("fails malformed or oversized payloads and does not preserve unknown fields", async () => {
    await expect(readLangfusePage(config, null, keys, undefined, async () => new Response("x".repeat(1024 * 1024 + 1)))).rejects.toMatchObject({ code: "invalid_response" });
    await expect(readLangfusePage(config, null, keys, undefined, async () => new Response("{}"))).rejects.toMatchObject({ code: "invalid_response" });
    const result = await readLangfusePage(config, null, keys, undefined, async () => response([{ ...row, input: "NEVER-PERSIST", metadata: { customer: "NEVER-PERSIST" } } as typeof row]));
    expect(JSON.stringify(result)).not.toContain("NEVER-PERSIST");
  });
  it("redacts known credentials even outside assignment syntax", async () => {
    const result = await readLangfusePage(config, null, keys, undefined, async () => response([{ ...row, statusMessage: `${keys.publicKey} ${keys.secretKey}` }]));
    expect(JSON.stringify(result)).not.toContain(keys.publicKey); expect(JSON.stringify(result)).not.toContain(keys.secretKey);
  });
  it("cancels before network and while streaming", async () => {
    const abort = new AbortController(); abort.abort(); const fetcher = vi.fn();
    await expect(readLangfusePage(config, null, keys, abort.signal, fetcher)).rejects.toMatchObject({ code: "cancelled" }); expect(fetcher).not.toHaveBeenCalled();
    const during = new AbortController();
    const body = new ReadableStream({ start() { queueMicrotask(() => during.abort()); } });
    await expect(readLangfusePage(config, null, keys, during.signal, async () => new Response(body))).rejects.toMatchObject({ code: "cancelled" });
  });
  it("rejects credentials in origins, plaintext and unbounded windows", () => {
    for (const origin of ["http://cloud.langfuse.com", "https://user:secret@cloud.langfuse.com", "https://cloud.langfuse.com?token=secret", "https://cloud.langfuse.com/path"]) expect(langfuseConfigSchema.safeParse({ ...config, origin }).success).toBe(false);
    expect(langfuseConfigSchema.safeParse({ ...config, to: "2026-10-03T00:00:00Z" }).success).toBe(false);
    expect(langfuseConfigSchema.safeParse({ ...config, publicKey: { ...config.publicKey, version: "latest" } }).success).toBe(false);
  });
});
