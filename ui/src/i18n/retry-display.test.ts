import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "./index";
import { issueRetryMessages } from "./issue-retry-test-resources";
import { validateLocaleMessages } from "./locale-validation";
import { retryReasonDisplay, retryScheduleDisplay } from "./retry-display";
import { formatMonitorOffset } from "../lib/issue-monitor";

const now = new Date("2026-10-26T12:00:00Z").getTime();
afterEach(() => { vi.restoreAllMocks(); });

describe("retry display contracts", () => {
  it.each(Object.entries(issueRetryMessages))("validates keys, interpolation and known/unknown diagnostic labels in %s", (locale, messages) => {
    expect(validateLocaleMessages(messages, issueRetryMessages.en)).toEqual([]);
    for (const value of Object.values(messages)) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    }
    for (const reason of ["native_provider_overloaded", "ai_connection_pool_wait", "transient_failure", "missing_issue_comment", "process_lost", "assignment_recovery", "issue_continuation_needed", "max_turns_continuation", "workspace_busy"] as const) {
      expect(retryReasonDisplay(reason, locale)).toBe(messages[reason]);
    }
    expect(retryReasonDisplay("  future_reason 原文  ", locale)).toBe("  future_reason 原文  ");
    expect(retryReasonDisplay(null, locale)).toBeNull();
    expect(retryReasonDisplay("  ", locale)).toBeNull();
    expect(retryScheduleDisplay(null, locale)).toEqual({ offset: null, when: messages.pendingScheduleLower });
    expect(() => retryScheduleDisplay("invalid", locale)).toThrow(RangeError);
  });

  it.each(Object.keys(issueRetryMessages).flatMap((locale) => [0, 29_999, 30_000, 59_999, 60_000, 7_920_000, 90_000_000, -29_999, -30_000, -59_999, -60_000, -7_920_000, -90_000_000].map((delta) => ({ locale, delta }))))("keeps legacy due-now and unit boundaries at $delta ms in $locale", ({ locale, delta }) => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const at = new Date(now + delta).toISOString();
    const original = formatMonitorOffset(at);
    const actual = retryScheduleDisplay(at, locale);
    const t = i18n.getFixedT(locale);
    if (original === "now") {
      expect(actual).toEqual({ offset: t("issueRetryUi.now"), when: t("issueRetryUi.dueNow") });
    } else if (locale === "en") {
      expect(actual).toEqual({ offset: original, when: original });
    } else {
      const units: Record<string, string> = { s: "seconds", m: "minutes", h: "hours", d: "days" };
      const duration = original.replace(/^in | ago$/g, "").replace(/(\d+)([smhd])/g, (_all, value: string, unit: string) => t(`issueMonitorUi.${units[unit]}`, { value: new Intl.NumberFormat(locale).format(Number(value)) }));
      const expected = t(delta > 0 ? "issueMonitorUi.inDuration" : "issueRetryUi.ago", { duration });
      expect(actual).toEqual({ offset: expected, when: expected });
    }
  });
});
