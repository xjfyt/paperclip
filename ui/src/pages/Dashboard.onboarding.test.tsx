// @vitest-environment jsdom
import "../i18n/optional-onboarding-test-resources";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "../i18n";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const setup = vi.hoisted(() => ({ allowed: true, pending: false, failed: false }));
const openOnboarding = vi.hoisted(() => vi.fn());
const setBreadcrumbs = vi.hoisted(() => vi.fn());
const agents = vi.hoisted(() => ({ list: vi.fn(async () => []), resume: vi.fn() }));
vi.mock("@/hooks/useCompanyAgentCreationAccess", () => ({ useCompanyAgentCreationAccess: () => setup }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "c1", companies: [{ id: "c1", issuePrefix: "PC1" }] }) }));
vi.mock("../context/DialogContext", () => ({ useDialogActions: () => ({ openOnboarding }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs }) }));
vi.mock("../api/agents", () => ({ agentsApi: agents }));
vi.mock("../api/dashboard", () => ({ dashboardApi: { summary: async () => null } }));
vi.mock("../api/activity", () => ({ activityApi: { list: async () => [] } }));
vi.mock("../api/issues", () => ({ issuesApi: { list: async () => [] } }));
vi.mock("../api/projects", () => ({ projectsApi: { list: async () => [] } }));
vi.mock("../api/access", () => ({ accessApi: { listUserDirectory: async () => ({ users: [] }) } }));
vi.mock("../hooks/useSharedPolling", () => ({ useSharedPollingQuery: () => ({}), usePublishSharedQueryData: () => {} }));
vi.mock("../components/ActiveAgentsPanel", () => ({ ActiveAgentsPanel: () => <section>Dashboard content</section> }));
vi.mock("../components/SmokeLabDashboardCard", () => ({ SmokeLabDashboardCard: () => null }));
vi.mock("@/plugins/slots", () => ({ PluginSlotOutlet: () => null }));
const { Dashboard } = await import("./Dashboard");

beforeEach(() => { vi.clearAllMocks(); setup.allowed = true; });
afterEach(async () => { await i18n.changeLanguage("en"); });

it.each(["en", "zh-CN", "es", "ja"])("keeps a zero-agent dashboard usable and setup explicit in %s", async locale => {
  await i18n.changeLanguage(locale);
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const render = (key: number) => root.render(<QueryClientProvider client={client}><MemoryRouter><Dashboard key={key} /></MemoryRouter></QueryClientProvider>);
  try {
    for (let visit = 0; visit < 2; visit++) {
      await act(async () => render(visit));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
      expect(container.textContent).toContain("Dashboard content");
      expect(container.textContent).toContain(i18n.t("optionalOnboarding.noAgents"));
      expect(openOnboarding).not.toHaveBeenCalled();
      expect(agents.resume).not.toHaveBeenCalled();
    }
    const configure = [...container.querySelectorAll("button")].find(button => button.textContent === i18n.t("optionalOnboarding.configureAgent"));
    expect(configure).toBeDefined();
    await act(async () => configure!.click());
    expect(openOnboarding).toHaveBeenCalledExactlyOnceWith({ initialStep: 3, companyId: "c1" });
    setup.allowed = false;
    await act(async () => render(2));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(container.textContent).toContain(i18n.t("authGate.askAdmin"));
    expect([...container.querySelectorAll("button")].some(button => button.textContent === i18n.t("optionalOnboarding.configureAgent"))).toBe(false);
  } finally { await act(async () => root.unmount()); client.clear(); container.remove(); }
});
