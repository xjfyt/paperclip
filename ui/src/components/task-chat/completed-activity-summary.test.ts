import { AlertTriangle, Info, Layers3 } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { completedActivityMessages, i18n } from "@/i18n/completed-activity-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import { toolActivityPresentation } from "./tool-taxonomy";
import { completedActivitySummary } from "./completed-activity-summary";
import type {
  TaskChatActivityPhaseItem,
  TaskChatProviderActivityItem,
  TaskChatToolItem,
} from "./task-chat-model";

type Activity = TaskChatActivityPhaseItem["items"][number];
const tool = (
  name: string,
  status: TaskChatToolItem["status"] = "completed",
): TaskChatToolItem => ({
  id: name,
  kind: "tool",
  name,
  status,
  target: "private-command-or-path",
  detail: "private-output",
});
const provider = (
  family: TaskChatProviderActivityItem["family"],
  status: TaskChatProviderActivityItem["status"] = "completed",
): TaskChatProviderActivityItem => ({
  id: family,
  kind: "protocol",
  surface: "provider_activity",
  family,
  status,
  title: "provider internal title",
  eventType: "activity",
  details: [],
  steps: [],
  links: [],
  children: [],
});
const thought: Activity = {
  id: "thought",
  kind: "thinking",
  lines: ["Reasoning text"],
};

describe("completedActivitySummary", () => {
  it.each([
    "completed",
    "failed",
    "interrupted",
    "pending",
    "in_progress",
  ] as const)(
    "describes command attempts without claiming success (%s)",
    (status) => {
      expect(
        completedActivitySummary([
          tool("exec_command", status),
          tool("bash", status),
        ]).label,
      ).toBe("Ran commands");
    },
  );
  it("merges retries and hides reasoning, raw targets and output from the summary", () => {
    const summary = completedActivitySummary([
      thought,
      tool("read"),
      tool("exec_command", "failed"),
      tool("exec_command"),
    ]);
    expect(summary.label).toBe("Read files, ran commands");
    expect(summary.fullLabel).not.toMatch(/private|Reasoning|failed/);
  });
  it.each([
    ["read", "failed", "Checked files"],
    ["read", "interrupted", "Checked files"],
    ["apply_patch", "failed", "Worked on files"],
    ["apply_patch", "interrupted", "Worked on files"],
    ["read", "completed", "Read files"],
    ["apply_patch", "completed", "Edited files"],
  ] as const)(
    "does not claim an unsuccessful %s completed",
    (name, status, expected) => {
      expect(completedActivitySummary([tool(name, status)]).label).toBe(
        expected,
      );
    },
  );
  it("uses completed work once when a read or edit retry succeeds", () => {
    expect(
      completedActivitySummary([
        tool("read", "failed"),
        tool("apply_patch", "failed"),
        tool("read"),
        tool("apply_patch"),
      ]).label,
    ).toBe("Read files, edited files");
  });
  it("classifies native provider tools through the same taxonomy and keeps encounter order", () => {
    const native = {
      ...provider("tool_execution", "failed"),
      details: [{ label: "Name", value: "exec_command" }],
    };
    expect(
      completedActivitySummary([
        tool("read"),
        provider("research"),
        native,
        tool("bash"),
      ]).label,
    ).toBe("Read files, searched the web, ran commands");
  });
  it("supports canonical operation identity when a native tool has no useful name", () => {
    const native = {
      ...provider("tool_execution"),
      details: [
        { label: "Name", value: "tool" },
        { label: "Operation", value: "execute" },
      ],
    };
    expect(completedActivitySummary([native]).label).toBe("Ran commands");
  });
  it("bounds many categories while keeping the complete accessible description", () => {
    const summary = completedActivitySummary([
      tool("read"),
      tool("exec_command"),
      tool("grep"),
      tool("apply_patch"),
      provider("research"),
    ]);
    expect(summary.label).toBe("Read files, ran commands, and more");
    expect(summary.fullLabel).toBe(
      "Read files, ran commands, searched files, edited files, searched the web",
    );
  });
  it("does not invent tool activity for thoughts-only groups or expose unknown identifiers", () => {
    expect(completedActivitySummary([thought]).label).toBe(
      "Thought through the task",
    );
    expect(completedActivitySummary([tool("opaque_8792")]).label).toBe(
      "Used tools",
    );
    expect(
      completedActivitySummary([tool("mcp__github__get_pull_request")]).label,
    ).toBe("Used connected tools");
  });
  it("shows the preserved pricing estimate as informational, not a billing receipt", () => {
    const summary = "Pi estimates this turn at $0.000617 from its model prices. Billing cost is unverified.";
    expect(completedActivitySummary([{
      ...provider("provider_notice", "informational"), summary,
      details: [{ label: "Severity", value: "info" }],
    }])).toEqual({ label: summary, fullLabel: summary, accessibleLabel: summary, icon: Info });
  });
  it.each(["warning", "error", undefined])("retains warning/error icons and safe notice text (%s)", (severity) => {
    const summary = "Provider request needs attention.";
    const result = completedActivitySummary([{
      ...provider("provider_notice", severity === "error" ? "failed" : "informational"),
      details: [
        { label: "Summary", value: summary },
        ...(severity ? [{ label: "Severity", value: severity }] : []),
      ],
    }]);
    expect(result).toEqual({ label: summary, fullLabel: summary, accessibleLabel: summary, icon: AlertTriangle });
  });
  it("uses a generic fallback without promoting arbitrary detail fields", () => {
    expect(completedActivitySummary([{
      ...provider("provider_notice", "informational"), summary: "  ",
      details: [{ label: "Raw input", value: "private-command-or-path" }],
    }]).label).toBe("Received a provider update");
  });
  it("does not hide a failed notice behind informational metadata", () => {
    expect(completedActivitySummary([{
      ...provider("provider_notice", "failed"), summary: "Provider failed.",
      details: [{ label: "Severity", value: "info" }],
    }]).icon).toBe(AlertTriangle);
  });

  it("groups distinct notices and keeps a later error visible beside actual work", () => {
    const notices = ["info", "info", "warning", "error"].map((severity, index) => ({
      ...provider("provider_notice", "informational"),
      id: `notice-${index}`,
      summary: `Distinct provider message ${index}`,
      details: [{ label: "Severity", value: severity }],
    }));
    const result = completedActivitySummary([tool("bash"), ...notices]);
    expect(result.label).toBe("Provider error reported, ran commands");
    expect(result.fullLabel).toBe(result.label);
    expect(result.label).not.toContain("Distinct provider message");
  });

});


