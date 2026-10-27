// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { QuotaWindow } from "@paperclipai/shared";
import { ProviderQuotaCard } from "./ProviderQuotaCard";
import { agentTaskQuotaMessages, i18n } from "../i18n/agent-task-quota-test-resources";
import { validateLocaleMessages } from "../i18n/locale-validation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => { await i18n.changeLanguage("en"); });

// ProviderQuotaCard's legacy/no-account fallback, not the newer AccountQuotaPanels path.
describe.each(["anthropic", "openai"])("localized %s subscription fallback panel", (provider) => {
  it.each(Object.entries(agentTaskQuotaMessages))("updates display copy in %s while preserving provider windows and numeric values", async (locale, copy) => {
    expect(validateLocaleMessages(copy, agentTaskQuotaMessages.en)).toEqual([]);
    await i18n.changeLanguage(locale);
    const windows: QuotaWindow[] = [
      { label: "GPT-5.3-Codex-Spark 5h limit", usedPercent: 108.25, resetsAt: null, valueLabel: null, detail: "Provider detail 用户: 04:30" },
      { label: "Current session", usedPercent: -2, resetsAt: null, valueLabel: null, detail: "Provider reset text UTC" },
      { label: "Current week (all models)", usedPercent: 72.5, resetsAt: "2026-10-28T14:05:00Z", valueLabel: null },
      { label: "Extra usage", usedPercent: null, resetsAt: null, valueLabel: "$8.75 / $10.00", detail: "Raw quota notice" },
    ];
    const original = JSON.stringify(windows);
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<ProviderQuotaCard provider={provider} rows={[]} budgetMonthlyCents={0}
        totalCompanySpendCents={0} weekSpendCents={0} windowRows={[]} showDeficitNotch={false}
        quotaWindows={windows} quotaSource={provider === "anthropic" ? "anthropic-oauth" : "codex-rpc"} quotaError="secret-provider-diagnostic" />));
      const assertCopy = (messages: typeof copy) => {
        expect(container.textContent).toContain(provider === "anthropic" ? messages.anthropicSubscription : messages.codexSubscription);
        expect(container.textContent).toContain(provider === "anthropic" ? messages.claudeSubscriptionHelp : messages.codexSubscriptionHelp);
        if (provider === "openai") {
          expect(container.textContent).toContain(messages.accountWindows);
          expect(container.textContent).toContain(messages.modelWindows);
        }
        for (const percent of [108.25, -2, 72.5]) expect(container.textContent).toContain(i18n.t("agentTaskQuotaUi.usedPercent", { percent }));
        for (const window of windows) {
          expect(container.textContent).toContain(window.label);
          if (window.detail) expect(container.textContent).toContain(window.detail);
          if (window.valueLabel) expect(container.textContent).toContain(window.valueLabel);
        }
        expect(container.textContent).toContain(messages.lastQuota);
        const formatted = new Date("2026-10-28T14:05:00Z").toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
        expect(container.textContent).toContain(i18n.t("agentTaskQuotaUi.resetsAt", { time: formatted }));
        expect(container.textContent).not.toContain("secret-provider-diagnostic");
        expect(container.textContent).toContain(provider === "anthropic" ? "Anthropic OAuth" : "Codex app server");
      };
      assertCopy(copy);
      const widths = () => [...container.querySelectorAll<HTMLElement>("[style]")].map(node => node.style.width).filter(Boolean);
      expect(widths()).toEqual(expect.arrayContaining(["100%", "0%", "72.5%"]));
      const originalWidths = widths();
      const next = locale === "ja" ? "es" : "ja";
      await act(async () => { await i18n.changeLanguage(next); });
      assertCopy(agentTaskQuotaMessages[next]);
      expect(widths()).toEqual(originalWidths);
      expect(JSON.stringify(windows)).toBe(original);
    } finally { act(() => root.unmount()); container.remove(); }
  });
  it.each(Object.entries(agentTaskQuotaMessages))("localizes unavailable quota in %s without exposing diagnostics or inventing values", async (locale, copy) => {
    await i18n.changeLanguage(locale);
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<ProviderQuotaCard provider={provider} rows={[]} budgetMonthlyCents={0}
        totalCompanySpendCents={0} weekSpendCents={0} windowRows={[]} showDeficitNotch={false}
        quotaWindows={[]} quotaSource={provider === "anthropic" ? "anthropic-oauth" : "codex-rpc"} quotaError="sensitive API response" />));
      expect(container.querySelector('[role="status"]')?.textContent).toBe(copy.unavailableQuota);
      expect(container.textContent).not.toContain("sensitive API response");
      expect(container.textContent).not.toContain(copy.lastQuota);
      expect(container.textContent).not.toContain(copy.modelWindows);
      const next = locale === "ja" ? "es" : "ja";
      await act(async () => { await i18n.changeLanguage(next); });
      expect(container.querySelector('[role="status"]')?.textContent).toBe(agentTaskQuotaMessages[next].unavailableQuota);
    } finally { act(() => root.unmount()); container.remove(); }
  });

});
