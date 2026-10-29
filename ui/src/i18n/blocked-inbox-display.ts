import type { IssueBlockedInboxSeverity } from "@paperclipai/shared";
import { BLOCKED_REASON_VARIANT_ORDER, type BlockedReasonVariant } from "../lib/blockedInbox";
import { formatRelativeTime, t } from "./index";

// Display only: canonical grouping, filtering, sorting, and API enums stay unchanged.
export function blockedVariantDisplay(variant: BlockedReasonVariant): string {
  return BLOCKED_REASON_VARIANT_ORDER.includes(variant) ? t(`blockedInboxUi.variant.${variant}`) : variant;
}

export function blockedSeverityDisplay(severity: IssueBlockedInboxSeverity): string {
  return ["critical", "high", "medium", "low"].includes(severity) ? t(`blockedInboxUi.severity.${severity}`) : severity;
}

export function stoppedAgeDisplay(stoppedSinceAt: string | null, now = Date.now()): string {
  const then = stoppedSinceAt ? new Date(stoppedSinceAt).getTime() : NaN;
  if (!Number.isFinite(then)) return t("blockedInboxUi.stopped");
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return t("blockedInboxUi.justNow");
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] = seconds < 3600
    ? [Math.floor(seconds / 60), "minute"]
    : seconds < 86400 ? [Math.floor(seconds / 3600), "hour"]
    : seconds < 86400 * 7 ? [Math.floor(seconds / 86400), "day"]
    : seconds < 86400 * 30 ? [Math.floor(seconds / (86400 * 7)), "week"]
    : [Math.floor(seconds / (86400 * 30)), "month"];
  return t("blockedInboxUi.stoppedAt", { time: formatRelativeTime(-value, unit) });
}
