// @vitest-environment jsdom

import { act, useState, type ComponentProps } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentsApi, type AdapterModel } from "@/api/agents";
import { i18n, composerModelMessages } from "../../i18n/composer-model-test-resources";
import "../../i18n/composer-assignee-test-resources";
import { validateLocaleMessages } from "../../i18n/locale-validation";
import { ComposerRunSettingsPicker } from "./ComposerRunSettingsPicker";
import type { ComposerRunSettings } from "./composer-run-settings";

type Props = ComponentProps<typeof ComposerRunSettingsPicker>;
const agent = { id: "a1", name: "用户 Clippy", role: "Engineering Lead", adapterType: "codex_local", adapterConfig: { model: "gpt-6-sol" } } as Agent;
const models = [{ id: "gpt-6-sol", label: "Private 用户model" }, { id: "gpt-6-astra", label: "GPT-6 Astra" }];
const cases = Object.entries(composerModelMessages).flatMap(([locale, messages]) => [false, true].map(mobile => ({ locale, messages, mobile })));
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  flushSync(() => root.unmount());
  client.clear();
  container.remove();
  vi.restoreAllMocks();
});
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
function render(props: Partial<Props> = {}) {
  const onSettingsChange = vi.fn(), onAssigneeChange = vi.fn();
  function Host() {
    const [settings, setSettings] = useState<ComposerRunSettings | null>({ model: "gpt-6-sol", effort: "high", fast: false });
    return <ComposerRunSettingsPicker companyId="company-1" assigneeValue="agent:a1" currentAssigneeValue="agent:a1"
      options={[{ id: "agent:a1", label: agent.name }, { id: "agent:a2", label: "Next 用户agent" }]} agents={new Map([[agent.id, agent]])}
      settings={settings} onSettingsChange={next => { onSettingsChange(next); setSettings(next); }} onAssigneeChange={onAssigneeChange}
      modelOptionsOverride={models} {...props} />;
  }
  flushSync(() => root.render(<QueryClientProvider client={client}><Host /></QueryClientProvider>));
  return { onSettingsChange, onAssigneeChange };
}
async function click(label: string) {
  const picker = document.querySelector('[data-testid="composer-mobile-dialog"], [data-testid="composer-model-popover"]');
  const buttons = [...(picker?.querySelectorAll<HTMLButtonElement>("button") ?? []), ...document.querySelectorAll<HTMLButtonElement>("button")];
  const button = buttons.find(el => el.getAttribute("aria-label") === label || el.textContent?.trim() === label);
  expect(button).toBeDefined();
  flushSync(() => button!.click());
  await settle();
}
function input(label: string) { return [...document.querySelectorAll<HTMLInputElement>("input")].find(el => el.getAttribute("aria-label") === label)!; }
function change(input: HTMLInputElement, value: string) {
  flushSync(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function enter(input: HTMLInputElement, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...options });
  flushSync(() => input.dispatchEvent(event));
  return event;
}
function composing(input: HTMLInputElement, type: "compositionstart" | "compositionend") {
  flushSync(() => input.dispatchEvent(new CompositionEvent(type, { bubbles: true, data: "用户" })));
}

