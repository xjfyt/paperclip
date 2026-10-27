// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n, managementMessages } from "../i18n/management-test-resources";
import type { Approval } from "@paperclipai/shared";
import type { ApprovalCard } from "../components/ApprovalCard";
import { Approvals } from "./Approvals";
import { SidebarProvider } from "../context/SidebarContext";
const mocks = vi.hoisted(() => ({ list: vi.fn(), agents: vi.fn(), approve: vi.fn(), reject: vi.fn(), navigate: vi.fn(), breadcrumbs: vi.fn() }));
vi.mock("../api/approvals", () => ({ approvalsApi: { list: mocks.list, approve: mocks.approve, reject: mocks.reject } }));
vi.mock("../api/agents", () => ({ agentsApi: { list: mocks.agents } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-original" }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mocks.breadcrumbs }) }));
vi.mock("@/lib/router", () => ({ useNavigate: () => mocks.navigate, useLocation: () => ({ pathname: "/approvals/pending" }) }));
// Keep list/query/mutation real; expose the existing ApprovalCard callback boundary.
vi.mock("../components/ApprovalCard", () => ({ ApprovalCard: ({ approval, onApprove, onReject, isPending }: ComponentProps<typeof ApprovalCard>) =>
  <section data-approval-id={approval.id}><button data-action="approve" disabled={isPending} onClick={onApprove}>Approve boundary</button><button data-action="reject" disabled={isPending} onClick={onReject}>Reject boundary</button></section> }));
let host: HTMLDivElement; let root: Root; let client: QueryClient;
beforeEach(async () => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(() => true) })));
  vi.clearAllMocks(); mocks.approve.mockReset(); mocks.reject.mockReset(); await i18n.changeLanguage("en");
  const approval: Approval = { id: "approval-original", companyId: "company-original", type: "hire_agent", status: "pending", payload: { name: "Original agent 原文" }, requestedByAgentId: null, requestedByUserId: "original-user", decisionNote: null, decidedByUserId: null, decidedAt: null, createdAt: new Date("2026-10-27T00:00:00Z"), updatedAt: new Date("2026-10-27T00:00:00Z") };
  mocks.list.mockResolvedValue([approval]); mocks.agents.mockResolvedValue([]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  await act(async () => { root.render(<QueryClientProvider client={client}><SidebarProvider><Approvals /></SidebarProvider></QueryClientProvider>); });
  await act(async () => { await vi.waitFor(() => expect(host.querySelector('[data-action="approve"]')).not.toBeNull()); });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); await i18n.changeLanguage("en"); });
const button = (action: string) => host.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
for (const action of ["approve", "reject"] as const) {
  it.each(Object.entries(managementMessages))(`${action} fallback hot-switches without repeating the request in %s`, async (locale, messages) => {
    const request = mocks[action]; request.mockRejectedValueOnce(null).mockRejectedValueOnce(new Error("Failed to approve: 原始服务器错误"));
    await act(async () => { button(action).click(); });
    await act(async () => { await vi.waitFor(() => expect(host.textContent).toContain(managementMessages.en[`${action}Failed`])); });
    expect(request).toHaveBeenCalledExactlyOnceWith("approval-original");
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(host.textContent).toContain(messages[`${action}Failed`]); expect(request).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith("company-original"); expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => { button(action).click(); });
    await act(async () => { await vi.waitFor(() => expect(host.textContent).toContain("Failed to approve: 原始服务器错误")); });
    await act(async () => { await i18n.changeLanguage("ja"); });
    expect(host.textContent).toContain("Failed to approve: 原始服务器错误"); expect(request).toHaveBeenCalledTimes(2);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
}
