// @vitest-environment jsdom
import { act, type ReactNode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n, managementMessages } from "../i18n/management-test-resources";
import type { Approval, ApprovalComment, Agent } from "@paperclipai/shared";
import type { approvalsApi } from "../api/approvals";
import type { agentsApi } from "../api/agents";
import type { AgentIdentity } from "../components/AgentIdentity";
import type { Identity } from "../components/Identity";
import { approvalDetailMessages } from "../i18n/approval-detail-test-resources";
import { queryKeys } from "../lib/queryKeys";
import { validateLocaleMessages } from "../i18n/locale-validation";
import { ApprovalDetail } from "./ApprovalDetail";
const mocks = vi.hoisted(() => ({
  get: vi.fn<typeof approvalsApi.get>(), approve: vi.fn<typeof approvalsApi.approve>(), reject: vi.fn<typeof approvalsApi.reject>(),
  comments: vi.fn<typeof approvalsApi.listComments>(), issues: vi.fn<typeof approvalsApi.listIssues>(),
  agents: vi.fn<typeof agentsApi.list>(), remove: vi.fn<typeof agentsApi.remove>(),
  navigate: vi.fn(), breadcrumbs: vi.fn(), select: vi.fn(),
}));
vi.mock("@/api/approvals", () => ({ approvalsApi: { get: mocks.get, approve: mocks.approve, reject: mocks.reject, listComments: mocks.comments, listIssues: mocks.issues } }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: mocks.agents, remove: mocks.remove } }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-a", setSelectedCompanyId: mocks.select }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mocks.breadcrumbs }) }));
vi.mock("@/lib/router", () => ({ useParams: () => ({ approvalId: "approval-a" }), useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams("resolved=approved")],
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a> }));
vi.mock("@/components/AgentIdentity", () => ({ AgentIdentity: ({ agent }: ComponentProps<typeof AgentIdentity>) => <span data-agent-id={agent.id}>{agent.name}</span> }));
vi.mock("@/components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <div>{children}</div> }));
vi.mock("@/components/Identity", () => ({ Identity: ({ name }: ComponentProps<typeof Identity>) => <span data-local-identity>{name}</span> }));
vi.mock("@/components/ApprovalPayload", () => ({ approvalLabel: () => "Review", typeIcon: {}, defaultTypeIcon: () => null, ApprovalPayloadRenderer: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(async () => {
  vi.clearAllMocks(); await i18n.changeLanguage("en");
  mocks.get.mockReset(); mocks.approve.mockReset(); mocks.reject.mockReset(); mocks.remove.mockReset();
  mocks.comments.mockReset().mockResolvedValue([]); mocks.issues.mockReset().mockResolvedValue([]); mocks.agents.mockReset().mockResolvedValue([]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => { await act(async () => { root.unmount(); }); client.clear(); host.remove(); vi.restoreAllMocks(); await i18n.changeLanguage("en"); });
function approvalFixture(overrides: Partial<Approval> = {}): Approval {
  return { id: "approval-a", companyId: "company-a", type: "request_board_approval", payload: {}, status: "pending", requestedByAgentId: null, requestedByUserId: "user-a", decisionNote: null, decidedByUserId: null, decidedAt: null, createdAt: new Date(0), updatedAt: new Date(0), ...overrides };
}
async function mount(status: Approval["status"], requestedByAgentId: string | null, type: Approval["type"] = "request_board_approval", payload: Approval["payload"] = {}) {
  mocks.get.mockResolvedValue(approvalFixture({ type, payload, status, requestedByAgentId }));
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
it.each(["pending", "rejected", "revision_requested"] as const)("does not trust the URL success flag over %s server state", async status => {
  await mount(status, null);
  expect(host.textContent).not.toContain(i18n.t("workflowHelp.approvalRecorded"));
  expect(host.textContent).not.toContain(i18n.t("workflow.approvalConfirmed"));
});

it.each(Object.entries(managementMessages))("localizes the budget-control link and deferred approval error in %s", async (locale, messages) => {
  await i18n.changeLanguage(locale);
  await mount("pending", null, "budget_override_required");
  expect(host.textContent).toContain(messages.budgetStop.replace(/<\/?0>/g, ""));
  expect(host.querySelector('a[href="/costs"]')?.textContent).toBe("/costs");
});
it("retranslates a local approval fallback while preserving a remote error", async () => {
  mocks.approve.mockRejectedValueOnce("unknown").mockRejectedValueOnce(new Error("Remote original"));
  await mount("pending", null);
  const approve = () => [...host.querySelectorAll("button")].find(button => button.textContent === i18n.t("commonUi.approve"))!;
  await act(async () => { approve().click(); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(host.textContent).toContain(managementMessages.en.approveFailed);
  expect(mocks.approve).toHaveBeenCalledTimes(1);
  await act(async () => { await i18n.changeLanguage("ja"); });
  expect(mocks.approve).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain(managementMessages.ja.approveFailed);
  await act(async () => { approve().click(); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(host.textContent).toContain("Remote original");
});

async function settle() { await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 20)); }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function deleteButton() {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === i18n.t("workflow.deleteDisapproved"));
}

it.each(Object.entries(approvalDetailMessages))("requires the translated native confirmation after rejecting a hire in %s", async (locale, messages) => {
  const payload = { agentId: "agent-original-原文", name: "Authored Agent {{keep}}", adapterConfig: { model: "model-original" } };
  const rejected = approvalFixture({ type: "hire_agent", payload, status: "rejected" });
  const pendingDelete = deferred<{ ok: true }>();
  mocks.reject.mockResolvedValue(rejected);
  mocks.remove.mockReturnValue(pendingDelete.promise);
  await mount("pending", "requester-original", "hire_agent", payload);
  expect(deleteButton()).toBeUndefined();
  mocks.get.mockResolvedValue(rejected);
  const reject = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === i18n.t("commonUi.reject"))!;
  await act(async () => { reject.click(); }); await settle();
  expect(mocks.reject).toHaveBeenCalledExactlyOnceWith("approval-a");
  expect(deleteButton()).toBeDefined();
  await act(async () => { await i18n.changeLanguage(locale); });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await act(async () => { deleteButton()!.click(); });
  expect(confirm).toHaveBeenCalledExactlyOnceWith(messages.deleteDisapprovedConfirm);
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(client.getQueryData<Approval>(queryKeys.approvals.detail("approval-a"))?.payload).toEqual(payload);
  confirm.mockReturnValue(true);
  await act(async () => { deleteButton()!.click(); }); await settle();
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(payload.agentId);
  expect(deleteButton()!.disabled).toBe(true);
  expect(mocks.navigate).not.toHaveBeenCalled();
  await act(async () => { deleteButton()!.click(); });
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(mocks.remove).toHaveBeenCalledTimes(1);
  await act(async () => { pendingDelete.resolve({ ok: true }); }); await settle();
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/approvals");
  expect(mocks.reject.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]);
});

it.each(Object.entries(approvalDetailMessages))("preserves failed deletion diagnostics and rejected state in %s", async (locale) => {
  await i18n.changeLanguage(locale);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const payload = { agentId: "agent-original" };
  await mount("rejected", null, "hire_agent", payload);
  for (const error of [new Error("Remote deletion error 原文 {{keep}}"), { privatePayload: "do not display" }]) {
    mocks.remove.mockRejectedValueOnce(error);
    await act(async () => { deleteButton()!.click(); }); await settle();
    expect(host.textContent).toContain(error instanceof Error ? error.message : i18n.t("managementUi.deleteFailed"));
    expect(host.textContent).not.toContain("do not display");
    expect(deleteButton()!.disabled).toBe(false);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(client.getQueryData<Approval>(queryKeys.approvals.detail("approval-a"))?.status).toBe("rejected");
  }
  expect(mocks.remove).toHaveBeenCalledTimes(2);
  expect(mocks.remove).toHaveBeenLastCalledWith(payload.agentId);
});

it.each([
  { status: "pending", type: "hire_agent", payload: { agentId: "agent-original" } },
  { status: "approved", type: "hire_agent", payload: { agentId: "agent-original" } },
  { status: "revision_requested", type: "hire_agent", payload: { agentId: "agent-original" } },
  { status: "rejected", type: "request_board_approval", payload: { agentId: "agent-original" } },
  { status: "rejected", type: "hire_agent", payload: {} },
  { status: "rejected", type: "hire_agent", payload: { agentId: 123 } },
] satisfies Array<Pick<Approval, "status" | "type" | "payload">>)("does not expose agent deletion outside the existing condition: %j", async ({ status, type, payload }) => {
  const confirm = vi.spyOn(window, "confirm");
  await mount(status, null, type, payload);
  expect(deleteButton()).toBeUndefined();
  expect(confirm).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
});

it.each(Object.entries(approvalDetailMessages))("translates only page-owned identity fallbacks in %s", async (locale, messages) => {
  const namedAgent: Agent = { id: "named-agent", companyId: "company-a", name: "Agent", urlKey: "named-agent", role: "engineer", title: null, icon: null, status: "active", reportsTo: null, capabilities: null, adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {}, budgetMonthlyCents: 0, spentMonthlyCents: 0, pauseReason: null, pausedAt: null, permissions: { canCreateAgents: false }, lastHeartbeatAt: null, metadata: null, createdAt: new Date(0), updatedAt: new Date(0) };
  const comment = (id: string, authorAgentId: string | null): ApprovalComment => ({ id, companyId: "company-a", approvalId: "approval-a", authorAgentId, authorUserId: authorAgentId ? null : "user-a", body: `Original comment ${id} {{keep}}`, createdAt: new Date(0), updatedAt: new Date(0) });
  mocks.agents.mockResolvedValue([namedAgent]);
  mocks.comments.mockResolvedValue([comment("unknown-comment", "unknown-agent"), comment("named-comment", namedAgent.id), comment("board-comment", null)]);
  await mount("approved", "unknown-requester");
  const requests = [mocks.get.mock.calls.length, mocks.agents.mock.calls.length, mocks.comments.mock.calls.length];
  await act(async () => { await i18n.changeLanguage(locale); });
  expect(host.querySelector('[data-agent-id="unknown-requester"]')?.textContent).toBe(messages.agent);
  expect(host.querySelector('[data-agent-id="unknown-agent"]')?.textContent).toBe(messages.agent);
  expect(host.querySelector('[data-agent-id="named-agent"]')?.textContent).toBe("Agent");
  expect(host.querySelector('[data-local-identity]')?.textContent).toBe(i18n.t("workflow.board"));
  expect(host.querySelector('a[href="/agents/unknown-agent"]')).not.toBeNull();
  expect(host.textContent).toContain("Original comment unknown-comment {{keep}}");
  expect([mocks.get.mock.calls.length, mocks.agents.mock.calls.length, mocks.comments.mock.calls.length]).toEqual(requests);
});

it.each(Object.entries(approvalDetailMessages))("keeps the %s confirmation contribution contract complete", (_locale, messages) => {
  expect(validateLocaleMessages(messages, approvalDetailMessages.en)).toEqual([]);
  expect(Object.values(messages).every(value => value.trim().length > 0)).toBe(true);
});
