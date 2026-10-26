import { formatMonitorEta, formatMonitorEtaLabel } from "../lib/issue-monitor";
import { formatNumber, i18n, t } from "./index";

/** Display only. Scheduling, due/overdue gates and countdown cadence stay in issue-monitor. */
export function monitorEtaDisplay(nextCheckAt: Date | string, now: Date | string, title = false): string {
  // Keep the existing English compact display, including its validated dates.
  const english = title ? formatMonitorEtaLabel(nextCheckAt, now) : formatMonitorEta(nextCheckAt, now);
  if (i18n.language === "en") return english;
  const delta = new Date(nextCheckAt).getTime() - new Date(now).getTime();
  if (delta <= 0 && delta > -60_000) return t("issueMonitorUi.dueNow");
  const ms = Math.abs(delta);
  const unit = (key: string, value: number) => t(`issueMonitorUi.${key}`, { value: formatNumber(value) });
  let duration: string;
  if (ms < 60_000) duration = unit("seconds", Math.max(1, Math.ceil(ms / 1_000)));
  else if (ms < 3_600_000) duration = unit("minutes", Math.floor(ms / 60_000));
  else if (ms < 86_400_000) {
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    duration = [unit("hours", Math.floor(ms / 3_600_000)), minutes ? unit("minutes", minutes) : null].filter(Boolean).join(" ");
  } else {
    const hours = Math.floor((ms % 86_400_000) / 3_600_000);
    duration = [unit("days", Math.floor(ms / 86_400_000)), hours ? unit("hours", hours) : null].filter(Boolean).join(" ");
  }
  return t(delta > 0 ? "issueMonitorUi.inDuration" : "issueMonitorUi.overdue", { duration });
}
