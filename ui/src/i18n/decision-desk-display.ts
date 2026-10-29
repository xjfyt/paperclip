import { t } from "./index";
import { formatDate } from "../lib/utils";
import { NO_GROUP_SENTINEL, type AttentionGroup } from "../lib/attention";

// Translate system group identities, never the returned English label or a user title.
const groupKeys: Record<string, string> = {
  "desk:decide-now": "shelf.decide-now", "desk:new-today": "shelf.new-today", "desk:earlier": "shelf.earlier",
  "date:today": "date.today", "date:yesterday": "date.yesterday", "date:this_week": "date.this_week", "date:earlier": "date.earlier",
  "severity:critical": "severities.critical", "severity:high": "severities.high", "severity:medium": "severities.medium", "severity:low": "severities.low",
  [`project:${NO_GROUP_SENTINEL}`]: "noProject",
};
export function decisionGroupLabel(group: AttentionGroup) {
  if (group.key.startsWith("type:")) return t(`decisionDeskUi.source.${group.key.slice(5)}`, { defaultValue: group.label ?? group.key.slice(5) });
  return groupKeys[group.key] ? t(`decisionDeskUi.${groupKeys[group.key]}`) : group.label;
}
export function decisionDateLabel(value: string | null) {
  if (!value) return "…";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) ? formatDate(date) : value;
}
