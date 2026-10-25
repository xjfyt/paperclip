// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { BudgetPolicySummary } from "@paperclipai/shared";
import { i18n } from "@/i18n";
import { BudgetPolicyCard } from "./BudgetPolicyCard";
const summary: BudgetPolicySummary = {
  policyId: "fixture-policy", companyId: "company", scopeType: "agent", scopeId: "agent", scopeName: "Customer named Budget", metric: "billed_cents", windowKind: "calendar_month_utc",
  amount: 500, observedAmount: 125, remainingAmount: 375, utilizationPercent: 25, warnPercent: 80, hardStopEnabled: true, unpricedUsagePolicy: "block", notifyEnabled: true, isActive: true, status: "warning", paused: true, pauseReason: "budget", unpricedEventCount: 1, pendingRunCount: 1,
  windowStart: new Date("2026-10-01T00:00:00Z"), windowEnd: new Date("2026-11-01T00:00:00Z"), reservationCents: "1.0000000",
};
afterEach(async () => { await i18n.changeLanguage("en"); });
it.each([["en", "Monthly UTC budget"], ["zh-CN", "月度 UTC 预算"], ["es", "Presupuesto mensual UTC"], ["ja", "月次 UTC 予算"]])("localizes budget explanations in %s without changing UTC or customer names", async (locale, label) => {
  await i18n.changeLanguage(locale);
  const html = renderToStaticMarkup(<BudgetPolicyCard summary={summary} onSave={() => {}} onReservationChange={() => {}} onUnpricedUsagePolicyChange={() => {}} />);
  expect(html).toContain(label); expect(html).toContain("Customer named Budget"); expect(html).toContain("USD"); expect(html).toContain('aria-valuenow="25"');
  expect(summary.amount).toBe(500); expect(summary.windowKind).toBe("calendar_month_utc");
});
it("saves the same USD cents in Chinese and keeps invalid amounts disabled", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await i18n.changeLanguage("zh-CN"); const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const save = vi.fn();
  try {
    await act(async () => root.render(<BudgetPolicyCard summary={summary} onSave={save} />));
    const input = host.querySelector<HTMLInputElement>("input")!;
    expect(host.querySelector(`label[for="${input.id}"]`)?.textContent).toContain("预算（USD）");
    const change = async (value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); };
    await change("-1"); expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true); expect(save).not.toHaveBeenCalled();
    await change("1.25"); await act(async () => host.querySelector<HTMLButtonElement>("button")!.click()); expect(save).toHaveBeenCalledWith(125);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
