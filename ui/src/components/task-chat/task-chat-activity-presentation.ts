import { t } from "@/i18n";
import { toolActivityDisplayLabels } from "./tool-activity-display";
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Box,
  Clock3,
  Database,
  FileCheck2,
  FilePenLine,
  FileText,
  GitBranch,
  Info,
  ListChecks,
  PackageCheck,
  Search,
  ShieldCheck,
  TerminalSquare,
  Users,
} from "lucide-react";
import type {
  TaskChatMaterializedResourceItem,
  TaskChatProtocolItem,
  TaskChatProviderActivityItem,
  TaskChatWorkspaceChangeItem,
  TaskChatWorkspaceFileItem,
} from "./task-chat-model";
import {
  humanizeToolName,
  isGenericToolName,
  mcpToolIdentity,
  toolActivityPresentation,
  type ToolIcon,
} from "./tool-taxonomy";

export interface TaskChatActivityPresentation {
  icon: ToolIcon;
  runningLabel: string;
  completedLabel: string;
  failedLabel?: string;
  interruptedLabel?: string;
  detail?: string;
}

export function providerNoticeSeverity(item: TaskChatProviderActivityItem): "info" | "warning" | "error" {
  const severity = item.details.find((entry) => entry.label === "Severity")?.value;
  if (item.status === "failed" || severity === "error") return "error";
  return severity === "info" ? "info" : "warning";
}

function providerDetail(item: TaskChatProviderActivityItem, ...labels: string[]): string | undefined {
  return item.details.find((entry) => labels.includes(entry.label))?.value;
}

function meaningfulToolDetail(value: string | undefined): string | undefined {
  if (!value || isGenericToolName(value) || /^tool(?:\s+|_)call\b/i.test(value)) return undefined;
  return value;
}

