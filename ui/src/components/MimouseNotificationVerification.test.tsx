// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api as legacyApi } from "@/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { i18n } from "@/i18n";
import en from "@/i18n/contributions/notificationVerification/en.json";
import zh from "@/i18n/contributions/notificationVerification/zh-CN.json";
import es from "@/i18n/contributions/notificationVerification/es.json";
import ja from "@/i18n/contributions/notificationVerification/ja.json";
import { MimouseNotificationVerification } from "./MimouseNotificationVerification";
const state = vi.hoisted(() => ({ fetch: vi.fn(), session: vi.fn(), health: vi.fn(), append: vi.fn(), view: {} as any, events: [] as any[], next: null as number | null }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: state.session } }));
vi.mock("@/api/health", () => ({ healthApi: { get: state.health } }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { endpointId: id(1), configVersion: 1, verificationEpoch: 1, kind: "wecom_webhook", secretRef: id(2), secretVersion: 1 };
const props = { companyId: "company", endpointId: id(1), onClose: vi.fn() };
const session = (value = "one") => ({ session: { id: value, userId: "owner" }, user: { id: "owner" } });
const path = `/companies/company/notifications/endpoints/${id(1)}/verification`;
let host: HTMLDivElement, root: Root, client: QueryClient;
const text = (key: string) => i18n.t(`notificationVerification.${key}`);
const button = (key: string) => [...host.querySelectorAll("button")].find(item => item.textContent === text(key))!;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function mount(patch = {}) { await act(async () => root.render(<QueryClientProvider client={client}><MimouseNotificationVerification {...props} {...patch} /></QueryClientProvider>)); await flush(); await flush(); }
async function click(element: HTMLElement) { expect(element).toBeTruthy(); await act(async () => element.click()); await flush(); }
async function fill(key: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`[aria-label="${text(key)}"]`)!;
  expect(input).toBeTruthy(); await act(async () => { const proto = input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value); input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
}
async function edit(category = "protocol_report") {
  await fill("category", category);
  for (const [key, value] of Object.entries({ runtimeVersion: "v1", environmentAlias: "fixture", accountAlias: "test-account", reportRef: "report-one", testedCommit: "a".repeat(40) })) await fill(key, value);
  if (category !== "protocol_report") await click(host.querySelector('input[type="checkbox"]')!);
  if (category === "approval_scenario") await click(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]);
}
async function confirm() { await click(button("prepare")); await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!); }
function receipt(input: any) {
  return { id: id(10 + input.expectedRevision), companyId: "company", revision: input.expectedRevision + 1, action: input.action, targetId: input.targetId ?? null, reason: input.reason, reviewerId: "owner", createdAt: new Date().toISOString(), receipt: input.receipt ? { ...input.receipt, domain: "notification", scope, resourceId: null, manual: true, machineVerified: false } : null };
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); sessionStorage.clear(); state.events = []; state.next = null;
  for (const [locale, data] of Object.entries({ en, "zh-CN": zh, es, ja })) i18n.addResourceBundle(locale, "translation", { notificationVerification: data }, true, true);
  await i18n.changeLanguage("en");
  state.session.mockResolvedValue(session()); state.health.mockResolvedValue({ deploymentMode: "local_trusted" });
  const row = { id: id(3), eventId: "manual-test:fixture", subscriptionId: id(8), state: "accepted", attempt: 1, lastCode: "accepted", configVersion: 1, verificationEpoch: 1, secretVersion: 1, scopeMatches: true, eventType: "manual.test", resourceId: null, createdAt: new Date(Date.now() - 60000).toISOString(), updatedAt: new Date().toISOString(), review: { id: id(4), companyId: "company", deliveryId: id(3), requestId: id(9), outcome: "accepted", evidence: "fixture observation", actorId: "operator", observedState: "accepted", observedAttempt: 1, createdAt: new Date().toISOString() } };
  state.view = { scope, configuration: "saved_not_revalidated", credentialStatus: "metadata_active", endpointEnabled: false, dispatchEnabled: false, implemented: true, machineVerified: false, latestTest: row, latestApproval: { ...row, eventType: "approval.requested", eventId: `approval:${id(7)}`, resourceId: id(7) } };
  state.append.mockImplementation(async (input: any) => { const result = receipt(input); state.events.push(result); return Response.json(result); });
  state.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return state.append(JSON.parse(String(init.body)));
    if (url.includes("/evidence")) return Response.json({ events: state.events, nextRevision: url.endsWith("=0") ? state.next : null, headRevision: state.events.length });
    return Response.json(state.view);
  }); vi.stubGlobal("fetch", state.fetch);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } }); client.setQueryData(queryKeys.auth.session, session());
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("keeps four-language keys/placeholders aligned and renders real safety copy", async () => {
  for (const data of [zh, es, ja]) { expect(Object.keys(data).sort()).toEqual(Object.keys(en).sort()); for (const key of Object.keys(en) as Array<keyof typeof en>) expect(data[key].match(/{{[^}]+}}/g)).toEqual(en[key].match(/{{[^}]+}}/g)); }
  await mount();
  for (const locale of ["en", "zh-CN", "es", "ja"]) { await act(async () => { await i18n.changeLanguage(locale); }); expect(host.textContent).toContain(text("boundary")); expect(host.textContent).toContain(text("oldReview")); }
  expect(state.append).not.toHaveBeenCalled();
});
it("accepted plus an old human accepted review never grants C3/C4", async () => {
  await mount(); expect(host.textContent).not.toContain(text("manual_passed")); expect(host.textContent).toContain(text("not_recorded"));
  expect(state.fetch.mock.calls.every(([, init]) => init.method === "GET" && init.cache === "no-store" && init.signal instanceof AbortSignal)).toBe(true);
});
it.each(["protocol_report", "live_connection", "recipient_observation", "approval_scenario"])("saves only explicitly confirmed %s, with no test/probe call", async category => {
  await mount(); await edit(category); await click(button("prepare")); expect(button("save").disabled).toBe(true); expect(state.append).not.toHaveBeenCalled();
  await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!); await click(button("save"));
  expect(state.append).toHaveBeenCalledOnce(); const input = state.append.mock.calls[0][0]; expect(input).toMatchObject({ expectedConfigVersion: 1, expectedEpoch: 1, receipt: { category } });
  expect(input.receipt).not.toHaveProperty("machineVerified"); expect(input.receipt).not.toHaveProperty("scope");
  expect(state.fetch.mock.calls.every(([url]) => url.includes("/verification"))).toBe(true); expect(sessionStorage.length).toBe(0);
});
it("rejects incomplete inputs without a POST", async () => { await mount(); await click(button("prepare")); expect(host.textContent).toContain(text("invalid")); expect(state.append).not.toHaveBeenCalled(); });
it("double clicks send once and freeze the request", async () => {
  let resolve!: (value: Response) => void; state.append.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await mount(); await edit(); await confirm(); const save = button("save"); await act(async () => { save.click(); save.click(); });
  expect(state.append).toHaveBeenCalledOnce(); expect(host.querySelector('[aria-label="' + text("reportRef") + '"]')).toBeNull();
  await act(async () => resolve(Response.json(receipt(state.append.mock.calls[0][0])))); await flush();
});
it.each(["network", "500", "wrong_receipt"])("retains exact key/payload after %s and requires explicit same-request retry", async failure => {
  state.append.mockImplementationOnce(async () => { if (failure === "network") throw Error("lost"); return failure === "500" ? Response.json({}, { status: 500 }) : Response.json({ id: id(99) }); });
  await mount(); await edit(); await confirm(); await click(button("save")); const original = state.append.mock.calls[0][0];
  expect(host.textContent).toContain(text("unknown")); expect(sessionStorage.length).toBe(1); expect(button("retrySame").disabled).toBe(true);
  await act(async () => root.render(<QueryClientProvider client={client}><span>closed</span></QueryClientProvider>)); await mount();
  expect(host.textContent).toContain(original.idempotencyKey); expect(state.append).toHaveBeenCalledOnce();
  await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!); await click(button("retrySame"));
  expect(state.append.mock.calls[1][0]).toEqual(original); expect(sessionStorage.length).toBe(0);
});
it.each([401, 403, 404, 409, 422])("known rejection %s closes writes until re-read", async status => {
  state.append.mockResolvedValueOnce(Response.json({ error: "rejected" }, { status })); await mount(); await edit(); await confirm(); await click(button("save"));
  expect(host.textContent).toContain(text("rejected")); expect(button("prepare")).toBeUndefined(); expect(sessionStorage.length).toBe(0); expect(state.append).toHaveBeenCalledOnce();
});
it("storage failure blocks a POST", async () => {
  await mount(); await edit(); await confirm(); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("storage unavailable"); });
  await click(button("save")); expect(state.append).not.toHaveBeenCalled(); expect(host.textContent).toContain(text("storageError"));
});
it("incomplete paged history blocks declaration until every page is read", async () => {
  state.next = 101; await mount(); expect(button("prepare")).toBeUndefined(); expect(host.textContent).toContain(text("incomplete"));
  await click(button("more")); expect(button("prepare")).toBeTruthy(); expect(state.fetch.mock.calls.some(([url]) => url.endsWith("afterRevision=101"))).toBe(true);
});
it("auth revalidation hides private drafts and requires a fresh private read", async () => {
  await mount(); await edit(); let resolve!: (value: unknown) => void; state.session.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  let work!: Promise<void>; await act(async () => { work = client.refetchQueries({ queryKey: queryKeys.auth.session }); }); await flush();
  expect(host.textContent).not.toContain("report-one"); expect(button("prepare")).toBeUndefined();
  await act(async () => resolve(session())); await work; await flush(); await flush();
  expect((host.querySelector(`[aria-label="${text("reportRef")}"]`) as HTMLInputElement).value).toBe("");
});
it("new sessions never join a retained URL-only observer or render its late result", async () => {
  const pending: Array<{ resolve: (value: Response) => void; signal?: AbortSignal }> = [];
  state.fetch.mockImplementation((url: string, init?: RequestInit) => url.includes("/evidence") ? Promise.resolve(Response.json({ events: [], nextRevision: null, headRevision: 0 })) : new Promise<Response>(resolve => pending.push({ resolve, signal: init?.signal as AbortSignal })));
  const observer = legacyApi.get(path); await mount(); expect(pending).toHaveLength(2);
  await act(async () => client.setQueryData(queryKeys.auth.session, session("two"))); await flush(); await flush(); expect(pending).toHaveLength(3); expect(pending[1].signal?.aborted).toBe(true);
  const old = { ...state.view, latestTest: { ...state.view.latestTest, id: "old-private-delivery" } };
  await act(async () => { pending[0].resolve(Response.json(old)); pending[1].resolve(Response.json(old)); }); await observer; await flush(); expect(host.textContent).not.toContain("old-private");
  await act(async () => pending[2].resolve(Response.json(state.view))); await flush(); expect(button("prepare")).toBeTruthy();
});
it("late POST from an old session cannot clear its marker or modify the new session", async () => {
  let resolve!: (value: Response) => void; state.append.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await mount(); await edit(); await confirm(); await click(button("save")); const old = state.append.mock.calls[0][0];
  await act(async () => client.setQueryData(queryKeys.auth.session, session("two"))); await flush(); await flush();
  expect(host.textContent).not.toContain(old.idempotencyKey); await act(async () => resolve(Response.json(receipt(old)))); await flush();
  expect(sessionStorage.length).toBe(1); expect(button("prepare")).toBeTruthy(); expect(host.textContent).not.toContain(text("savedDeclaration"));
});
it("403 read hides previously visible private evidence", async () => {
  await mount(); state.fetch.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 })); await click(button("refresh"));
  expect(host.textContent).toContain(text("readError")); expect(host.textContent).not.toContain(id(3)); expect(button("prepare")).toBeUndefined();
});
it("confirmed local-trusted identity works, but a missing authenticated session does not", async () => {
  client.setQueryData(queryKeys.auth.session, null); await mount(); expect(button("prepare")).toBeTruthy();
  state.health.mockResolvedValue({ deploymentMode: "authenticated" }); await act(async () => client.setQueryData(queryKeys.health, { deploymentMode: "authenticated" })); await flush();
  expect(host.textContent).toContain(text("readError")); expect(button("prepare")).toBeUndefined();
});
it("late success never removes a replacement operation marker at the same identity", async () => {
  let resolve!: (value: Response) => void; state.append.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await mount(); await edit(); await confirm(); await click(button("save")); const old = state.append.mock.calls[0][0], key = sessionStorage.key(0)!;
  const replacement = JSON.stringify({ input: { ...old, idempotencyKey: id(98) }, scope }); sessionStorage.setItem(key, replacement);
  await act(async () => resolve(Response.json(receipt(old)))); await flush(); await flush();
  expect(sessionStorage.getItem(key)).toBe(replacement); expect(state.append).toHaveBeenCalledOnce();
});
it.each(["companyId", "endpointId"])("changing %s clears draft/consent without posting", async field => {
  await mount(); await edit(); await confirm();
  const patch = { [field]: field === "companyId" ? "another-company" : id(30) };
  if (field === "endpointId") state.view = { ...state.view, scope: { ...scope, endpointId: id(30) } };
  await mount(patch); expect(host.textContent).not.toContain("report-one"); expect(button("save")).toBeUndefined(); expect(state.append).not.toHaveBeenCalled();
});

it("malformed persisted scope blocks replay without clearing the unknown marker", async () => {
  state.append.mockRejectedValueOnce(Error("lost")); await mount(); await edit(); await confirm(); await click(button("save"));
  const key = sessionStorage.key(0)!, frozen = JSON.parse(sessionStorage.getItem(key)!); delete frozen.scope;
  sessionStorage.setItem(key, JSON.stringify(frozen));
  await act(async () => root.render(<QueryClientProvider client={client}><span>closed</span></QueryClientProvider>)); await mount();
  expect(host.textContent).toContain(text("manualRecovery")); expect(button("retrySame")).toBeUndefined(); expect(state.append).toHaveBeenCalledOnce(); expect(sessionStorage.length).toBe(1);
});
