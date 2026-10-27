// @vitest-environment jsdom
import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvBinding } from "@paperclipai/shared";
import { i18n } from "@/i18n";
import "./i18n-test-resources";
import { EnvironmentVariablesEditor } from "./index";
import { RoutineSaveBar } from "../RoutineSaveBar";

const tr = (key: string) => i18n.t(`environmentEditorUi.${key}`);
let root: Root;
let container: HTMLDivElement;
async function settle() {
  for (let i = 0; i < 3; i += 1) await new Promise(resolve => window.setTimeout(resolve, 0));
  flushSync(() => {});
}
function input(key: string) { return document.querySelector<HTMLInputElement>(`input[aria-label="${tr(key)}"]`)!; }
async function edit(value: string) {
  const target = input("variableValue");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(target, value);
  target.dispatchEvent(new Event("input", { bubbles: true })); await settle();
}
function button(label: string, scope: ParentNode = document) {
  const target = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent?.trim().startsWith(label) || el.getAttribute("aria-label") === label);
  expect(target, label).toBeDefined(); return target!;
}
const payload = (value: string) => ({ RAW_KEY: { type: "plain", value } });
function SaveHarness({ changed, saved, conflict, disabled = false, isSaving = false }: {
  changed: (next: Record<string, EnvBinding> | undefined) => void;
  saved: (next: Record<string, EnvBinding>) => void;
  conflict: boolean;
  disabled?: boolean;
  isSaving?: boolean;
}) {
  const [value, setValue] = useState<Record<string, EnvBinding>>(payload("A"));
  const [dirty, setDirty] = useState(false);
  return <>
    <div data-testid="editor"><EnvironmentVariablesEditor value={value} secrets={[]} onCreateSecret={vi.fn()} onChange={next => { changed(next); setValue(next ?? {}); setDirty(true); }} /></div>
    <div data-testid="savebar"><RoutineSaveBar dirtyFields={dirty ? [{ key: "env", label: "raw env descriptor" }] : []} isSaving={isSaving} saveConflict={conflict} disabled={disabled} onSave={() => saved(value)} onDiscard={vi.fn()} onReload={vi.fn()} /></div>
  </>;
}

beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(async () => {
  flushSync(() => root.unmount()); container.remove(); await settle();
  vi.unstubAllGlobals(); await i18n.changeLanguage("en");
});

describe.each(["en", "zh-CN", "es", "ja"])("routine save compatibility in %s", language => {
  it.each([false, true])("flushes the latest draft once before the actual outer save (conflict=%s)", async conflict => {
    await i18n.changeLanguage(language);
    const changed = vi.fn(); const saved = vi.fn();
    flushSync(() => root.render(<SaveHarness changed={changed} saved={saved} conflict={conflict} />));
    await edit("B"); button(tr("save"), container.querySelector('[data-testid="editor"]')!).click(); await settle();
    expect(changed).toHaveBeenCalledExactlyOnceWith(payload("B")); changed.mockClear();
    await edit("C-${{KEEP}}");
    const value = input("variableValue");
    await i18n.changeLanguage(language === "en" ? "ja" : "en"); await settle();
    await i18n.changeLanguage(language); await settle();
    expect(input("variableValue")).toBe(value); expect(changed).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
    const outer = button(i18n.t(conflict ? "stabilizationUi.overwrite" : "stabilizationUi.save"), container.querySelector('[data-testid="savebar"]')!);
    expect(outer.dataset.envDraftAction).toBe("save");
    outer.click(); await settle();
    expect(changed).toHaveBeenCalledExactlyOnceWith(payload("C-${{KEEP}}"));
    expect(saved).toHaveBeenCalledExactlyOnceWith(payload("C-${{KEEP}}"));
    expect(changed.mock.invocationCallOrder[0]).toBeLessThan(saved.mock.invocationCallOrder[0]);
    // The production button currently defaults to submit. Independently prove
    // the explicit semantic contract without relying on that browser fallback.
    changed.mockClear(); saved.mockClear(); await edit("D-latest");
    const semanticOuter = button(i18n.t(conflict ? "stabilizationUi.overwrite" : "stabilizationUi.save"), container.querySelector('[data-testid="savebar"]')!);
    semanticOuter.type = "button";
    semanticOuter.click(); await settle();
    expect(changed).toHaveBeenCalledExactlyOnceWith(payload("D-latest"));
    expect(saved).toHaveBeenCalledExactlyOnceWith(payload("D-latest"));
    expect(changed.mock.invocationCallOrder[0]).toBeLessThan(saved.mock.invocationCallOrder[0]);
  });

  it("does not flush a draft from store, reveal or locale changes", async () => {
    await i18n.changeLanguage(language);
    const onChange = vi.fn(); const onCreateSecret = vi.fn(() => new Promise<never>(() => {}));
    flushSync(() => root.render(<EnvironmentVariablesEditor value={{ API_KEY: { type: "plain", value: "A" } }} secrets={[]} onChange={onChange} onCreateSecret={onCreateSecret} />));
    await edit("raw-draft-B");
    button(tr("storeAsSecret")).click(); await settle();
    const secretValue = input("secretValue"); expect(secretValue.value).toBe("raw-draft-B"); expect(secretValue.type).toBe("password");
    button(tr("showValue")).click(); await settle(); expect(secretValue.type).toBe("text");
    await i18n.changeLanguage(language === "ja" ? "zh-CN" : "ja"); await settle();
    expect(input("secretValue")).toBe(secretValue); expect(secretValue.type).toBe("text");
    button(tr("hideValue")).click(); await settle(); expect(secretValue.type).toBe("password");
    expect(onChange).not.toHaveBeenCalled(); expect(onCreateSecret).not.toHaveBeenCalled();
    button(tr("storeAndBind")).click(); await settle();
    expect(onCreateSecret).toHaveBeenCalledExactlyOnceWith("api_key", "raw-draft-B");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not flush or save through disabled or pending outer buttons", async () => {
    await i18n.changeLanguage(language);
    const changed = vi.fn(); const saved = vi.fn();
    const render = (disabled: boolean, isSaving: boolean) => flushSync(() => root.render(<SaveHarness changed={changed} saved={saved} conflict={false} disabled={disabled} isSaving={isSaving} />));
    render(false, false); await edit("B");
    button(tr("save"), container.querySelector('[data-testid="editor"]')!).click(); await settle(); changed.mockClear();
    await edit("C");
    for (const state of [[true, false], [false, true]]) {
      render(state[0], state[1]);
      const outer = button(i18n.t("stabilizationUi.save"), container.querySelector('[data-testid="savebar"]')!);
      expect(outer.disabled).toBe(true); outer.click(); await settle();
      expect(changed).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
    }
  });
});
