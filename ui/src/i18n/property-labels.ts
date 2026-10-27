import { useTranslation } from "./index";
// Only framework-defined labels are translated. Attribute values and arbitrary
// user/provider labels remain unchanged, including data-property-label hooks.
const keys: Record<string, string> = {
  Work: "work", Triage: "triage", Status: "status", Assignee: "assignee", Project: "project", Labels: "labels", Priority: "priority", Goal: "goal",
  Relationships: "relationships", Parent: "parent", "Blocked by": "blockedBy", Blocking: "blocking", Subtasks: "subtasks", "Sub-tasks": "subtasks", Referenced: "referenced", "Related tasks": "relatedTasks", "Pull requests": "pullRequests",
  Execution: "execution", Approvals: "approvals", "Execution policy": "executionPolicy", Reviewers: "reviewers", Approvers: "approvers", Workspace: "workspace", "Scheduled retry": "scheduledRetry", Monitor: "monitor", Watchdog: "watchdog", Service: "service", Branch: "branch", Folder: "folder",
  About: "about", Originating: "originating", Started: "started", Completed: "completed", Created: "created", Updated: "updated", Archived: "archived", Depth: "depth", Properties: "properties", Plan: "plan", Artifacts: "artifacts", References: "references", "External objects": "externalObjects",
};
export function usePropertyLabels() {
  const { t } = useTranslation();
  return (label: string) => label === "Model" ? t("issueModelUi.model") : Object.hasOwn(keys, label) ? t(`propertyLabels.${keys[label]}`) : label;
}

const builtinPanelLabels: Record<string, string> = { properties: "Properties", plans: "Plan", artifacts: "Artifacts", subtasks: "Subtasks", references: "References" };
export function useBuiltinPanelLabel() {
  const labelText = usePropertyLabels();
  return (id: string, label: string) => Object.hasOwn(builtinPanelLabels, id) && builtinPanelLabels[id] === label ? labelText(label) : label;
}
