// @vitest-environment jsdom
import { act, useState, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CODEX_LOCAL_FAST_MODE_SUPPORTED_MODELS, DEFAULT_CODEX_LOCAL_MODEL } from "@paperclipai/adapter-codex-local";
import { buildCodexLocalConfig } from "@paperclipai/adapter-codex-local/ui";
import { buildClaudeLocalConfig } from "@paperclipai/adapter-claude-local/ui";
import { defaultCreateValues } from "../components/agent-config-defaults";
import { help } from "../components/agent-config-primitives";
import { TooltipProvider } from "../components/ui/tooltip";
import { i18n } from "../i18n";
import { agentRuntimeFieldsMessages } from "../i18n/agent-runtime-fields-test-resources";
import { validateLocaleMessages } from "../i18n/locale-validation";
import { CodexLocalConfigFields } from "./codex-local/config-fields";
import { ClaudeLocalAdvancedFields } from "./claude-local/config-fields";
import type { AdapterConfigFieldsProps, CreateConfigValues } from "./types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
const mark = vi.fn();
const set = vi.fn();
const manualModel = "customer/model-原文";
const instructionsFilePath = "/customer/原文/AGENTS.md";
const originalHelp = { ...help };
beforeEach(async () => {
  await i18n.changeLanguage("en"); vi.clearAllMocks();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); await i18n.changeLanguage("en");
  expect(help).toEqual(originalHelp);
});

async function mount(Component: ComponentType<AdapterConfigFieldsProps>, adapterType: string,
  config: Record<string, unknown> = {}, createValues?: Partial<CreateConfigValues>, section: AdapterConfigFieldsProps["section"] = "configuration") {
  const snapshot = { current: {} as CreateConfigValues };
  function Harness() {
    const [overlay, setOverlay] = useState<Record<string, unknown>>({});
    const [values, setValues] = useState({ ...defaultCreateValues, adapterType, ...createValues });
    snapshot.current = values;
    return <TooltipProvider><Component section={section} mode={createValues ? "create" : "edit"} isCreate={!!createValues}
      adapterType={adapterType} config={config} values={values} models={[]} managedSandboxOnly
      eff={(_group, key, original) => (key in overlay ? overlay[key] : original) as typeof original}
      mark={(group, key, value) => { mark(group, key, value); setOverlay(previous => ({ ...previous, [key]: value })); }}
      set={patch => { set(patch); setValues(previous => ({ ...previous, ...patch })); }} /></TooltipProvider>;
  }
  await act(async () => root.render(<Harness />));
  return snapshot;
}
const toggle = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')]
  .find(button => button.getAttribute("aria-label") === label)!;
