import type { InboxGroupedSection } from "../lib/inbox";
import { t } from "./index";

// Use canonical group identity, never reverse-map English text or user labels.
export function inboxGroupDisplay(group: Pick<InboxGroupedSection, "key" | "label" | "searchSection">): string | null {
  const prefix = group.searchSection === "archived" ? "archived-search:" : group.searchSection === "other" ? "other-search:" : "";
  const key = prefix && group.key.startsWith(prefix) ? group.key.slice(prefix.length) : group.key;
  const section = ({
    issue: "issue", approval: "approval", failed_run: "failed_run", join_request: "join_request",
    "kind:approval": "approval", "kind:failed_run": "failed_run", "kind:join_request": "join_request",
    "assignee:none": "unassigned", "project:none": "noProject", "workspace:none": "noWorkspace",
  } as Record<string, string>)[key];
  return section ? t(`inboxUi.section.${section}`) : group.label;
}

type JoinRequestLabelInput = {
  requestType: string;
  agentName: string | null;
  requestEmailSnapshot: string | null;
  requestingUserId: string | null;
  requesterUser?: { name: string | null; email: string | null } | null;
};

export function joinRequestDisplay<T extends JoinRequestLabelInput>(request: T, canonical: (request: T) => string): string {
  if (request.requestType === "agent") {
    return request.agentName ? t("inboxUi.agentJoinNamed", { name: request.agentName }) : t("inboxUi.agentJoin");
  }
  if (request.requestType === "human" && ![
    request.requesterUser?.name, request.requesterUser?.email, request.requestEmailSnapshot, request.requestingUserId,
  ].some(value => value?.trim())) return t("inboxUi.humanJoin");
  return canonical(request);
}
