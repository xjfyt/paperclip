// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { researchPrivateGet } from "./research-private";
afterEach(() => vi.unstubAllGlobals());
it("never coalesces private reads by URL across sessions", async () => {
  const complete: Array<(response: Response) => void> = [];
  const fetch = vi.fn((_url: string, _options: RequestInit) => new Promise<Response>(resolve => complete.push(resolve))); vi.stubGlobal("fetch", fetch);
  const old = researchPrivateGet("/companies/company/research-routines/routine/history");
  const fresh = researchPrivateGet("/companies/company/research-routines/routine/history");
  expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[0]?.[1]).toMatchObject({ cache: "no-store", credentials: "include" });
  complete[1](new Response(JSON.stringify({ owner: "new" }), { headers: { "Content-Type": "application/json" } }));
  complete[0](new Response(JSON.stringify({ owner: "old" }), { headers: { "Content-Type": "application/json" } }));
  expect(await fresh).toEqual({ owner: "new" }); expect(await old).toEqual({ owner: "old" });
});