const hint = (text: string) => [...container.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === text);
async function changeLanguage(locale: string) { await act(async () => { await i18n.changeLanguage(locale); }); }
async function changeNumber(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe.each(Object.entries(agentRuntimeFieldsMessages))("ordinary local runtime fields (%s)", (locale, messages) => {
  it("validates translations and retains safety, model and CLI literals in the local help contract", () => {
    expect(validateLocaleMessages(messages, agentRuntimeFieldsMessages.en)).toEqual([]);
    if (locale !== "en") for (const key of Object.keys(messages) as (keyof typeof messages)[]) {
      expect(messages[key], key).not.toBe(agentRuntimeFieldsMessages.en[key]);
    }
    expect(messages.enableChromeHelp).toContain("--chrome");
    for (const model of ["GPT-6", "GPT-5.6", "GPT-5.5", "GPT-5.4"]) expect(messages.fastModeHelp).toContain(model);
    expect(agentRuntimeFieldsMessages.en.bypassSandboxHelp).toBe(help.dangerouslyBypassSandbox);
    expect(agentRuntimeFieldsMessages.en.skipPermissionsHelp).toBe(help.dangerouslySkipPermissions);
    expect(agentRuntimeFieldsMessages.en.fastModeHelp).toBe(help.fastMode);
  });

  it("keeps Codex drafts, focus and canonical edit keys through a language change and repeated toggles", async () => {
    const config = Object.freeze({ model: manualModel, instructionsFilePath, dangerouslyBypassSandbox: true, search: false, fastMode: true });
    await mount(CodexLocalConfigFields, "codex_local", config);
    const bypass = toggle("Bypass sandbox"); bypass.focus();
    const path = container.querySelector<HTMLInputElement>('input[placeholder="/absolute/path/to/AGENTS.md"]')!;
    await changeLanguage(locale);
    expect(toggle(messages.bypassSandbox)).toBe(bypass); expect(document.activeElement).toBe(bypass);
    expect(bypass.getAttribute("aria-checked")).toBe("true");
    expect(path.value).toBe(instructionsFilePath);
    expect(container.querySelector('input[placeholder="/absolute/path/to/AGENTS.md"]')).toBe(path);
    for (const text of [messages.bypassSandboxHelp, messages.enableSearchHelp, messages.fastModeHelp]) expect(hint(text)).toBeDefined();
    expect(container.textContent).toContain(messages.fastModeManual);
    expect(mark).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
    await act(async () => bypass.click()); await act(async () => bypass.click());
    await act(async () => toggle(messages.enableSearch).click());
    await act(async () => toggle(messages.fastMode).click());
    expect(mark.mock.calls).toEqual([
      ["adapterConfig", "dangerouslyBypassApprovalsAndSandbox", false],
      ["adapterConfig", "dangerouslyBypassApprovalsAndSandbox", true],
      ["adapterConfig", "search", true], ["adapterConfig", "fastMode", false],
    ]);
    expect(container.textContent).not.toContain(messages.fastModeManual);
    expect(config).toEqual({ model: manualModel, instructionsFilePath, dangerouslyBypassSandbox: true, search: false, fastMode: true });
  });

  it.each([
    [DEFAULT_CODEX_LOCAL_MODEL, "fastModeCredits"],
    [manualModel, "fastModeManual"],
    ["gpt-5.4-mini", "fastModeUnsupported"],
  ] as const)("localizes the %s warning without changing fast-mode state or its model list", async (model, key) => {
    await mount(CodexLocalConfigFields, "codex_local", { model, fastMode: true });
    const fast = toggle("Fast mode");
    await changeLanguage(locale);
    expect(container.textContent).toContain(messages[key].replace("{{models}}", CODEX_LOCAL_FAST_MODE_SUPPORTED_MODELS.join(", ")));
    expect(toggle(messages.fastMode)).toBe(fast); expect(fast.getAttribute("aria-checked")).toBe("true");
    // Unsupported models remain an enabled choice with a warning; localization
    // must not silently change the established pass-through/ignore behavior.
    expect(fast.disabled).toBe(false); expect(mark).not.toHaveBeenCalled();
  });

  it("preserves Claude permission defaults, numeric drafts and edit payload keys", async () => {
    await mount(ClaudeLocalAdvancedFields, "claude_local");
    expect(toggle("Enable Chrome").getAttribute("aria-checked")).toBe("false");
    expect(toggle("Skip permissions").getAttribute("aria-checked")).toBe("true");
    const turns = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(turns.value).toBe("1000");
    await changeNumber(turns, "37"); turns.focus(); mark.mockClear();
    await changeLanguage(locale);
    expect(container.querySelector('input[type="number"]')).toBe(turns);
    expect(document.activeElement).toBe(turns); expect(turns.value).toBe("37");
    expect(container.textContent).toContain(messages.maxTurnsPerRun);
    for (const text of [messages.enableChromeHelp, messages.skipPermissionsHelp, messages.maxTurnsPerRunHelp]) expect(hint(text)).toBeDefined();
    expect(mark).not.toHaveBeenCalled();
    await act(async () => toggle(messages.enableChrome).click());
    await act(async () => toggle(messages.skipPermissions).click());
    await changeNumber(turns, "42");
    expect(mark.mock.calls).toEqual([["adapterConfig", "chrome", true], ["adapterConfig", "dangerouslySkipPermissions", false], ["adapterConfig", "maxTurnsPerRun", 42]]);
  });

  it.each(["codex_local", "claude_local"])("keeps %s create values and pure config serialization unchanged by locale", async adapterType => {
    const isCodex = adapterType === "codex_local";
    const build = isCodex ? buildCodexLocalConfig : buildClaudeLocalConfig;
    const snapshot = await mount(isCodex ? CodexLocalConfigFields : ClaudeLocalAdvancedFields, adapterType, {}, {
      model: manualModel, instructionsFilePath, chrome: false, dangerouslySkipPermissions: false,
      dangerouslyBypassSandbox: false, search: false, fastMode: false, maxTurnsPerRun: 37,
    });
    const initial = build(snapshot.current);
    await changeLanguage(locale);
    expect(build(snapshot.current)).toEqual(initial); expect(set).not.toHaveBeenCalled(); expect(mark).not.toHaveBeenCalled();
    if (isCodex) {
      expect(toggle(messages.bypassSandbox).getAttribute("aria-checked")).toBe("false");
      await act(async () => toggle(messages.bypassSandbox).click());
      await act(async () => toggle(messages.enableSearch).click());
      await act(async () => toggle(messages.fastMode).click());
      expect(set.mock.calls).toEqual([[{ dangerouslyBypassSandbox: true }], [{ search: true }], [{ fastMode: true }]]);
      expect(build(snapshot.current)).toEqual({ ...initial, dangerouslyBypassApprovalsAndSandbox: true, search: true, fastMode: true });
    } else {
      expect(toggle(messages.skipPermissions).getAttribute("aria-checked")).toBe("false");
      await act(async () => toggle(messages.enableChrome).click());
      await act(async () => toggle(messages.skipPermissions).click());
      await changeNumber(container.querySelector<HTMLInputElement>('input[type="number"]')!, "42");
      expect(set.mock.calls).toEqual([[{ chrome: true }], [{ dangerouslySkipPermissions: true }], [{ maxTurnsPerRun: 42 }]]);
      expect(build(snapshot.current)).toEqual({ ...initial, chrome: true, dangerouslySkipPermissions: true, maxTurnsPerRun: 42 });
    }
    expect(build(snapshot.current)).toMatchObject({ model: manualModel, instructionsFilePath });
  });

  it("does not move ordinary controls into unrelated configuration sections", async () => {
    await changeLanguage(locale);
    for (const section of ["adapter", "advanced", "runPolicy", "environment"] as const) {
      for (const [Component, adapterType] of [[CodexLocalConfigFields, "codex_local"], [ClaudeLocalAdvancedFields, "claude_local"]] as const) {
        await mount(Component, adapterType, {}, undefined, section);
        expect(container.querySelector('[role="switch"]')).toBeNull();
      }
    }
  });
});
