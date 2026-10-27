// @vitest-environment jsdom
import "../i18n/agent-directory-test-resources";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { instanceGeneralSettingsSchema, instanceExperimentalSettingsWithManagedSchema, type AgentDetail as AgentRecord, type Company } from "@paperclipai/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentDetail, AgentOverview } from "./AgentDetail";
import { TooltipProvider } from "../components/ui/tooltip";
import { queryKeys } from "../lib/queryKeys";
import { i18n } from "../i18n";

const api = vi.hoisted(() => ({ agent: vi.fn(), identity: vi.fn(), revisions: vi.fn(), access: vi.fn(), general: vi.fn(), experimental: vi.fn(), memberships: vi.fn() }));
const context = vi.hoisted(() => ({ closePanel: vi.fn(), setBreadcrumbs: vi.fn(), setSelectedCompanyId: vi.fn(), pushToast: vi.fn(), openNewIssue: vi.fn() }));
vi.mock("../api/agents", () => ({ agentsApi: { get: api.agent, getIdentity: api.identity, listConfigRevisions: api.revisions } }));
vi.mock("../api/access", () => ({ accessApi: { getCurrentBoardAccess: api.access } }));
vi.mock("../api/instanceSettings", () => ({ instanceSettingsApi: { getGeneral: api.general, getExperimental: api.experimental } }));
vi.mock("../api/resourceMemberships", () => ({ resourceMembershipsApi: { listMine: api.memberships } }));
vi.mock("../lib/router", async () => await import("react-router-dom"));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ companies: [company], selectedCompanyId: company.id, setSelectedCompanyId: context.setSelectedCompanyId }), useOptionalCompany: () => null }));
vi.mock("../context/PanelContext", () => ({ usePanel: () => ({ closePanel: context.closePanel }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: context.setBreadcrumbs }) }));
vi.mock("../context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: false }) }));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast: context.pushToast }) }));
vi.mock("../context/DialogContext", () => ({ useDialogActions: () => ({ openNewIssue: context.openNewIssue }) }));
vi.mock("../components/AgentCharacter", () => ({ AgentCharacter: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const date = new Date("2026-01-01T00:00:00Z");
const company: Company = {
  id: "company-original", name: "Original company", description: null, status: "active", pauseReason: null,
  pausedAt: null, issuePrefix: "RAW", issueCounter: 1, budgetMonthlyCents: 0, spentMonthlyCents: 0,
  defaultResponsibleUserId: null, requireBoardApprovalForNewAgents: false, interactionResolverGovernance: {},
  feedbackDataSharingEnabled: false, feedbackDataSharingConsentAt: null, feedbackDataSharingConsentByUserId: null,
  feedbackDataSharingTermsVersion: null, logoAssetId: null, logoUrl: null, createdAt: date, updatedAt: date,
};
function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return { id: "agent-original", companyId: company.id, name: 'Agent "用户" <raw>', urlKey: "raw-agent", role: "engineer",
    title: null, icon: null, status: "active", reportsTo: null, capabilities: null,
    adapterType: "codex_local", adapterConfig: { model: "raw-model" }, runtimeConfig: {}, budgetMonthlyCents: 0,
    spentMonthlyCents: 0, pauseReason: null, pausedAt: null, permissions: { canCreateAgents: false },
    lastHeartbeatAt: null, metadata: null, createdAt: date, updatedAt: date, chainOfCommand: [],
    access: { canAssignTasks: true, taskAssignSource: "explicit_grant", membership: null, grants: [] }, ...overrides };
}
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let agent: AgentRecord;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  Object.values(api).forEach(mock => mock.mockReset());
  agent = makeAgent(); api.agent.mockImplementation(async () => agent); api.identity.mockResolvedValue(null); api.revisions.mockResolvedValue([]);
  api.access.mockResolvedValue({ user: null, userId: "operator", isInstanceAdmin: false, companyIds: [company.id], source: "session", keyId: null });
  api.general.mockResolvedValue(instanceGeneralSettingsSchema.parse({}));
  api.experimental.mockResolvedValue(instanceExperimentalSettingsWithManagedSchema.parse({}));
  api.memberships.mockResolvedValue({ projectMemberships: {}, agentMemberships: {}, starredProjectIds: [], starredAgentIds: [], starredDocumentIds: [], projectStarredAt: {}, agentStarredAt: {}, documentStarredAt: {}, updatedAt: null });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected unmocked request"); }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.unstubAllGlobals(); await i18n.changeLanguage("en"); });
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/agents/raw-agent/revisions"]}><TooltipProvider>
    <Routes><Route path="/agents/:agentId/:tab" element={<AgentDetail />} /></Routes>
    <div data-testid="overview"><AgentOverview agent={agent} runs={[]} assignedIssues={[]} directReportCount={0} skillNames={[]} agentRouteId="raw-agent" /></div>
  </TooltipProvider></MemoryRouter></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
it.each([
  ["en", "Engineer", "Designer"], ["zh-CN", "工程师", "设计师"],
  ["es", "Ingeniero", "Diseñador"], ["ja", "エンジニア", "デザイナー"],
] as const)("localizes actual detail header and overview roles in %s while keeping title priority and raw identity", async (locale, engineer, designer) => {
  await i18n.changeLanguage(locale);
  await render();
  await act(async () => { await vi.waitFor(() => expect(container.querySelector("header")).not.toBeNull()); });
  const header = () => container.querySelector("header")!;
  const role = () => [...container.querySelectorAll('[data-testid="overview"] span')].find(span => span.textContent === i18n.t("workflow.role"))!.parentElement!;
  expect(header().textContent).toContain(engineer);
  expect(role().textContent).toContain(engineer);
  const before = api.agent.mock.calls.map(args => [...args]);
  await act(async () => { await i18n.changeLanguage(locale === "ja" ? "zh-CN" : "ja"); });
  expect(header().textContent).toContain(locale === "ja" ? "工程师" : "エンジニア");
  expect(role().textContent).toContain(locale === "ja" ? "工程师" : "エンジニア");
  expect(api.agent.mock.calls).toEqual(before);
  await act(async () => { await i18n.changeLanguage(locale); });
  const update = async (patch: Partial<AgentRecord>) => {
    agent = { ...agent, ...patch };
    await act(async () => { client.setQueryData([...queryKeys.agents.detail("raw-agent"), company.id], agent); });
    await render();
  };
  await update({ role: "designer", title: "Lead 用户 <original>" });
  expect(header().textContent).toContain("Lead 用户 <original>");
  expect(header().textContent).not.toContain(designer);
  expect(role().textContent).toContain(designer);
  await update({ role: "Future role 用户" as AgentRecord["role"], title: "" });
  expect(header().textContent).toContain("Future role 用户");
  expect(role().textContent).toContain("Future role 用户");
  expect(header().textContent).toContain('Agent "用户" <raw>');
  expect(container.textContent).toContain("raw-model");
  expect(container.textContent).not.toContain("agentDirectoryUi.");
  expect(api.agent.mock.calls).toEqual(before);
  expect(fetch).not.toHaveBeenCalled();
});
