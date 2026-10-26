// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { wecomApi } from "./wecom";
afterEach(() => vi.unstubAllGlobals());
it("retained old observer cannot coalesce with a new session's same-URL read", async () => {
  let old!: (response: Response) => void, current!: (response: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockImplementationOnce(() => new Promise(resolve => { current = resolve; })); vi.stubGlobal("fetch", fetcher);
  const first = wecomApi("company", new AbortController().signal).list(), second = wecomApi("company", new AbortController().signal).list();
  expect(fetcher).toHaveBeenCalledTimes(2); current(new Response('[{"id":"new"}]')); expect((await second)[0]!.id).toBe("new");
  old(new Response('[{"id":"old"}]')); expect((await first)[0]!.id).toBe("old");
  for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({ cache: "no-store", credentials: "include", signal: expect.any(AbortSignal), method: "GET" });
});
it("projects only active undeleted company metadata and pins numeric versions, never reads values", async () => {
  const valid = { id: "active", companyId: "company", scope: "company", status: "active", deletedAt: null, latestVersion: 7, name: "Credential", externalRef: "not-for-ui", providerMetadata: { private: true } };
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify([valid, { ...valid, id: "foreign", companyId: "other" }, { ...valid, id: "user", scope: "user" }, { ...valid, id: "revoked", status: "revoked" }, { ...valid, id: "deleted", deletedAt: "today" }, { ...valid, id: "latest", latestVersion: "latest" }]))); vi.stubGlobal("fetch", fetcher);
  expect(await wecomApi("company", new AbortController().signal).secrets()).toEqual([{ id: "active", name: "Credential", version: 7 }]);
  expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0]![0]).toBe("/api/companies/company/secrets"); expect(fetcher.mock.calls[0]![1]).toMatchObject({ cache: "no-store", method: "GET" });
});
it("drops late responses after abort even when fetch ignores cancellation", async () => {
  let finish!: (response: Response) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { finish = resolve; })));
  const controller = new AbortController(), promise = wecomApi("company", controller.signal).secrets(); controller.abort(); finish(new Response("[]"));
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
});
it("makes only one POST on uncertain creation; no retry or invented detail/config endpoint", async () => {
  const fetcher = vi.fn().mockRejectedValue(Error("unknown response")); vi.stubGlobal("fetch", fetcher);
  await expect(wecomApi("company", new AbortController().signal).register({ transport: "long_connection", botId: "bot", product: "Product", allowedGroupIds: ["group"], allowedDirectSenderIds: [], secret: { secretId: "id", version: 2 } })).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1); expect(JSON.parse(fetcher.mock.calls[0]![1].body)).not.toHaveProperty("enabled");
});
it("secret metadata also keeps old and new session observers on independent fetches", async () => {
  let old!: (response: Response) => void, fresh!: (response: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockImplementationOnce(() => new Promise(resolve => { fresh = resolve; })); vi.stubGlobal("fetch", fetcher);
  const a = wecomApi("company", new AbortController().signal).secrets(), b = wecomApi("company", new AbortController().signal).secrets();
  expect(fetcher).toHaveBeenCalledTimes(2);
  const metadata = (name: string) => new Response(JSON.stringify([{ id: name, companyId: "company", scope: "company", status: "active", deletedAt: null, latestVersion: 1, name }]));
  fresh(metadata("new-session")); expect((await b)[0]!.name).toBe("new-session"); old(metadata("old-session")); expect((await a)[0]!.name).toBe("old-session");
  for (const [url, init] of fetcher.mock.calls) { expect(url).toBe("/api/companies/company/secrets"); expect(init).toMatchObject({ cache: "no-store", method: "GET", signal: expect.any(AbortSignal) }); }
});
