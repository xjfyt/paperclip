// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { privatePromptTestsApi } from "./private-prompt-tests";
afterEach(() => vi.unstubAllGlobals());
it("does not coalesce identical private detail URLs across sessions", async () => {
  const resolvers: Array<(value: Response) => void> = [];
  const fetcher = vi.fn(() => new Promise<Response>(resolve => resolvers.push(resolve))); vi.stubGlobal("fetch", fetcher);
  const first = privatePromptTestsApi("company", new AbortController().signal).detail("prompt", "test");
  const second = privatePromptTestsApi("company", new AbortController().signal).detail("prompt", "test");
  expect(fetcher).toHaveBeenCalledTimes(2);
  resolvers[1]!(new Response(JSON.stringify({ privateResult: "new" }))); expect(await second).toEqual({ privateResult: "new" });
  resolvers[0]!(new Response(JSON.stringify({ privateResult: "old" }))); expect(await first).toEqual({ privateResult: "old" });
  for (const call of fetcher.mock.calls as unknown as Array<[string, RequestInit]>) expect(call[1]).toMatchObject({ cache: "no-store", credentials: "include", method: "GET", signal: expect.any(AbortSignal) });
});
it("discards a late result after abort even when fetch ignores its signal", async () => {
  let finish!: (value: Response) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { finish = resolve; })));
  const controller = new AbortController(), pending = privatePromptTestsApi("company", controller.signal).detail("prompt", "test");
  controller.abort(); finish(new Response(JSON.stringify({ privateResult: "secret" })));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
it("uses no-store for every path and posts only explicit references and confirmation", async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}")); vi.stubGlobal("fetch", fetcher);
  const api = privatePromptTestsApi("c/1", new AbortController().signal);
  await api.capabilities(); await api.list("p/1", "cursor/1"); await api.detail("p/1", "t/1");
  const body = { requestId: "r", revisionId: "v", expectedHeadReceiptId: null, agentId: "a", datasetId: "d", caseId: "c", skillVersionId: "s", executionProfile: "claude_cli_bare_api_key_v1", confirmRestrictedProfile: true, confirmExecution: true, confirmPossibleCharges: true } as const;
  await api.create("p/1", body);
  expect(fetcher.mock.calls[1]![0]).toContain("/c%2F1/prompt-registry/p%2F1/tests?beforeId=cursor%2F1");
  expect(fetcher.mock.calls[3]![1]).toMatchObject({ method: "POST", body: JSON.stringify(body), cache: "no-store" });
  for (const [, init] of fetcher.mock.calls) expect(init.cache).toBe("no-store");
});
