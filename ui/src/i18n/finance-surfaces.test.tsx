// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FINANCE_EVENT_KINDS } from "@paperclipai/shared";
import { i18n } from "./index";
import { FinanceTimelineCard } from "../components/FinanceTimelineCard";
import { FinanceKindCard } from "../components/FinanceKindCard";
import { financeDirectionDisplayName, financeEventKindDisplayName } from "../lib/utils";
afterEach(async () => { await i18n.changeLanguage("en"); });
it.each([["en", "Recent financial events", "Credit"], ["zh-CN", "近期财务事件", "贷方"], ["es", "Eventos financieros recientes", "Crédito"], ["ja", "最近の財務イベント", "貸方"]])("localizes finance system labels in %s and preserves custom text", async (locale, title, credit) => {
  await i18n.changeLanguage(locale);
  const timeline = renderToStaticMarkup(<FinanceTimelineCard rows={[]} emptyMessage="Customer supplied empty message" />);
  expect(timeline).toContain(title); expect(timeline).toContain("Customer supplied empty message");
  expect(financeDirectionDisplayName("credit")).toBe(credit);
  for (const kind of FINANCE_EVENT_KINDS) { expect(financeEventKindDisplayName(kind)).not.toContain("financeOps."); expect(financeEventKindDisplayName(kind)).not.toBe(kind); }
  expect(renderToStaticMarkup(<FinanceKindCard rows={[]} />)).not.toContain("financeOps.");
});