afterEach(async () => { await i18n.changeLanguage("en"); });
const notice = (summary?: string, severity = "info"): TaskChatProviderActivityItem => ({
  ...provider("provider_notice", "informational"), summary,
  details: [{ label: "Severity", value: severity }],
});
type MessageKey = keyof typeof completedActivityMessages.en;
const ownedCases: Array<[Activity, MessageKey]> = [
  [tool("exec_command"), "ranCommands"], [tool("grep"), "searchedFiles"],
  [tool("glob"), "searchedFiles"], [tool("read"), "readFiles"],
  [tool("apply_patch"), "editedFiles"], [tool("web_search"), "searchedWeb"],
  [tool("todo_write"), "workedPlan"], [tool("ask_user_question"), "requestedInput"],
  [tool("spawn_agent"), "workedAgents"], [tool("guardian_review"), "reviewedSafety"],
  [tool("image_generation"), "workedImages"], [tool("wait"), "waited"],
  [tool("mcp__example__opaque"), "usedConnectedTools"], [tool("opaque_8792"), "usedTools"],
  [provider("research"), "searchedWeb"], [provider("plan"), "workedPlan"],
  [provider("delegation"), "workedAgents"], [provider("artifact"), "workedArtifacts"],
  [provider("context"), "managedContext"], [provider("memory"), "checkedMemory"],
  [provider("model_identity"), "checkedModelSettings"], [provider("review"), "workedReview"],
  [provider("hook"), "ranHooks"], [provider("safety"), "reviewedSafety"],
  [provider("terminal"), "ranCommands"], [provider("wait"), "waited"],
  [{ id: "change", kind: "protocol", surface: "workspace_change", changeSetId: "raw-change",
    revision: 7, source: "runner_verified", complete: true, files: [],
    totals: { files: 0, additions: null, deletions: null }, patchArtifactRef: null }, "workedFiles"],
  [{ id: "file", kind: "protocol", surface: "workspace_file", referenceId: "raw-reference",
    source: "harness_reported", path: "/原文/File.ts", displayName: "原文 File", mediaType: null,
    presentation: "code", line: 7, preview: null, previewTruncated: false }, "referencedFiles"],
  [{ id: "resource", kind: "protocol", surface: "resource", resourceKind: "document",
    title: "Raw resource", subtitle: "Raw subtitle", href: null }, "addedResources"],
  [thought, "thought"],
  [{ id: "stop", kind: "marker", variant: "interrupted", label: "Raw reason" }, "stopped"],
  [{ id: "usage", kind: "usage", usage: { used: 17, size: 100 } }, "usage"],
  [notice(), "providerUpdate"],
];

