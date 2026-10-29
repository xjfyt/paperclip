// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "./index";
import { agentConfigurationMessages } from "./agent-configuration-test-resources";
import "../components/environment-variables-editor/i18n-test-resources";
import { agentConfigurationContextError } from "../lib/agent-configuration-errors";
import { LocalizedUiError, localizedUiErrorMessage } from "../lib/localized-ui-error";
import { SecretPopoverForm } from "../components/environment-variables-editor/CreateSecretPopover";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); await i18n.changeLanguage("en"); });

describe.each(Object.entries(agentConfigurationMessages))("local configuration guard messages (%s)", (locale, messages) => {
  it("uses stable local action codes and translates at action time, never by matching arbitrary errors", async () => {
    await i18n.changeLanguage(locale);
    for (const [action, key] of [["createSecret", "createSecretOrganization"], ["uploadImage", "uploadImageOrganization"], ["detectModel", "detectModelOrganization"]] as const) {
      const error = agentConfigurationContextError(action);
      expect(error).toBeInstanceOf(LocalizedUiError); expect(error.message).toBe(messages[key]);
      expect(localizedUiErrorMessage(error, "unused")).toEqual({ key: `agentConfigurationUi.${key}` });
      const originalError = new Error(agentConfigurationMessages.en[key]);
      expect(localizedUiErrorMessage(originalError, "unused")).toBe(agentConfigurationMessages.en[key]);
    }
  });
  it("documents the legacy secret-consumer boundary: a stored error stays literal until the next explicit action", async () => {
    await i18n.changeLanguage(locale);
    const submit = vi.fn<(name: string, value: string) => Promise<void>>(async () => { throw agentConfigurationContextError("createSecret"); });
    await act(async () => root.render(<SecretPopoverForm mode="create" initialName="fixture_name" initialValue="opaque-fixture-value" onCancel={() => {}} onSubmit={submit} />));
    const button = () => [...container.querySelectorAll("button")].find(button => button.textContent === i18n.t("environmentEditorUi.createAndBind"))!;
    await act(async () => button().click());
    expect(container.textContent).toContain(messages.createSecretOrganization);
    const name = container.querySelector<HTMLInputElement>('input[placeholder="secret_name"]')!; name.focus(); name.setSelectionRange(2, 5);
    const nextLocale = locale === "ja" ? "en" : "ja";
    await act(async () => { await i18n.changeLanguage(nextLocale); });
    // SecretPopoverForm owns a raw Error.message snapshot. Changing that cross-
    // component contract is outside this slice; new attempts use current language.
    expect(container.textContent).toContain(messages.createSecretOrganization);
    expect(container.querySelector('input[placeholder="secret_name"]')).toBe(name);
    expect(document.activeElement).toBe(name); expect([name.selectionStart, name.selectionEnd]).toEqual([2, 5]);
    expect(name.value).toBe("fixture_name"); expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("opaque-fixture-value");
    expect(submit).toHaveBeenCalledExactlyOnceWith("fixture_name", "opaque-fixture-value");
    await act(async () => button().click());
    expect(container.textContent).toContain(i18n.t("agentConfigurationUi.createSecretOrganization"));
    expect(submit.mock.calls).toEqual([["fixture_name", "opaque-fixture-value"], ["fixture_name", "opaque-fixture-value"]]);
    expect(container.textContent).not.toContain("opaque-fixture-value");
  });
});