export function providerActivityPresentation(item: TaskChatProviderActivityItem): TaskChatActivityPresentation {
  const detail = item.summary
    ?? providerDetail(item, "Query", "URL", "Target", "Name", "Reference", "Reason", "Summary");
  switch (item.family) {
    case "research": {
      const action = providerDetail(item, "Action")?.toLowerCase();
      if (action === "open_page") {
        return { icon: Search, runningLabel: t("runnerProviderActivityUi.researchOpenRunning"), completedLabel: t("runnerProviderActivityUi.researchOpenCompleted"), failedLabel: t("runnerProviderActivityUi.researchOpenFailed"), interruptedLabel: t("runnerProviderActivityUi.researchOpenInterrupted"), detail };
      }
      if (action === "find_in_page") {
        return { icon: Search, runningLabel: t("runnerProviderActivityUi.researchFindRunning"), completedLabel: t("runnerProviderActivityUi.researchFindCompleted"), failedLabel: t("runnerProviderActivityUi.researchFindFailed"), interruptedLabel: t("runnerProviderActivityUi.researchFindInterrupted"), detail };
      }
      return { icon: Search, runningLabel: t("runnerProviderActivityUi.researchWebRunning"), completedLabel: t("runnerProviderActivityUi.researchWebCompleted"), failedLabel: t("runnerProviderActivityUi.researchWebFailed"), interruptedLabel: t("runnerProviderActivityUi.researchWebInterrupted"), detail };
    }
    case "tool_execution": {
      const name = providerDetail(item, "Name");
      const target = providerDetail(item, "Target");
      const progress = providerDetail(item, "Progress");
      const input = {
        name,
        transport: providerDetail(item, "Transport"),
        namespace: providerDetail(item, "Namespace"),
        operation: providerDetail(item, "Operation"),
        target,
        progress,
      };
      const tool = toolActivityPresentation(input);
      const boundedActivity = meaningfulToolDetail(item.summary)
        ?? meaningfulToolDetail(progress)
        ?? meaningfulToolDetail(target);
      const activityIsIdentity = Boolean(
        boundedActivity && name && humanizeToolName(boundedActivity) === humanizeToolName(name),
      );
      const technicalName = name ? mcpToolIdentity(name)?.name ?? name : t("toolActivityUi.unnamedName");
      const source = tool.sourceLabel
        ? `${tool.sourceLabel} · ${technicalName}`
        : name && !isGenericToolName(name) && humanizeToolName(name) !== tool.runningLabel.replace(/^Running /, "")
          ? name
          : undefined;
      return {
        icon: tool.icon,
        ...toolActivityDisplayLabels(input),
        detail: [activityIsIdentity ? undefined : boundedActivity, source].filter(Boolean).join(" · ") || undefined,
      };
    }
    case "plan":
      return { icon: ListChecks, runningLabel: t("runnerProviderActivityUi.planRunning"), completedLabel: t("runnerProviderActivityUi.planCompleted"), failedLabel: t("runnerProviderActivityUi.planFailed"), interruptedLabel: t("runnerProviderActivityUi.planInterrupted"), detail };
    case "delegation": {
      const action = providerDetail(item, "Action")?.toLowerCase();
      if (action === "message") return { icon: Users, runningLabel: t("runnerProviderActivityUi.delegationMessageRunning"), completedLabel: t("runnerProviderActivityUi.delegationMessageCompleted"), failedLabel: t("runnerProviderActivityUi.delegationMessageFailed"), interruptedLabel: t("runnerProviderActivityUi.delegationMessageInterrupted"), detail };
      if (action === "resume") return { icon: Users, runningLabel: t("runnerProviderActivityUi.delegationResumeRunning"), completedLabel: t("runnerProviderActivityUi.delegationResumeCompleted"), failedLabel: t("runnerProviderActivityUi.delegationResumeFailed"), interruptedLabel: t("runnerProviderActivityUi.delegationResumeInterrupted"), detail };
      if (action === "close") return { icon: Users, runningLabel: t("runnerProviderActivityUi.delegationCloseRunning"), completedLabel: t("runnerProviderActivityUi.delegationCloseCompleted"), failedLabel: t("runnerProviderActivityUi.delegationCloseFailed"), interruptedLabel: t("runnerProviderActivityUi.delegationCloseInterrupted"), detail };
      if (action === "wait") return { icon: Users, runningLabel: t("runnerProviderActivityUi.delegationWaitRunning"), completedLabel: t("runnerProviderActivityUi.delegationWaitCompleted"), failedLabel: t("runnerProviderActivityUi.delegationWaitFailed"), interruptedLabel: t("runnerProviderActivityUi.delegationWaitInterrupted"), detail };
      return { icon: Users, runningLabel: t("runnerProviderActivityUi.delegationStartRunning"), completedLabel: t("runnerProviderActivityUi.delegationStartCompleted"), failedLabel: t("runnerProviderActivityUi.delegationStartFailed"), interruptedLabel: t("runnerProviderActivityUi.delegationStartInterrupted"), detail };
    }
    case "model_identity":
      return item.eventType === "model.route.changed"
        ? { icon: Bot, runningLabel: t("runnerProviderActivityUi.modelSwitchRunning"), completedLabel: t("runnerProviderActivityUi.modelSwitchCompleted"), failedLabel: t("runnerProviderActivityUi.modelSwitchFailed"), interruptedLabel: t("runnerProviderActivityUi.modelSwitchInterrupted"), detail }
        : { icon: Bot, runningLabel: t("runnerProviderActivityUi.modelVerifyRunning"), completedLabel: t("runnerProviderActivityUi.modelVerifyCompleted"), failedLabel: t("runnerProviderActivityUi.modelVerifyFailed"), interruptedLabel: t("runnerProviderActivityUi.modelVerifyInterrupted"), detail };
    case "context":
      return { icon: Database, runningLabel: t("runnerProviderActivityUi.contextRunning"), completedLabel: t("runnerProviderActivityUi.contextCompleted"), failedLabel: t("runnerProviderActivityUi.contextFailed"), interruptedLabel: t("runnerProviderActivityUi.contextInterrupted"), detail };
    case "artifact": {
      const viewed = item.eventType === "artifact.viewed";
      return viewed
        ? { icon: Box, runningLabel: t("runnerProviderActivityUi.artifactViewRunning"), completedLabel: t("runnerProviderActivityUi.artifactViewCompleted"), failedLabel: t("runnerProviderActivityUi.artifactViewFailed"), interruptedLabel: t("runnerProviderActivityUi.artifactViewInterrupted"), detail }
        : { icon: Box, runningLabel: t("runnerProviderActivityUi.artifactGenerateRunning"), completedLabel: t("runnerProviderActivityUi.artifactGenerateCompleted"), failedLabel: t("runnerProviderActivityUi.artifactGenerateFailed"), interruptedLabel: t("runnerProviderActivityUi.artifactGenerateInterrupted"), detail };
    }
    case "review": {
      const state = providerDetail(item, "State")?.toLowerCase();
      return state === "exited"
        ? { icon: FileCheck2, runningLabel: t("runnerProviderActivityUi.reviewExitRunning"), completedLabel: t("runnerProviderActivityUi.reviewExitCompleted"), failedLabel: t("runnerProviderActivityUi.reviewExitFailed"), interruptedLabel: t("runnerProviderActivityUi.reviewExitInterrupted"), detail }
        : { icon: FileCheck2, runningLabel: t("runnerProviderActivityUi.reviewEnterRunning"), completedLabel: t("runnerProviderActivityUi.reviewEnterCompleted"), failedLabel: t("runnerProviderActivityUi.reviewEnterFailed"), interruptedLabel: t("runnerProviderActivityUi.reviewEnterInterrupted"), detail };
    }
    case "hook":
      return { icon: GitBranch, runningLabel: t("runnerProviderActivityUi.hookRunning"), completedLabel: t("runnerProviderActivityUi.hookCompleted"), failedLabel: t("runnerProviderActivityUi.hookFailed"), interruptedLabel: t("runnerProviderActivityUi.hookInterrupted"), detail };
    case "memory":
      return { icon: BookOpen, runningLabel: t("runnerProviderActivityUi.memoryRunning"), completedLabel: t("runnerProviderActivityUi.memoryCompleted"), failedLabel: t("runnerProviderActivityUi.memoryFailed"), interruptedLabel: t("runnerProviderActivityUi.memoryInterrupted"), detail };
    case "safety":
      return { icon: ShieldCheck, runningLabel: t("runnerProviderActivityUi.safetyRunning"), completedLabel: t("runnerProviderActivityUi.safetyCompleted"), failedLabel: t("runnerProviderActivityUi.safetyFailed"), interruptedLabel: t("runnerProviderActivityUi.safetyInterrupted"), detail };
    case "terminal":
      return { icon: TerminalSquare, runningLabel: t("runnerProviderActivityUi.terminalRunning"), completedLabel: t("runnerProviderActivityUi.terminalCompleted"), failedLabel: t("runnerProviderActivityUi.terminalFailed"), interruptedLabel: t("runnerProviderActivityUi.terminalInterrupted"), detail };
    case "wait":
      return { icon: Clock3, runningLabel: t("runnerProviderActivityUi.waitRunning"), completedLabel: t("runnerProviderActivityUi.waitCompleted"), failedLabel: t("runnerProviderActivityUi.waitFailed"), interruptedLabel: t("runnerProviderActivityUi.waitInterrupted"), detail };
    case "provider_notice":
      return { icon: providerNoticeSeverity(item) === "info" ? Info : AlertTriangle, runningLabel: t("runnerProviderActivityUi.notice"), completedLabel: t("runnerProviderActivityUi.notice"), failedLabel: t("runnerProviderActivityUi.noticeError"), interruptedLabel: t("runnerProviderActivityUi.notice"), detail };
  }
}