for (const [locale, messages] of Object.entries(completedActivityMessages)) {
  describe(`completed summary display in ${locale}`, () => {
    it("validates complete phrases and translates every owned category without mutating inputs", async () => {
      await i18n.changeLanguage(locale);
      expect(validateLocaleMessages(messages, completedActivityMessages.en)).toEqual([]);
      expect(Object.keys(messages)).toHaveLength(69);
      for (const [item, key] of ownedCases) {
        const before = JSON.stringify(item);
        expect(completedActivitySummary([item]).label, key).toBe(messages[key]);
        expect(JSON.stringify(item)).toBe(before);
      }
      for (const count of [0, 1, 2]) {
        const expected = messages[count === 1 ? "count_one" : "count_other"].replace("{{count}}", String(count));
        expect(i18n.t("completedActivityUi.count", { count })).toBe(expected);
      }
    });

    it("keeps read/edit success factual across retries and native provider tools", async () => {
      await i18n.changeLanguage(locale);
      for (const status of ["pending", "in_progress", "failed", "interrupted"] as const) {
        expect(completedActivitySummary([tool("read", status)]).label).toBe(messages.checkedFiles);
        expect(completedActivitySummary([tool("edit", status)]).label).toBe(messages.workedFiles);
        expect(completedActivitySummary([tool("bash", status)]).label).toBe(messages.ranCommands);
      }
      const native: TaskChatProviderActivityItem = {
        ...provider("tool_execution", "failed"), details: [{ label: "Name", value: "read" }],
      };
      expect(completedActivitySummary([native]).label).toBe(messages.checkedFiles);
      expect(completedActivitySummary([native, tool("read")]).label).toBe(messages.readFiles);
      expect(completedActivitySummary([tool("edit", "failed"), tool("edit")]).label).toBe(messages.editedFiles);
    });

    it("deduplicates canonical categories, retains encounter order, and truncates only above three", async () => {
      await i18n.changeLanguage(locale);
      const items = [tool("read"), tool("bash"), provider("terminal"), tool("grep"), tool("glob")];
      const firstThree = [messages.readFiles, messages.ranCommands_continuation, messages.searchedFiles_continuation].join(messages.separator);
      expect(completedActivitySummary(items)).toMatchObject({ label: firstThree, fullLabel: firstThree, icon: Layers3 });
      const four = completedActivitySummary([...items, tool("edit")]);
      expect(four.label).toBe(messages.andMore.replace("{{activities}}", [messages.readFiles, messages.ranCommands_continuation].join(messages.separator)));
      expect(four.fullLabel).toBe(firstThree + messages.separator + messages.editedFiles_continuation);
    });

    it("never uses translated labels as deduplication identities", async () => {
      await i18n.changeLanguage(locale);
      i18n.addResourceBundle(locale, "translation", { completedActivityUi: {
        readFiles: "Same translated label", readFiles_continuation: "same translated label",
        editedFiles: "Same translated label", editedFiles_continuation: "same translated label",
      } }, true, true);
      try {
        const result = completedActivitySummary([tool("read"), tool("edit"), tool("grep"), tool("bash")]);
        expect(result.icon).toBe(Layers3);
        expect(result.label).toBe(messages.andMore.replace("{{activities}}", ["Same translated label", "same translated label"].join(messages.separator)));
        expect(result.fullLabel).toBe(["Same translated label", "same translated label", messages.searchedFiles_continuation, messages.ranCommands_continuation].join(messages.separator));
      } finally { i18n.addResourceBundle(locale, "translation", { completedActivityUi: messages }, true, true); }
    });

    it("keeps summary and Summary detail raw, including owned-English collisions in either order", async () => {
      await i18n.changeLanguage(locale);
      for (const detailFallback of [false, true]) {
        const raw: TaskChatProviderActivityItem = detailFallback
          ? { ...notice("  "), details: [{ label: "Severity", value: "info" }, { label: "Summary", value: "  Ran commands  " }] }
          : notice("  Ran commands  ");
        expect(completedActivitySummary([raw])).toEqual({ label: "Ran commands", fullLabel: "Ran commands", accessibleLabel: "Ran commands", icon: Info });
        for (const terminal of [tool("bash"), provider("terminal")]) {
          const terminalIcon = terminal.kind === "tool"
            ? toolActivityPresentation({ name: "bash" }).icon : completedActivitySummary([terminal]).icon;
          for (const rawFirst of [false, true]) {
            const items = rawFirst ? [raw, terminal] : [terminal, raw];
            const before = JSON.stringify(items);
            expect(completedActivitySummary(items)).toEqual({ label: "Ran commands", fullLabel: "Ran commands", accessibleLabel: "Ran commands",
              icon: rawFirst ? Info : terminalIcon });
            expect(JSON.stringify(items)).toBe(before);
          }
        }
        expect(completedActivitySummary([tool("read"), raw, tool("bash")]).fullLabel)
          .toBe(messages.readFiles + messages.separator + "Ran commands");
      }
      const raw = "Provider CASE, Ran commands, Ω 原文";
      const summary = completedActivitySummary([tool("read"), notice(raw)]);
      expect(summary.fullLabel).toBe(messages.readFiles + messages.separator + raw);
      expect(summary.accessibleLabel).toBe(messages.readFiles_continuation + messages.separator + raw);
    });

    it("keeps notice severity priority and first-two/full-summary order", async () => {
      await i18n.changeLanguage(locale);
      for (const severity of ["info", "warning", "error"]) {
        const key = severity === "error" ? "providerError" : severity === "warning" ? "providerWarning" : "providerUpdates";
        const result = completedActivitySummary([tool("read"), tool("bash"), tool("edit"), notice("First", "info"), notice("Last", severity)]);
        const labels = severity === "info"
          ? [messages.readFiles, messages.ranCommands_continuation, messages.editedFiles_continuation, messages.providerUpdates_continuation]
          : [messages[key], messages.readFiles_continuation, messages.ranCommands_continuation, messages.editedFiles_continuation];
        expect(result.fullLabel).toBe(labels.join(messages.separator));
        expect(result.label).toBe(messages.andMore.replace("{{activities}}", labels.slice(0, 2).join(messages.separator)));
      }
      const warning = notice("Raw WARNING", "warning");
      expect(completedActivitySummary([tool("read"), warning]).fullLabel).toBe("Raw WARNING" + messages.separator + messages.readFiles_continuation);
      expect(completedActivitySummary([notice("Warn", "warning"), notice("Error", "error")])).toMatchObject({ label: messages.providerError, icon: AlertTriangle });
    });
  });
}
