// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { i18n, useTranslation } from "./index";
import "./connection-access-test-resources";
import { connectionCompletionMessages } from "./connection-completion-test-resources";
import { validateLocaleMessages } from "./locale-validation";
import { accessSummaryLines, ConnectionSetupCompletionScreen, connectionDefaultSummarySentence } from "../features/connections/ConnectionSetupFlow";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/pages/apps/AppLogo", () => ({ AppLogo: () => null }));
afterEach(async () => { await i18n.changeLanguage("en"); });
const locales = ["en", "zh-CN", "es", "ja"] as const;
const input = { authKind: "oauth", grantKind: "user", installChoice: "specific", installCount: 1, enabledCount: 2 } as const;
it.each(Object.entries(connectionCompletionMessages))("validates completion resources against composer rules in %s", (locale, messages) => {
  expect(validateLocaleMessages(messages, connectionCompletionMessages.en)).toEqual([]);
  for (const [key, value] of Object.entries(messages)) {
    expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    if (locale !== "en") expect(value).not.toBe(connectionCompletionMessages.en[key as keyof typeof messages]);
  }
});
it.each(locales)("renders identity, selected reach, and enabled action counts in %s", async locale => {
  await i18n.changeLanguage(locale);
  for (const [authKind, grantKind, key] of [["none", "user", "connectionAccessUi.noIdentity"], ["oauth", "user", "connectionCompletionUi.yourIdentity"], ["api_key", "agent", "connectionCompletionUi.dedicatedIdentity"], ["oauth", "organization", "connectionCompletionUi.organizationIdentity"]] as const) {
    for (const count of [0, 1, 2]) {
      const summary = accessSummaryLines({ ...input, authKind, grantKind, installCount: count, enabledCount: count });
      expect(summary).toEqual([
        { label: i18n.t("connectionCompletionUi.identityLabel"), value: i18n.t(key) },
        { label: i18n.t("connectionCompletionUi.availableToLabel"), value: i18n.t("connectionCompletionUi.selectedAgents", { count }) },
        { label: i18n.t("connectionCompletionUi.actionsLabel"), value: i18n.t("connectionCompletionUi.actionsOn", { count }) },
      ]);
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(<ConnectionSetupCompletionScreen appName="Customer <strong>API</strong> 私の接続" summary={summary} onDone={() => {}} />);
      expect(host.querySelector('h2')?.textContent).toBe(i18n.t("connectionCompletionUi.appReady", { appName: "Customer <strong>API</strong> 私の接続" }));
      expect(host.querySelector('strong')).toBeNull();
      expect(Array.from(host.querySelectorAll('dd'), node => node.textContent)).toEqual(summary.map(line => line.value));
      expect(host.querySelector('button')?.textContent).toBe(i18n.t("connectionCompletionUi.viewConnection"));
    }
  }
  expect(accessSummaryLines({ ...input, installChoice: "all" })[1].value).toBe(i18n.t("connectionAccessUi.anyAgent"));
});
it.each(locales)("does not describe unknown completion inputs as granted or read-only in %s", async locale => {
  await i18n.changeLanguage(locale);
  const unknown = { authKind: "unknown", grantKind: "unknown", installChoice: "unknown", installCount: -1, enabledCount: -1 } as unknown as Parameters<typeof accessSummaryLines>[0];
  expect(accessSummaryLines(unknown).map(line => line.value)).toEqual([i18n.t("connectionAccessUi.summaryIdentityUnknown"), i18n.t("connectionAccessUi.summaryReachUnknown"), i18n.t("connectionCompletionUi.actionsUnknown")]);
  expect(accessSummaryLines({ ...input, grantKind: "unknown" as typeof input.grantKind })[0].value).toBe(i18n.t("connectionAccessUi.summaryIdentityUnknown"));
  for (const count of [-1, Number.NaN, 1.5]) {
    const result = accessSummaryLines({ ...input, installCount: count, enabledCount: count });
    expect(result[1].value).toBe(i18n.t("connectionAccessUi.summaryReachUnknown"));
    expect(result[2].value).toBe(i18n.t("connectionCompletionUi.actionsUnknown"));
  }
});
it.each(locales)("retranslates a mounted completion from %s without completing again", async locale => {
  await i18n.changeLanguage(locale);
  const onDone = vi.fn();
  function Harness() {
    const { t } = useTranslation();
    return <ConnectionSetupCompletionScreen appName="Customer API" summary={accessSummaryLines(input, t)} statedDefault={connectionDefaultSummarySentence(input, t)} onDone={onDone} />;
  }
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => { await i18n.changeLanguage(locale === "ja" ? "zh-CN" : "ja"); });
    expect(container.querySelector('h2')?.textContent).toBe(i18n.t("connectionCompletionUi.appReady", { appName: "Customer API" }));
    expect(Array.from(container.querySelectorAll('dd'), node => node.textContent)).toEqual(accessSummaryLines(input).map(line => line.value));
    expect(container.textContent).toContain(connectionDefaultSummarySentence(input));
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => container.querySelector('button')!.click());
    expect(onDone).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); container.remove(); }
});
it("keeps externally supplied completion labels and diagnostics verbatim", () => {
  const summary = [{ label: "Customer Actions", value: "Provider raw diagnostic <read/write>" }];
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<ConnectionSetupCompletionScreen appName="API" summary={summary} onDone={() => {}} />);
  expect(host.querySelector('dt')?.textContent).toBe(summary[0].label);
  expect(host.querySelector('dd')?.textContent).toBe(summary[0].value);
});