function workspaceChangePresentation(item: TaskChatWorkspaceChangeItem): TaskChatActivityPresentation {
  const count = item.totals.files || item.files.length;
  const detail = count > 0 ? `${count} ${count === 1 ? "file" : "files"}` : undefined;
  return { icon: FilePenLine, runningLabel: "Editing files", completedLabel: "Edited files", detail };
}

function workspaceFilePresentation(item: TaskChatWorkspaceFileItem): TaskChatActivityPresentation {
  return {
    icon: FileText,
    runningLabel: "Referencing a file",
    completedLabel: "Referenced a file",
    detail: item.line == null ? item.path : `${item.path}:${item.line}`,
  };
}

function resourcePresentation(item: TaskChatMaterializedResourceItem): TaskChatActivityPresentation {
  return {
    icon: item.resourceKind === "document" ? FileText : PackageCheck,
    runningLabel: "Saving a resource",
    completedLabel: item.resourceKind === "document" ? "Added a document" : "Added a deliverable",
    detail: item.title,
  };
}

export function protocolActivityPresentation(item: TaskChatProtocolItem): TaskChatActivityPresentation | null {
  switch (item.surface) {
    case "provider_activity": return providerActivityPresentation(item);
    case "workspace_change": return workspaceChangePresentation(item);
    case "workspace_file": return workspaceFilePresentation(item);
    case "resource": return resourcePresentation(item);
    case "runtime_request":
    case "run_result":
    case "run_terminal":
      return null;
  }
}

export function protocolActivityIsRunning(item: TaskChatProtocolItem): boolean {
  if (item.surface === "provider_activity") return item.status === "running";
  if (item.surface === "workspace_change") return !item.complete;
  return false;
}

export function protocolActivityLabel(item: TaskChatProtocolItem, presentation: TaskChatActivityPresentation): string {
  if (item.surface !== "provider_activity") {
    return protocolActivityIsRunning(item) ? presentation.runningLabel : presentation.completedLabel;
  }
  if (item.status === "failed") return presentation.failedLabel ?? `${presentation.completedLabel} · failed`;
  if (item.status === "interrupted") return presentation.interruptedLabel ?? `${presentation.completedLabel} · interrupted`;
  return item.status === "running" ? presentation.runningLabel : presentation.completedLabel;
}
