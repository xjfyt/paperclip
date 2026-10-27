// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { BILLING_TYPES, type CostByProviderModel, type CostWindowSpendRow } from "@paperclipai/shared";
import { ProviderQuotaCard } from "./ProviderQuotaCard";
import { i18n, providerQuotaMessages } from "../i18n/provider-quota-test-resources";
import { formatCents } from "../lib/utils";
import { validateLocaleMessages } from "../i18n/locale-validation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => { await i18n.changeLanguage("en"); });

const expected = {
  en: { period: "Period spend", week: "This week", rolling: "Rolling windows", quota: "Subscription quota", budget: "10% of company budget", weekly: (amount: string) => `~${amount} / wk`, flow: "360 in · 90 out", mixed: "~2 api / ~1 sub runs", usage: "1 run · 50 total · 40 in · 10 out", tokenShare: "33% of provider tokens", costShare: "60% of provider cost", subscriptionShare: "11% of token usage via subscription", used: "23.5% used", reset: "Resets", unit: "10 tok", stale: "Showing the last available quota.", apiOne: "~1 api run", apiMany: "~2 api runs", subOne: "~1 sub run", subMany: "~2 sub runs", zeroUsage: "1 run · 0 in · 0 out" },
  "zh-CN": { period: "本期支出", week: "本周", rolling: "滚动时间窗口", quota: "订阅额度", budget: "占公司预算的 10%", weekly: (amount: string) => `约 ${amount} / 周`, flow: "输入 360 · 输出 90", mixed: "约 2 次 API / 约 1 次订阅运行", usage: "1 次运行 · 共 50 · 输入 40 · 输出 10", tokenShare: "占服务商词元用量的 33%", costShare: "占服务商费用的 60%", subscriptionShare: "11% 的词元用量来自订阅", used: "已使用 23.5%", reset: "重置时间：", unit: "10 词元", stale: "正在显示最近可用的额度", apiOne: "约 1 次 API 运行", apiMany: "约 2 次 API 运行", subOne: "约 1 次订阅运行", subMany: "约 2 次订阅运行", zeroUsage: "1 次运行 · 输入 0 · 输出 0" },
  es: { period: "Gasto del período", week: "Esta semana", rolling: "Ventanas móviles", quota: "Cuota de suscripción", budget: "10% del presupuesto de la empresa", weekly: (amount: string) => `~${amount} / semana`, flow: "360 de entrada · 90 de salida", mixed: "~2 ejecuciones API / ~1 de suscripción", usage: "1 ejecución · 50 en total · 40 de entrada · 10 de salida", tokenShare: "33% de los tokens del proveedor", costShare: "60% del costo del proveedor", subscriptionShare: "11% del uso de tokens mediante suscripción", used: "23.5% utilizado", reset: "Se restablece el", unit: "10 tokens", stale: "Se muestra la última cuota disponible.", apiOne: "~1 ejecución API", apiMany: "~2 ejecuciones API", subOne: "~1 ejecución de suscripción", subMany: "~2 ejecuciones de suscripción", zeroUsage: "1 ejecución · 0 de entrada · 0 de salida" },
  ja: { period: "対象期間の支出", week: "今週", rolling: "ローリング期間", quota: "サブスクリプションの利用枠", budget: "会社予算の 10%", weekly: (amount: string) => `約 ${amount} / 週`, flow: "入力 360 · 出力 90", mixed: "API 実行 約2回 / サブスクリプション実行 約1回", usage: "1回の実行 · 合計 50 · 入力 40 · 出力 10", tokenShare: "プロバイダーのトークン使用量の 33%", costShare: "プロバイダーの費用の 60%", subscriptionShare: "トークン使用量の 11% がサブスクリプション経由", used: "23.5% 使用済み", reset: "リセット日時：", unit: "10 トークン", stale: "直近の取得済み利用枠を表示しています。", apiOne: "API 実行 約1回", apiMany: "API 実行 約2回", subOne: "サブスクリプション実行 約1回", subMany: "サブスクリプション実行 約2回", zeroUsage: "1回の実行 · 入力 0 · 出力 0" },
};

