// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { ids, record, capabilities } from "@/test/private-prompt-fixtures";
import { privatePromptTestsApi, privatePromptRecordSchema, privatePromptDetailSchema } from "./private-prompt-tests";
afterEach(() => vi.unstubAllGlobals());
const detail = () => ({ item: record(), privateResult: null, contentDisposition: "untrusted_inert_text" });
it("does not coalesce identical private detail URLs across sessions", async () => {
  const resolvers: Array<(value: Response) => void> = [];
  const fetcher = vi.fn(() => new Promise<Response>(resolve => resolvers.push(resolve))); vi.stubGlobal("fetch", fetcher);
  const first = privatePromptTestsApi(ids.company, new AbortController().signal).detail(ids.prompt, ids.test);
  const second = privatePromptTestsApi(ids.company, new AbortController().signal).detail(ids.prompt, ids.test);
  expect(fetcher).toHaveBeenCalledTimes(2);
  resolvers[1]!(new Response(JSON.stringify(detail()))); await second;
  resolvers[0]!(new Response(JSON.stringify(detail()))); await first;
  for (const call of fetcher.mock.calls as unknown as Array<[string, RequestInit]>) expect(call[1]).toMatchObject({ cache: "no-store", credentials: "include", method: "GET", signal: expect.any(AbortSignal) });
});
it("discards a late result after abort even when fetch ignores its signal", async () => {
  let finish!: (value: Response) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { finish = resolve; })));
  const controller = new AbortController(), pending = privatePromptTestsApi(ids.company, controller.signal).detail(ids.prompt, ids.test);
  controller.abort(); finish(new Response(JSON.stringify(detail()))); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
it("prepares without confirmations and uses separate execution and cancellation endpoints", async () => {
  const fetcher = vi.fn(async (url: string, _init: RequestInit) => new Response(JSON.stringify(url.endsWith("test-capabilities") ? capabilities : { item: record(), duplicate: false }))); vi.stubGlobal("fetch", fetcher);
  const api = privatePromptTestsApi(ids.company, new AbortController().signal);
  await api.capabilities();
  const body = { requestId: ids.request, revisionId: ids.revision, expectedHeadReceiptId: null, agentId: ids.ref, datasetId: ids.ref, caseId: ids.ref, skillVersionId: ids.ref, executionProfile: "claude_cli_bare_api_key_v1" } as const;
  await api.prepare(ids.prompt, body); await api.execute(ids.prompt, ids.test, { approvalDigest: "a".repeat(64), executionProfile: body.executionProfile, confirmRestrictedProfile: true, confirmExecution: true, confirmPossibleCharges: true }); await api.cancel(ids.prompt, ids.test, { approvalDigest: "a".repeat(64) });
  expect(fetcher.mock.calls[1]![1].body).toBe(JSON.stringify(body)); expect(fetcher.mock.calls[2]![0]).toContain(`/tests/${ids.test}/execute`); expect(fetcher.mock.calls[3]![0]).toContain(`/tests/${ids.test}/cancel`);
  for (const [, init] of fetcher.mock.calls) expect(init.cache).toBe("no-store");
});
it.each([{}, { item: {} }, { item: record({ status: "unrecognized" as never }), duplicate: false }])("rejects malformed 200 instead of acknowledging it", async response => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(response))));
  await expect(privatePromptTestsApi(ids.company, new AbortController().signal).cancel(ids.prompt, ids.test, { approvalDigest: "a".repeat(64) })).rejects.toThrow();
});

it.each(["missing", "date", "false-flag", "witness", "nested-id", "profile"])("rejects invalid required/nested %s shape", kind => {
  const row = record({ status: "completed" }) as unknown as Record<string, unknown>;
  if (kind === "missing") delete row.requestId;
  if (kind === "date") row.createdAt = "2026-10-26";
  if (kind === "false-flag") row.runtimeApplied = true;
  if (kind === "witness") row.prepared = null;
  if (kind === "nested-id") (row.prepared as Record<string, unknown>).testId = ids.ref;
  if (kind === "profile") row.executionProfile = "other";
  expect(() => privatePromptRecordSchema.parse(row)).toThrow();
});
it("rejects malformed or oversized private results and terminal result absence", () => {
  for (const privateResult of [undefined, null, { summary: 4, resultJson: {} }, { summary: "x".repeat(128001), resultJson: {} }]) expect(() => privatePromptDetailSchema.parse({ item: record({ status: "completed" }), privateResult, contentDisposition: "untrusted_inert_text" })).toThrow();
});
