import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "./index";
import { formatCents, formatNumber, formatDate, relativeTime } from "../lib/utils";

afterEach(async () => { await i18n.changeLanguage("en"); });
describe("locale-aware formatting", () => {
  it("keeps currency independent from language", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(formatCents(12345, "USD")).toBe(new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(123.45));
  });
  it("formats dates and numbers using the selected locale", async () => {
    await i18n.changeLanguage("es");
    expect(formatNumber(1234567.8)).toBe(new Intl.NumberFormat("es").format(1234567.8));
    expect(formatDate(new Date(2026, 9, 25))).toBe(new Date(2026, 9, 25).toLocaleDateString("es", { month: "short", day: "numeric", year: "numeric" }));
  });
  it("localizes relative time rather than changing the timestamp", async () => {
    await i18n.changeLanguage("ja");
    expect(relativeTime(new Date(Date.now() - 120000))).toBe(new Intl.RelativeTimeFormat("ja", { numeric: "auto" }).format(-2, "minute"));
  });
});
