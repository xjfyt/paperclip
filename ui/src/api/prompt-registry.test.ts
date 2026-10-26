// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { promptRegistryApi } from "./prompt-registry";
afterEach(() => vi.unstubAllGlobals());
it("keeps an old observer and a new session on separate actual HTTP requests", async () => {
  let old!: (value: Response) => void, fresh!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockImplementationOnce(() => new Promise(resolve => { fresh = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  const first = promptRegistryApi("company", new AbortController().signal).list();
  const second = promptRegistryApi("company", new AbortController().signal).list();
  expect(fetcher).toHaveBeenCalledTimes(2);
  fresh(new Response(JSON.stringify({ items: [{ id: "new-session" }], nextBeforeId: null })));
  expect((await second).items[0]!.id).toBe("new-session");
  old(new Response(JSON.stringify({ items: [{ id: "old-session" }], nextBeforeId: null })));
  expect((await first).items[0]!.id).toBe("old-session");
  for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({ method: "GET", credentials: "include", cache: "no-store", signal: expect.any(AbortSignal) });
});
it("discards a late sensitive response after abort even if transport ignores abort", async () => {
  let complete!: (response: Response) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { complete = resolve; })));
  const controller = new AbortController(), result = promptRegistryApi("company", controller.signal).content("prompt", "revision");
  controller.abort(); complete(new Response(JSON.stringify({ content: "private" })));
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
});
it("every history/detail/pagination request bypasses URL coalescing with no-store", async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ items: [], nextBeforeId: null }))); vi.stubGlobal("fetch", fetcher);
  const api = promptRegistryApi("company", new AbortController().signal);
  await Promise.all([api.list("cursor"), api.revisions("p", "cursor"), api.receipts("p", "cursor"), api.content("p", "r")]);
  expect(fetcher).toHaveBeenCalledTimes(4);
  for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({ cache: "no-store", method: "GET" });
});
