// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Company, PluginRecord, SidebarBadges } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { useSidebar } from "@/context/SidebarContext";
import { queryKeys } from "@/lib/queryKeys";
import { SIDEBAR_SCROLL_RESET_STATE } from "@/lib/navigation-scroll";
import { usePluginSlots, type ResolvedPluginSlot } from "@/plugins/slots";
import { TooltipProvider } from "./ui/tooltip";
import { SidebarNavExpandedProvider } from "./SidebarNavItem.production";
import { CompanySettingsSidebar } from "./CompanySettingsSidebar.production";
import { i18n, productionSettingsNavMessages } from "@/i18n/production-settings-nav-test-resources";
import en from "@/i18n/contributions/settingsUi/en.json";
import zh from "@/i18n/contributions/settingsUi/zh-CN.json";
import ja from "@/i18n/contributions/settingsUi/ja.json";
import es from "@/i18n/contributions/settingsUi/es.json";

const mocks = vi.hoisted(() => ({
  badges: vi.fn<(companyId: string) => Promise<SidebarBadges>>(),
  plugins: vi.fn<() => Promise<PluginRecord[]>>(),
  slots: vi.fn<typeof usePluginSlots>(),
}));
const state = vi.hoisted((): {
  selectedCompany: Company | null; selectedCompanyId: string | null;
  hidden: Set<string>; fast: boolean; sidebar: ReturnType<typeof useSidebar>;
} => ({
  selectedCompany: null, selectedCompanyId: null,
  hidden: new Set<string>(), fast: true,
  sidebar: {
    sidebarOpen: true, setSidebarOpen: vi.fn(), toggleSidebar: vi.fn(), isMobile: false,
    collapsed: false, setCollapsed: vi.fn(), toggleCollapsed: vi.fn(), collapseLocked: false,
    peeking: false, setPeeking: vi.fn(), forceCollapsed: false, setForceCollapsed: vi.fn(),
    routeRequestsCollapsed: false, setRouteRequestsCollapsed: vi.fn(),
  },
}));
vi.mock("@/api/sidebarBadges", () => ({ sidebarBadgesApi: { get: mocks.badges } }));
vi.mock("@/api/plugins", () => ({ pluginsApi: { list: mocks.plugins } }));
vi.mock("@/plugins/slots", () => ({ usePluginSlots: mocks.slots }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => state }));
vi.mock("@/context/SidebarContext", () => ({ useSidebar: () => state.sidebar }));
vi.mock("@/hooks/useHiddenSettings", () => ({ useHiddenSettings: () => ({ hidden: state.hidden }) }));
vi.mock("@/hooks/useFastResponsesEnabled", () => ({ useFastResponsesEnabled: () => ({ enabled: state.fast }) }));
// Keep the real company-aware Link/NavLink; no issue quicklook is used by settings routes.
vi.mock("@/components/IssueLinkQuicklook", () => ({ IssueLinkQuicklook: () => null }));
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });

const settingsMessages = { en, "zh-CN": zh, ja, es };
const locales = ["en", "zh-CN", "ja", "es"] as const;
const company: Company = {
  id: "company-original", name: 'Org "用户" 日本語', description: "Original description", status: "active",
  pauseReason: null, pausedAt: null, issuePrefix: "ORG", issueCounter: 7,
  budgetMonthlyCents: 100, spentMonthlyCents: 4, defaultResponsibleUserId: null,
  requireBoardApprovalForNewAgents: false, interactionResolverGovernance: {},
  feedbackDataSharingEnabled: false, feedbackDataSharingConsentAt: null, feedbackDataSharingConsentByUserId: null,
  feedbackDataSharingTermsVersion: null, logoAssetId: null, logoUrl: null,
  createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"),
};
function plugin(id: string, drivers: PluginRecord["manifestJson"]["environmentDrivers"] = []): PluginRecord {
  return {
    id, pluginKey: `original.${id}`, packageName: `@original/${id}`, version: "1.0.0", apiVersion: 1,
    categories: [], status: "ready", installOrder: null, packagePath: null, lastError: null,
    installedAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"),
    manifestJson: {
      id: `original.${id}`, apiVersion: 1, version: "1.0.0", displayName: `Plugin ${id} 日本語`,
      description: "Raw plugin description", author: "原作者", categories: [], capabilities: [],
      entrypoints: { worker: "worker.js" }, environmentDrivers: drivers,
    },
  };
}
const slot: ResolvedPluginSlot = {
  type: "companySettingsPage", id: "permissions", displayName: "General 用户权限", exportName: "PermissionsPage",
  routePath: "custom-permissions", pluginId: "plugin-original", pluginKey: "original.permissions",
  pluginDisplayName: "原始插件", pluginVersion: "1.0.0",
};
const paths = {
  general: "/company/settings", profile: "/company/settings/instance/profile", members: "/company/settings/members",
  secrets: "/company/settings/secrets", environments: "/company/settings/instance/environments",
  connections: "/company/settings/connections", access: "/company/settings/instance/access",
  export: "/company/export", import: "/company/import", experimental: "/company/settings/instance/experimental",
  plugins: "/company/settings/instance/plugins", adapters: "/company/settings/instance/adapters",
} as const;
function LocationProbe() {
  const location = useLocation();
  return <output data-location={location.pathname} data-state={JSON.stringify(location.state)} />;
}
async function settle(assertion: () => void) {
  for (let attempt = 0; ; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    try { assertion(); return; } catch (error) { if (attempt >= 19) throw error; }
  }
}

