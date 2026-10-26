// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { privateFeedbackGet } from "./private-feedback";
afterEach(() => vi.unstubAllGlobals());
it("keeps same-URL old and new session observers independent", async () => {
  let old!: (value: Response) => void, fresh!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockImplementationOnce(() => new Promise(resolve => { fresh = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  const path = "/companies/company/feedback-inbox";
  const first = privateFeedbackGet(path, new AbortController().signal), second = privateFeedbackGet(path, new AbortController().signal);
  expect(fetcher).toHaveBeenCalledTimes(2);
  fresh(new Response('{"session":"new"}')); expect(await second).toEqual({ session: "new" });
  old(new Response('{"session":"old"}')); expect(await first).toEqual({ session: "old" });
  for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({ method: "GET", cache: "no-store", credentials: "include", signal: expect.any(AbortSignal) });
});
it("rejects late response even when fetch ignores abort", async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { finish = resolve; })));
  const controller = new AbortController(), pending = privateFeedbackGet("/companies/company/feedback-inbox", controller.signal);
  controller.abort(); finish(new Response('{"private":"old"}'));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
