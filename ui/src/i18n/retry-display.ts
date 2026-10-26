import { formatMonitorOffset } from "../lib/issue-monitor";
import { i18n } from "./index";
import { monitorDurationDisplay } from "./monitor-display";

const knownReasons = new Set([
  "native_provider_overloaded", "ai_connection_pool_wait", "transient_failure",
  "missing_issue_comment", "process_lost", "assignment_recovery",
  "issue_continuation_needed", "max_turns_continuation", "workspace_busy",
]);

/** Known protocol IDs get labels; unknown diagnostics remain verbatim. */
export function retryReasonDisplay(reason: string | null | undefined, locale = i18n.language): string | null {
  if (!reason?.trim()) return null;
  return knownReasons.has(reason) ? i18n.getFixedT(locale)(`issueRetryUi.${reason}`) : reason;
}

/** Use the existing offset's exact due-now boundaries; no scheduling or timer changes. */
export function retryScheduleDisplay(nextCheckAt: string | null, locale = i18n.language) {
  const t = i18n.getFixedT(locale);
  if (!nextCheckAt) return { offset: null, when: t("issueRetryUi.pendingScheduleLower") };
  const original = formatMonitorOffset(nextCheckAt);
  if (original === "now") return { offset: t("issueRetryUi.now"), when: t("issueRetryUi.dueNow") };
  const delta = new Date(nextCheckAt).getTime() - Date.now();
  const offset = locale === "en" ? original : t(delta > 0 ? "issueMonitorUi.inDuration" : "issueRetryUi.ago", {
    duration: monitorDurationDisplay(delta, locale),
  });
  return { offset, when: offset };
}