function row(overrides: Partial<CostByProviderModel> = {}): CostByProviderModel {
  return { provider: "openai", biller: "openai", billingType: "subscription_included", model: "raw-model-用户-a", costCents: 600,
    eventCount: 1, estimatedEventCount: 0, unpricedEventCount: 0, inputTokens: 100, cachedInputTokens: 20, outputTokens: 30,
    apiRunCount: 1, subscriptionRunCount: 1, subscriptionInputTokens: 30, subscriptionCachedInputTokens: 10, subscriptionOutputTokens: 10, ...overrides };
}
const windowRows: CostWindowSpendRow[] = [
  { provider: "openai", biller: "openai", window: "5h", windowHours: 5, costCents: 100, inputTokens: 5, cachedInputTokens: 2, outputTokens: 3 },
  { provider: "openai", biller: "openai", window: "7d", windowHours: 168, costCents: 250, inputTokens: 50, cachedInputTokens: 20, outputTokens: 30 },
];
function props(overrides: Partial<ComponentProps<typeof ProviderQuotaCard>> = {}): ComponentProps<typeof ProviderQuotaCard> {
  return { provider: "openai", rows: [row(), row({ model: "raw-model-用户-b", billingType: "metered_api", costCents: 400, inputTokens: 200, cachedInputTokens: 40, outputTokens: 60, subscriptionRunCount: 0, subscriptionInputTokens: 0, subscriptionCachedInputTokens: 0, subscriptionOutputTokens: 0 })],
    budgetMonthlyCents: 10000, totalCompanySpendCents: 20000, weekSpendCents: 250, windowRows, showDeficitNotch: true,
    quotaSource: "raw-provider-source", quotaError: "private server diagnostic", quotaWindows: [
      { label: "Raw 5h quota 用户", usedPercent: 23.5, valueLabel: null, resetsAt: "2026-10-28T14:05:00Z" },
      { label: "Raw credits", usedPercent: null, valueLabel: "$4.20 remaining", resetsAt: null, detail: "Raw provider detail 用户" },
    ], ...overrides };
}
async function mount(input: ComponentProps<typeof ProviderQuotaCard>) {
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<ProviderQuotaCard {...input} />));
  return { container, render: async (next: ComponentProps<typeof ProviderQuotaCard>) => { await act(async () => root.render(<ProviderQuotaCard {...next} />)); }, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

describe("ProviderQuotaCard display contract", () => {
  it.each(Object.entries(expected))("renders complete %s templates in the real quota host without changing numeric budgets or provider values", async (locale, copy) => {
    expect(validateLocaleMessages(providerQuotaMessages[locale as keyof typeof expected], providerQuotaMessages.en)).toEqual([]);
    await i18n.changeLanguage(locale);
    const input = props();
    const snapshot = JSON.stringify(input);
    const { container, unmount } = await mount(input);
    const widths = () => [...container.querySelectorAll<HTMLElement>("[style]")].map(node => node.style.width).filter(Boolean);
    const check = (text: typeof copy) => {
      for (const value of [text.period, text.week, text.rolling, text.quota, text.budget, text.weekly(formatCents(2309)), text.flow, text.mixed, text.usage, text.subscriptionShare, text.used, text.reset, text.unit, text.stale]) expect(container.textContent).toContain(value);
      for (const raw of ["OpenAI", "raw-model-用户-a", "raw-model-用户-b", "Raw 5h quota 用户", "$4.20 remaining", "Raw provider detail 用户", "raw-provider-source", "5h", "7d"]) expect(container.textContent).toContain(raw);
      expect(container.textContent).not.toContain("24h");
      expect(container.textContent).not.toContain("private server diagnostic");
      expect(container.textContent).not.toMatch(/providerQuotaUi\.|agentTaskQuotaUi\.|<\/?\d>|{{/);
      expect(container.querySelector(`[title="${text.tokenShare}"]`)).not.toBeNull();
      expect(container.querySelector(`[title="${text.costShare}"]`)).not.toBeNull();
      const period = container.querySelector<HTMLElement>(`[role="progressbar"][aria-label="${text.period}: 10%"]`)!;
      expect(period.style.width).toBe("10%");
      expect(period.getAttribute("aria-valuenow")).toBe("10");
      expect(period.parentElement?.querySelector('[style*="left: 10%"]')).not.toBeNull();
      const week = container.querySelector<HTMLElement>(`[role="progressbar"][aria-label="${text.week}: 11%"]`)!;
      expect(Number.parseFloat(week.style.width)).toBeCloseTo(10.825);
      expect([...container.querySelectorAll('[data-slot="card-description"] .font-mono')].map(node => node.textContent)).toEqual(["360", "90"]);
      expect([...container.querySelectorAll("p > .font-mono.text-foreground")].map(node => node.textContent)).toEqual(["1", "50", "40", "10"]);
    };
    try {
      check(copy);
      const originalWidths = widths();
      const next = locale === "ja" ? "es" : "ja";
      await act(async () => { await i18n.changeLanguage(next); });
      check(expected[next]);
      expect(widths()).toEqual(originalWidths);
      expect(JSON.stringify(input)).toBe(snapshot);
    } finally { unmount(); }
  });

  it.each(Object.entries(expected))("keeps unavailable budgets and missing data absent in %s", async (locale, copy) => {
    await i18n.changeLanguage(locale);
    const input = props({ rows: [], windowRows: [], quotaWindows: [], quotaError: null, budgetMonthlyCents: 0 });
    const { container, render, unmount } = await mount(input);
    try {
      expect(container.querySelector('[role="progressbar"]')).toBeNull();
      for (const text of [copy.period, copy.week, copy.rolling, copy.quota]) expect(container.textContent).not.toContain(text);
      expect(container.querySelector('[data-slot="card-description"]')?.textContent).not.toContain("~");
      await render(props({ showBudgetUtilization: false }));
      expect(container.querySelector('[role="progressbar"]')).toBeNull();
      expect(container.textContent).not.toContain(copy.budget);
      expect(container.textContent).toContain(copy.quota);
    } finally { unmount(); }
  });

  it.each(Object.entries(expected))("handles API-only, subscription-only, mixed, and zero-token run counts in %s", async (locale, copy) => {
    await i18n.changeLanguage(locale);
    const { container, render, unmount } = await mount(props());
    try {
      const variants = [
        { apiRunCount: 1, subscriptionRunCount: 0, expected: copy.apiOne },
        { apiRunCount: 2, subscriptionRunCount: 0, expected: copy.apiMany },
        { apiRunCount: 0, subscriptionRunCount: 1, expected: copy.subOne },
        { apiRunCount: 0, subscriptionRunCount: 2, expected: copy.subMany },
      ];
      for (const variant of variants) {
        await render(props({ rows: [row({ apiRunCount: variant.apiRunCount, subscriptionRunCount: variant.subscriptionRunCount, subscriptionInputTokens: 0, subscriptionCachedInputTokens: 0, subscriptionOutputTokens: 0 })] }));
        expect(container.querySelector('[data-slot="card-description"]')?.textContent).toContain(variant.expected);
        if (variant.subscriptionRunCount === 1) expect(container.textContent).toContain(copy.zeroUsage);
      }
    } finally { unmount(); }
  });

  it.each(Object.entries(expected))("localizes every declared billing type without changing the wire enum in %s", async (locale) => {
    await i18n.changeLanguage(locale);
    const labels = {
      en: ["Metered API", "Subscription", "Subscription overage", "Credits", "Fixed", "Unknown"],
      "zh-CN": ["按量计费 API", "订阅", "订阅超额用量", "额度", "固定费用", "未知"],
      es: ["API de pago por uso", "Suscripción", "Exceso de suscripción", "Créditos", "Fijo", "Desconocido"],
      ja: ["従量課金 API", "サブスクリプション", "サブスクリプション超過分", "クレジット", "固定料金", "不明"],
    };
    const rows = BILLING_TYPES.map((billingType, index) => row({ model: `raw-model-${index}`, billingType }));
    const snapshot = JSON.stringify(rows);
    const { container, unmount } = await mount(props({ rows }));
    try {
      for (const label of labels[locale as keyof typeof labels]) expect(container.textContent).toContain(label);
      expect(JSON.stringify(rows)).toBe(snapshot);
    } finally { unmount(); }
  });
});
