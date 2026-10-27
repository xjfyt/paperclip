// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanySecret, EnvBinding, UserSecretDefinition } from "@paperclipai/shared";
import { i18n } from "@/i18n";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import "@/i18n/agent-setup-shared-test-resources";
import { ToastProvider, useToastState } from "@/context/ToastContext";
import { environmentEditorMessages } from "./i18n-test-resources";
import { EnvironmentVariablesEditor, type EnvironmentVariablesEditorProps } from "./index";
import { SecretPopoverForm } from "./CreateSecretPopover";
import { localizeEditorMessage, localizeSecretStatus } from "./display";

const locales = ["en", "zh-CN", "es", "ja"] as const;
const secret = { id: "secret-raw-id", name: "Org/RAW_TOKEN", key: "RAW_TOKEN", status: "active", latestVersion: 3 } as CompanySecret;
const definitions = [{ id: "user-def", key: "PERSONAL_TOKEN", name: "Customer 原始名称", status: "disabled" }] as UserSecretDefinition[];
const tr = (key: string, options: Record<string, unknown> = {}) => i18n.t(`environmentEditorUi.${key}`, options);
let root: Root;
let container: HTMLDivElement;

async function settle() {
  for (let i = 0; i < 3; i += 1) await new Promise(resolve => window.setTimeout(resolve, 0));
  flushSync(() => {});
}
function render(node: ReactNode) { flushSync(() => root.render(node)); }
async function locale(language: string) { await i18n.changeLanguage(language); await settle(); }
function button(label: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent?.trim() === label || el.getAttribute("aria-label") === label);
  expect(result, label).toBeDefined();
  return result!;
}
function input(key: string) { return document.querySelector<HTMLInputElement>(`input[aria-label="${tr(key)}"]`)!; }
async function edit(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
}
function props(extra: Partial<EnvironmentVariablesEditorProps> = {}): EnvironmentVariablesEditorProps {
  return { value: {}, secrets: [secret], onChange: vi.fn(), onCreateSecret: vi.fn().mockResolvedValue(secret), ...extra };
}
function ToastCapture() { return <output data-testid="toasts">{useToastState().map(toast => toast.title).join(" | ")}</output>; }
function ControlledEditor({ onChange, ...rest }: EnvironmentVariablesEditorProps) {
  const [value, setValue] = useState(rest.value);
  return <EnvironmentVariablesEditor {...rest} value={value} onChange={next => { onChange(next); setValue(next ?? {}); }} />;
}

beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  vi.stubGlobal("PointerEvent", globalThis.PointerEvent ?? MouseEvent);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(async () => {
  vi.useRealTimers();
  flushSync(() => root.unmount()); container.remove(); await settle();
  document.body.style.pointerEvents = "";
  vi.unstubAllGlobals(); vi.restoreAllMocks(); await locale("en");
});

it.each(Object.entries(environmentEditorMessages))("validates all editor keys and interpolation in %s", (language, messages) => {
  expect(validateLocaleMessages(messages, environmentEditorMessages.en)).toEqual([]);
  if (language !== "en") for (const key of Object.keys(messages) as Array<keyof typeof messages>) {
    expect(messages[key], key).not.toBe(environmentEditorMessages.en[key]);
  }
  expect(localizeEditorMessage("constructor", i18n.t)).toBe("constructor");
  expect(localizeEditorMessage("Provider RAW_ERROR {{value}}", i18n.t)).toBe("Provider RAW_ERROR {{value}}");
  expect(localizeSecretStatus("future_raw_status", i18n.t)).toBe("future_raw_status");
});

