// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FastResponseSettings, FastResponseTestResult } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fastResponseSettingsMessages, i18n } from "@/i18n/fast-response-settings-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import { formatNumber } from "@/lib/utils";
import { FastResponseSettingsSection, FastResponseSettingsView } from "./FastResponseSettings";
import { choices } from "../../../storybook/stories/decision-models/fixtures";
const api = vi.hoisted(() => ({ settings: vi.fn(), models: vi.fn(), update: vi.fn(), test: vi.fn() }));
vi.mock("@/api/fast-responses", () => ({ fastResponsesApi: api }));
vi.mock("@/features/connections/ConnectionSetupFlow", () => ({ ConnectionSetupFlow: ({ serviceSlug }: { serviceSlug: string }) => <div data-testid="setup-provider">{serviceSlug}</div> }));
vi.mock("@/pages/apps/AppLogo", () => ({ AppLogo: () => null }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompany: { issuePrefix: "ACM" } }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const settings: FastResponseSettings = { companyId: "company-1", enabled: true, connectionId: choices[0]!.id, grantId: choices[0]!.grantId, provider: "openai", model: "provider/raw-model", allowSponsored: true };
const result: FastResponseTestResult = { status: "succeeded", invocationId: "fixture", text: "模型 <b> response_Ω", durationMs: 1234, usage: { inputTokens: 12345, outputTokens: 0, costCents: "0.0014", costStatus: "estimated" } };
let host: HTMLDivElement, root: Root, client: QueryClient;
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };
const language = async (locale: string) => { await act(async () => { await i18n.changeLanguage(locale); }); };
const button = (label: string) => [...host.querySelectorAll("button")].find(node => node.textContent === label)!;
async function render(children: React.ReactNode) { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>)); }
async function input(value: string) {
  const field = host.querySelector<HTMLInputElement>("input[list]")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
}
beforeEach(() => {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  for (const mock of Object.values(api)) mock.mockReset();
  api.models.mockResolvedValue([{ id: "provider/model-id", label: "用户模型 Ω" }]);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await language("en"); });

