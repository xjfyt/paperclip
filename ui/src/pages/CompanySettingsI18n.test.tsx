// @vitest-environment jsdom
import { ApiUnavailableError } from "@/api/response";
import { apiErrorMessages } from "@/i18n/api-errors-test-resources";

import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import type { AssetImage, Company } from "@paperclipai/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryKeys } from "@/lib/queryKeys";
import { i18n, companySettingsGeneralMessages as messagesByLocale } from "../i18n/company-settings-general-test-resources";
import { validateLocaleMessages } from "../i18n/locale-validation";
import { CompanySettings } from "./CompanySettings";

const mocks = vi.hoisted(() => ({
  update: vi.fn(), archive: vi.fn(), upload: vi.fn(), navigate: vi.fn(),
  navigateTopLevel: vi.fn(), setSelectedCompanyId: vi.fn(), setBreadcrumbs: vi.fn(), pushToast: vi.fn(),
}));
const companyState: { companies: Company[]; selectedCompany: Company | null; selectedCompanyId: string | null } = vi.hoisted(() => ({
  companies: [], selectedCompany: null, selectedCompanyId: null,
}));
vi.mock("../api/companies", () => ({ companiesApi: { update: mocks.update, archive: mocks.archive } }));
vi.mock("../api/assets", () => ({ assetsApi: { uploadCompanyLogo: mocks.upload } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ ...companyState, setSelectedCompanyId: mocks.setSelectedCompanyId }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mocks.setBreadcrumbs }) }));
vi.mock("../context/ToastContext", () => ({ useOptionalToastActions: () => ({ pushToast: mocks.pushToast }) }));
vi.mock("../hooks/useFastResponsesEnabled", () => ({ useFastResponsesEnabled: () => ({ enabled: true, loaded: true }) }));
vi.mock("react-router-dom", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-router-dom")>(), useNavigate: () => mocks.navigate,
}));
vi.mock("@/lib/browserNavigation", () => ({ navigateTopLevel: mocks.navigateTopLevel }));
vi.mock("./InstanceGeneralSettings", () => ({ InstanceGeneralSettings: () => null }));
vi.mock("../components/InteractionGovernancePanel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/InteractionGovernancePanel")>();
  return { ...actual, InteractionGovernancePanel: ({ onChange, errorMessage, isPending }: ComponentProps<typeof actual.InteractionGovernancePanel>) => (
    <div data-testid="governance-child">
      <button disabled={isPending} onClick={() => onChange("request_confirmation", "cap", "human_only")}>governance-test-action</button>
      {errorMessage}
    </div>
  ) };
});
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: "company-original", name: 'Org "用户" 日本語', description: "Original description 原文", status: "active",
    pauseReason: null, pausedAt: null, issuePrefix: "ORG", issueCounter: 7,
    budgetMonthlyCents: 100, spentMonthlyCents: 4, defaultResponsibleUserId: null,
    requireBoardApprovalForNewAgents: false, interactionResolverGovernance: {},
    feedbackDataSharingEnabled: false, feedbackDataSharingConsentAt: null, feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null, logoAssetId: "logo-original", logoUrl: "/api/assets/logo-original",
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z"), ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const asset: AssetImage = {
  assetId: "asset-original", companyId: "company-original", provider: "local_disk", objectKey: "logo/original.png",
  contentType: "image/png", byteSize: 3, sha256: "a".repeat(64), originalFilename: "原图.png", createdByAgentId: null,
  createdByUserId: "user-original", createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
  contentPath: "/api/assets/asset-original/content",
};
async function waitFor(assertion: () => void) {
  for (let attempt = 0; ; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    try { assertion(); return; } catch (error) { if (attempt >= 19) throw error; }
  }
}

