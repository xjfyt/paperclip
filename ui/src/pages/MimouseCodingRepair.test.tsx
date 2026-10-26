// @vitest-environment jsdom
import { BreadcrumbProvider } from "@/context/BreadcrumbContext";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { queryKeys } from "../lib/queryKeys";
import { MimouseCodingRepair } from "./MimouseCodingRepair";
import { MimouseCoding } from "./MimouseCoding";
const api = vi.hoisted(() => ({ post: vi.fn() }));
const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/api/client", async original => { const actual = await original<typeof import("@/api/client")>(); return { ...actual, api: { ...actual.api, post: api.post } }; }); vi.mock("@/api/auth", () => ({ authApi: auth }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-a" }) }));
vi.mock("@/lib/router", () => ({ useSearchParams: () => [new URLSearchParams()] }));
const props = { companyId: "company-a", userId: "owner-a", sessionId: "session-a", authEpoch: 1, issueId: "issue-a", deliveryId: "delivery-a", headSha: "a".repeat(40) };
const routine = { id: "routine-a", latestRevisionId: "revision-a", parentIssueId: "issue-a", status: "active", concurrencyPolicy: "always_enqueue", title: "Approved repair routine" };
const data = { operatorEnabled: true, status: "awaiting_review", lastCode: null, policy: null, attempts: [] };
let host: HTMLDivElement, root: Root, client: QueryClient;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function click(element: Element) { await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); }
async function mount(userId = "owner-a", parent = false, sessionId = props.sessionId, authEpoch = props.authEpoch) { await act(async () => root.render(<BreadcrumbProvider><QueryClientProvider client={client}>{parent ? <MimouseCoding /> : <MimouseCodingRepair {...props} userId={userId} sessionId={sessionId} authEpoch={authEpoch} />}</QueryClientProvider></BreadcrumbProvider>)); await flush(); }
async function open() { const button = await vi.waitFor(() => { const found = [...host.querySelectorAll("button")].find(item => item.textContent === i18n.t("codingRepair.manage")); expect(found).toBeDefined(); return found!; }); await click(button); await flush(); }
async function choose() { const select = host.querySelector("select")!; await act(async () => { select.value = routine.id; select.dispatchEvent(new Event("change", { bubbles: true })); }); await flush(); }
const button = (key: string) => [...host.querySelectorAll("button")].find(item => item.textContent === i18n.t(key))!;
const authorize = () => button("codingRepair.enable");
const confirmation = () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const repairKey = ["coding-repairs", "company-a", "owner-a", "session-a", 1, "delivery-a"];
const routineKey = ["coding-repair-routines", "company-a", "owner-a", "session-a", 1, "issue-a"];
const repairUrl = "/api/companies/company-a/coding/delivery-a/repairs";
const routineUrl = "/api/companies/company-a/routines";
function defaultResponse(url: string) {
  if (url === repairUrl) return Response.json(data);
  if (url === routineUrl) return Response.json([routine]);
  if (url === "/api/companies/company-a/coding") return Response.json({ deliveries: [], publishEnabled: false });
  throw new Error(`Unexpected request: ${url}`);
}
const pendingResolutions: Array<() => void> = [];
function deferred() { let resolve!: (value: Response) => void; const promise = new Promise<Response>(done => { resolve = done; }); pendingResolutions.push(() => resolve(Response.json(null))); return { promise, resolve }; }
async function refetch(queryKey: readonly unknown[]) { await act(async () => { void client.refetchQueries({ queryKey: queryKey.slice(0, 1), type: "active" }); }); await flush(); }
async function confirm() { await choose(); await click(confirmation()); expect(authorize().disabled).toBe(false); }
function expectUnavailable() {
  expect(authorize().disabled).toBe(true); expect(button("codingRepair.pause").disabled).toBe(true);
  expect(confirmation().disabled).toBe(true); expect(confirmation().checked).toBe(false);
  expect(host.querySelector<HTMLSelectElement>("select")!.disabled).toBe(true);
  expect([...host.querySelectorAll<HTMLInputElement>('input[type="number"]')].every(input => input.disabled)).toBe(true);
  expect(host.textContent).not.toContain(routine.title); expect(api.post).not.toHaveBeenCalled();
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); await i18n.changeLanguage("en");
  api.post.mockResolvedValue({}); auth.getSession.mockResolvedValue({ user: { id: "owner-a" }, session: { id: "session-a", userId: "owner-a" } });
  transport.fetch.mockImplementation(async (url: string) => defaultResponse(url)); vi.stubGlobal("fetch", transport.fetch);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); onlineManager.setOnline(true); pendingResolutions.splice(0).forEach(resolve => resolve()); await flush(); host.remove(); vi.unstubAllGlobals(); await i18n.changeLanguage("en"); });
