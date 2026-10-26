// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { ApprovalDetail } from "./ApprovalDetail";
const mocks = vi.hoisted(() => ({ get: vi.fn(), empty: vi.fn(async () => []), navigate: vi.fn(), breadcrumbs: vi.fn(), select: vi.fn() }));
vi.mock("@/api/approvals", () => ({ approvalsApi: { get: mocks.get, listComments: mocks.empty, listIssues: mocks.empty } }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: mocks.empty } }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-a", setSelectedCompanyId: mocks.select }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mocks.breadcrumbs }) }));
vi.mock("@/lib/router", () => ({ useParams: () => ({ approvalId: "approval-a" }), useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams("resolved=approved")],
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a> }));
vi.mock("@/components/AgentIdentity", () => ({ AgentIdentity: () => <span>Fixture agent</span> }));
vi.mock("@/components/Identity", () => ({ Identity: () => null }));
vi.mock("@/components/ApprovalPayload", () => ({ approvalLabel: () => "Review", typeIcon: {}, defaultTypeIcon: () => null, ApprovalPayloadRenderer: () => null }));
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(async () => {
  vi.clearAllMocks(); await i18n.changeLanguage("en");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });
async function mount(status: string, requestedByAgentId: string | null) {
  mocks.get.mockResolvedValue({ id: "approval-a", companyId: "company-a", type: "request_board_approval", payload: {}, status, requestedByAgentId });
  await act(async () => root.render(<QueryClientProvider client={client}><ApprovalDetail /></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
}
it.each(["en", "zh-CN", "es", "ja"])("shows only the saved decision, not an unverified agent notification (%s)", async locale => {
  await i18n.changeLanguage(locale); expect(i18n.exists("workflowHelp.approvalRecorded")).toBe(true);
  expect(i18n.t("workflowHelp.approvalRecorded")).not.toBe("workflowHelp.approvalRecorded"); await mount("approved", null);
  expect(host.textContent).toContain(i18n.t("workflowHelp.approvalRecorded"));
  expect(host.textContent).toContain(i18n.t("workflow.approvalConfirmed"));
});
it("does not infer notification delivery from a requesting agent ID", async () => {
  await mount("approved", "agent-a");
  expect(host.textContent).toContain(i18n.t("workflowHelp.approvalRecorded"));
  expect(host.textContent).not.toContain("Requesting agent was notified");
});
it.each(["pending", "rejected", "revision_requested"])("does not trust the URL success flag over %s server state", async status => {
  await mount(status, null);
  expect(host.textContent).not.toContain(i18n.t("workflowHelp.approvalRecorded"));
  expect(host.textContent).not.toContain(i18n.t("workflow.approvalConfirmed"));
});
