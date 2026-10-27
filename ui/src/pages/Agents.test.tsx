// @vitest-environment jsdom

import "../i18n/agent-directory-test-resources";

import { i18n, agentTaskQuotaMessages } from "../i18n/agent-task-quota-test-resources";
import { queryKeys } from "../lib/queryKeys";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, Environment, EnvironmentCapabilities } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../context/ToastContext";
import type { BuiltInAgentState } from "../api/builtInAgents";
import { Agents } from "./Agents";
import { Agents as ProductionAgents } from "./Agents.production";
import type { AgentOrgChainHealth } from "@paperclipai/shared";

const mockRouterState = vi.hoisted(() => ({
  pathname: "/agents/all",
  navigate: vi.fn(),
}));

const mockAgentsApi = vi.hoisted(() => ({
  list: vi.fn(),
  org: vi.fn(),
}));

const mockBuiltInAgentsApi = vi.hoisted(() => ({
  list: vi.fn(),
  provision: vi.fn(),
  reset: vi.fn(),
}));

const mockEnvironmentsApi = vi.hoisted(() => ({
  list: vi.fn(),
  capabilities: vi.fn(),
}));

const mockHeartbeatsApi = vi.hoisted(() => ({
  liveRunsForCompany: vi.fn(),
}));

const mockInstanceSettingsApi = vi.hoisted(() => ({
  get: vi.fn(),
}));

const mockResourceMembershipsApi = vi.hoisted(() => ({
  listMine: vi.fn(),
  updateAgent: vi.fn(),
}));

const mockCompanyState = vi.hoisted(() => ({ selectedCompanyId: "company-1" as string | null }));
const mockOpenNewAgent = vi.hoisted(() => vi.fn());
const mockSetBreadcrumbs = vi.hoisted(() => vi.fn());
const mockSidebarState = vi.hoisted(() => ({ isMobile: false }));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useLocation: () => ({ pathname: mockRouterState.pathname, search: "", hash: "", state: null }),
  useNavigate: () => mockRouterState.navigate,
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompanyState,
}));

vi.mock("../context/DialogContext", () => ({
  useDialogActions: () => ({ openNewAgent: mockOpenNewAgent }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mockSetBreadcrumbs }),
}));

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({ isMobile: mockSidebarState.isMobile }),
}));

vi.mock("../api/agents", () => ({
  agentsApi: mockAgentsApi,
}));

vi.mock("../api/builtInAgents", () => ({
  builtInAgentsApi: mockBuiltInAgentsApi,
}));

vi.mock("../api/environments", () => ({
  environmentsApi: mockEnvironmentsApi,
}));

vi.mock("../api/heartbeats", () => ({
  heartbeatsApi: mockHeartbeatsApi,
}));

vi.mock("../api/instanceSettings", () => ({
  instanceSettingsApi: mockInstanceSettingsApi,
}));

vi.mock("../api/resourceMemberships", () => ({
  resourceMembershipsApi: mockResourceMembershipsApi,
}));