it("requires explicit confirmation and sends the exact displayed routine revision and commit", async () => {
  await mount(); await open(); await choose(); expect(authorize().disabled).toBe(true); expect(api.post).not.toHaveBeenCalled();
  await click(host.querySelector('input[type="checkbox"]')!); expect(authorize().disabled).toBe(false); await click(authorize());
  expect(api.post).toHaveBeenCalledWith("/companies/company-a/coding/delivery-a/repair-settings", { enabled: true, confirm: true, headSha: props.headSha, routineId: routine.id, expectedRoutineRevisionId: routine.latestRevisionId, maxAttempts: 2, maxDurationMinutes: 15, maxCostCents: 100 });
});
it("a changed routine revision invalidates the prior confirmation", async () => {
  await mount(); await open(); await choose(); await click(host.querySelector('input[type="checkbox"]')!); expect(authorize().disabled).toBe(false);
  await act(async () => client.setQueryData(routineKey, [{ ...routine, latestRevisionId: "revision-b" }])); await flush();
  expect(authorize().disabled).toBe(true); expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false); expect(api.post).not.toHaveBeenCalled();
});
it("local implicit access cannot authorize background repair execution", async () => {
  await mount("local-board"); await open(); await choose(); await click(host.querySelector('input[type="checkbox"]')!);
  expect(authorize().disabled).toBe(true); expect(host.textContent).toContain(i18n.t("codingRepair.loginRequired")); expect(api.post).not.toHaveBeenCalled();
});
it.each(["en", "zh-CN", "es", "ja"])("renders repair controls and states in %s", async locale => {
  await i18n.changeLanguage(locale); await mount(); await open(); expect(host.textContent).toContain(i18n.t("codingRepair.title")); expect(host.textContent).toContain(i18n.t("codingRepair.state_awaiting_review")); expect(host.textContent).not.toContain("awaiting_review");
});
it("owner changes remount the coding view and discard its prior private draft", async () => {
  const row = { id: props.deliveryId, issueId: props.issueId, headSha: props.headSha, operationState: "local", mrIid: null, pipelineId: null, gate: { readyForReleaseCandidate: false, blockers: [] } };
  transport.fetch.mockImplementation(async (url: string) => url === "/api/companies/company-a/coding" ? Response.json({ deliveries: [row], publishEnabled: false }) : defaultResponse(url));
  client.setQueryData(queryKeys.auth.session, { user: { id: "owner-a" }, session: { id: "session-a", userId: "owner-a" } }); await mount("owner-a", true); await open(); await choose(); await click(host.querySelector('input[type="checkbox"]')!);
  transport.fetch.mockImplementation(async (url: string) => defaultResponse(url));
  await act(async () => client.setQueryData(queryKeys.auth.session, { user: { id: "owner-b" }, session: { id: "session-b", userId: "owner-b" } })); await flush();
  expect(host.querySelector('input[type="checkbox"]')).toBeNull(); expect(host.textContent).not.toContain(props.headSha); expect(api.post).not.toHaveBeenCalled();
  const parentReads = transport.fetch.mock.calls.filter(([url]) => url === "/api/companies/company-a/coding");
  expect(parentReads).toHaveLength(2);
  expect(transport.fetch).toHaveBeenLastCalledWith("/api/companies/company-a/coding", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  expect(parentReads[0]![1].signal).not.toBe(parentReads[1]![1].signal);
});

it.each(["repairs", "routines"])("does not join an old pending %s read when the same user starts another session", async kind => {
  const old = deferred(); const target = kind === "repairs" ? repairUrl : routineUrl;
  let targetReads = 0;
  transport.fetch.mockImplementation(async (url: string) => url === target && targetReads++ === 0 ? old.promise : defaultResponse(url));
  await mount(); await open();
  const oldCall = transport.fetch.mock.calls.find(([url]) => url === target)!;
  expect(oldCall[1]).toEqual(expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  await mount("owner-a", false, "session-b", 2);
  const calls = transport.fetch.mock.calls.filter(([url]) => url === target);
  expect(calls).toHaveLength(2); expect(oldCall[1].signal.aborted).toBe(true);
  expect(calls[1]![1]).toEqual(expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  expect(calls[1]![1].signal).not.toBe(oldCall[1].signal);
  await act(async () => old.resolve(Response.json(kind === "repairs" ? { ...data, lastCode: "OLD_SESSION_REPAIR" } : [{ ...routine, title: "OLD_SESSION_ROUTINE" }]))); await flush();
  expect(host.textContent).not.toContain("OLD_SESSION_"); expect(host.textContent).toContain(routine.title);
  expect(confirmation().checked).toBe(false); expect(authorize().disabled).toBe(true); expect(api.post).not.toHaveBeenCalled();
});
it("a new authorization epoch cannot reuse the same session's confirmation or reads", async () => {
  await mount(); await open(); await confirm();
  await mount("owner-a", false, "session-a", 2);
  expect(transport.fetch.mock.calls.filter(([url]) => url === repairUrl)).toHaveLength(2);
  expect(transport.fetch.mock.calls.filter(([url]) => url === routineUrl)).toHaveLength(2);
  expect(authorize().disabled).toBe(true); expect(confirmation().checked).toBe(false); expect(api.post).not.toHaveBeenCalled();
});
it("hides retained routine candidates after a real 403 and requires new confirmation after same-data recovery", async () => {
  await mount(); await open(); await confirm();
  transport.fetch.mockImplementation(async (url: string) => url === routineUrl ? Response.json({ error: "Forbidden" }, { status: 403 }) : defaultResponse(url));
  await refetch(routineKey);
  expectUnavailable(); expect(client.getQueryData(routineKey)).toEqual([routine]); expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.textContent).not.toContain(routine.latestRevisionId);
  transport.fetch.mockImplementation(async (url: string) => defaultResponse(url)); await refetch(routineKey);
  expect(host.textContent).toContain(routine.title); expect(confirmation().checked).toBe(false); expect(authorize().disabled).toBe(true);
  await click(confirmation()); expect(authorize().disabled).toBe(false); expect(api.post).not.toHaveBeenCalled();
});
it.each(["repairs", "routines"])("disables confirmation and actions while %s revalidates, even with retained data", async kind => {
  const saved = { ...data, lastCode: "REPAIR_DETAIL", policy: { enabled: true, routineId: routine.id, routineRevisionId: "POLICY_REVISION", expiresAt: "2026-10-27" } };
  transport.fetch.mockImplementation(async (url: string) => url === repairUrl ? Response.json(saved) : defaultResponse(url));
  await mount(); await open(); await confirm(); expect(button("codingRepair.pause").disabled).toBe(false);
  const pending = deferred(); const target = kind === "repairs" ? repairUrl : routineUrl;
  transport.fetch.mockImplementation(async (url: string) => url === target ? pending.promise : defaultResponse(url));
  await refetch(kind === "repairs" ? repairKey : routineKey); expectUnavailable();
  if (kind === "repairs") { expect(host.textContent).not.toContain("REPAIR_DETAIL"); expect(host.textContent).not.toContain("POLICY_REVISION"); }
  await click(authorize()); await click(button("codingRepair.pause")); expect(api.post).not.toHaveBeenCalled();
  await act(async () => pending.resolve(Response.json(kind === "repairs" ? saved : [routine]))); await flush();
  expect(confirmation().checked).toBe(false); expect(authorize().disabled).toBe(true);
});
it("requires fresh reads on mount even when a shared client considers cached evidence fresh forever", async () => {
  client.setQueryData(repairKey, { ...data, lastCode: "CACHED_REPAIR" }); client.setQueryData(routineKey, [{ ...routine, title: "CACHED_ROUTINE" }]);
  const pending = deferred();
  transport.fetch.mockImplementation(async (url: string) => url === repairUrl ? pending.promise : defaultResponse(url));
  await mount(); await open(); expectUnavailable(); expect(host.textContent).not.toContain("CACHED_");
  expect(transport.fetch).toHaveBeenCalledWith(repairUrl, expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  await act(async () => pending.resolve(Response.json(data))); await flush();
  expect(transport.fetch).toHaveBeenCalledWith(routineUrl, expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
  expect(host.textContent).toContain(routine.title); expect(host.textContent).not.toContain("CACHED_");
});

it("keeps confirmation disabled when revalidation is paused offline rather than fetching", async () => {
  await mount(); await open(); await confirm();
  await act(async () => { onlineManager.setOnline(false); }); await refetch(repairKey);
  expect(client.getQueryState(repairKey)?.fetchStatus).toBe("paused"); expectUnavailable();
  await act(async () => { onlineManager.setOnline(true); }); await flush();
  expect(host.textContent).toContain(routine.title); expect(confirmation().checked).toBe(false); expect(authorize().disabled).toBe(true);
});
