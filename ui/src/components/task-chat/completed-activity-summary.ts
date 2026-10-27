import { t } from "@/i18n";
import { Brain, CirclePause, Gauge, Layers3 } from "lucide-react";
import type { TaskChatActivityPhaseItem } from "./task-chat-model";
import {
  toolActivityPresentation,
  type ToolFamily,
  type ToolIcon,
} from "./tool-taxonomy";
import { protocolActivityPresentation, providerNoticeSeverity } from "./task-chat-activity-presentation";

type Activity = TaskChatActivityPhaseItem["items"][number];
type OwnedLabel = readonly [canonical: string, key: string];
const labels: Record<ToolFamily, OwnedLabel> = {
  terminal: ["Ran commands", "ranCommands"],
  grep: ["Searched files", "searchedFiles"],
  search: ["Searched files", "searchedFiles"],
  read: ["Read files", "readFiles"],
  edit: ["Edited files", "editedFiles"],
  web: ["Searched the web", "searchedWeb"],
  plan: ["Worked on a plan", "workedPlan"],
  question: ["Requested input", "requestedInput"],
  agent: ["Worked with agents", "workedAgents"],
  safety: ["Reviewed safety", "reviewedSafety"],
  image: ["Worked with images", "workedImages"],
  wait: ["Waited", "waited"],
  mcp: ["Used connected tools", "usedConnectedTools"],
  other: ["Used tools", "usedTools"],
};

/** Describe observed activities, never infer success from a finished group. */
export function completedActivitySummary(items: Activity[]) {
  const categories = new Map<
    string,
    { label: string; icon: ToolIcon; order: number; key?: string }
  >();
  // Canonical English identities keep deduplication independent of locale.
  // A missing key means provider-authored text, even if it matches owned English.
  const add = (label: string, icon: ToolIcon, order = 0, key?: string) => {
    const existing = categories.get(label);
    // Raw provenance survives a collision without changing the winning icon/order.
    const displayKey = existing && (existing.key === undefined || key === undefined) ? undefined : key;
    if (!existing || order < existing.order)
      categories.set(label, { label, icon, order, key: displayKey });
    else existing.key = displayKey;
  };
  const addOwned = ([label, key]: OwnedLabel, icon: ToolIcon, order = 0) =>
    add(label, icon, order, key);
  const tools: Array<{
    family: ToolFamily;
    icon: ToolIcon;
    completed: boolean;
    order: number;
  }> = [];
  const notices: Array<{
    summary: string | undefined;
    severity: "info" | "warning" | "error";
    icon: ToolIcon;
    order: number;
  }> = [];
  for (const [order, item] of items.entries()) {
    if (item.kind === "tool") {
      const p = toolActivityPresentation({
        name: item.rawName ?? item.name,
        target: item.target,
      });
      tools.push({ ...p, order, completed: item.status === "completed" });
    } else if (item.kind === "protocol") {
      if (
        item.surface === "provider_activity" &&
        item.family === "tool_execution"
      ) {
        const value = (label: string) =>
          item.details.find((d) => d.label === label)?.value;
        const p = toolActivityPresentation({
          name: value("Name"),
          operation: value("Operation"),
          transport: value("Transport"),
          namespace: value("Namespace"),
          target: value("Target"),
        });
        tools.push({ ...p, order, completed: item.status === "completed" });
      } else {
        const p = protocolActivityPresentation(item);
        if (!p) continue;
        if (item.surface === "provider_activity" && item.family === "provider_notice") {
          // Reuse only the normalized notice text already available in the row.
          const summary = item.summary?.trim()
            || item.details.find((entry) => entry.label === "Summary")?.value.trim();
          notices.push({ summary, severity: providerNoticeSeverity(item), icon: p.icon, order });
          continue;
        }
        const family =
          item.surface === "provider_activity" ? item.family : item.surface;
        const label: OwnedLabel =
          (
            {
              research: ["Searched the web", "searchedWeb"],
              plan: ["Worked on a plan", "workedPlan"],
              delegation: ["Worked with agents", "workedAgents"],
              artifact: ["Worked with artifacts", "workedArtifacts"],
              context: ["Managed context", "managedContext"],
              memory: ["Checked memory", "checkedMemory"],
              model_identity: ["Checked model settings", "checkedModelSettings"],
              review: ["Worked in review mode", "workedReview"],
              hook: ["Ran hooks", "ranHooks"],
              safety: ["Reviewed safety", "reviewedSafety"],
              terminal: ["Ran commands", "ranCommands"],
              wait: ["Waited", "waited"],
              workspace_change: ["Worked on files", "workedFiles"],
              workspace_file: ["Referenced files", "referencedFiles"],
              resource: ["Added resources", "addedResources"],
            } as Record<string, OwnedLabel>
          )[family] ?? ["Used tools", "usedTools"];
        addOwned(label, p.icon, order);
      }
    }
  }
  if (notices.length) {
    const strongest = notices.find((notice) => notice.severity === "error")
      ?? notices.find((notice) => notice.severity === "warning")
      ?? notices[0]!;
    const fallback: OwnedLabel = notices.length === 1
      ? ["Received a provider update", "providerUpdate"]
      : strongest.severity === "error"
        ? ["Provider error reported", "providerError"]
        : strongest.severity === "warning"
          ? ["Provider warning reported", "providerWarning"]
          : ["Received provider updates", "providerUpdates"];
    // One notice category leaves room for actual work. Keep warnings and errors
    // visible when the compact label truncates other activity categories.
    const order = strongest.severity === "info" ? notices[0]!.order : -1;
    if (notices.length === 1 && strongest.summary) add(strongest.summary, strongest.icon, order);
    else addOwned(fallback, strongest.icon, order);
  }
  const completedFamilies = new Set(
    tools.filter((tool) => tool.completed).map((tool) => tool.family),
  );
  // Merge repeated families and retries. Terminal is an action, not an exit-status claim.
  for (const tool of tools) {
    const succeeded = completedFamilies.has(tool.family);
    const label: OwnedLabel =
      tool.family === "read" && !succeeded
        ? ["Checked files", "checkedFiles"]
        : tool.family === "edit" && !succeeded
          ? ["Worked on files", "workedFiles"]
          : labels[tool.family];
    addOwned(label, tool.icon, tool.order);
  }
  if (!categories.size) {
    if (items.some((item) => item.kind === "thinking"))
      addOwned(["Thought through the task", "thought"], Brain);
    else if (items.some((item) => item.kind === "marker"))
      addOwned(["Activity stopped", "stopped"], CirclePause);
    else addOwned(["Recorded usage", "usage"], Gauge);
  }
  const values = [...categories.values()].sort((a, b) => a.order - b.order);
  const join = (parts: typeof values, continuation = false) =>
    parts.map((part, index) => {
      if (!part.key) return part.label;
      const continued = continuation || index > 0;
      return t(`completedActivityUi.${part.key}`, {
        context: continued ? "continuation" : undefined,
        defaultValue: continued ? part.label.charAt(0).toLowerCase() + part.label.slice(1) : part.label,
      });
    }).join(t("completedActivityUi.separator", { defaultValue: ", " }));
  const fullLabel = join(values);
  return {
    label:
      values.length > 3
        ? t("completedActivityUi.andMore", { activities: join(values.slice(0, 2)), defaultValue: "{{activities}}, and more" })
        : fullLabel,
    fullLabel,
    // Only owned phrases use sentence-case variants; never lowercase raw notices.
    accessibleLabel: join(values, true),
    icon: values.length === 1 ? values[0].icon : Layers3,
  };
}
