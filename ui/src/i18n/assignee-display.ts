import { useCallback, useMemo } from "react";
import type { CompanyUserDirectoryEntry } from "@/api/access";
import { formatUserLabel } from "@/lib/assignees";
import { useTranslation } from "./index";

type UserDisplaySource = Pick<CompanyUserDirectoryEntry, "principalId" | "user">;

/** UI-only opt-in. Never pass these labels to wire/search/interaction helpers. */
export function useAssigneeDisplayLabels(
  currentUserId: string | null | undefined,
  users?: readonly UserDisplaySource[] | null,
) {
  const { t, i18n } = useTranslation();
  // The shared company label map also contains synthesized "Board"/ID labels.
  // Read original directory fields so real names (even "You"/"Board") stay raw.
  const names = useMemo(() => {
    const result = new Map<string, string>();
    for (const entry of users ?? []) {
      const name = entry.user?.name?.trim() || entry.user?.email?.trim();
      if (name) result.set(entry.principalId, name);
      else result.delete(entry.principalId);
    }
    return result;
  }, [users]);
  const userLabel = useCallback((userId: string | null | undefined): string | null => {
    if (!userId) return null;
    const name = names.get(userId);
    if (name) return name;
    if (currentUserId && userId === currentUserId) return t("filterUi.you");
    if (userId === "local-board") return t("taskListUi.board");
    return formatUserLabel(userId);
  }, [currentUserId, names, t, i18n.language]);
  const currentUserOptionLabel = currentUserId
    ? names.get(currentUserId) ?? t(currentUserId === "local-board" ? "taskListUi.board" : "filterUi.me")
    : null;
  return { userLabel, currentUserOptionLabel };
}
