// @vitest-environment jsdom
import { BreadcrumbProvider } from "@/context/BreadcrumbContext";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { queryKeys } from "../lib/queryKeys";
import { MimouseCodingRepair } from "./MimouseCodingRepair";
import { MimouseCoding } from "./MimouseCoding";
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const routines = vi.hoisted(() => ({ list: vi.fn() }));
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/api/client", () => ({ api })); vi.mock("@/api/routines", () => ({ routinesApi: routines })); vi.mock("@/api/auth", () => ({ authApi: auth }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-a" }) }));
vi.mock("@/lib/router", () => ({ useSearchParams: () => [new URLSearchParams()] }));
const props = { companyId: "company-a", userId: "owner-a", issueId: "issue-a", deliveryId: "delivery-a", headSha: "a".repeat(40) };
const routine = { id: "routine-a", latestRevisionId: "revision-a", parentIssueId: "issue-a", status: "active", concurrencyPolicy: "always_enqueue", title: "Approved repair routine" };
const data = { operatorEnabled: true, status: "awaiting_review", lastCode: null, policy: null, attempts: [] };
let host: HTMLDivElement, root: Root, client: QueryClient;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function click(element: Element) { await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); }
async function mount(userId = "owner-a", parent = false) { await act(async () => root.render(<BreadcrumbProvider><QueryClientProvider client={client}>{parent ? <MimouseCoding /> : <MimouseCodingRepair {...props} userId={userId} />}</QueryClientProvider></BreadcrumbProvider>)); await flush(); }
async function open() { const button = [...host.querySelectorAll("button")].find(item => item.textContent === i18n.t("codingRepair.manage"))!; await click(button); await flush(); }
async function choose() { const select = host.querySelector("select")!; await act(async () => { select.value = routine.id; select.dispatchEvent(new Event("change", { bubbles: true })); }); await flush(); }
const authorize = () => [...host.querySelectorAll("button")].find(item => item.textContent === i18n.t("codingRepair.enable"))!;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); await i18n.changeLanguage("en");
  api.get.mockResolvedValue(data); api.post.mockResolvedValue({}); routines.list.mockResolvedValue([routine]); auth.getSession.mockResolvedValue({ user: { id: "owner-a" }, session: { userId: "owner-a" } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });
it("requires explicit confirmation and sends the exact displayed routine revision and commit", async () => {
  await mount(); await open(); await choose(); expect(authorize().disabled).toBe(true); expect(api.post).not.toHaveBeenCalled();
  await click(host.querySelector('input[type="checkbox"]')!); expect(authorize().disabled).toBe(false); await click(authorize());
  expect(api.post).toHaveBeenCalledWith("/companies/company-a/coding/delivery-a/repair-settings", { enabled: true, confirm: true, headSha: props.headSha, routineId: routine.id, expectedRoutineRevisionId: routine.latestRevisionId, maxAttempts: 2, maxDurationMinutes: 15, maxCostCents: 100 });
});
it("a changed routine revision invalidates the prior confirmation", async () => {
  await mount(); await open(); await choose(); await click(host.querySelector('input[type="checkbox"]')!); expect(authorize().disabled).toBe(false);
  await act(async () => client.setQueryData(["coding-repair-routines", "company-a", "owner-a", "issue-a"], [{ ...routine, latestRevisionId: "revision-b" }])); await flush();
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
  api.get.mockImplementation((url: string) => Promise.resolve(url.endsWith("/repairs") ? data : { deliveries: [row], publishEnabled: false }));
  client.setQueryData(queryKeys.auth.session, { user: { id: "owner-a" }, session: { userId: "owner-a" } }); await mount("owner-a", true); await open(); await choose(); await click(host.querySelector('input[type="checkbox"]')!);
  api.get.mockResolvedValue({ deliveries: [], publishEnabled: false });
  await act(async () => client.setQueryData(queryKeys.auth.session, { user: { id: "owner-b" }, session: { userId: "owner-b" } })); await flush();
  expect(host.querySelector('input[type="checkbox"]')).toBeNull(); expect(host.textContent).not.toContain(props.headSha); expect(api.post).not.toHaveBeenCalled();
});