describe.each(Object.entries(fastResponseSettingsMessages))("fast response settings %s", (locale, strings) => {
  it("renders labels, charge warning and result metadata without translating model/user output", async () => {
    expect(validateLocaleMessages(strings, fastResponseSettingsMessages.en)).toEqual([]); await language(locale);
    const onSave = vi.fn(), onTest = vi.fn();
    await render(<FastResponseSettingsView settings={settings} choices={choices} models={[{ id: "provider/model-id", label: "用户模型 Ω" }]} result={result} error="Provider <b> raw_error" onSave={onSave} onTest={onTest} />);
    expect(host.querySelector("section")?.getAttribute("aria-label")).toBe(strings.title);
    const field = host.querySelector<HTMLInputElement>("input[list]")!;
    expect(field.placeholder).toBe(strings.modelPlaceholder); expect(field.value).toBe(settings.model);
    expect(host.querySelector(`label[for="${field.id}"]`)?.textContent).toBe(strings.model);
    expect(host.querySelector("option")?.value).toBe("provider/model-id"); expect(host.querySelector("option")?.textContent).toBe("用户模型 Ω");
    expect(host.querySelector('[role="switch"]')?.getAttribute("aria-label")).toBe(strings.enable);
    expect(host.querySelectorAll('[role="switch"]')[1]?.getAttribute("aria-label")).toBe(strings.allowSponsored);
    for (const value of [strings.description, strings.sponsoredDescription, strings.testCharge, result.text, "Provider <b> raw_error", choices[0]!.name]) expect(host.textContent).toContain(value);
    expect(host.textContent).toContain(i18n.t("fastResponseSettingsUi.usageRecorded", { seconds: formatNumber(1.234, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), input: formatNumber(12345), output: formatNumber(0) }));
    expect(host.querySelector("b")).toBeNull(); expect(host.textContent).not.toContain("fastResponseSettingsUi.");
    expect(onSave).not.toHaveBeenCalled(); expect(onTest).not.toHaveBeenCalled();
    await act(async () => button(strings.test).click()); expect(onTest).toHaveBeenCalledTimes(1);
  });
  it("distinguishes timeout/failure from success and retains unknown usage as unknown", async () => {
    await language(locale); const callbacks = { onSave: vi.fn(), onTest: vi.fn() };
    for (const reason of ["timeout", "provider_new_failure"]) {
      await render(<FastResponseSettingsView settings={settings} choices={choices} result={{ status: "failed", reason }} {...callbacks} />);
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(reason === "timeout" ? strings.timeout : strings.testFailed);
      expect(host.querySelector('[role="status"]')).toBeNull();
    }
    await render(<FastResponseSettingsView settings={settings} choices={choices} result={{ ...result, usage: { inputTokens: null, outputTokens: null, costCents: null, costStatus: "unpriced" } }} {...callbacks} />);
    expect(host.textContent).toContain(i18n.t("fastResponseSettingsUi.usageRecorded", { seconds: formatNumber(1.234, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), input: "—", output: "—" }));
  });
  it("localizes empty/unavailable and busy states without changing access or enabling a pending save", async () => {
    await language(locale); const callbacks = { onSave: vi.fn(), onTest: vi.fn(), onAdd: vi.fn() };
    await render(<FastResponseSettingsView settings={settings} choices={[]} {...callbacks} />);
    expect(host.textContent).toContain(strings.empty); expect(host.textContent).toContain(strings.unavailable);
    await render(<FastResponseSettingsView settings={settings} choices={choices.map(row => ({ ...row, status: "needs_attention" as const }))} testing {...callbacks} />);
    expect(host.textContent).toContain(strings.needsAttention); expect(button(strings.testing).disabled).toBe(true);
    expect(host.querySelector("fieldset")?.disabled).toBe(true);
    await render(<FastResponseSettingsView settings={settings} choices={choices} {...callbacks} />);
    await input("manual/model-Ω");
    await render(<FastResponseSettingsView settings={settings} choices={choices} saving {...callbacks} />);
    expect(button(strings.saving).disabled).toBe(true);
    api.settings.mockResolvedValue({ canManage: false, settings: null, choices: [] });
    await render(<FastResponseSettingsSection companyId="no-management-permission" />); await flush();
    expect(host.textContent).toBe(""); expect(api.test).not.toHaveBeenCalled(); expect(api.update).not.toHaveBeenCalled();
  });
  it("separates failed settings/models reads from empty results and permits an explicit read retry", async () => {
    await language(locale); let reject!: (error: Error) => void;
    api.settings.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    await render(<FastResponseSettingsSection companyId={settings.companyId} />);
    expect(host.textContent).toBe(strings.loading);
    await act(async () => { reject(new Error("read failed")); }); await flush();
    expect(host.textContent).toContain(strings.loadFailed); expect(host.querySelector("section")).toBeNull();
    api.settings.mockResolvedValue({ canManage: true, settings, choices }); api.models.mockRejectedValue(new Error("catalog failed"));
    await act(async () => button(strings.retry).click()); await flush(); await flush();
    expect(api.settings).toHaveBeenCalledTimes(2); expect(api.settings).toHaveBeenLastCalledWith(settings.companyId);
    expect(host.textContent).toContain(strings.modelsFailed); expect(host.textContent).not.toContain(strings.empty);
    expect(host.querySelector<HTMLInputElement>("input[list]")?.disabled).toBe(false);
    expect(api.test).not.toHaveBeenCalled(); expect(api.update).not.toHaveBeenCalled();
  });
});
it("hot-switches a custom-model draft and provider dialog without changing selection, catalog requests or mutation count", async () => {
  api.settings.mockResolvedValue({ canManage: true, settings, choices });
  api.update.mockImplementation(async (_, draft) => ({ ...settings, ...draft }));
  await render(<FastResponseSettingsSection companyId={settings.companyId} />); await flush(); await flush();
  await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${choices[1]!.name}"]`)!.click()); await flush();
  await input("自定义/provider-model_Ω");
  await act(async () => host.querySelectorAll<HTMLButtonElement>('[role="switch"]')[1]!.click());
  await act(async () => button(fastResponseSettingsMessages.en.addConnection).click());
  const dialog = document.querySelector('[role="dialog"]')!, field = host.querySelector<HTMLInputElement>("input[list]")!;
  await act(async () => dialog.querySelector<HTMLButtonElement>('button[aria-label="OpenRouter"]')!.click());
  const reads = api.models.mock.calls.length;
  for (const [locale, strings] of Object.entries(fastResponseSettingsMessages)) {
    await language(locale);
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(dialog.textContent).toContain(strings.addTitle); expect(dialog.textContent).toContain(strings.addDescription);
    expect(dialog.querySelector('[data-testid="setup-provider"]')?.textContent).toBe("openrouter");
    expect(host.querySelector("input[list]")).toBe(field); expect(field.value).toBe("自定义/provider-model_Ω");
    expect(field.placeholder).toBe(strings.modelPlaceholder);
    expect(host.querySelector('[aria-pressed="true"]')?.getAttribute("aria-label")).toBe(choices[1]!.name);
    expect(host.querySelectorAll('[role="switch"]')[1]?.getAttribute("aria-checked")).toBe("false");
    expect(host.textContent).toContain(strings.saveBeforeTest);
    expect(api.settings).toHaveBeenCalledTimes(1); expect(api.models).toHaveBeenCalledTimes(reads);
    expect(api.update).not.toHaveBeenCalled(); expect(api.test).not.toHaveBeenCalled();
  }
  await act(async () => dialog.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!.click());
  await act(async () => button(fastResponseSettingsMessages.ja.save).click()); await flush();
  expect(api.update).toHaveBeenCalledTimes(1);
  expect(api.update).toHaveBeenLastCalledWith(settings.companyId, { connectionId: choices[1]!.id, grantId: choices[1]!.grantId, model: "自定义/provider-model_Ω", enabled: true, allowSponsored: false });
});
