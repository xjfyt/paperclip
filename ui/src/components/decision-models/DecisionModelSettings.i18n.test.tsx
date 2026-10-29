// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DecisionResult } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decisionSettingsMessages, i18n } from "@/i18n/decision-settings-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import { formatNumber } from "@/lib/utils";
import { DecisionModelSettingsSection, DecisionModelSettingsView } from "./DecisionModelSettings";
import { choices, configured, result } from "../../../storybook/stories/decision-models/fixtures";
const api = vi.hoisted(() => ({ settings: vi.fn(), update: vi.fn(), test: vi.fn() }));
vi.mock("@/api/decision-models", () => ({ decisionModelsApi: api }));
vi.mock("@/features/connections/ConnectionSetupFlow", () => ({ ConnectionSetupFlow: ({ serviceSlug }: { serviceSlug: string }) => <div data-testid="setup-provider">{serviceSlug}</div> }));
vi.mock("@/pages/apps/AppLogo", () => ({ AppLogo: () => null }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompany: { issuePrefix: "ACM" } }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };
const language = async (locale: string) => { await act(async () => { await i18n.changeLanguage(locale); }); };
const button = (label: string, scope: ParentNode = host) => [...scope.querySelectorAll("button")].find(node => node.textContent === label)!;
async function render(children: React.ReactNode) { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>)); }
beforeEach(() => {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  for (const mock of Object.values(api)) mock.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await language("en"); });

