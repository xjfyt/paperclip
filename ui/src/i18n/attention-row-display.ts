import type { AttentionItem } from "@paperclipai/shared";
import { t } from "./index";
import { formatNumber } from "../lib/utils";
import { attentionDetailLine } from "../lib/attention";
import { decisionDateLabel } from "./decision-desk-display";

export function attentionDecideByDisplay(value: string | null) {
  if (!value) return t("attentionRowUi.notSet");
  if (value === "today" || value === "this_week") return t(`decisionDeskUi.date.${value}`);
  if (value === "whenever") return t("attentionRowUi.whenever");
  return decisionDateLabel(value);
}

/** Translate only structured system framing, not provider excerpts or whyNow. */
export function attentionDetailDisplay(item: AttentionItem) {
  const detail = item.detail;
  if (!detail) return null;
  const countLine = (key: string, count: number, excerpt: string | null | undefined) => {
    const label = t(`attentionRowUi.${key}`, { count, n: formatNumber(count) });
    return excerpt?.trim() ? `${label} — “${excerpt.trim()}”` : label;
  };
  switch (detail.kind) {
    case "checkbox_confirmation": return countLine("options", detail.optionCount, detail.promptExcerpt);
    case "questions": return countLine("questions", detail.questionCount, detail.firstQuestionText);
    case "suggested_tasks": return countLine("suggestedTasks", detail.taskCount, detail.firstTaskTitle);
    case "item_verdicts": return countLine("verdicts", detail.itemCount, detail.promptExcerpt);
    case "blocker": {
      const blocker = detail.blockingIssue;
      if (!blocker?.title && !blocker?.identifier) return null;
      return t("attentionRowUi.blockedBy", { target: [blocker.identifier, blocker.title].filter(Boolean).join(" ") });
    }
    case "budget": return t("attentionRowUi.budget", {
      percent: formatNumber(Math.round(detail.observedPercent)),
      observed: formatNumber(detail.amountObserved, { maximumFractionDigits: 20 }),
      limit: formatNumber(detail.amountLimit, { maximumFractionDigits: 20 }),
    });
    default: return attentionDetailLine(item);
  }
}
