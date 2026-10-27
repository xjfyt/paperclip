// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Company } from "@paperclipai/shared";
import type { HealthStatus } from "../api/health";
import type { Breadcrumb } from "../context/BreadcrumbContext";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { formatCents, relativeTime } from "../lib/utils";
import { Companies } from "./Companies";
import { i18n } from "../i18n";
import { validateLocaleMessages } from "../i18n/locale-validation";
import en from "../i18n/contributions/companiesDirectoryUi/en.json";
import zh from "../i18n/contributions/companiesDirectoryUi/zh-CN.json";
import es from "../i18n/contributions/companiesDirectoryUi/es.json";
import ja from "../i18n/contributions/companiesDirectoryUi/ja.json";

type CompaniesApi = typeof import("../api/companies").companiesApi;
const mockCompaniesApi = vi.hoisted(() => ({
  stats: vi.fn<CompaniesApi["stats"]>(), update: vi.fn<CompaniesApi["update"]>(), remove: vi.fn<CompaniesApi["remove"]>(),
}));
const state = vi.hoisted(() => {
  const value: { companies: Company[]; selectedCompanyId: string | null; loading: boolean; error: Error | null } = {
    companies: [], selectedCompanyId: "company-1", loading: false, error: null,
  };
  return value;
});
const actions = vi.hoisted(() => ({
  onboarding: vi.fn(), select: vi.fn<(id: string) => void>(), breadcrumbs: vi.fn<(crumbs: Breadcrumb[]) => void>(),
}));
vi.mock("../api/companies", () => ({ companiesApi: mockCompaniesApi }));
vi.mock("../context/CompanyContext", () => ({
  useCompany: (): ReturnType<typeof import("../context/CompanyContext").useCompany> => ({
    ...state, selectedCompany: state.companies.find(company => company.id === state.selectedCompanyId) ?? null,
    selectionSource: "manual", companyListUnavailable: Boolean(state.error),
    setSelectedCompanyId: actions.select, retryCompanies: async () => {}, reloadCompanies: async () => {},
    createCompany: async data => makeCompany({ name: data.name }),
  }),
}));
vi.mock("../context/DialogContext", () => ({ useDialogActions: () => ({ openOnboarding: actions.onboarding }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: actions.breadcrumbs }) }));

