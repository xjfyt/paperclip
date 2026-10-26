// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { getConnectableAppDefinition } from "@paperclipai/shared";
import { i18n } from "./index";
import { connectionOAuthMessages } from "./connection-oauth-test-resources";
import { validateLocaleMessages } from "./locale-validation";
import { OAuthConnectStateScreen } from "../features/connections/ConnectionSetupFlow";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/pages/apps/AppLogo", () => ({ AppLogo: () => null }));
afterEach(async () => { await i18n.changeLanguage("en"); });
const locales = ["en", "zh-CN", "es", "ja"] as const;
const noop = () => {};
const serverName = "Customer <strong>私のサーバー</strong>";
const authorizationHost = "auth.customer.example";
const authorizationUrl = "https://auth.customer.example/authorize?state=opaque%2Bvalue";
const props = { identity: { name: serverName, unverifiedHost: "customer.example" }, onRetry: noop, onBack: noop, onCancel: noop };
it.each(Object.entries(connectionOAuthMessages))("validates OAuth resources and composer rules in %s", (locale, messages) => {
  expect(validateLocaleMessages(messages, connectionOAuthMessages.en)).toEqual([]);
  for (const [key, value] of Object.entries(messages)) {
    expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    if (locale !== "en") expect(value).not.toBe(connectionOAuthMessages.en[key as keyof typeof messages]);
  }
});
it.each(locales)("renders every OAuth phase, resume wording, host warning and stable links in %s", async locale => {
  await i18n.changeLanguage(locale);
  for (const [phase, resuming, title, body, action] of [
    ["entry", false, "connectTitle", "entryBody", "continueTo"],
    ["entry", true, "finishTitle", "resumeBody", "finishWith"],
    ["starting", false, "preparingTitle", "preparingBody", "preparing"],
    ["redirecting", false, "openingTitle", "redirectHostBody", "opening"],
    ["error", false, "errorTitle", "startFailed", "tryAgain"],
  ] as const) {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<OAuthConnectStateScreen {...props} phase={phase} resuming={resuming} authorizationHost={authorizationHost} authorizationUrl={authorizationUrl} steps={{ labels: ["User step", "User checkpoint"], activeIndex: 1 }} />);
    const values = { serverName, authorizationHost };
    expect(host.querySelector('h2')?.textContent).toBe(i18n.t(`connectionOAuthUi.${title}`, values));
    expect(host.textContent).toContain(i18n.t(`connectionOAuthUi.${body}`, values));
    expect(host.textContent).toContain(i18n.t(`connectionOAuthUi.${action}`, values));
    expect(host.textContent).toContain(i18n.t("connectionOAuthUi.unverifiedServer"));
    expect(host.querySelector('nav')?.getAttribute('aria-label')).toBe(i18n.t("connectionOAuthUi.setupProgress"));
    expect(host.querySelector('[data-testid="wizard-step-labels"]')?.textContent).toContain("User step");
    expect(host.querySelector('strong')).toBeNull();
    expect(host.querySelector('a')?.getAttribute('href')).toBe(authorizationUrl);
    expect(host.querySelector('a')?.getAttribute('rel')).toBe("noopener noreferrer");
    expect(host.querySelector('a')?.textContent).toBe(i18n.t("connectionOAuthUi.openNewTab"));
  }
});
it.each(locales)("keeps external errors and guidance literal while translating the mounted OAuth screen from %s", async locale => {
  await i18n.changeLanguage(locale);
  const onRetry = vi.fn(), onBack = vi.fn(), onCancel = vi.fn(), onOpenAuthorization = vi.fn();
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const callbacks = { onRetry, onBack, onCancel, onOpenAuthorization };
  const entry = { ...getConnectableAppDefinition("github")!, name: serverName };
  try {
    await act(async () => root.render(<OAuthConnectStateScreen {...props} {...callbacks} entry={entry} phase="error" error={{ key: "connectionOAuthUi.callbackDenied" }} recoveryActions={{ installationUrl: "https://github.com/apps/customer/installations/new", managementUrl: "https://github.com/settings/installations" }} />));
    expect(container.textContent).toContain(i18n.t("connectionOAuthUi.callbackDenied"));
    await act(async () => { await i18n.changeLanguage(locale === "ja" ? "zh-CN" : "ja"); });
    expect(container.textContent).toContain(i18n.t("connectionOAuthUi.callbackDenied"));
    expect(container.querySelector('h1')?.textContent).toBe(i18n.t("connectionOAuthUi.headerConnect", { serverName }));
    expect(Array.from(container.querySelectorAll('a'), a => a.getAttribute('href'))).toEqual(["https://github.com/apps/customer/installations/new", "https://github.com/settings/installations"]);
    expect(container.textContent).toContain(i18n.t("connectionOAuthUi.installGithub"));
    expect(container.textContent).toContain(i18n.t("connectionOAuthUi.manageGithub"));
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
    await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === i18n.t("connectionOAuthUi.tryAgain"))!.click());
    expect(onRetry).toHaveBeenCalledOnce();
    const raw = "Provider diagnostic <write:repo> state=raw-provider-id";
    await act(async () => root.render(<OAuthConnectStateScreen {...props} {...callbacks} phase="error" error={raw} />));
    expect(container.textContent).toContain(raw);
    await act(async () => { await i18n.changeLanguage("es"); });
    expect(container.textContent).toContain(raw);
    await act(async () => root.render(<OAuthConnectStateScreen {...props} {...callbacks} phase="entry" guidance={<p>{raw}</p>} settingsValid={false} />));
    expect(container.textContent).toContain(raw);
    expect(Array.from(container.querySelectorAll('button')).find(b => b.textContent === i18n.t("connectionOAuthUi.continueTo", { serverName }))?.disabled).toBe(true);
    expect(onRetry).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); container.remove(); }
});