describe("CompanySettings actual-page localization", () => {
  let container: HTMLDivElement;
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    for (const mock of Object.values(mocks)) mock.mockReset();
    companyState.selectedCompany = company();
    companyState.selectedCompanyId = "company-original";
    companyState.companies = [companyState.selectedCompany];
    mocks.update.mockResolvedValue(company());
    mocks.archive.mockResolvedValue(company({ status: "archived" }));
    mocks.upload.mockResolvedValue(asset);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    container = document.createElement("div"); document.body.appendChild(container);
  });
  afterEach(() => { container.remove(); vi.restoreAllMocks(); });
  async function render(managed = false) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.health, { status: "ok", cloud: managed ? {
      managed: true, managedBy: "paperclip-cloud", stackSlug: "original", cloudBaseUrl: "https://cloud.example.test",
    } : null });
    const root = createRoot(container);
    await act(async () => root.render(<QueryClientProvider client={queryClient}><TooltipProvider><CompanySettings /></TooltipProvider></QueryClientProvider>));
    return { queryClient, close: async () => { await act(async () => root.unmount()); queryClient.clear(); } };
  }
  function button(text: string) {
    const result = Array.from(container.querySelectorAll("button")).find(item => item.textContent === text);
    expect(result, text).toBeDefined(); return result!;
  }
  async function setInput(input: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function chooseFile() {
    const file = new File(["png"], "原图.png", { type: "image/png" });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    return file;
  }

  it.each(Object.entries(messagesByLocale))("validates the contribution contract in %s", (_locale, messages) => {
    expect(validateLocaleMessages(messages, messagesByLocale.en)).toEqual([]);
    for (const value of Object.values(messages)) expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
  });

  it.each(Object.entries(messagesByLocale))("uses the latest locale for native confirmation and cancellation makes no API call in %s", async (locale, messages) => {
    const view = await render(true);
    try {
      await act(async () => { await i18n.changeLanguage(locale); });
      expect(container.querySelector("h1")?.textContent).toBe(messages.general);
      for (const label of [messages.organizationName, messages.description, messages.logo, messages.appearance, messages.hiring, messages.dangerZone, messages.renameWarning, messages.archiveHint]) expect(container.textContent).toContain(label);
      expect(container.querySelector('input[type="file"]')?.getAttribute("accept")).toBe("image/png,image/jpeg,image/webp,image/gif,image/svg+xml");
      expect(container.querySelector('[data-testid="company-settings-team-approval-toggle"]')?.getAttribute("aria-label")).toBe(messages.approvalRequired);
      expect(mocks.setBreadcrumbs).toHaveBeenLastCalledWith([{ label: company().name, href: "/dashboard" }, { label: messages.settings }]);
      vi.mocked(window.confirm).mockReturnValue(false);
      await act(async () => button(messages.archiveOrganization).click());
      expect(window.confirm).toHaveBeenCalledExactlyOnceWith(messages.archiveConfirm.replace("{{name}}", company().name));
      for (const mock of [mocks.archive, mocks.update, mocks.upload, mocks.navigate, mocks.navigateTopLevel, mocks.pushToast, mocks.setSelectedCompanyId]) expect(mock).not.toHaveBeenCalled();
    } finally { await view.close(); }
  });

  it.each(Object.entries(messagesByLocale).flatMap(([locale, messages]) => [false, true].map(sibling => ({ locale, messages, sibling }))))("keeps archive pending guarded and uses completion locale for sibling=$sibling from $locale", async ({ locale, messages, sibling }) => {
    await i18n.changeLanguage(locale);
    const nextCompany = company({ id: "company-next", name: "Next 组织 / 日本語", issuePrefix: "NEXT" });
    if (sibling) companyState.companies.push(nextCompany);
    const request = deferred<Company>(); mocks.archive.mockReturnValueOnce(request.promise);
    const view = await render();
    try {
      const action = button(messages.archiveOrganization);
      await act(async () => action.click());
      await waitFor(() => expect(action.textContent).toBe(messages.archiving));
      expect(action.disabled).toBe(true);
      await act(async () => action.click());
      expect(window.confirm).toHaveBeenCalledTimes(1);
      expect(mocks.archive).toHaveBeenCalledExactlyOnceWith("company-original");
      const nextLocale = locale === "ja" ? "es" : "ja"; const next = messagesByLocale[nextLocale];
      await act(async () => { await i18n.changeLanguage(nextLocale); });
      expect(action.textContent).toBe(next.archiving);
      await act(async () => request.resolve(company({ status: "archived" })));
      await waitFor(() => expect(mocks.pushToast).toHaveBeenCalledWith({
        title: next.archivedTitle.replace("{{name}}", company().name),
        body: sibling ? next.switchedBody.replace("{{name}}", nextCompany.name) : next.unarchiveListBody,
        tone: "info", dedupeKey: "company-archive-departure:company-original",
      }));
      expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(sibling ? "/NEXT/dashboard" : "/ORG/companies", { replace: true });
      expect(mocks.setSelectedCompanyId.mock.calls).toEqual(sibling ? [["company-next"]] : []);
      expect(mocks.archive).toHaveBeenCalledTimes(1); expect(mocks.update).not.toHaveBeenCalled();
    } finally { await view.close(); }
  });

  it.each(Object.entries(messagesByLocale))("preserves unsaved inputs and exact save/hiring payloads across locale changes in %s", async (locale, messages) => {
    const view = await render();
    try {
      const [name, description] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="text"]'));
      await setInput(name, "  Name 用户 / 日本語  "); await setInput(description, "  Description 原文  ");
      await act(async () => { await i18n.changeLanguage(locale); });
      expect(container.querySelector('input[type="text"]')).toBe(name); expect(name.value).toBe("  Name 用户 / 日本語  ");
      expect(description.value).toBe("  Description 原文  "); expect(description.placeholder).toBe(messages.descriptionPlaceholder);
      expect(mocks.update).not.toHaveBeenCalled();
      const request = deferred<Company>(); mocks.update.mockReturnValueOnce(request.promise);
      const save = button(messages.saveChanges); await act(async () => save.click());
      await waitFor(() => expect(save.textContent).toBe(messages.saving)); expect(save.disabled).toBe(true);
      await act(async () => save.click());
      expect(mocks.update).toHaveBeenCalledExactlyOnceWith("company-original", { name: "Name 用户 / 日本語", description: "Description 原文" });
      await act(async () => request.resolve(company())); await waitFor(() => expect(container.textContent).toContain(messages.saved));
      await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="company-settings-team-approval-toggle"]')!.click());
      expect(mocks.update).toHaveBeenLastCalledWith("company-original", { requireBoardApprovalForNewAgents: true });
      expect(mocks.archive).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
    } finally { await view.close(); }
  });

  it.each(Object.entries(messagesByLocale).flatMap(([locale, messages]) =>
    (["archive", "save", "upload", "governance"] as const).flatMap(action => [false, true].map(raw => ({ locale, messages, action, raw }))),
  ))("refreshes only local $action errors, raw=$raw in $locale", async ({ locale, messages, action, raw }) => {
    await i18n.changeLanguage(locale);
    const key = action === "archive" ? "archiveFailed" : action === "save" ? "saveFailed" : action === "upload" ? "logoUploadFailed" : "governanceFailed";
    // Deliberately collide with local English copy; server strings must not be recognized by text.
    const diagnostic = messagesByLocale.en[key];
    const api = action === "archive" ? mocks.archive : action === "upload" ? mocks.upload : mocks.update;
    api.mockRejectedValueOnce(raw ? new Error(diagnostic) : { code: "failed" });
    const view = await render();
    try {
      if (action === "save") {
        await setInput(container.querySelector<HTMLInputElement>('input[type="text"]')!, "Draft 原文");
        await act(async () => button(messages.saveChanges).click());
      } else if (action === "upload") await chooseFile();
      else await act(async () => button(action === "archive" ? messages.archiveOrganization : "governance-test-action").click());
      await waitFor(() => expect(container.textContent).toContain(raw ? diagnostic : messages[key]));
      const nextLocale = locale === "ja" ? "es" : "ja"; const next = messagesByLocale[nextLocale];
      await act(async () => { await i18n.changeLanguage(nextLocale); });
      expect(container.textContent).toContain(raw ? diagnostic : next[key]); expect(api).toHaveBeenCalledTimes(1);
      expect(mocks.navigate).not.toHaveBeenCalled(); expect(mocks.pushToast).not.toHaveBeenCalled();
      if (action === "governance") expect(mocks.update).toHaveBeenCalledWith("company-original", { interactionResolverGovernance: { request_confirmation: { cap: "human_only" } } });
      if (action === "upload") expect(mocks.update).not.toHaveBeenCalled();
    } finally { await view.close(); }
  });

  it.each(Object.entries(messagesByLocale))("preserves logo bytes, asset IDs, remove behavior and latest pending labels in %s", async (locale, messages) => {
    await i18n.changeLanguage(locale);
    const request = deferred<AssetImage>(); mocks.upload.mockReturnValueOnce(request.promise);
    const view = await render();
    try {
      const file = await chooseFile(); await waitFor(() => expect(container.textContent).toContain(messages.uploadingLogo));
      expect(mocks.upload).toHaveBeenCalledExactlyOnceWith("company-original", file); expect(mocks.update).not.toHaveBeenCalled();
      const nextLocale = locale === "ja" ? "es" : "ja"; const next = messagesByLocale[nextLocale];
      await act(async () => { await i18n.changeLanguage(nextLocale); });
      expect(container.textContent).toContain(next.uploadingLogo);
      await act(async () => request.resolve(asset));
      await waitFor(() => expect(mocks.update).toHaveBeenCalledExactlyOnceWith("company-original", { logoAssetId: "asset-original" }));
      const removal = deferred<Company>(); mocks.update.mockReturnValueOnce(removal.promise);
      const remove = button(next.removeLogo); await act(async () => remove.click());
      await waitFor(() => expect(remove.textContent).toBe(next.removingLogo)); expect(remove.disabled).toBe(true);
      await act(async () => remove.click()); expect(mocks.update).toHaveBeenCalledTimes(2);
      expect(mocks.update).toHaveBeenLastCalledWith("company-original", { logoAssetId: null });
      await act(async () => removal.resolve(company({ logoAssetId: null, logoUrl: null })));
      await waitFor(() => expect(container.textContent).not.toContain(next.removeLogo));
    } finally { await view.close(); }
  });

  it.each(Object.entries(messagesByLocale))("keeps no-selection and already-archived guards intact in %s", async (locale, messages) => {
    await i18n.changeLanguage(locale); companyState.selectedCompany = null; companyState.selectedCompanyId = null;
    let view = await render();
    try {
      expect(container.textContent).toContain(messages.noOrganization); expect(container.querySelector("button")).toBeNull();
      expect(mocks.setBreadcrumbs).toHaveBeenLastCalledWith([{ label: messages.company, href: "/dashboard" }, { label: messages.settings }]);
    } finally { await view.close(); }
    companyState.selectedCompany = company();
    view = await render();
    try {
      await act(async () => button(messages.archiveOrganization).click());
      expect(window.confirm).not.toHaveBeenCalled(); expect(mocks.archive).not.toHaveBeenCalled();
    } finally { await view.close(); }
    companyState.selectedCompany = company({ status: "archived" }); companyState.selectedCompanyId = "company-original";
    view = await render();
    try {
      const archive = button(messages.alreadyArchived); expect(archive.disabled).toBe(true); await act(async () => archive.click());
      expect(window.confirm).not.toHaveBeenCalled(); expect(mocks.archive).not.toHaveBeenCalled();
    } finally { await view.close(); }
  });
  it.each((["archive", "save", "upload", "remove"] as const).flatMap(action => [true, false].map(local => ({ action, local }))))(
    "keeps typed $action outage translatable after rejection, local=$local", async ({ action, local }) => {
      const failure = local ? new ApiUnavailableError(503) : new Error(apiErrorMessages.en.unavailable);
      const api = action === "archive" ? mocks.archive : action === "upload" ? mocks.upload : mocks.update;
      api.mockRejectedValueOnce(failure);
      const view = await render();
      try {
        if (action === "save") {
          await setInput(container.querySelector<HTMLInputElement>('input[type="text"]')!, "Draft 原文");
          await act(async () => button(messagesByLocale.en.saveChanges).click());
        } else if (action === "upload") await chooseFile();
        else await act(async () => button(action === "archive" ? messagesByLocale.en.archiveOrganization : messagesByLocale.en.removeLogo).click());
        await waitFor(() => expect(container.textContent).toContain(apiErrorMessages.en.unavailable));
        for (const [locale, messages] of Object.entries(apiErrorMessages)) {
          await act(async () => { await i18n.changeLanguage(locale); });
          expect(container.textContent).toContain(local ? messages.unavailable : apiErrorMessages.en.unavailable);
        }
        expect(api).toHaveBeenCalledTimes(1);
        expect(failure.message).toBe(apiErrorMessages.en.unavailable);
        expect(mocks.navigate).not.toHaveBeenCalled();
      } finally { await view.close(); }
    },
  );

});
