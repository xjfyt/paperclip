import { afterEach, describe, expect, it } from "vitest";
import { i18n, t } from "./index";
import { issueMonitorMessages } from "./issue-monitor-test-resources";
import { monitorEtaDisplay } from "./monitor-display";
import { formatMonitorAbsolute, formatMonitorEta, formatMonitorEtaLabel } from "../lib/issue-monitor";

const now = new Date("2026-10-26T12:00:00Z");
afterEach(async () => { await i18n.changeLanguage("en"); });

describe("monitor display boundaries", () => {
  it.each(Object.keys(issueMonitorMessages).flatMap((locale) => [
    1, 59_000, 60_000, 3_600_000, 7_920_000, 86_400_000, 90_000_000, 0, -59_999, -60_000, -1_080_000,
  ].map((delta) => ({ locale, delta }))))("keeps temporal boundaries at $delta ms in $locale", async ({ locale, delta }) => {
    await i18n.changeLanguage(locale);
    const target = new Date(now.getTime() + delta);
    const value = monitorEtaDisplay(target, now);
    const english = formatMonitorEta(target, now);
    if (locale === "en") {
      expect(value).toBe(english);
      expect(monitorEtaDisplay(target, now, true)).toBe(formatMonitorEtaLabel(target, now));
    } else if (delta <= 0 && delta > -60_000) {
      expect(value).toBe(t("issueMonitorUi.dueNow"));
    } else {
      const match = english.match(/(?:in |overdue by )(.+)/)!;
      const units: Record<string, string> = { s: "seconds", m: "minutes", h: "hours", d: "days" };
      const duration = match[1].replace(/(\d+)([smhd])/g, (_all, number: string, unit: string) =>
        t(`issueMonitorUi.${units[unit]}`, { value: new Intl.NumberFormat(locale).format(Number(number)) }),
      );
      expect(value).toBe(t(delta > 0 ? "issueMonitorUi.inDuration" : "issueMonitorUi.overdue", { duration }));
    }
  });

  it.each(Object.keys(issueMonitorMessages))("keeps time-zone comparison while translating Today in %s", async (locale) => {
    await i18n.changeLanguage(locale);
    const target = new Date("2026-10-26T23:59:00Z");
    const options = { locale, timeZone: "Asia/Tokyo", todayLabel: t("issueMonitorUi.today") };
    expect(formatMonitorAbsolute(target, options, "2026-10-27T00:01:00Z"))
      .toBe(`${t("issueMonitorUi.today")}, ${new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Tokyo" }).format(target)}`);
    expect(formatMonitorAbsolute(target, options, "2026-10-26T00:01:00Z")).not.toContain(`${t("issueMonitorUi.today")},`);
    expect(() => monitorEtaDisplay("invalid", now)).toThrow(RangeError);
  });
});
