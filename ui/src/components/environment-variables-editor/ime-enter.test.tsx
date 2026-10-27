// @vitest-environment jsdom
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import "./i18n-test-resources";
import { EnvironmentVariablesEditor } from "./index";
import { SecretPopoverForm } from "./CreateSecretPopover";

let root: Root;
let container: HTMLDivElement;
const tr = (key: string) => i18n.t(`environmentEditorUi.${key}`);
const input = (key: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${tr(key)}"]`)!;
const names = () => container.querySelectorAll(`input[aria-label="${tr("variableName")}"]`);
function render(node: ReactNode) { flushSync(() => root.render(node)); }
function enter(target: HTMLInputElement, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}
async function settle() {
  for (let i = 0; i < 3; i += 1) await new Promise(resolve => window.setTimeout(resolve, 0));
  flushSync(() => {});
}
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  flushSync(() => root.unmount()); container.remove(); await settle(); await i18n.changeLanguage("en");
});

describe.each(["en", "zh-CN", "es", "ja"])("IME Enter in %s", language => {
  it.each(["create", "store"] as const)("does not submit %s while composing or for keyCode 229; ordinary Enter remains explicit", async mode => {
    await i18n.changeLanguage(language);
    let reject!: (error: unknown) => void;
    const onSubmit = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; })); const onCancel = vi.fn();
    render(<SecretPopoverForm mode={mode} initialName="literal_name" initialValue="${{ KEEP_RAW }}" onSubmit={onSubmit} onCancel={onCancel} />);
    const name = input("secretName"); const value = input("secretValue"); name.focus();
    expect(enter(name, { isComposing: true }).defaultPrevented).toBe(false); await settle();
    expect(onSubmit).not.toHaveBeenCalled(); expect(document.activeElement).toBe(name);
    expect(enter(name, { keyCode: 229 }).defaultPrevented).toBe(false); await settle();
    expect(onSubmit).not.toHaveBeenCalled(); expect(value.value).toBe("${{ KEEP_RAW }}"); expect(value.type).toBe("password");
    expect(enter(name).defaultPrevented).toBe(true); await settle();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("literal_name", "${{ KEEP_RAW }}");
    await i18n.changeLanguage(language === "ja" ? "zh-CN" : "ja"); await settle();
    expect(input("secretName")).toBe(name); expect(input("secretValue")).toBe(value);
    enter(name); enter(name, { isComposing: true }); enter(name, { keyCode: 229 }); await settle();
    expect(onSubmit).toHaveBeenCalledTimes(1); expect(onCancel).not.toHaveBeenCalled(); expect(value.type).toBe("password");
    reject(new Error("Original service diagnostic")); await settle();
    expect(container.textContent).toContain("Original service diagnostic");
    enter(name); await settle(); expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("keeps name focus and row count through IME commit, with normal Enter focus and append intact", async () => {
    await i18n.changeLanguage(language);
    const onChange = vi.fn(); const onCreateSecret = vi.fn();
    render(<EnvironmentVariablesEditor value={{ RAW_KEY: { type: "plain", value: "${{ 日本語_中文 }}" } }} secrets={[]} onChange={onChange} onCreateSecret={onCreateSecret} />);
    const name = input("variableName"); const value = input("variableValue"); name.focus();
    for (const event of [{ isComposing: true }, { keyCode: 229 }]) {
      expect(enter(name, event).defaultPrevented).toBe(false); await settle();
      expect(document.activeElement).toBe(name); expect(names()).toHaveLength(1);
    }
    expect(enter(name).defaultPrevented).toBe(true); await settle(); expect(document.activeElement).toBe(value);
    for (const event of [{ isComposing: true }, { keyCode: 229 }]) {
      expect(enter(value, event).defaultPrevented).toBe(false); await settle();
      expect(document.activeElement).toBe(value); expect(names()).toHaveLength(1);
    }
    await i18n.changeLanguage(language === "ja" ? "zh-CN" : "ja"); await settle();
    expect(input("variableName")).toBe(name); expect(input("variableValue")).toBe(value);
    expect(value.value).toBe("${{ 日本語_中文 }}");
    expect(enter(value).defaultPrevented).toBe(true); await settle();
    expect(names()).toHaveLength(2); expect(document.activeElement).toBe(names()[1]);
    expect(onChange).not.toHaveBeenCalled(); expect(onCreateSecret).not.toHaveBeenCalled();
  });

  it("admits only one create request for a burst of ordinary Enter events before rerender", async () => {
    await i18n.changeLanguage(language);
    const onSubmit = vi.fn(() => new Promise<void>(() => {}));
    render(<SecretPopoverForm mode="create" initialName="literal_name" initialValue="literal_value" onSubmit={onSubmit} onCancel={vi.fn()} />);
    const name = input("secretName");
    flushSync(() => { enter(name); enter(name); }); await settle();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("literal_name", "literal_value");
  });
});