describe.each(Object.entries(decisionSettingsMessages))("decision settings %s", (locale, strings) => {
  it("renders localized controls and test feedback while preserving provider choices and raw errors", async () => {
    expect(validateLocaleMessages(strings, decisionSettingsMessages.en)).toEqual([]); await language(locale);
    const onSave = vi.fn(), onTest = vi.fn(), onAdd = vi.fn();
    await render(<DecisionModelSettingsView settings={configured} choices={choices} result={result} error="Provider <b> raw_error" onSave={onSave} onTest={onTest} onAdd={onAdd} />);
    for (const value of [strings.title, strings.description, strings.backgroundDescription, strings.working, strings.usageRecorded, strings.testCharge, ...Object.values(strings.answers)]) expect(host.textContent).toContain(value);
    expect(host.querySelector('[role="switch"]')?.getAttribute("aria-label")).toBe(strings.enable);
    expect(host.querySelectorAll('[role="switch"]')[1]?.getAttribute("aria-label")).toBe(strings.allowBackground);
    expect(host.querySelector('a[href="/ACM/activity/costs?tab=decisions"]')?.textContent).toBe(strings.viewUsage);
    for (const value of [choices[0]!.name, choices[0]!.decisionModel, "billing", "Provider <b> raw_error"]) expect(host.textContent).toContain(value);
    expect(host.textContent).toContain(formatNumber(0.99, { style: "percent", maximumFractionDigits: 0 }));
    expect(host.textContent).toContain(formatNumber(0.08, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    expect(host.querySelector("b")).toBeNull();
    expect(host.textContent).not.toContain("decisionSettingsUi.");
    expect(onSave).not.toHaveBeenCalled(); expect(onTest).not.toHaveBeenCalled();
    await act(async () => button(strings.test).click()); expect(onTest).toHaveBeenCalledTimes(1);
  });
  it("localizes known failure codes and does not relabel unknown answer fields", async () => {
    await language(locale); const callbacks = { onSave: vi.fn(), onTest: vi.fn(), onAdd: vi.fn() };
    for (const [code, message] of Object.entries(strings.failure)) {
      const failure: DecisionResult = { status: "failed", invocationId: "fixture", errorCode: code === "fallback" ? "new_provider_error" : code, usage: { inputTokens: null, outputTokens: null, costCents: null, costStatus: "unpriced" } };
      await render(<DecisionModelSettingsView settings={configured} choices={choices} result={failure} {...callbacks} />);
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(message);
    }
    await render(<DecisionModelSettingsView settings={configured} choices={choices} result={{ status: "failed", invocationId: "fixture", errorCode: "", usage: { inputTokens: null, outputTokens: null, costCents: null, costStatus: "unpriced" } }} {...callbacks} />);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(strings.failure.fallback);
    const unknownAnswer: DecisionResult = { status: "succeeded", invocationId: "fixture", usage: { inputTokens: 0, outputTokens: 0, costCents: "0", costStatus: "reported" }, answers: { "customer_field_Ω": { type: "choice", choice: "customer_value_Ω" } } };
    await render(<DecisionModelSettingsView settings={configured} choices={choices} result={unknownAnswer} {...callbacks} />);
    expect(host.querySelector("dt")?.textContent).toBe("customer_field_Ω"); expect(host.querySelector("dd")?.textContent).toBe("customer_value_Ω");
  });
  it("localizes empty/unavailable and busy controls while preserving permission gates", async () => {
    await language(locale); const callbacks = { onSave: vi.fn(), onTest: vi.fn(), onAdd: vi.fn() };
    await render(<DecisionModelSettingsView settings={configured} choices={[]} {...callbacks} />);
    expect(host.textContent).toContain(strings.empty); expect(host.textContent).toContain(strings.unavailable);
    expect(button(strings.test).disabled).toBe(true);
    await render(<DecisionModelSettingsView settings={configured} choices={choices.map(row => ({ ...row, status: "needs_attention" as const }))} testing {...callbacks} />);
    expect(host.textContent).toContain(strings.needsAttention); expect(host.textContent).toContain(strings.reconnectConnection);
    expect(button(strings.testing).disabled).toBe(true); expect(button(strings.addConnection).disabled).toBe(true);
    await render(<DecisionModelSettingsView settings={configured} choices={choices} {...callbacks} />);
    await act(async () => host.querySelectorAll<HTMLButtonElement>('[role="switch"]')[1]!.click());
    await render(<DecisionModelSettingsView settings={configured} choices={choices} saving {...callbacks} />);
    expect(button(strings.saving).disabled).toBe(true); expect(host.querySelector("fieldset")?.disabled).toBe(true);
    api.settings.mockResolvedValue({ canManage: false, settings: null, choices: [] });
    await render(<DecisionModelSettingsSection companyId="no-management-permission" />); await flush();
    expect(host.textContent).toBe(""); expect(api.test).not.toHaveBeenCalled(); expect(api.update).not.toHaveBeenCalled();
  });
  it("keeps load failures actionable without exposing an empty settings form", async () => {
    await language(locale); let reject!: (error: Error) => void;
    api.settings.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    await render(<DecisionModelSettingsSection companyId={configured.companyId} />);
    expect(host.textContent).toBe(strings.loading);
    await act(async () => { reject(new Error("read failed")); }); await flush();
    expect(host.textContent).toContain(strings.loadFailed); expect(host.querySelector("section")).toBeNull();
    api.settings.mockResolvedValue({ canManage: true, settings: configured, choices });
    await act(async () => button(strings.retry).click()); await flush();
    expect(api.settings).toHaveBeenCalledTimes(2); expect(api.settings).toHaveBeenLastCalledWith(configured.companyId);
    expect(host.textContent).toContain(strings.title); expect(host.textContent).not.toContain(strings.loadFailed);
    expect(api.test).not.toHaveBeenCalled(); expect(api.update).not.toHaveBeenCalled();
  });
});
it("preserves the selected grant, sponsorship draft and opened provider flow during locale changes without API writes or rereads", async () => {
  api.settings.mockResolvedValue({ canManage: true, settings: configured, choices });
  api.update.mockImplementation(async (_, draft) => ({ ...configured, ...draft }));
  await render(<DecisionModelSettingsSection companyId={configured.companyId} />); await flush();
  await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${choices[1]!.name}"]`)!.click());
  await act(async () => host.querySelectorAll<HTMLButtonElement>('[role="switch"]')[1]!.click());
  await act(async () => button(decisionSettingsMessages.en.addConnection).click());
  const dialog = document.querySelector('[role="dialog"]')!;
  await act(async () => dialog.querySelector<HTMLButtonElement>('button[aria-label="OpenAI"]')!.click());
  for (const [locale, strings] of Object.entries(decisionSettingsMessages)) {
    await language(locale);
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(dialog.textContent).toContain(strings.addTitle); expect(dialog.textContent).toContain(strings.addDescription);
    expect(dialog.querySelector('[data-testid="setup-provider"]')?.textContent).toBe("openai");
    expect(host.querySelector('[aria-pressed="true"]')?.getAttribute("aria-label")).toBe(choices[1]!.name);
    expect(host.querySelectorAll('[role="switch"]')[1]?.getAttribute("aria-checked")).toBe("false");
    expect(host.textContent).toContain(strings.saveBeforeTest);
    expect(api.settings).toHaveBeenCalledTimes(1); expect(api.update).not.toHaveBeenCalled(); expect(api.test).not.toHaveBeenCalled();
  }
  // Closing the local dialog and saving remain explicit user operations.
  await act(async () => dialog.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!.click());
  await act(async () => button(decisionSettingsMessages.ja.save).click()); await flush();
  expect(api.update).toHaveBeenCalledTimes(1);
  expect(api.update).toHaveBeenLastCalledWith(configured.companyId, expect.objectContaining({ connectionId: choices[1]!.id, grantId: choices[1]!.grantId, enabled: true, allowBackground: false }));
});
