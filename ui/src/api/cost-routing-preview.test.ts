import { afterEach, expect, it, vi } from "vitest";
import { api } from "./client";
import { costRoutingPreviewApi } from "./cost-routing-preview";
const response = (value: unknown) => ({ ok: true, status: 200, json: async () => value }) as Response;
afterEach(() => { vi.unstubAllGlobals(); });
it("new identity reads cannot join an old-session URL-coalesced request kept alive by another observer", async () => {
  let finishOld!: (value: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValueOnce(response({ revision: 2, policy: { owner: "new-session" } }));
  vi.stubGlobal("fetch", fetch);
  const path = "/companies/company-a/cost-routing/policy";
  const retainedOldObserver = api.get(path);
  const removedObserver = new AbortController();
  const oldPage = api.get(path, { signal: removedObserver.signal });
  const oldPageFailure = expect(oldPage).rejects.toMatchObject({ name: "AbortError" });
  removedObserver.abort(); await oldPageFailure;
  // Browser identity has changed; React Query starts the new scope's read.
  const current = await costRoutingPreviewApi.current("company-a");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(current).toMatchObject({ policy: { owner: "new-session" } });
  expect(fetch.mock.calls[1]![1]).toMatchObject({ method: "GET", credentials: "include", cache: "no-store" });
  finishOld(response({ revision: 1, policy: { owner: "old-session-secret" } }));
  await expect(retainedOldObserver).resolves.toMatchObject({ policy: { owner: "old-session-secret" } });
  expect(JSON.stringify(current)).not.toContain("old-session-secret");
});
it("each private current-policy read owns its fetch and abort signal", async () => {
  const fetch = vi.fn().mockResolvedValue(response(null)); vi.stubGlobal("fetch", fetch);
  const first = new AbortController(), second = new AbortController();
  await Promise.all([costRoutingPreviewApi.current("company-b", first.signal), costRoutingPreviewApi.current("company-b", second.signal)]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0]![1].signal).toBe(first.signal); expect(fetch.mock.calls[1]![1].signal).toBe(second.signal);
});
