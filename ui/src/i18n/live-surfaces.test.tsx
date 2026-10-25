// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { i18n } from "./index";
import { PropertyRow, PropertySection } from "../components/issue-properties/primitives";
import { StatusIcon } from "../components/StatusIcon";
import { timeAgo } from "../lib/timeAgo";
afterEach(async () => { vi.restoreAllMocks(); await i18n.changeLanguage("en"); });
it.each(["en", "zh-CN", "es", "ja"])("localizes visible properties, status actions and relative time in %s without changing stable attributes", async locale => {
  await i18n.changeLanguage(locale); vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-25T12:00:00Z"));
  const properties = renderToStaticMarkup(<PropertySection title="Work"><PropertyRow label="Status">fixture</PropertyRow></PropertySection>);
  expect(properties).toContain('data-property-label="Status"'); expect(properties).toContain(i18n.t("propertyLabels.status")); expect(properties).toContain(i18n.t("propertyLabels.work"));
  const status = locale === "en" ? "In Progress" : i18n.t("statuses.in_progress");
  const icon = renderToStaticMarkup(<StatusIcon status="in_progress" showLabel onChange={() => {}} />);
  expect(icon).toContain(i18n.t("liveUi.changeStatus", { status })); expect(icon).toContain(status);
  expect(timeAgo("2026-10-25T11:00:00Z")).toBe(locale === "en" ? "1h ago" : new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" }).format(-1, "hour"));
});
it("keeps user-defined property labels unchanged", async () => {
  await i18n.changeLanguage("ja");
  const output = renderToStaticMarkup(<PropertyRow label="Customer workflow">Customer content</PropertyRow>);
  expect(output).toContain('data-property-label="Customer workflow"'); expect(output).toContain("Customer content"); expect(output).toContain("Customer workflow");
});