describe.each(locales)("environment editor in %s", language => {
  it("pastes dotenv literally and keeps drafts and callbacks stable across locale changes", async () => {
    await locale(language);
    const callbacks = props(); const onDirtyChange = vi.fn();
    render(<ToastProvider><ControlledEditor {...callbacks} onDirtyChange={onDirtyChange} /><ToastCapture /></ToastProvider>);
    expect(container.textContent).toContain(tr("empty"));
    button(tr("addVariable")).click(); await settle();
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => 'RAW_KEY="${{ secrets.KEEP }}"\nSECOND=value=literal\nTHIRD=3\nFOURTH=4' } });
    input("variableName").dispatchEvent(paste); await settle();
    expect(paste.defaultPrevented).toBe(true);
    expect(container.textContent).toContain(tr("imported", { count: 4 }));
    expect(container.textContent).toContain(tr("moreNames", { names: "FOURTH, RAW_KEY, SECOND", count: 1 }));
    const name = input("variableName"); const value = input("variableValue"); value.focus();
    expect(value.value).toBe("${{ secrets.KEEP }}");
    onDirtyChange.mockClear();
    for (const next of locales) {
      await locale(next);
      expect(input("variableName")).toBe(name); expect(input("variableValue")).toBe(value);
      expect(document.activeElement).toBe(value); expect(value.value).toBe("${{ secrets.KEEP }}");
      expect(container.textContent).toContain(tr("unsavedChanges"));
      expect(callbacks.onChange).not.toHaveBeenCalled(); expect(callbacks.onCreateSecret).not.toHaveBeenCalled();
      expect(onDirtyChange).not.toHaveBeenCalled();
    }
    button(tr("save")).click(); await settle();
    expect(callbacks.onChange).toHaveBeenCalledTimes(1);
    expect(callbacks.onChange).toHaveBeenLastCalledWith({ RAW_KEY: { type: "plain", value: "${{ secrets.KEEP }}" }, SECOND: { type: "plain", value: "value=literal" }, THIRD: { type: "plain", value: "3" }, FOURTH: { type: "plain", value: "4" } });
    expect(container.textContent).not.toContain(tr("unsavedChanges"));
  });

  it("localizes health and validation while preserving references, versions, flags and disabled controls", async () => {
    await locale(language);
    const initial: Record<string, EnvBinding> = {
      "invalid-name": { type: "plain", value: "raw" }, PAPERCLIP_KEEP: "provided",
      ORG: { type: "secret_ref", secretId: secret.id, version: 2 },
      MISSING: { type: "secret_ref", secretId: "missing-id-raw", version: "latest" },
      USER: { type: "user_secret_ref", key: "UNKNOWN_RAW", version: 7, required: false },
      DISABLED: { type: "user_secret_ref", key: "PERSONAL_TOKEN", version: "latest", required: true },
    };
    const callbacks = props({ value: initial, userSecretDefinitions: definitions });
    render(<ControlledEditor {...callbacks} />);
    for (const key of ["invalidName", "reservedName", "missingSecret", "missingUserSecret", "disabledUserSecret", "userSecretsHint"]) expect(container.textContent).toContain(tr(key));
    expect(container.textContent).toContain(tr("bindingsNeedAttention", { count: 3 }));
    expect(container.textContent).toContain(tr("unknownUserSecret", { key: "UNKNOWN_RAW" }));
    expect(container.textContent).toContain("Customer 原始名称");
    expect(container.textContent).toContain(i18n.t("agentSetupSharedUi.secretDisabled"));
    const version = button(tr("version")); expect(version.textContent).toBe("v2");
    version.click(); await settle();
    const latest = document.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="false"]')!;
    expect(latest.textContent).toContain(tr("latest")); latest.click(); await settle();
    await edit(input("variableValue"), "raw-updated");
    const optional = container.querySelector<HTMLSelectElement>(`select[aria-label="${tr("requirement")}"]`)!;
    expect(optional.value).toBe("optional");
    await locale(language === "en" ? "ja" : "en");
    expect(container.querySelector(`select[aria-label="${tr("requirement")}"]`)).toBe(optional);
    expect(optional.value).toBe("optional"); expect(callbacks.onChange).not.toHaveBeenCalled();
    button(tr("save")).click(); await settle();
    expect(callbacks.onChange).toHaveBeenLastCalledWith({ ...initial, "invalid-name": { type: "plain", value: "raw-updated" }, PAPERCLIP_KEEP: { type: "plain", value: "provided" }, ORG: { type: "secret_ref", secretId: secret.id, version: "latest" } });
    render(<EnvironmentVariablesEditor {...callbacks} disabled />);
    for (const el of container.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input,button,select")) expect(el.disabled).toBe(true);
    const count = vi.mocked(callbacks.onChange).mock.calls.length;
    await locale(language); button(tr("addVariable")).click();
    expect(callbacks.onChange).toHaveBeenCalledTimes(count); expect(callbacks.onCreateSecret).not.toHaveBeenCalled();
  });

  it("keeps mask, form identity, raw errors and one creation stable while pending", async () => {
    await locale(language);
    let reject!: (error: unknown) => void;
    const onSubmit = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; })); const onCancel = vi.fn();
    render(<SecretPopoverForm mode="create" initialName="fixture_name" initialValue="raw-${{KEEP}}" onCancel={onCancel} onSubmit={onSubmit} />);
    const name = input("secretName"); const value = input("secretValue");
    expect(value.type).toBe("password"); expect(value.readOnly).toBe(false);
    await edit(name, "edited_name"); await edit(value, "literal-${{KEEP}}"); value.focus();
    button(tr("createAndBind")).click(); await settle();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("edited_name", "literal-${{KEEP}}");
    for (const next of locales) {
      await locale(next);
      expect(input("secretName")).toBe(name); expect(input("secretValue")).toBe(value);
      expect(name.value).toBe("edited_name"); expect(value.value).toBe("literal-${{KEEP}}"); expect(value.type).toBe("password");
      expect(button(tr("createAndBind")).disabled).toBe(true); expect(button(tr("cancel")).disabled).toBe(true);
      button(tr("createAndBind")).click(); button(tr("cancel")).click();
      expect(onSubmit).toHaveBeenCalledTimes(1); expect(onCancel).not.toHaveBeenCalled();
    }
    reject(new Error("Provider RAW diagnostic {{KEEP}}")); await settle();
    expect(container.textContent).toContain("Provider RAW diagnostic {{KEEP}}");
    await locale(language); expect(container.textContent).toContain("Provider RAW diagnostic {{KEEP}}");
    expect(button(tr("createAndBind")).disabled).toBe(false);
    button(tr("showValue")).click(); await settle(); expect(value.type).toBe("text");
    await locale(language === "ja" ? "es" : "ja"); expect(input("secretValue")).toBe(value); expect(value.type).toBe("text");
    button(tr("hideValue")).click(); await settle(); expect(value.type).toBe("password");
  });

  it("retranslates known validation and generic failure without resubmitting or changing store inputs", async () => {
    await locale(language);
    const onSubmit = vi.fn().mockRejectedValue("opaque rejection"); const onCancel = vi.fn();
    render(<SecretPopoverForm mode="store" initialName="store_fixture" initialValue="literal-${{RAW}}" existingSecretNames={["existing_name"]} onCancel={onCancel} onSubmit={onSubmit} />);
    const name = input("secretName"); const value = input("secretValue");
    expect(value.readOnly).toBe(true); expect(value.type).toBe("password");
    expect(container.querySelector('[data-slot="popover-description"]')?.textContent).toContain("store_fixture");
    await edit(name, "BAD-NAME"); expect(container.textContent).toContain(tr("secretNameFormat"));
    await edit(name, "existing_name"); expect(container.textContent).toContain(tr("secretNameExists"));
    await locale(language === "en" ? "zh-CN" : "en"); expect(container.textContent).toContain(tr("secretNameExists"));
    expect(onSubmit).not.toHaveBeenCalled();
    await edit(name, ""); name.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); await settle();
    expect(container.textContent).toContain(tr("nameRequired"));
    await edit(name, "valid_name"); button(tr("storeAndBind")).click(); await settle();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("valid_name", "literal-${{RAW}}");
    for (const next of locales) {
      await locale(next); expect(container.textContent).toContain(tr("createFailed"));
      expect(input("secretName")).toBe(name); expect(input("secretValue")).toBe(value);
      expect(value.value).toBe("literal-${{RAW}}"); expect(value.readOnly).toBe(true); expect(value.type).toBe("password");
      expect(onSubmit).toHaveBeenCalledTimes(1); expect(onCancel).not.toHaveBeenCalled();
    }
    button(tr("cancel")).click(); expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps the source-switch undo deadline and original reference across locale changes", async () => {
    await locale(language);
    const callbacks = props({ value: { TOKEN: { type: "secret_ref", secretId: secret.id, version: 2 } } });
    const click = (element: HTMLElement) => flushSync(() => {
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0 }));
      element.click();
    });
    for (const expires of [false, true]) {
      render(<ControlledEditor key={String(expires)} {...callbacks} />);
      vi.useFakeTimers();
      click(button(tr("valueSource")));
      const textItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el => el.textContent?.startsWith(tr("textValue")))!;
      expect(textItem).toBeDefined(); click(textItem);
      flushSync(() => vi.advanceTimersByTime(3000));
      expect(container.textContent).toContain(tr("revertedToText"));
      const name = input("variableName");
      flushSync(() => { void i18n.changeLanguage(i18n.language === "ja" ? "es" : "ja"); });
      expect(input("variableName")).toBe(name); expect(container.textContent).toContain(tr("revertedToText"));
      if (expires) {
        flushSync(() => vi.advanceTimersByTime(1999)); expect(container.textContent).toContain(tr("undo"));
        flushSync(() => vi.advanceTimersByTime(1)); expect(container.textContent).not.toContain(tr("revertedToText"));
      } else {
        click(button(tr("undo")));
        expect(button(tr("version")).textContent).toBe("v2");
        expect(container.textContent).not.toContain(tr("unsavedChanges"));
      }
      expect(callbacks.onChange).not.toHaveBeenCalled(); expect(callbacks.onCreateSecret).not.toHaveBeenCalled();
      vi.useRealTimers(); await settle();
    }
  });

  it("preserves explicit portal create draft-flush timing independently of translated labels", async () => {
    await locale(language);
    const callbacks = props({ value: { NODE_ENV: "original" } }); const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<><ControlledEditor {...callbacks} />{createPortal(<SecretPopoverForm mode="create" initialName="new_secret" initialValue="raw_value" onCancel={vi.fn()} onSubmit={onSubmit} />, document.body)}</>);
    await edit(input("variableValue"), "draft-value");
    expect(callbacks.onChange).not.toHaveBeenCalled(); expect(onSubmit).not.toHaveBeenCalled();
    button(tr("createAndBind")).click(); await settle();
    expect(callbacks.onChange).toHaveBeenCalledExactlyOnceWith({ NODE_ENV: { type: "plain", value: "draft-value" } });
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("new_secret", "raw_value");
    expect(vi.mocked(callbacks.onChange).mock.invocationCallOrder[0]).toBeLessThan(onSubmit.mock.invocationCallOrder[0]);
  });

  it("keeps interpolated secret names literal in the store description", async () => {
    await locale(language);
    const raw = "raw_<strong>NAME</strong>_{{KEEP}}";
    render(<SecretPopoverForm mode="store" initialName={raw} initialValue="raw-value" onCancel={vi.fn()} onSubmit={vi.fn()} />);
    const description = container.querySelector('[data-slot="popover-description"]')!;
    expect(description.textContent).toContain(raw);
    expect(description.querySelector("strong")).toBeNull();
    expect(description.querySelector("span")?.textContent).toBe(raw);
  });

  it("creates and binds only on explicit store, preserving pending state on the real row", async () => {
    await locale(language);
    let resolve!: (created: CompanySecret) => void;
    const onCreateSecret = vi.fn(() => new Promise<CompanySecret>(done => { resolve = done; }));
    const callbacks = props({ value: { API_KEY: { type: "plain", value: "fixture-sensitive-value" } }, onCreateSecret });
    render(<ToastProvider><ControlledEditor {...callbacks} /><ToastCapture /></ToastProvider>);
    const rowValue = input("variableValue"); expect(rowValue.type).toBe("password");
    button(tr("storeAsSecret")).click(); await settle();
    const draft = input("secretValue"); expect(draft.value).toBe("fixture-sensitive-value"); expect(draft.readOnly).toBe(true);
    button(tr("storeAndBind")).click(); await settle();
    expect(onCreateSecret).toHaveBeenCalledExactlyOnceWith("api_key", "fixture-sensitive-value");
    await locale(language === "ja" ? "es" : "ja");
    expect(input("secretValue")).toBe(draft); expect(draft.type).toBe("password"); expect(input("variableValue")).toBe(rowValue);
    expect(callbacks.onChange).not.toHaveBeenCalled(); expect(onCreateSecret).toHaveBeenCalledTimes(1);
    resolve(secret); await settle();
    expect(document.querySelector(`input[aria-label="${tr("secretValue")}"]`)).toBeNull();
    expect(container.textContent).toContain(tr("secretCreated", { name: secret.name }));
    expect(callbacks.onChange).not.toHaveBeenCalled();
    button(tr("save")).click(); await settle();
    expect(callbacks.onChange).toHaveBeenCalledExactlyOnceWith({ API_KEY: { type: "secret_ref", secretId: secret.id, version: "latest" } });
  });
});