const locales = ["en", "zh-CN", "es", "ja"] as const;
const messages = { en, "zh-CN": zh, es, ja };
for (const locale of locales) i18n.addResourceBundle(locale, "translation", { companiesDirectoryUi: messages[locale] }, true, true);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const CLOUD_HEALTH: HealthStatus = { status: "ok", cloud: {
  managed: true, managedBy: "paperclip-cloud", stackSlug: "acme-labs", cloudBaseUrl: "https://cloud.example.test",
} };
function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: "company-1", name: "Acme Labs", description: "Original organization description", status: "active",
    pauseReason: null, pausedAt: null, issuePrefix: "PAP", issueCounter: 0, budgetMonthlyCents: 0, spentMonthlyCents: 0,
    defaultResponsibleUserId: null, requireBoardApprovalForNewAgents: false, interactionResolverGovernance: {},
    feedbackDataSharingEnabled: false, feedbackDataSharingConsentAt: null, feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null, logoAssetId: null, logoUrl: null,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"), ...overrides,
  };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  Object.values(mockCompaniesApi).forEach(mock => mock.mockReset()); Object.values(actions).forEach(mock => mock.mockReset());
  state.companies = [makeCompany()]; state.selectedCompanyId = "company-1"; state.loading = false; state.error = null;
  mockCompaniesApi.stats.mockResolvedValue({}); mockCompaniesApi.remove.mockResolvedValue({ ok: true });
  mockCompaniesApi.update.mockImplementation(async (id, data) => makeCompany({ id, ...data }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount()); queryClient.clear(); container.remove(); document.body.innerHTML = "";
  vi.restoreAllMocks(); await i18n.changeLanguage("en");
});
async function flush() { await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); }); }
async function waitFor(assertion: () => void) {
  let error: unknown;
  for (let attempt = 0; attempt < 30; attempt++) { try { assertion(); return; } catch (caught) { error = caught; await flush(); } }
  throw error;
}
async function renderPage({ cloud = false }: { cloud?: boolean } = {}) {
  queryClient.setQueryData(queryKeys.health, cloud ? CLOUD_HEALTH : { status: "ok" } satisfies HealthStatus);
  await act(async () => root.render(<QueryClientProvider client={queryClient}><Companies /></QueryClientProvider>));
  await flush();
}
async function switchLanguage(locale: typeof locales[number]) { await act(async () => { await i18n.changeLanguage(locale); }); await flush(); }
function button(text: string, host: ParentNode = container): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(candidate => candidate.textContent?.trim() === text);
  if (!result) throw new Error(`Missing action: ${text}`);
  return result;
}
function ariaButton(label: string): HTMLButtonElement {
  const result = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(candidate => candidate.getAttribute("aria-label") === label);
  if (!result) throw new Error(`Missing named action: ${label}`);
  return result;
}
async function click(text: string, host?: ParentNode) { await act(async () => button(text, host).click()); await flush(); }
async function openMenu(company: Company) {
  const trigger = ariaButton(i18n.t("companiesDirectoryUi.organizationActions", { name: company.name }));
  await act(async () => { trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })); }); await flush();
  await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
}
async function menuClick(key: "rename" | "unarchive" | "deleteOrganization") {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(candidate => candidate.textContent?.trim() === i18n.t(`companiesDirectoryUi.${key}`));
  expect(item).toBeDefined(); await act(async () => item!.click()); await flush();
}
function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Companies page", () => {
  it.each(locales)("validates directory translations and irreversible confirmation in %s", locale => {
    expect(validateLocaleMessages(messages[locale], en)).toEqual([]);
    const warning = messages[locale].deleteConfirmation;
    expect(warning).toContain({ en: "all its data", "zh-CN": "全部数据", es: "todos sus datos", ja: "すべてのデータ" }[locale]);
    expect(warning).toContain({ en: "cannot be undone", "zh-CN": "无法撤销", es: "no se puede deshacer", ja: "元に戻せません" }[locale]);
  });

  it.each(locales)("offers the company wizard only when self-hosted in %s", async locale => {
    await switchLanguage(locale); await renderPage();
    expect(button(messages[locale].newOrganization)).toBeDefined(); expect(actions.onboarding).not.toHaveBeenCalled();
    await click(messages[locale].newOrganization); expect(actions.onboarding).toHaveBeenCalledTimes(1);
    await renderPage({ cloud: true });
    expect(container.textContent).not.toContain(messages[locale].newOrganization); expect(container.textContent).toContain("Acme Labs");
    expect(actions.onboarding).toHaveBeenCalledTimes(1);
  });

  it.each(locales)("localizes directory status/count wrappers without changing raw organization data in %s", async locale => {
    await switchLanguage(locale);
    const statuses = ["active", "paused", "archived"] as const;
    state.companies = statuses.map((status, index) => makeCompany({ id: `company-${index + 1}`, status,
      name: `组织 <literal> ${index}`, description: `Original description ${index}`, budgetMonthlyCents: index === 1 ? 10000 : 0, spentMonthlyCents: index === 1 ? 2500 : 0 }));
    mockCompaniesApi.stats.mockResolvedValue(Object.fromEntries(state.companies.map((company, count) => [company.id, { agentCount: count, issueCount: count }])));
    await renderPage();
    await waitFor(() => expect(container.textContent).toContain(i18n.t("companiesDirectoryUi.agentCount", { count: 2 })));
    const cards = container.querySelectorAll<HTMLElement>('[role="button"]');
    state.companies.forEach((company, index) => {
      expect(cards[index].textContent).toContain(company.name); expect(cards[index].textContent).toContain(company.description);
      expect(cards[index].textContent).toContain(messages[locale].status[company.status]);
      expect(cards[index].textContent).toContain(i18n.t("companiesDirectoryUi.agentCount", { count: index }));
      expect(cards[index].textContent).toContain(i18n.t("companiesDirectoryUi.taskCount", { count: index }));
      expect(cards[index].textContent).toContain(i18n.t("companiesDirectoryUi.created", { time: relativeTime(company.createdAt) }));
      expect(company.status).toBe(statuses[index]);
    });
    expect(cards[1].textContent).toContain(`${formatCents(2500)} / ${formatCents(10000)} (25%)`);
    expect(cards[0].textContent).toContain(messages[locale].unlimitedBudget); expect(container.querySelector("literal")).toBeNull();
    await act(async () => cards[2].click()); expect(actions.select).toHaveBeenCalledExactlyOnceWith("company-3");
    expect(mockCompaniesApi.update).not.toHaveBeenCalled(); expect(mockCompaniesApi.remove).not.toHaveBeenCalled();
  });

  it.each(locales)("retranslates loading and breadcrumbs while preserving raw errors and empty lists in %s", async locale => {
    await switchLanguage(locale); state.companies = []; state.loading = true;
    const rawError = "Server original <literal> 未改写"; state.error = new Error(rawError);
    await renderPage();
    expect(container.textContent).toContain(messages[locale].loading); expect(container.textContent).toContain(rawError);
    expect(actions.breadcrumbs).toHaveBeenLastCalledWith([{ label: messages[locale].organizations }]);
    const requests = mockCompaniesApi.stats.mock.calls.length;
    await switchLanguage(locale === "ja" ? "zh-CN" : "ja");
    expect(container.textContent).toContain(i18n.t("companiesDirectoryUi.loading")); expect(container.textContent).toContain(rawError);
    expect(actions.breadcrumbs).toHaveBeenLastCalledWith([{ label: i18n.t("companiesDirectoryUi.organizations") }]);
    expect(container.querySelector("literal")).toBeNull(); expect(container.querySelector('[role="button"]')).toBeNull();
    expect(mockCompaniesApi.stats).toHaveBeenCalledTimes(requests); expect(mockCompaniesApi.remove).not.toHaveBeenCalled();
  });

  it.each(locales)("keeps the original inline deletion target across language changes and cancellation in %s", async locale => {
    await switchLanguage(locale);
    const target = makeCompany({ id: "delete-target", name: "原始 <literal> 组织" }); state.companies.push(target);
    const pending = deferred<{ ok: true }>(); mockCompaniesApi.remove.mockReturnValue(pending.promise);
    const nativeConfirm = vi.spyOn(window, "confirm");
    await renderPage(); await openMenu(target); await menuClick("deleteOrganization");
    expect(container.textContent).toContain(messages[locale].deleteConfirmation); expect(mockCompaniesApi.remove).not.toHaveBeenCalled();
    const requests = mockCompaniesApi.stats.mock.calls.length;
    await switchLanguage(locale === "ja" ? "zh-CN" : "ja");
    expect(container.textContent).toContain(i18n.t("companiesDirectoryUi.deleteConfirmation"));
    expect(mockCompaniesApi.stats).toHaveBeenCalledTimes(requests); expect(mockCompaniesApi.remove).not.toHaveBeenCalled();
    await click(i18n.t("commonUi.cancel"));
    expect(container.textContent).not.toContain(i18n.t("companiesDirectoryUi.deleteConfirmation")); expect(mockCompaniesApi.remove).not.toHaveBeenCalled();
    await openMenu(target); await menuClick("deleteOrganization"); await click(i18n.t("commonUi.delete"));
    await waitFor(() => expect(button(i18n.t("companiesDirectoryUi.deleting")).disabled).toBe(true));
    expect(button(i18n.t("commonUi.cancel")).disabled).toBe(true);
    expect(mockCompaniesApi.remove).toHaveBeenCalledExactlyOnceWith("delete-target");
    await switchLanguage(locale);
    expect(button(messages[locale].deleting).disabled).toBe(true); expect(container.textContent).toContain(messages[locale].deleteConfirmation);
    expect(mockCompaniesApi.remove).toHaveBeenCalledTimes(1); expect(actions.select).not.toHaveBeenCalled(); expect(nativeConfirm).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ ok: true })); await flush();
    expect(container.textContent).not.toContain(messages[locale].deleteConfirmation); expect(mockCompaniesApi.remove).toHaveBeenCalledTimes(1);
  });

  it.each(locales)("preserves rename drafts and explicit save/cancel payloads while switching %s", async locale => {
    await switchLanguage(locale); const company = state.companies[0]; await renderPage();
    await act(async () => ariaButton(i18n.t("companiesDirectoryUi.renameOrganization", { name: company.name })).click()); await flush();
    const input = container.querySelector("input")!; input.focus();
    const draft = "  未保存 <literal> 日本語  "; await act(async () => setInput(input, draft)); input.setSelectionRange(2, 6);
    const requests = mockCompaniesApi.stats.mock.calls.length;
    await switchLanguage(locale === "ja" ? "zh-CN" : "ja");
    expect(container.querySelector("input")).toBe(input); expect(input.value).toBe(draft); expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 6]); expect(input.getAttribute("aria-label")).toBe(i18n.t("companiesDirectoryUi.organizationName"));
    expect(mockCompaniesApi.update).not.toHaveBeenCalled(); expect(mockCompaniesApi.stats).toHaveBeenCalledTimes(requests);
    await act(async () => ariaButton(i18n.t("companiesDirectoryUi.cancelRename")).click()); await flush();
    expect(container.querySelector("input")).toBeNull(); expect(mockCompaniesApi.update).not.toHaveBeenCalled();
    await openMenu(company); await menuClick("rename");
    await act(async () => setInput(container.querySelector("input")!, draft));
    await act(async () => ariaButton(i18n.t("companiesDirectoryUi.saveName")).click()); await flush();
    expect(mockCompaniesApi.update).toHaveBeenCalledExactlyOnceWith("company-1", { name: draft.trim() });
    expect(mockCompaniesApi.remove).not.toHaveBeenCalled(); expect(actions.select).not.toHaveBeenCalled();
  });

  it.each(locales)("keeps archived restoration explicit with the original status payload in %s", async locale => {
    await switchLanguage(locale); const company = makeCompany({ status: "archived" }); state.companies = [company];
    await renderPage(); await openMenu(company);
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(messages[locale].unarchive);
    const requests = mockCompaniesApi.stats.mock.calls.length;
    await switchLanguage(locale === "ja" ? "zh-CN" : "ja");
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(i18n.t("companiesDirectoryUi.unarchive"));
    expect(mockCompaniesApi.update).not.toHaveBeenCalled(); expect(mockCompaniesApi.stats).toHaveBeenCalledTimes(requests);
    await menuClick("unarchive"); expect(mockCompaniesApi.update).toHaveBeenCalledExactlyOnceWith("company-1", { status: "active" });
    expect(company.status).toBe("archived"); expect(mockCompaniesApi.remove).not.toHaveBeenCalled();
  });
});
