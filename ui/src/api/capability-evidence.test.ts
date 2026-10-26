import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { capabilityEvidenceApi } from "./capability-evidence";
import { api, ApiError } from "./client";
import { ApiUnavailableError } from "./response";

const path = "/companies/company/capability-evidence?afterRevision=0";
const fetchMock = vi.fn();
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("does not join an old-session GET retained by a second observer after identity transition", async () => {
  const old = deferred(), fresh = deferred();
  fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const oldComponent = new AbortController();
  const removedObserver = api.get(path, { signal: oldComponent.signal, cache: "no-store" });
  const retainedObserver = api.get(path, { cache: "no-store" });
  const removedResult = expect(removedObserver).rejects.toMatchObject({ name: "AbortError" });
  oldComponent.abort(); await removedResult;
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
  // Model the next identity's query using the real capability API transport.
  const nextIdentity = new AbortController();
  const next = capabilityEvidenceApi.list("company", 0, nextIdentity.signal);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1]).toEqual([`/api${path}`, expect.objectContaining({
    method: "GET", credentials: "include", cache: "no-store", signal: nextIdentity.signal,
  })]);
  fresh.resolve(response({ events: [], nextRevision: null }));
  await expect(next).resolves.toEqual({ events: [], nextRevision: null });
  old.resolve(response({ events: [{ reviewerId: "private-old-reviewer", accountAlias: "private-old-account" }], nextRevision: null }));
  expect(await retainedObserver).toMatchObject({ events: [{ reviewerId: "private-old-reviewer" }] });
});

it("issues independent fetches for concurrent ledger observers", async () => {
  fetchMock.mockResolvedValueOnce(response({ events: [], nextRevision: null }))
    .mockResolvedValueOnce(response({ events: [], nextRevision: 100 }));
  const [first, second] = await Promise.all([capabilityEvidenceApi.list("company"), capabilityEvidenceApi.list("company")]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(first.nextRevision).toBeNull(); expect(second.nextRevision).toBe(100);
});

it("preserves standard forbidden response handling", async () => {
  fetchMock.mockResolvedValueOnce(response({ error: "Company administrator required" }, 403));
  const pending = capabilityEvidenceApi.list("company");
  await expect(pending).rejects.toBeInstanceOf(ApiError);
  await expect(pending).rejects.toMatchObject({ status: 403 });
});

it("preserves JSON availability errors and fetch cancellation", async () => {
  fetchMock.mockResolvedValueOnce(new Response("<html>not JSON</html>", { status: 200 }));
  await expect(capabilityEvidenceApi.list("company")).rejects.toBeInstanceOf(ApiUnavailableError);
  fetchMock.mockImplementationOnce((_url, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  const controller = new AbortController();
  const pending = capabilityEvidenceApi.list("company", 0, controller.signal);
  const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort(); await assertion;
});
