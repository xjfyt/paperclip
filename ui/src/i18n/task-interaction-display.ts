import type { IssueThreadInteraction } from "@/lib/issue-thread-interactions";
import { getItemVerdictProgress } from "@/lib/issue-thread-interactions";
import { formatNumber, t } from "./index";

/** Display-only opt-in. Never use localized receipts as delivery text or persisted state. */
export function taskInteractionSummary(interaction: IssueThreadInteraction): string {
  const text = (key: string, values: Record<string, string | number> = {}) => t(`taskThreadReceiptsUi.${key}`, values);
  const count = (key: string, value: number, values: Record<string, string | number> = {}) =>
    text(key, { count: value, number: formatNumber(value), ...values });
  const outcome = interaction.result && "outcome" in interaction.result ? interaction.result.outcome : null;
  if (outcome === "skipped") return text("skipped");
  if (outcome === "withdrawn") return text("withdrawn");
  if (outcome === "issue_closed") return text("issueClosed");
  if (outcome === "addressee_deleted") return text("addresseeDeleted");
  if (interaction.kind === "suggest_tasks") {
    if (interaction.status === "accepted") {
      const created = interaction.result?.createdTasks?.length ?? 0;
      return interaction.result?.skippedClientKeys?.length
        ? text("acceptedSome", { number: formatNumber(created), total: formatNumber(interaction.payload.tasks.length) })
        : count("acceptedTasks", created);
    }
    return count(interaction.status === "rejected" ? "rejectedTasks" : "suggestedTasks", interaction.payload.tasks.length);
  }
  if (interaction.kind === "request_confirmation") {
    if (interaction.status === "accepted") return text("confirmed");
    if (interaction.status === "rejected") {
      const label = interaction.payload.rejectLabel?.trim();
      return label ? text("selectedLabel", { label }) : text("declined");
    }
    if (interaction.status === "expired") return text(outcome === "superseded_by_comment" ? "confirmationComment" : outcome === "stale_target" ? "confirmationChanged" : "confirmationExpired");
    return text("requestedConfirmation");
  }
  if (interaction.kind === "request_checkbox_confirmation") {
    if (interaction.status === "accepted") {
      const selected = interaction.result?.selectedOptionIds?.length ?? 0;
      return selected ? text("confirmedOptions", { number: formatNumber(selected), total: formatNumber(interaction.payload.options.length) }) : text("confirmedNoOptions");
    }
    if (interaction.status === "rejected") return text("selectionDeclined");
    if (interaction.status === "expired") return text(outcome === "superseded_by_comment" ? "selectionComment" : outcome === "stale_target" ? "selectionChanged" : "selectionExpired");
    return count("requestedOptions", interaction.payload.options.length);
  }
  if (interaction.kind === "request_item_verdicts") {
    const progress = getItemVerdictProgress({ payload: interaction.payload, result: interaction.result });
    if (interaction.status === "answered") {
      const parts = [count("decided", progress.decided)];
      if (progress.approved) parts.push(count("approved", progress.approved));
      if (progress.rejected) parts.push(count("rejected", progress.rejected));
      if (progress.deferred) parts.push(count("deferred", progress.deferred));
      return parts.join(" · ");
    }
    if (interaction.status === "expired") return text(outcome === "superseded_by_comment" ? "verdictsComment" : outcome === "stale_target" ? "verdictsChanged" : "verdictsExpired");
    return text("decidedOfTotal", { number: formatNumber(progress.decided), total: formatNumber(progress.total) });
  }
  if (interaction.kind === "connection_intent") {
    const key = interaction.status === "accepted" ? "connected" : interaction.status === "rejected" ? "connectionDeclined"
      : interaction.status === "expired" ? outcome === "superseded" ? "connectionSuperseded" : "connectionExpired" : "connect";
    return text(key, { service: interaction.payload.serviceName });
  }
  const key = interaction.status === "answered" ? "answeredQuestions" : interaction.status === "cancelled" ? "cancelledQuestions"
    : interaction.status === "expired" ? interaction.result?.expirationReason === "superseded_by_comment" ? "questionsComment" : "questionsExpired" : "askedQuestions";
  return count(key, interaction.payload.questions.length);
}

/** Structural expiration codes only; free-form cancellation reasons remain raw. */
export function taskQuestionExpirationReason(reason: string): string {
  if (reason === "superseded_by_comment") return t("taskThreadReceiptsUi.supersededComment");
  if (reason === "superseded_by_newer_interaction") return t("taskThreadReceiptsUi.supersededInteraction");
  return reason;
}