vi.mock("../adapters/adapter-display-registry", () => ({
  getAdapterLabel: (type: string) => type,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Alpha",
    urlKey: "alpha",
    role: "engineer",
    title: null,
    icon: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeBuiltInAgentState(overrides: Partial<BuiltInAgentState> = {}): BuiltInAgentState {
  return {
    definition: {
      key: "briefs",
      displayName: "Briefs Agent",
      featureKeys: ["Briefs"],
      shortPurpose: "Generates briefs.",
      defaultInstructions: "You are Paperclip's built-in Briefs agent.",
      defaultRole: "engineer",
    },
    status: "ready",
    agentId: "built-in-agent",
    agent: null,
    pauseReason: null,
    ...overrides,
  };
}

function makeEnvironment(overrides: Partial<Environment>): Environment {
  return {
    id: "env-1",
    name: "Daytona Sandbox",
    description: null,
    driver: "sandbox",
    status: "active",
    config: { provider: "daytona" },
    envVars: {},
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const environmentCapabilities: EnvironmentCapabilities = {
  adapters: [],
  drivers: {
    local: "supported",
    ssh: "supported",
    sandbox: "supported",
    plugin: "supported",
  },
  sandboxProviders: {
    fake: {
      status: "supported",
      supportsSavedProbe: true,
      supportsUnsavedProbe: true,
      supportsRunExecution: true,
      supportsReusableLeases: true,
      supportsInteractiveSetup: false,
      interactiveSetupConnectionTypes: [],
      supportsTemplateCapture: false,
      supportsTemplateDelete: false,
      supportsLoginPty: false,
      displayName: "Fake",
      source: "builtin",
    },
    daytona: {
      status: "supported",
      supportsSavedProbe: true,
      supportsUnsavedProbe: true,
      supportsRunExecution: true,
      supportsReusableLeases: true,
      supportsInteractiveSetup: true,
      interactiveSetupConnectionTypes: ["ssh"],
      supportsTemplateCapture: true,
      supportsTemplateDelete: true,
      supportsLoginPty: true,
      displayName: "Daytona",
      source: "plugin",
    },
  },
};

function makeInstanceSettings({
  defaultEnvironmentId = null,
  enableEnvironments = true,
  enableBuiltInAgents = false,
}: {
  defaultEnvironmentId?: string | null;
  enableEnvironments?: boolean;
  enableBuiltInAgents?: boolean;
} = {}) {
  return {
    id: "instance-settings-1",
    defaultEnvironmentId,
    general: {
      censorUsernameInLogs: true,
      feedbackDataSharingPreference: "prompt",
      backupRetention: {
        dailyDays: 7,
        weeklyWeeks: 4,
        monthlyMonths: 1,
      },
      executionMode: "any",
    },
    experimental: {
      enableEnvironments,
      enableIsolatedWorkspaces: true,
      enableStreamlinedLeftNavigation: false,
      enableAgentChat: false,
      enableConferenceRoomChat: false,
      enableIssuePlanDecompositions: true,
      enableExperimentalFileViewer: false,
      enableExternalObjects: false,
      enableBuiltInAgents,
      autoRestartDevServerWhenIdle: false,
    },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

const invalidOrgChainHealth: AgentOrgChainHealth = {
  status: "invalid_org_chain",
  reason: "terminated_ancestor",
  fullChain: [
    {
      id: "agent-1",
      companyId: "company-1",
      name: "Alpha",
      status: "active",
      reportsTo: "manager-1",
      depth: 0,
      relation: "self",
    },
    {
      id: "manager-1",
      companyId: "company-1",
      name: "Terminated Manager",
      status: "terminated",
      reportsTo: null,
      depth: 1,
      relation: "ancestor",
    },
  ],
  firstInvalidAncestor: { id: "manager-1", name: "Terminated Manager", status: "terminated" },
  invalidAncestors: [{ id: "manager-1", name: "Terminated Manager", status: "terminated" }],
  repairGuidance: "Alpha reports through terminated ancestor Terminated Manager.",
};

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function findAgentRow(container: HTMLElement, agentName: string): HTMLElement | null {
  return Array.from(container.querySelectorAll("a")).find((row) => row.textContent?.includes(agentName)) ?? null;
}

describe("Agents", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null;
  let queryClient: QueryClient;

  beforeEach(() => {
    mockCompanyState.selectedCompanyId = "company-1";
    mockRouterState.pathname = "/agents/all";
    mockRouterState.navigate.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    mockAgentsApi.list.mockResolvedValue([
      makeAgent({
        adapterConfig: { model: "gpt-5.4" },
        // Old enough that relativeTime() falls back to an absolute date string.
        lastHeartbeatAt: new Date("2026-01-15T00:00:00Z"),
      }),
    ]);
    mockAgentsApi.org.mockResolvedValue([
      {
        id: "agent-1",
        name: "Alpha",
        role: "engineer",
        status: "active",
        reports: [],
      },
    ]);
    mockBuiltInAgentsApi.list.mockResolvedValue([]);
    mockEnvironmentsApi.list.mockResolvedValue([
      makeEnvironment({ id: "env-daytona" }),
    ]);
    mockEnvironmentsApi.capabilities.mockResolvedValue(environmentCapabilities);
    mockInstanceSettingsApi.get.mockResolvedValue(makeInstanceSettings());
    mockHeartbeatsApi.liveRunsForCompany.mockResolvedValue([]);
    mockResourceMembershipsApi.listMine.mockResolvedValue({
      projectMemberships: {},
      agentMemberships: {},
      updatedAt: null,
    });
    mockResourceMembershipsApi.updateAgent.mockResolvedValue({
      resourceType: "agent",
      resourceId: "agent-1",
      state: "left",
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    });
    mockSidebarState.isMobile = false;
  });

  afterEach(async () => {
    const currentRoot = root;
    if (currentRoot) {
      await act(async () => {
        currentRoot.unmount();
      });
    }
    queryClient.clear();
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    await i18n.changeLanguage("en");
  });

  describe.each([["streamlined", Agents], ["production", ProductionAgents]] as const)("localized %s agent directory", (mode, AgentList) => {
    const displayCopy = {
      en: { tabs: ["All", "Active", "Paused", "Error", "Built-in"], roles: ["Security", "Engineer", "Designer", "Researcher", "General"], local: "Local", host: "Paperclip host", loading: "Loading environment", managed: "Managed by Paperclip", sandbox: "Sandbox", provider: "PROVIDER sandbox provider", unknown: "Unknown environment" },
      "zh-CN": { tabs: ["全部", "活动", "已暂停", "错误", "内置"], roles: ["安全", "工程师", "设计师", "研究员", "通用"], local: "本地", host: "Paperclip 主机", loading: "正在加载环境", managed: "由 Paperclip 管理", sandbox: "沙箱", provider: "PROVIDER 沙箱提供方", unknown: "未知环境" },
      es: { tabs: ["Todos", "Activo", "Pausado", "Error", "Integrados"], roles: ["Seguridad", "Ingeniero", "Diseñador", "Investigador", "General"], local: "Local", host: "Host de Paperclip", loading: "Cargando entorno", managed: "Administrado por Paperclip", sandbox: "Sandbox", provider: "Proveedor de sandbox PROVIDER", unknown: "Entorno desconocido" },
      ja: { tabs: ["すべて", "有効", "一時停止", "エラー", "組み込み"], roles: ["セキュリティ", "エンジニア", "デザイナー", "リサーチャー", "汎用"], local: "ローカル", host: "Paperclip ホスト", loading: "環境を読み込み中", managed: "Paperclip が管理", sandbox: "サンドボックス", provider: "PROVIDER サンドボックスプロバイダー", unknown: "不明な環境" },
    };

    it.each(Object.entries(displayCopy))("localizes mounted tabs, roles and environment states in %s with stable wire filters", async (locale, copy) => {
      await i18n.changeLanguage(locale);
      const roles = ["security", "engineer", "designer", "researcher", "general", "ceo", "devops", "Role 用户"];
      const environmentIds = [null, "env-local", "env-managed", "env-provider", "missing-environment-用户", "env-ssh", "env-fallback", "env-raw-provider"];
      const agents = roles.map((role, index) => makeAgent({ id: `agent-${index}`, name: `Agent 用户 ${index}`, urlKey: `raw-${index}`, role: role as Agent["role"], title: `Title 原文 ${index}`, defaultEnvironmentId: environmentIds[index], status: index === 1 ? "paused" : index === 2 ? "error" : "active" }));
      const environments = [
        makeEnvironment({ id: "env-local", name: "Named host 原文", driver: "local", config: {} }),
        makeEnvironment({ id: "env-managed", name: "Managed 名称", metadata: { managedByPaperclip: true } }),
        makeEnvironment({ id: "env-provider", name: "Provider env 原文", config: { provider: "daytona" } }),
        makeEnvironment({ id: "env-ssh", name: "SSH target 原文", driver: "ssh", config: {} }),
        makeEnvironment({ id: "env-fallback", name: "Fallback env 原文", config: {} }),
        makeEnvironment({ id: "env-raw-provider", name: "Raw provider env 原文", config: { provider: "Vendor 原名" } }),
      ];
      const original = JSON.stringify({ agents, environments });
      let finishEnvironments!: (value: Environment[]) => void;
      mockAgentsApi.list.mockResolvedValue(agents);
      mockAgentsApi.org.mockResolvedValue(agents.map(agent => ({ id: agent.id, name: agent.name, role: agent.role, status: agent.status, reports: [] })));
      mockEnvironmentsApi.list.mockReturnValue(new Promise<Environment[]>(resolve => { finishEnvironments = resolve; }));
      mockInstanceSettingsApi.get.mockResolvedValue(makeInstanceSettings({ enableBuiltInAgents: true, enableEnvironments: true }));
      mockBuiltInAgentsApi.list.mockResolvedValue([makeBuiltInAgentState({ agentId: "agent-3", agent: agents[3] })]);
      root = createRoot(container);
      const render = async () => { await act(async () => root!.render(<QueryClientProvider client={queryClient}><ToastProvider><AgentList /></ToastProvider></QueryClientProvider>)); await flushReact(); await flushReact(); };
      await render();
      await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("workflow.listView")}"]`)!.click());
      await flushReact();
      expect(container.textContent).toContain(copy.loading);
      expect(container.querySelector(`[title="${copy.loading}"]`)).not.toBeNull();
      const next = locale === "ja" ? "es" : "ja";
      await act(async () => { await i18n.changeLanguage(next); });
      expect(container.textContent).toContain(displayCopy[next].loading);
      await act(async () => finishEnvironments(environments));
      await flushReact(); await flushReact();
      const assertDisplay = (expected: typeof copy) => {
        expect([...container.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(expected.tabs);
        const environmentDetails = [expected.host, expected.host, expected.managed, expected.provider.replace("PROVIDER", "Daytona"), "missing-", "SSH", expected.provider.replace("PROVIDER", expected.sandbox), expected.provider.replace("PROVIDER", "Vendor 原名")];
        agents.forEach((agent, index) => {
          const row = findAgentRow(container, agent.name)!;
          expect(row).not.toBeNull();
          expect(row.getAttribute("href")).toContain(`/agents/raw-${index}`);
          expect(row.textContent).toContain(`${expected.roles[index] ?? ["CEO", "DevOps", "Role 用户"][index - 5]} - Title 原文 ${index}`);
          const environmentName = index === 0 ? expected.local : index === 4 ? expected.unknown : environments.find(environment => environment.id === environmentIds[index])!.name;
          const title = index === 4 ? `${expected.unknown} - missing-environment-用户` : `${environmentName} - ${environmentDetails[index]}`;
          expect(row.querySelector(`[title="${title}"]`)).not.toBeNull();
          expect(row.textContent).toContain(environmentName);
          expect(row.textContent).toContain(environmentDetails[index]);
        });
        expect(container.textContent).not.toContain(expected.loading);
        expect(container.textContent).not.toContain("agentDirectoryUi.");
      };
      assertDisplay(displayCopy[next]);
      const calls = () => [mockAgentsApi.list, mockAgentsApi.org, mockEnvironmentsApi.list, mockEnvironmentsApi.capabilities, mockBuiltInAgentsApi.list].map(mock => mock.mock.calls.map(args => [...args]));
      const beforeLanguageChange = calls();
      await act(async () => { await i18n.changeLanguage(locale); });
      assertDisplay(copy);
      expect(calls()).toEqual(beforeLanguageChange);
      if (mode === "production") {
        await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("workflow.orgChartView")}"]`)!.click());
        await flushReact();
        assertDisplay(copy);
        await act(async () => { await i18n.changeLanguage(next); });
        assertDisplay(displayCopy[next]);
        await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("workflow.listView")}"]`)!.click());
      }
      for (const [index, wire] of ["all", "active", "paused", "error", "builtin"].entries()) {
        if (wire !== "all") {
          await act(async () => { container.querySelectorAll<HTMLElement>('[role="tab"]')[index].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); });
          expect(mockRouterState.navigate).toHaveBeenLastCalledWith(`/agents/${wire}`);
        }
        mockRouterState.pathname = `/agents/${wire}`;
        await render();
        const shown = agents.filter(agent => wire === "all" || (wire === "builtin" ? agent.id === "agent-3" : agent.status === wire));
        expect([...container.querySelectorAll('a[href^="/agents/raw-"]')].map(row => row.getAttribute("href"))).toEqual(shown.map(agent => `/agents/${agent.urlKey}`));
      }
      mockSidebarState.isMobile = true;
      await render();
      const section = container.querySelector<HTMLSelectElement>("select")!;
      expect([...section.options].map(option => option.value)).toEqual(["all", "active", "paused", "error", "builtin"]);
      expect([...section.options].map(option => option.textContent)).toEqual(mode === "production" ? displayCopy[next].tabs : copy.tabs);
      await act(async () => { section.value = "all"; section.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(mockRouterState.navigate).toHaveBeenLastCalledWith("/agents/all");
      expect(mockAgentsApi.list).toHaveBeenCalledWith("company-1");
      expect(mockEnvironmentsApi.list).toHaveBeenCalledExactlyOnceWith("company-1");
      expect(mockBuiltInAgentsApi.provision).not.toHaveBeenCalled();
      expect(mockOpenNewAgent).not.toHaveBeenCalled();
      expect(JSON.stringify({ agents, environments })).toBe(original);
    });

    it.each(Object.entries(displayCopy))("keeps disabled and single-environment branches hidden in %s", async (locale, copy) => {
      await i18n.changeLanguage(locale);
      mockInstanceSettingsApi.get.mockResolvedValue(makeInstanceSettings({ enableEnvironments: false, enableBuiltInAgents: false }));
      root = createRoot(container);
      await act(async () => root!.render(<QueryClientProvider client={queryClient}><ToastProvider><AgentList /></ToastProvider></QueryClientProvider>));
      await flushReact(); await flushReact();
      await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("workflow.listView")}"]`)!.click());
      expect([...container.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(copy.tabs.slice(0, 4));
      expect(container.textContent).not.toContain(copy.host);
      expect(mockEnvironmentsApi.list).not.toHaveBeenCalled();
      expect(mockEnvironmentsApi.capabilities).not.toHaveBeenCalled();
      expect(mockBuiltInAgentsApi.list).not.toHaveBeenCalled();
      await act(async () => { queryClient.setQueryData(queryKeys.instance.settings, makeInstanceSettings({ enableEnvironments: true })); });
      await flushReact(); await flushReact();
      expect(mockEnvironmentsApi.list).toHaveBeenCalledExactlyOnceWith("company-1");
      expect(container.textContent).not.toContain("Daytona Sandbox");
      expect(container.textContent).not.toContain(copy.host);
      await act(async () => { await i18n.changeLanguage(locale === "ja" ? "es" : "ja"); });
      expect(container.textContent).not.toContain("Daytona Sandbox");
      expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
    });

    it.each(Object.entries(agentTaskQuotaMessages))("shows the correct no-company scope in %s without creating anything", async (locale, copy) => {
      await i18n.changeLanguage(locale);
      mockCompanyState.selectedCompanyId = null;
      root = createRoot(container);
      await act(async () => root!.render(<QueryClientProvider client={queryClient}><ToastProvider><AgentList /></ToastProvider></QueryClientProvider>));
      expect(container.textContent).toContain(mode === "streamlined" ? copy.selectOrganizationAgents : copy.selectCompanyAgents);
      expect(mockAgentsApi.list).not.toHaveBeenCalled();
      expect(mockAgentsApi.org).not.toHaveBeenCalled();
      expect(mockOpenNewAgent).not.toHaveBeenCalled();
      expect(mockRouterState.navigate).not.toHaveBeenCalled();
    });

    it.each(Object.entries(agentTaskQuotaMessages))("keeps zero-agent setup explicitly optional through language changes in %s", async (locale, copy) => {
      await i18n.changeLanguage(locale);
      mockAgentsApi.list.mockResolvedValue([]);
      mockAgentsApi.org.mockResolvedValue([]);
      root = createRoot(container);
      await act(async () => root!.render(<QueryClientProvider client={queryClient}><ToastProvider><AgentList /></ToastProvider></QueryClientProvider>));
      await flushReact();
      await vi.waitFor(() => expect(container.textContent).toContain(copy.firstAgent));
      const buttons = () => [...container.querySelectorAll("button")].filter(button => button.textContent === i18n.t("commonUi.newAgent"));
      expect(buttons()).toHaveLength(2);
      expect(mockOpenNewAgent).not.toHaveBeenCalled();
      const next = locale === "ja" ? "es" : "ja";
      await act(async () => { await i18n.changeLanguage(next); });
      expect(container.textContent).toContain(agentTaskQuotaMessages[next].firstAgent);
      expect(buttons()).toHaveLength(2);
      expect(mockOpenNewAgent).not.toHaveBeenCalled();
      await act(async () => buttons()[0]!.click());
      await act(async () => buttons()[1]!.click());
      expect(mockOpenNewAgent).toHaveBeenCalledTimes(2);
      expect(mockRouterState.navigate).not.toHaveBeenCalled();
      expect(mockBuiltInAgentsApi.provision).not.toHaveBeenCalled();
    });

    it.each(Object.keys(agentTaskQuotaMessages))("translates singular/plural counts without changing names or links in %s", async (locale) => {
      await i18n.changeLanguage(locale);
      root = createRoot(container);
      await act(async () => root!.render(<QueryClientProvider client={queryClient}><ToastProvider><AgentList /></ToastProvider></QueryClientProvider>));
      await flushReact();
      await vi.waitFor(() => expect(container.textContent).toContain(i18n.t("companiesDirectoryUi.agentCount", { count: 1 })));
      const listButton = container.querySelector<HTMLButtonElement>(`[aria-label="${i18n.t("workflow.listView")}"]`);
      if (listButton) await act(async () => listButton.click());
      const originalHref = findAgentRow(container, "Alpha")?.getAttribute("href");
      expect(originalHref).toContain("alpha");
      await act(async () => { queryClient.setQueryData(queryKeys.agents.list("company-1"), [makeAgent({}), makeAgent({ id: "agent-2", name: "用户 Beta", urlKey: "beta" })]); });
      await flushReact();
      await vi.waitFor(() => expect(container.textContent).toContain(i18n.t("companiesDirectoryUi.agentCount", { count: 2 })));
      expect(container.textContent).not.toContain("companiesDirectoryUi.");
      expect(container.textContent).toContain("用户 Beta");
      expect(findAgentRow(container, "Alpha")?.getAttribute("href")).toBe(originalHref);
      expect(mockOpenNewAgent).not.toHaveBeenCalled();
      expect(mockResourceMembershipsApi.updateAgent).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["streamlined", Agents],
    ["production", ProductionAgents],
  ] as const)("omits the action bar from %s agent list rows", async (_mode, AgentList) => {
    mockAgentsApi.list.mockResolvedValue([
      makeAgent({ name: "Alpha", status: "active" }),
      makeAgent({ id: "agent-paused", name: "Paused agent", status: "paused" }),
    ]);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <AgentList />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();
    const listToggle = container.querySelector<HTMLButtonElement>('button[aria-label="List view"]');
    await act(async () => { listToggle?.click(); });
    await flushReact();

    for (const name of ["Alpha", "Paused agent"]) {
      const row = findAgentRow(container, name);
      expect(row).not.toBeNull();
      expect(row?.getAttribute("href")).toMatch(/^\/agents\//);
      expect(row?.querySelector('button[aria-label^="Open actions for"]')).toBeNull();
      const buttons = Array.from(row?.querySelectorAll("button") ?? []).map((button) => button.textContent);
      expect(buttons).not.toEqual(expect.arrayContaining([expect.stringMatching(/Assign Task|Run Heartbeat|Run with provider trace|Pause|Resume/)]));
    }
  });

  it("shows the configured model beside the adapter on the all agents page", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("codex_local");
    expect(container.textContent).toContain("gpt-5.4");

    // The heartbeat cell must render on a single line so full dates like
    // "Apr 30, 2026" never wrap (PAP-85 defect #2).
    const heartbeatCell = container.querySelector(".whitespace-nowrap.w-24");
    expect(heartbeatCell).not.toBeNull();
    expect(heartbeatCell?.textContent).not.toContain("\n");
  });

  it("switches between the preserved list and the interactive org chart with icon buttons", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();

    const listToggle = container.querySelector<HTMLButtonElement>('button[aria-label="List view"]');
    const orgToggle = container.querySelector<HTMLButtonElement>('button[aria-label="Org chart view"]');
    expect(listToggle?.getAttribute("aria-pressed")).toBe("true");
    expect(orgToggle?.getAttribute("aria-pressed")).toBe("false");
    expect(orgToggle?.querySelector(".lucide-network")).not.toBeNull();
    expect(orgToggle?.querySelector(".lucide-git-branch")).toBeNull();
    expect(container.querySelector('[data-testid="org-chart-viewport"]')).toBeNull();

    await act(async () => {
      orgToggle?.click();
    });
    await flushReact();
    await flushReact();

    expect(mockAgentsApi.org).toHaveBeenCalledWith("company-1");
    expect(orgToggle?.getAttribute("aria-pressed")).toBe("true");
    const orgViewport = container.querySelector('[data-testid="org-chart-viewport"]');
    expect(orgViewport).not.toBeNull();
    expect(orgViewport?.parentElement?.classList.contains("flex-1")).toBe(true);
    expect(orgViewport?.parentElement?.classList.contains("md:min-h-0")).toBe(true);
    expect(orgViewport?.parentElement?.classList.contains("h-(--sz-calc-38)")).toBe(false);
    expect(orgViewport?.parentElement?.parentElement?.classList.contains("h-full")).toBe(true);
    expect(orgViewport?.parentElement?.parentElement?.classList.contains("min-h-0")).toBe(true);
    expect(container.querySelector('[aria-label="Zoom in"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Zoom out"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Fit chart to screen"]')).not.toBeNull();

    await act(async () => {
      listToggle?.click();
    });
    await flushReact();
    expect(container.querySelector('[data-testid="org-chart-viewport"]')).toBeNull();
    expect(container.textContent).toContain("gpt-5.4");
  });

  it("gives mobile agent names the full row width after the leading status indicator", async () => {
    mockSidebarState.isMobile = true;
    mockResourceMembershipsApi.listMine.mockResolvedValue({
      projectMemberships: {},
      agentMemberships: {
        "agent-mobile": "left",
      },
      starredProjectIds: [],
      starredAgentIds: [],
      projectStarredAt: {},
      agentStarredAt: {},
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    });
    mockAgentsApi.list.mockResolvedValue([
      makeAgent({
        id: "agent-mobile",
        name: "Paperclip Engineer With A Much Longer Display Name",
        title: "Software Engineer With A Much Longer Specialty Title",
        urlKey: "paperclip-engineer-long",
      }),
    ]);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const row = findAgentRow(container, "Paperclip Engineer With A Much Longer Display Name");
    expect(row).not.toBeNull();
    expect(row?.querySelector(".sm\\:hidden")).toBeNull();
    expect(row?.querySelector(".hidden.sm\\:flex")).not.toBeNull();
    expect(row?.querySelector(".flex-1.hidden.\\@5xl\\:block")).not.toBeNull();
    expect(row?.classList.contains("text-foreground/55")).toBe(false);
    expect(row?.classList.contains("sm:text-foreground/55")).toBe(true);
    const name = row?.querySelector("span[title='Paperclip Engineer With A Much Longer Display Name']");
    const subtitle = Array.from(row?.querySelectorAll("p") ?? []).find((node) =>
      node.textContent?.includes("Software Engineer With A Much Longer Specialty Title"),
    );
    expect(name?.classList.contains("truncate")).toBe(true);
    expect(subtitle).toBeDefined();
    expect(subtitle?.classList.contains("truncate")).toBe(true);
    const actions = row?.querySelector('button[aria-label="Open actions for Paperclip Engineer With A Much Longer Display Name"]');
    expect(actions).toBeNull();
    expect(row?.textContent).not.toContain("Assign Task");
    expect(row?.textContent).not.toContain("Run Heartbeat");
    expect(row?.textContent).not.toContain("Run with provider trace");
    expect(row?.textContent).not.toContain("Pause");
  });

  it("uses the built-in agents route segment as the built-in filter", async () => {
    mockRouterState.pathname = "/agents/builtin";
    mockInstanceSettingsApi.get.mockResolvedValue(makeInstanceSettings({ enableBuiltInAgents: true }));
    const builtInAgent = makeAgent({
      id: "built-in-agent",
      name: "Briefs Agent",
      urlKey: "briefs-agent",
    });
    const regularAgent = makeAgent({
      id: "regular-agent",
      name: "Regular Agent",
      urlKey: "regular-agent",
    });
    mockAgentsApi.list.mockResolvedValue([builtInAgent, regularAgent]);
    mockAgentsApi.org.mockResolvedValue([
      {
        id: "built-in-agent",
        name: "Briefs Agent",
        role: "engineer",
        status: "active",
        reports: [],
      },
      {
        id: "regular-agent",
        name: "Regular Agent",
        role: "engineer",
        status: "active",
        reports: [],
      },
    ]);
    mockBuiltInAgentsApi.list.mockResolvedValue([
      makeBuiltInAgentState({ agentId: "built-in-agent", agent: builtInAgent }),
    ]);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("1 agent");
    expect(container.textContent).toContain("Briefs Agent");
    expect(container.textContent).not.toContain("Regular Agent");
  });

  it("shows effective environment and sandbox provider beside agents", async () => {
    mockAgentsApi.list.mockResolvedValue([
      makeAgent({
        defaultEnvironmentId: "env-daytona",
      }),
    ]);
    mockEnvironmentsApi.list.mockResolvedValue([
      makeEnvironment({
        id: "env-local",
        name: "Local",
        driver: "local",
        config: {},
      }),
      makeEnvironment({ id: "env-daytona" }),
    ]);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Daytona Sandbox");
    expect(container.textContent).toContain("Daytona sandbox provider");
  });

  it("uses configured names for local-driver environments", async () => {
    mockAgentsApi.list.mockResolvedValue([
      makeAgent({
        defaultEnvironmentId: "env-local",
      }),
    ]);
    mockEnvironmentsApi.list.mockResolvedValue([
      makeEnvironment({
        id: "env-local",
        name: "Dev Laptop",
        driver: "local",
        config: {},
      }),
      makeEnvironment({ id: "env-daytona" }),
    ]);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Dev Laptop");
    expect(container.textContent).toContain("Paperclip host");
  });

  it("reserves the environment column while environment metadata is loading", async () => {
    let resolveEnvironments: (environments: Environment[]) => void = () => {};
    mockAgentsApi.list.mockResolvedValue([
      makeAgent({
        defaultEnvironmentId: "env-daytona",
      }),
    ]);
    mockEnvironmentsApi.list.mockReturnValue(new Promise((resolve) => {
      resolveEnvironments = resolve;
    }));

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Loading environment");

    await act(async () => {
      resolveEnvironments([
        makeEnvironment({
          id: "env-local",
          name: "Local",
          driver: "local",
          config: {},
        }),
        makeEnvironment({ id: "env-daytona" }),
      ]);
    });
    await flushReact();

    expect(container.textContent).toContain("Daytona Sandbox");
    expect(container.textContent).not.toContain("Loading environment");
  });

  it("hides the environment column when there is only one configured environment", async () => {
    mockAgentsApi.list.mockResolvedValue([
      makeAgent({
        defaultEnvironmentId: "env-daytona",
      }),
    ]);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).not.toContain("Daytona Sandbox");
    expect(container.textContent).not.toContain("Daytona sandbox provider");
  });

  it("hides the environment column when environments are experimentally disabled", async () => {
    mockInstanceSettingsApi.get.mockResolvedValue(makeInstanceSettings({ enableEnvironments: false }));
    mockAgentsApi.list.mockResolvedValue([
      makeAgent({
        id: "agent-local",
        name: "Local Agent",
        urlKey: "local-agent",
        defaultEnvironmentId: null,
      }),
      makeAgent({
        id: "agent-sandbox",
        name: "Sandbox Agent",
        urlKey: "sandbox-agent",
        defaultEnvironmentId: "env-daytona",
      }),
    ]);
    mockAgentsApi.org.mockResolvedValue([
      {
        id: "agent-local",
        name: "Local Agent",
        role: "engineer",
        status: "active",
        reports: [],
      },
      {
        id: "agent-sandbox",
        name: "Sandbox Agent",
        role: "engineer",
        status: "active",
        reports: [],
      },
    ]);
    mockEnvironmentsApi.list.mockResolvedValue([
      makeEnvironment({
        id: "env-local",
        name: "Local",
        driver: "local",
        config: {},
      }),
      makeEnvironment({ id: "env-daytona" }),
    ]);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).not.toContain("Daytona Sandbox");
    expect(container.textContent).not.toContain("Daytona sandbox provider");
    expect(mockEnvironmentsApi.list).not.toHaveBeenCalled();
    expect(mockEnvironmentsApi.capabilities).not.toHaveBeenCalled();
  });

  it("uses the instance default environment unless the agent overrides it", async () => {
    mockAgentsApi.list.mockResolvedValue([
      makeAgent({
        id: "agent-fallback",
        name: "Fallback Agent",
        urlKey: "fallback-agent",
        defaultEnvironmentId: null,
      }),
      makeAgent({
        id: "agent-override",
        name: "Override Agent",
        urlKey: "override-agent",
        defaultEnvironmentId: "env-override",
      }),
    ]);
    mockAgentsApi.org.mockResolvedValue([
      {
        id: "agent-fallback",
        name: "Fallback Agent",
        role: "engineer",
        status: "active",
        reports: [],
      },
      {
        id: "agent-override",
        name: "Override Agent",
        role: "engineer",
        status: "active",
        reports: [],
      },
    ]);
    mockEnvironmentsApi.list.mockResolvedValue([
      makeEnvironment({
        id: "env-default",
        name: "Instance Default",
        config: { provider: "daytona" },
      }),
      makeEnvironment({
        id: "env-override",
        name: "Agent Override",
        config: { provider: "daytona" },
      }),
    ]);
    mockInstanceSettingsApi.get.mockResolvedValue(makeInstanceSettings({ defaultEnvironmentId: "env-default" }));

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const fallbackRow = findAgentRow(container, "Fallback Agent");
    const overrideRow = findAgentRow(container, "Override Agent");
    expect(fallbackRow?.textContent).toContain("Instance Default");
    expect(overrideRow?.textContent).toContain("Agent Override");
    expect(overrideRow?.textContent).not.toContain("Instance Default");
  });

  it("falls back to the raw sandbox provider config when capabilities omit a display name", async () => {
    mockAgentsApi.list.mockResolvedValue([
      makeAgent({
        defaultEnvironmentId: "env-custom",
      }),
    ]);
    mockEnvironmentsApi.list.mockResolvedValue([
      makeEnvironment({
        id: "env-local",
        name: "Local",
        driver: "local",
        config: {},
      }),
      makeEnvironment({
        id: "env-custom",
        name: "Custom Sandbox",
        config: { provider: "acme_sandbox" },
      }),
    ]);
    mockEnvironmentsApi.capabilities.mockResolvedValue({
      ...environmentCapabilities,
      sandboxProviders: {},
    });

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Custom Sandbox");
    expect(container.textContent).toContain("acme_sandbox sandbox provider");
  });

  it("does not show environment filter or grouping controls yet", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.querySelector('select[aria-label="Filter by environment"]')).toBeNull();
    expect(container.querySelector('select[aria-label="Group agents"]')).toBeNull();
  });

  it("hides built-in agent surfaces while the experimental flag is disabled", async () => {
    mockRouterState.pathname = "/agents/builtin";

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(mockBuiltInAgentsApi.list).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Built-in");
    expect(mockRouterState.navigate).toHaveBeenCalledWith("/agents/all", { replace: true });
  });

  it("shows and filters built-in agents when the experimental flag is enabled", async () => {
    mockRouterState.pathname = "/agents/builtin";
    mockInstanceSettingsApi.get.mockResolvedValue(makeInstanceSettings({ enableBuiltInAgents: true }));
    mockAgentsApi.list.mockResolvedValue([
      makeAgent({
        id: "built-in-agent",
        name: "Briefs Agent",
        urlKey: "briefs-agent",
      }),
      makeAgent({
        id: "regular-agent",
        name: "Regular Agent",
        urlKey: "regular-agent",
      }),
    ]);
    mockAgentsApi.org.mockResolvedValue([
      {
        id: "built-in-agent",
        name: "Briefs Agent",
        role: "engineer",
        status: "active",
        reports: [],
      },
      {
        id: "regular-agent",
        name: "Regular Agent",
        role: "engineer",
        status: "active",
        reports: [],
      },
    ]);
    mockBuiltInAgentsApi.list.mockResolvedValue([
      makeBuiltInAgentState({ agentId: "built-in-agent" }),
    ]);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(mockBuiltInAgentsApi.list).toHaveBeenCalledWith("company-1");
    expect(container.textContent).toContain("Built-in");
    expect(container.textContent).toContain("Briefs Agent");
    expect(container.textContent).not.toContain("Regular Agent");
    expect(container.querySelector('[title="Ships with Paperclip"]')).toBeNull();
    expect(mockRouterState.navigate).not.toHaveBeenCalledWith("/agents/all", { replace: true });
  });

  it("gives list-view rows a fixed-width title so meta columns align (PAP-86)", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    // Keep the list view selected before checking its aligned metadata columns.
    const listToggle = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.querySelector("svg.lucide-list"),
    );
    expect(listToggle).toBeDefined();
    await act(async () => {
      listToggle!.click();
    });
    await flushReact();

    // The title cell carries a constant width in a wide container, not a
    // content-sized `min-w-(--sz-7rem)`, so the `meta` group starts at the same
    // x on every row and the model + timestamp columns line up vertically.
    // In narrower containers metadata is hidden and the title flexes (`flex-1`)
    // instead, so the shrink-0 trailing actions can't squeeze the agent name
    // to zero width on mobile.
    const titleCell = container.querySelector(".\\@5xl\\:w-56");
    expect(titleCell).not.toBeNull();
    expect(titleCell?.textContent).toContain("Alpha");
    expect(titleCell?.classList.contains("flex-1")).toBe(true);
    expect(container.querySelector(".min-w-\\(--sz-7rem\\)")).toBeNull();
  });

  it.each([
    ["streamlined", Agents],
    ["production", ProductionAgents],
  ] as const)("omits star and leave/join actions from %s agent index list and org views", async (_mode, AgentList) => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <AgentList />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    // Explicitly select the list view and assert the row renders there.
    const listToggle = container.querySelector<HTMLButtonElement>('button[aria-label="List view"]');
    expect(listToggle).not.toBeNull();
    await act(async () => {
      listToggle!.click();
    });
    await flushReact();
    const listRow = findAgentRow(container, "Alpha");
    expect(listRow).not.toBeNull();
    expect(container.querySelector('[aria-label="Leave Alpha"]')).toBeNull();
    expect(container.querySelector('[aria-label="Join Alpha"]')).toBeNull();
    expect(container.querySelector('[aria-label="Star Alpha"]')).toBeNull();

    // Explicitly select the org view and assert no membership actions there.
    const orgToggle = container.querySelector<HTMLButtonElement>('button[aria-label="Org chart view"]');
    expect(orgToggle).not.toBeNull();
    await act(async () => {
      orgToggle!.click();
    });
    await flushReact();
    await flushReact();
    expect(container.textContent).toContain("Alpha");
    expect(container.querySelector('[aria-label="Leave Alpha"]')).toBeNull();
    expect(container.querySelector('[aria-label="Join Alpha"]')).toBeNull();
    expect(container.querySelector('[aria-label="Star Alpha"]')).toBeNull();
  });

  it("does not dim left-membership agent names on mobile", async () => {
    mockSidebarState.isMobile = true;
    mockResourceMembershipsApi.listMine.mockResolvedValue({
      projectMemberships: {},
      agentMemberships: {
        "agent-1": "left",
      },
      starredProjectIds: [],
      starredAgentIds: [],
      projectStarredAt: {},
      agentStarredAt: {},
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    });

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    const row = findAgentRow(container, "Alpha");
    expect(row).not.toBeNull();
    expect(row?.classList.contains("text-foreground/55")).toBe(false);
    expect(row?.classList.contains("sm:text-foreground/55")).toBe(true);
  });

  it("keeps invalid-org-chain agents visible with a warning marker", async () => {
    mockAgentsApi.list.mockResolvedValue([
      makeAgent({ orgChainHealth: invalidOrgChainHealth }),
    ]);

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <Agents />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Alpha");
    expect(container.querySelector('[aria-label="Invalid reporting chain"]')).not.toBeNull();
  });
});