describe("production CompanySettingsSidebar localization", () => {
  let container: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.clearAllMocks();
    state.selectedCompany = company; state.selectedCompanyId = company.id;
    state.hidden = new Set(); state.fast = true;
    state.sidebar.collapsed = false; state.sidebar.isMobile = false;
    mocks.badges.mockResolvedValue({ inbox: 0, approvals: 0, failedRuns: 0, joinRequests: 2 });
    mocks.plugins.mockResolvedValue([]);
    mocks.slots.mockReturnValue({ slots: [], isLoading: false, errorMessage: null });
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });
  async function render({ path = "/ORG/company/settings/members", expanded = true, cloud = false } = {}) {
    client.setQueryData(queryKeys.health, { status: "ok", cloud: cloud ? {
      managed: true, managedBy: "paperclip-cloud", stackSlug: "original", cloudBaseUrl: "https://cloud.example.test",
    } : null });
    const sidebar = <CompanySettingsSidebar />;
    await act(async () => root.render(
      <QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><TooltipProvider>
        {expanded ? <SidebarNavExpandedProvider>{sidebar}</SidebarNavExpandedProvider> : sidebar}
        <LocationProbe />
      </TooltipProvider></MemoryRouter></QueryClientProvider>,
    ));
    await settle(() => expect(client.isFetching()).toBe(0));
  }
  function link(path: string) { return container.querySelector<HTMLAnchorElement>(`a[href="${path}"]`); }
  async function language(locale: typeof locales[number]) { await act(async () => { await i18n.changeLanguage(locale); }); }

  it.each(locales)("renders all labels in %s without changing raw names, hrefs, selection, collapse preference or requests", async locale => {
    state.sidebar.collapsed = true;
    mocks.slots.mockReturnValue({ slots: [slot, { ...slot, id: "no-route", routePath: undefined }], isLoading: false, errorMessage: null });
    mocks.plugins.mockResolvedValue([plugin("visible"), plugin("sandbox", [
      { driverKey: "sandbox", kind: "sandbox_provider", displayName: "原始沙箱" },
    ]), plugin("mixed", [
      { driverKey: "sandbox", kind: "sandbox_provider", displayName: "原始沙箱" },
      { driverKey: "runner", kind: "environment_driver", displayName: "Raw runner" },
    ])]);
    await render();
    const selected = link("/ORG/company/settings/members");
    const hrefs = Array.from(container.querySelectorAll("a"), anchor => anchor.getAttribute("href"));
    await language(locale);
    for (const [key, path] of Object.entries(paths)) {
      const expected = settingsMessages[locale][key as keyof typeof paths];
      expect(link(`/ORG${path}`)?.textContent).toBe(expected + (key === "members" ? "2" : ""));
    }
    expect(link("/ORG/company/settings/invites")?.textContent).toBe(productionSettingsNavMessages[locale].invites);
    expect(link("/ORG/company/settings/instance/heartbeats")?.textContent).toBe(productionSettingsNavMessages[locale].heartbeats);
    expect(link("/ORG/dashboard")?.textContent).toBe(company.name);
    expect(link("/ORG/company/settings/custom-permissions")?.textContent).toBe(slot.displayName);
    expect(link("/ORG/company/settings/instance/plugins/visible")?.textContent).toBe("Plugin visible 日本語");
    expect(link("/ORG/company/settings/instance/plugins/mixed")?.textContent).toBe("Plugin mixed 日本語");
    expect(link("/ORG/company/settings/instance/plugins/sandbox")).toBeNull();
    expect(Array.from(container.querySelectorAll("a")).filter(anchor => anchor.textContent === slot.displayName)).toHaveLength(1);
    expect(Array.from(container.querySelectorAll("a"), anchor => anchor.getAttribute("href"))).toEqual(hrefs);
    expect(link("/ORG/company/settings/members")).toBe(selected);
    expect(selected?.getAttribute("aria-current")).toBe("page");
    expect(link("/ORG/company/settings")?.getAttribute("aria-current")).toBeNull();
    expect(selected?.querySelector("span.min-w-0")).not.toBeNull();
    expect(state.selectedCompany).toBe(company);
    expect(state.selectedCompanyId).toBe(company.id);
    expect(state.sidebar.collapsed).toBe(true);
    expect(state.sidebar.setCollapsed).not.toHaveBeenCalled();
    expect(state.sidebar.setSidebarOpen).not.toHaveBeenCalled();
    expect(container.querySelector("output")?.getAttribute("data-location")).toBe("/ORG/company/settings/members");
    expect(mocks.badges).toHaveBeenCalledExactlyOnceWith(company.id);
    expect(mocks.plugins).toHaveBeenCalledTimes(1);
    expect(mocks.slots).toHaveBeenLastCalledWith({ slotTypes: ["companySettingsPage"], companyId: company.id, enabled: true });
    expect(Object.keys(productionSettingsNavMessages[locale])).toEqual(["invites", "heartbeats"]);
  });

  it.each(locales)("updates collapsed accessible labels in %s without expanding the rail", async locale => {
    state.sidebar.collapsed = true;
    await render({ expanded: false });
    const selected = link("/ORG/company/settings/members");
    await language(locale);
    expect(link("/ORG/company/settings/members")).toBe(selected);
    expect(selected?.getAttribute("aria-label")).toBe(`${settingsMessages[locale].members}, 2`);
    expect(selected?.querySelector("span.text-transparent")).not.toBeNull();
    expect(selected?.getAttribute("aria-current")).toBe("page");
    expect(state.sidebar.collapsed).toBe(true);
    expect(state.sidebar.setCollapsed).not.toHaveBeenCalled();
    expect(mocks.badges).toHaveBeenCalledTimes(1); expect(mocks.plugins).toHaveBeenCalledTimes(1);
  });

  it.each(locales)("retains mobile close, navigation state and nested active matching in %s", async locale => {
    state.sidebar.isMobile = true;
    await render({ path: "/ORG/company/export/details" });
    await language(locale);
    expect(link("/ORG/company/export")?.getAttribute("aria-current")).toBe("page");
    await act(async () => link("/ORG/company/settings/invites")!.click());
    expect(state.sidebar.setSidebarOpen).toHaveBeenCalledExactlyOnceWith(false);
    expect(container.querySelector("output")?.getAttribute("data-location")).toBe("/ORG/company/settings/invites");
    expect(JSON.parse(container.querySelector("output")!.getAttribute("data-state")!)).toEqual(SIDEBAR_SCROLL_RESET_STATE);
    await act(async () => link("/ORG/dashboard")!.click());
    expect(state.sidebar.setSidebarOpen).toHaveBeenCalledTimes(2);
    expect(container.querySelector("output")?.getAttribute("data-location")).toBe("/ORG/dashboard");
    expect(mocks.badges).toHaveBeenCalledTimes(1); expect(mocks.plugins).toHaveBeenCalledTimes(1);
  });

  it("keeps hidden-page IDs, fast-response and cloud gates unchanged across languages", async () => {
    state.hidden = new Set(["instance.profile", "company.members", "company.invites", "company.secrets", "instance.environments",
      "instance.access", "instance.heartbeats", "company.export", "company.import", "instance.experimental", "instance.plugins", "instance.adapters"]);
    state.fast = false;
    await render();
    for (const locale of locales) {
      await language(locale);
      expect(Array.from(container.querySelectorAll("a"), anchor => anchor.getAttribute("href"))).toEqual(["/ORG/dashboard", "/ORG/company/settings"]);
    }
    expect(mocks.plugins).not.toHaveBeenCalled(); expect(mocks.badges).toHaveBeenCalledTimes(1);
  });

  it("hides only import on cloud instances while keeping export and fast-response connections", async () => {
    await render({ cloud: true });
    for (const locale of locales) {
      await language(locale);
      expect(link("/ORG/company/import")).toBeNull();
      expect(link("/ORG/company/export")?.textContent).toBe(settingsMessages[locale].export);
      expect(link("/ORG/company/settings/connections")?.textContent).toBe(settingsMessages[locale].connections);
    }
    expect(mocks.plugins).toHaveBeenCalledTimes(1); expect(mocks.badges).toHaveBeenCalledTimes(1);
  });

  it("translates only the no-company fallback and keeps company-scoped requests disabled", async () => {
    state.selectedCompany = null; state.selectedCompanyId = null;
    state.hidden.add("instance.plugins");
    await render({ path: "/company/settings" });
    const expected = { en: "Company", "zh-CN": "公司", ja: "会社", es: "Empresa" };
    for (const locale of locales) { await language(locale); expect(link("/dashboard")?.textContent).toBe(expected[locale]); }
    expect(mocks.badges).not.toHaveBeenCalled(); expect(mocks.plugins).not.toHaveBeenCalled();
    expect(mocks.slots).toHaveBeenLastCalledWith({ slotTypes: ["companySettingsPage"], companyId: null, enabled: false });
  });

  it.each([401, 403, 500])("does not retry or rewrite a %s badge failure on language changes", async status => {
    const error = new ApiError("Raw server failure 原文", status, { code: "original_code" });
    mocks.badges.mockRejectedValue(error);
    await render();
    for (const locale of locales) {
      await language(locale);
      expect(link("/ORG/company/settings/members")?.textContent).toBe(settingsMessages[locale].members);
    }
    expect(mocks.badges).toHaveBeenCalledExactlyOnceWith(company.id);
    expect(error.message).toBe("Raw server failure 原文");
    expect(client.getQueryState(queryKeys.sidebarBadges(company.id))?.error).toBe(status === 500 ? error : null);
  });
});
