import { afterEach, expect, it, vi } from "vitest";
import { runtimeCostRoutingApi } from "./runtime-cost-routing";
import { api as sharedApi } from "./client";
import { routingId as id, routingHead as head, routingBinding as binding, routingRecord as record } from "@/test/runtime-cost-routing-fixtures";
const response = (value: unknown) => ({ ok: true, status: 200, json: async () => value }) as Response;
const client = (signal = new AbortController().signal, userId = "owner") => runtimeCostRoutingApi(id(1), userId, signal);
afterEach(() => vi.unstubAllGlobals());
it("identity reads do not join an old-session URL-only in-flight fetch", async () => {
  let finish!: (value: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(response(head())); vi.stubGlobal("fetch", fetch);
  const old = sharedApi.get(`/companies/${id(1)}/runtime-cost-routing`), abort = new AbortController();
  await client(abort.signal).current(); expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[1]![1]).toMatchObject({ cache: "no-store", signal: abort.signal, credentials: "include" });
  finish(response({ privateOldActorMetadata: true })); await old;
});
it("abort after response arrival never returns prior-session metadata", async () => {
  const abort = new AbortController(); vi.stubGlobal("fetch", vi.fn(async () => { abort.abort(); return response(head(true)); }));
  await expect(client(abort.signal).current()).rejects.toMatchObject({ name: "AbortError" });
});
it.each(["company", "request", "generation", "future_quote"])("rejects a %s-mismatched new-task binding", async mismatch => {
  const value = binding(); if (mismatch === "company") value.companyId = id(999); if (mismatch === "request") value.requestId = id(999); if (mismatch === "generation") value.generation = 2;
  if (mismatch === "future_quote") (value as any).futureCostQuoted = true;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ binding: value, duplicate: false })));
  await expect(client().createTask({ requestId: id(201), expectedGeneration: 1, title: "Work", confirmOrdinaryTaskVisibility: true })).rejects.toThrow();
});
it("an unrelated or impossible closure cannot release a pending request", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ enabled: true, companyPaused: false, policy: null, receipt: null, binding: null,
    closure: { outcome: "not_applied_closed", requestId: id(9), action: "approve", reason: "generation_advanced", currentGeneration: 1 } })));
  await expect(client().request(id(9), { action: "approve", policyId: id(3), expectedGeneration: 1 })).rejects.toThrow();
});
it("readback rejects another actor's prepared proposal and never replays a write", async () => {
  const fetch = vi.fn().mockResolvedValue(response({ enabled: true, companyPaused: false, policy: record(), receipt: null, binding: null, closure: null })); vi.stubGlobal("fetch", fetch);
  await expect(client(undefined, "other-owner").request(id(4), { action: "prepare", expectedGeneration: 0 })).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0]![1].method).toBe("GET");
});
