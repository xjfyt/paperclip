import type { IssueWorkMode } from "@paperclipai/shared";
import { t } from "../i18n";

/** Only the explicit current-user option is system copy; names are never translated. */
export function commentSelfAssigneeOption(userId: string) {
  return { id: `user:${userId}`, label: t("composerAssigneeUi.self"), searchText: "Me" };
}

export function composerModePlaceholder(mode: IssueWorkMode, assigneeName: string | null, mobile: boolean): string {
  const key = mode === "planning" ? "plan" : mode === "ask" ? "ask" : "message";
  return assigneeName === null
    ? t(`composerAssigneeUi.${key}Unassigned`)
    : t(`browserQa.${key}${mobile ? "Mobile" : ""}`, { agent: assigneeName });
}
