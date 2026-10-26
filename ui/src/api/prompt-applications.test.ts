import { afterEach, expect, it, vi } from "vitest";
import { promptApplicationsApi, parsePromptApplication, parseApplicationReceipt } from "./prompt-applications";
import { applicationId as id, applicationRecord as record, applicationReceipt as receipt, applicationDispatch as dispatch, applicationEvidence as evidence } from "@/test/prompt-application-fixtures";
const make = (signal = new AbortController().signal) => promptApplicationsApi(id(1), "user", signal);
const reply = (value: unknown) => { const fetcher = vi.fn(async () => new Response(JSON.stringify(value))); vi.stubGlobal("fetch", fetcher); return fetcher; };
afterEach(() => { vi.unstubAllGlobals(); });
it("uses independent no-store credentialed GETs and AbortSignal for each caller", async () => {
  const fetcher = reply({ enabled: false, items: [record()], nextBeforeId: null });
  await Promise.all([make().list(id(7)), make().list(id(7))]); expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [url, init] of fetcher.mock.calls as unknown as Array<[string, RequestInit]>) {
    expect(url).toBe(`/api/companies/${id(1)}/prompt-registry/${id(7)}/applications`);
    expect(init).toMatchObject({ method: "GET", cache: "no-store", credentials: "include", signal: expect.any(AbortSignal) });
  }
});
it("rejects a late response after abort even when fetch ignores cancellation", async () => {
  let finish!: (value: Response) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { finish = resolve; })));
  const abort = new AbortController(), pending = make(abort.signal).list(id(7)); abort.abort(); finish(new Response(JSON.stringify({ enabled: true, items: [record()], nextBeforeId: null })));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
it.each(["companyId", "promptId"])("rejects another %s in application responses", async key => {
  reply({ enabled: true, items: [record({ [key]: id(99) })], nextBeforeId: null }); await expect(make().list(id(7))).rejects.toThrow();
});
it.each([{ executionStarted: true }, { prompt: "PRIVATE" }, { configured: true }, { revisionHash: "bad" }, { revisionId: id(99) }])("rejects malformed or unsafe application fields", patch => {
  expect(() => parsePromptApplication({ ...record(), ...patch })).toThrow();
});
it.each([{ engine: "native" }, { adapterType: "codex_local" }, { scope: "all_tasks" }, { completeContextCaptured: true }, { ordinaryToolsQualityProven: true }, { secret: "PRIVATE" }])("rejects unsupported snapshots", patch => {
  const value = record(); expect(() => parsePromptApplication({ ...value, snapshot: { ...value.snapshot, ...patch } })).toThrow();
});
it("sends only exact fixed comparison metadata and validates prepare identity", async () => {
  const body = { requestId: id(21), agentId: id(9), expectedGeneration: 0, comparison: evidence.comparison, approvalValidForMinutes: 60 };
  const fetcher = reply({ item: record(), duplicate: false }); expect((await make().prepare(id(7), body)).item.id).toBe(id(20));
  expect(JSON.parse(String((fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0][1].body))).toEqual(body);
  reply({ item: record({ requestId: id(99) }), duplicate: true }); await expect(make().prepare(id(7), body)).rejects.toThrow();
});
it("requires four explicit confirmation literals before posting approval", async () => {
  const fetcher = reply({ receipt: receipt(), duplicate: false }); const body = { requestId: id(25), expectedGeneration: 0, approvalDigest: "f".repeat(64), confirmOrdinaryVisibility: true, confirmBareComparisonNotToolQuality: true, confirmNewTasksOnly: true, confirmNoAutomaticRun: true } as const;
  await make().approve(id(7), id(20), body); expect(fetcher).toHaveBeenCalledTimes(1);
  for (const key of ["confirmOrdinaryVisibility", "confirmBareComparisonNotToolQuality", "confirmNewTasksOnly", "confirmNoAutomaticRun"]) await expect(make().approve(id(7), id(20), { ...body, [key]: false })).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([{ requestId: id(99) }, { applicationId: id(99) }, { action: "rollback" }, { generation: 2 }])("rejects an approval receipt not bound to the exact write", async patch => {
  reply({ receipt: { ...receipt(), ...patch }, duplicate: false });
  await expect(make().approve(id(7), id(20), { requestId: id(25), expectedGeneration: 0, approvalDigest: "f".repeat(64), confirmOrdinaryVisibility: true, confirmBareComparisonNotToolQuality: true, confirmNewTasksOnly: true, confirmNoAutomaticRun: true })).rejects.toThrow();
});
it("recovers only the same request by GET; empty result is not a mutation", async () => {
  const fetcher = reply({ enabled: true, application: null, receipt: null }); expect(await make().request(id(7), id(25))).toEqual({ enabled: true, application: null, receipt: null });
  expect((fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]).toMatchObject([`/api/companies/${id(1)}/prompt-registry/${id(7)}/applications/requests/${id(25)}`, { method: "GET" }]);
  reply({ enabled: true, application: null, receipt: receipt({ requestId: id(99) }) }); await expect(make().request(id(7), id(25))).rejects.toThrow();
});
it("retains distinct configuration and actual dispatch evidence with pagination", async () => {
  reply({ items: [dispatch()], nextBeforeId: id(26) }); expect((await make().dispatches(id(7), id(20), id(29))).items[0].providerConsumed).toBe(false);
  for (const patch of [{ providerConsumed: true }, { promptHash: null }, { applicationId: id(99) }, { dispatchedAt: null }]) { reply({ items: [{ ...dispatch(), ...patch }], nextBeforeId: null }); await expect(make().dispatches(id(7), id(20))).rejects.toThrow(); }
  expect(() => parseApplicationReceipt({ ...receipt(), executionStarted: true })).toThrow();
});
it("keeps configured bindings valid after the approval deadline", () => {
  const row = record({ approvalExpiresAt: "2020-01-01T00:00:00.000Z", configured: true, currentGeneration: 1, configuredAt: "2026-10-26T12:01:00.000Z" });
  expect(parsePromptApplication(row).configured).toBe(true);
});

it("allows company metadata inspection for rollback, but binds prepare/recovery to the current actor", async () => {
  reply({ enabled: true, items: [record({ actorUserId: "other-admin" })], nextBeforeId: null }); expect((await make().list(id(7))).items[0].actorUserId).toBe("other-admin");
  reply({ enabled: true, item: record({ actorUserId: "other-admin" }) }); expect((await make().detail(id(7), id(20))).item.id).toBe(id(20));
  reply({ enabled: true, application: record({ actorUserId: "other-admin" }), receipt: null }); await expect(make().request(id(7), id(21))).rejects.toThrow();
});