describe("composer model localization and IME", () => {
  it.each(Object.entries(composerModelMessages))("keeps the %s contribution contract aligned", (_locale, messages) => {
    expect(validateLocaleMessages(messages, composerModelMessages.en)).toEqual([]);
    expect(JSON.stringify(messages)).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
  });

  it.each(cases)("localizes settings, ARIA and reset without translating identities ($locale, mobile=$mobile)", async ({ locale, messages: m, mobile }) => {
    await i18n.changeLanguage(locale);
    const { onSettingsChange, onAssigneeChange } = render({ mobile });
    expect(container.textContent).toContain("用户 Clippy");
    expect(container.textContent).toContain("Private 用户model");
    await click(m.selectModelEffort);
    expect(document.body.textContent).toContain("Codex");
    expect(input(m.effortLabel).getAttribute("aria-valuetext")).toBe(m.effort.high);
    expect(document.querySelector('[data-testid="selected-effort"]')?.textContent).toBe(m.effort.high);
    expect(document.querySelector<HTMLButtonElement>(`button[title="${m.reset}"]`)).not.toBeNull();
    await click(m.fastMode);
    expect(onSettingsChange).toHaveBeenLastCalledWith({ model: "gpt-6-sol", effort: "high", fast: true });
    await click(m.chooseExactModel);
    expect(document.querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe(m.models);
    expect(input(m.search).placeholder).toBe(m.search);
    expect(document.body.textContent).toContain(m.agentDefault);
    expect(document.body.textContent).toContain("gpt-6-sol");
    expect(document.body.textContent).toContain(m.customIdHint);
    change(input(m.search), "unlisted-model");
    expect(document.body.textContent).toContain(m.noMatch);
    const calls = onSettingsChange.mock.calls.length;
    const nextLocale = locale === "ja" ? "es" : "ja";
    await act(async () => { await i18n.changeLanguage(nextLocale); });
    const next = composerModelMessages[nextLocale];
    expect(input(next.search).value).toBe("unlisted-model");
    expect(document.body.textContent).toContain(next.useExactId);
    expect(onSettingsChange).toHaveBeenCalledTimes(calls);
    expect(onAssigneeChange).not.toHaveBeenCalled();
    await click(next.back);
    expect(input(next.effortLabel).getAttribute("aria-valuetext")).toBe(next.effort.high);
    await click(next.reset);
    expect(onSettingsChange).toHaveBeenLastCalledWith({ model: null, effort: null, fast: false });
    expect(input(next.effortLabel).getAttribute("aria-valuetext")).toBe(next.default);
    if (mobile) await click(i18n.t("liveUi.closePicker"));
    else { flushSync(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); await settle(); }
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(container.querySelector('[data-testid="task-chat-composer-model-label"]')?.textContent).toBe("Private 用户model");
  });

  it.each(cases)("ignores composition, native composing and 229 Enter but accepts normal Enter ($locale, mobile=$mobile)", async ({ locale, messages: m, mobile }) => {
    await i18n.changeLanguage(locale);
    const { onSettingsChange, onAssigneeChange } = render({ mobile, initialOpen: true, initialView: "models" });
    await settle();
    const search = input(m.search);
    change(search, "custom-用户-model");
    composing(search, "compositionstart");
    expect(enter(search).defaultPrevented).toBe(false);
    composing(search, "compositionend");
    expect(enter(search, { isComposing: true }).defaultPrevented).toBe(false);
    expect(enter(search, { keyCode: 229 }).defaultPrevented).toBe(false);
    expect(search.value).toBe("custom-用户-model");
    expect(onSettingsChange).not.toHaveBeenCalled();
    expect(enter(search).defaultPrevented).toBe(true);
    expect(onSettingsChange).toHaveBeenCalledExactlyOnceWith({ model: "custom-用户-model", effort: null, fast: false });
    await click(i18n.t("composerAssigneeUi.chooseAssignee"));
    const assigneeSearch = input(i18n.t("composerAssigneeUi.searchAssignees"));
    change(assigneeSearch, "Next 用户agent");
    composing(assigneeSearch, "compositionstart");
    expect(enter(assigneeSearch).defaultPrevented).toBe(false);
    composing(assigneeSearch, "compositionend");
    expect(enter(assigneeSearch, { isComposing: true }).defaultPrevented).toBe(false);
    expect(enter(assigneeSearch, { keyCode: 229 }).defaultPrevented).toBe(false);
    expect(onAssigneeChange).not.toHaveBeenCalled();
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(enter(assigneeSearch).defaultPrevented).toBe(true);
    expect(onAssigneeChange).toHaveBeenCalledExactlyOnceWith("agent:a2");
    expect(onSettingsChange).toHaveBeenLastCalledWith(null);
  });

  it.each(cases)("distinguishes loading, failure, retry and empty catalog ($locale, mobile=$mobile)", async ({ locale, messages: m, mobile }) => {
    await i18n.changeLanguage(locale);
    let fail!: (reason: Error) => void;
    const loadModels = vi.spyOn(agentsApi, "adapterModels").mockImplementationOnce(() => new Promise<AdapterModel[]>((_resolve, reject) => { fail = reject; })).mockResolvedValue([]);
    const { onSettingsChange } = render({ mobile, initialOpen: true, initialView: "models", modelOptionsOverride: undefined });
    await settle();
    expect(document.querySelector('[role="status"]')?.textContent).toBe(m.loading);
    expect(document.body.textContent).not.toContain(m.noModels);
    await act(async () => { fail(new Error("private raw transport details")); });
    await vi.waitFor(async () => { await settle(); expect(document.querySelector('[role="alert"]')?.textContent).toContain(m.loadError); });
    expect(document.body.textContent).not.toContain("private raw transport details");
    expect(document.body.textContent).not.toContain(m.noModels);
    expect(document.body.textContent).toContain(m.useAgentDefault);
    await click(m.retry);
    await vi.waitFor(async () => { await settle(); expect(document.body.textContent).toContain(m.noModels); });
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(loadModels).toHaveBeenCalledTimes(2);
    expect(onSettingsChange).not.toHaveBeenCalled();
    change(input(m.search), "bad model");
    expect(document.body.textContent).toContain(m.invalidId);
    enter(input(m.search));
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it.each(Object.entries(composerModelMessages))("localizes provider validation, thinking and unavailable adapters in %s", async (locale, m) => {
    await i18n.changeLanguage(locale);
    const pi = { ...agent, adapterType: "pi_local", adapterConfig: { model: "provider/model" } } as Agent;
    render({ agents: new Map([[pi.id, pi]]), initialOpen: true, settings: { model: "provider/model", effort: "off", fast: false }, modelOptionsOverride: [{ id: "provider/model", label: "Private model" }] });
    await settle();
    expect(input(m.thinking).getAttribute("aria-valuetext")).toBe(m.effort.off);
    await click(m.chooseExactModel);
    change(input(m.search), "missing-provider");
    expect(document.body.textContent).toContain(m.invalidProviderId);
    const router = { ...agent, adapterType: "opencode_local", adapterConfig: { model: "openrouter/provider/model" } } as Agent;
    render({ agents: new Map([[router.id, router]]), initialOpen: true, initialView: "models", initialModelSearch: "provider/model" });
    await settle();
    expect(document.body.textContent).toContain("OpenCode · OpenRouter");
    expect(document.body.textContent).toContain(m.invalidOpenRouterId);
    expect(document.body.textContent).toContain(m.customOpenRouterHint);
    for (const [adapterType, expected] of [["process", m.commandUnavailable], ["http", m.httpUnavailable], ["openclaw_gateway", m.gatewayUnavailable]]) {
      render({ agents: new Map([[agent.id, { ...agent, adapterType } as Agent]]), initialOpen: true });
      await settle();
      expect(document.querySelector('[data-testid="model-unavailable"]')?.textContent).toBe(expected);
    }
  });
});
