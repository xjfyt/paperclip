// @vitest-environment jsdom
import { BreadcrumbProvider } from "@/context/BreadcrumbContext";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { queryKeys } from "../lib/queryKeys";
import { i18n } from "../i18n";
import { MimouseWorkbuddy } from "./MimouseWorkbuddy";
const company = vi.hoisted(() => ({ selectedCompanyId: "company-a" }));
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() })); const agents = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/api/auth", () => ({ authApi: auth }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => company })); vi.mock("@/api/client", () => ({ api })); vi.mock("@/api/agents", () => ({ agentsApi: agents }));
let host: HTMLDivElement, root: Root, client: QueryClient;
const data = { enabled: true, connections: [{ id: "connection-1", status: "connected", allowedAgentIds: [] }], jobs: [] };
async function flush() {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(client.isFetching()).toBe(0);
    expect(host.textContent).not.toContain(i18n.t("common.loading"));
  });
}
async function mount() { await act(async () => root.render(<BreadcrumbProvider><QueryClientProvider client={client}><MimouseWorkbuddy /></QueryClientProvider></BreadcrumbProvider>)); await flush(); }
async function click(element: Element) { await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); }
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; await i18n.changeLanguage("en"); vi.clearAllMocks(); company.selectedCompanyId = "company-a";
  auth.getSession.mockResolvedValue({ user: { id: "owner-a" }, session: { userId: "owner-a" } });
  api.get.mockResolvedValue(data); api.post.mockResolvedValue({}); agents.list.mockResolvedValue([{ id: "agent-1", name: "Trusted research Agent" }]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } }); client.setQueryData(queryKeys.auth.session, { user: { id: "owner-a" }, session: { userId: "owner-a" } }); client.setQueryData(["workbuddy", "company-a", "owner-a"], data);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });
it("does not grant account access until selected Agents are explicitly confirmed", async () => {
  await mount(); expect(host.textContent).toContain("Connection ID: connection-1"); expect(host.textContent).toContain("retry its lifecycle verification"); const checks = host.querySelectorAll('input[type="checkbox"]'); const save = [...host.querySelectorAll("button")].find(button => button.textContent === "Save Agent permissions")!;
  expect(save.disabled).toBe(true); await click(checks[0]); expect(save.disabled).toBe(true); expect(api.post).not.toHaveBeenCalled(); await click(checks[1]); expect(save.disabled).toBe(false); await click(save);
  expect(api.post).toHaveBeenCalledWith("/companies/company-a/integrations/workbuddy/connections/connection-1/agents", { confirm: true, agentIds: ["agent-1"] });
});
it("changing the selection clears its prior permission confirmation", async () => {
  await mount(); const checks = host.querySelectorAll('input[type="checkbox"]'); await click(checks[1]); expect((checks[1] as HTMLInputElement).checked).toBe(true); await click(checks[0]); expect((checks[1] as HTMLInputElement).checked).toBe(false); expect(api.post).not.toHaveBeenCalled();
});

it("remounts account-scoped controls when the signed-in user changes", async () => {
  await mount(); const checks = host.querySelectorAll('input[type="checkbox"]'); await click(checks[0]); await click(checks[1]);
  await act(async () => { client.setQueryData(queryKeys.auth.session, { user: { id: "owner-b" }, session: { userId: "owner-b" } }); }); await flush();
  await vi.waitFor(async () => {
    await flush();
    expect(client.getQueryData(["workbuddy-authorizable-agents", "company-a", "owner-b"])).toHaveLength(1);
    const next = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(next).toHaveLength(3);
    expect(next[0].checked).toBe(false); expect(next[1].checked).toBe(false);
  });
  expect(api.post).not.toHaveBeenCalled();
});
