// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n, managementMessages } from "../../i18n/management-test-resources";
import * as current from "./editable-sections";
import * as production from "./editable-sections.production";
const fixture = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("./context", () => ({ useRoutineDetail: () => fixture.value, createDefaultNewTrigger: () => ({ kind: "schedule" }) }));
vi.mock("../MarkdownEditor", () => ({ MarkdownEditor: ({ placeholder, value }: { placeholder: string; value: string }) => <textarea placeholder={placeholder} value={value} readOnly /> }));
vi.mock("../InlineEntitySelector", () => ({ InlineEntitySelector: ({ placeholder, noneLabel, searchPlaceholder }: { placeholder: string; noneLabel: string; searchPlaceholder: string }) => <div>{placeholder}{noneLabel}<input placeholder={searchPlaceholder} /></div> }));
vi.mock("../RoutineVariablesEditor", () => ({ RoutineVariablesEditor: () => null, RoutineVariablesHint: () => null }));
vi.mock("../IssueDocumentAnnotations", () => ({ IssueDocumentAnnotations: () => null, DocumentAnnotationsCountChip: () => null }));
vi.mock("../environment-variables-editor", () => ({ EnvironmentVariablesEditor: () => null }));
vi.mock("../routine-triggers/RoutineTriggers", () => ({ RoutineTriggers: () => null }));
vi.mock("../RoutineTriggerCard", () => ({ RoutineTriggerCard: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  fixture.value = {
    routine: { id: "routine-a", assigneeAgentId: null, triggers: [{ id: "trigger-a", kind: "webhook" }], descriptionDocument: null },
    editDraft: { title: "Original title", description: "Original instructions <code>", variables: [], env: { ORIGINAL_ENV: { type: "plain", value: "unchanged" } } },
    setEditDraft: vi.fn(), assigneeOptions: [], projectOptions: [], recentAssigneeIds: [], recentProjectIds: [],
    agentById: new Map(), projectById: new Map(), currentAssignee: null, currentProject: null,
    mentionOptions: [], assigneeSelectorRef: { current: null }, projectSelectorRef: { current: null }, descriptionEditorRef: { current: null },
    routineRuns: [{ status: "failed", triggeredAt: new Date() }], activity: [], saveRoutine: { isPending: false, mutate: vi.fn() },
    saveConflict: false, isSectionDirty: () => false, navigateToSection: vi.fn(), availableSecrets: [], createSecret: { mutateAsync: vi.fn() },
  };
});
afterEach(async () => { await i18n.changeLanguage("en"); });
const statusKeys = { received: "managementUi.routineStatusReceived", coalesced: "managementUi.routineStatusCoalesced", skipped: "managementUi.routineStatusSkipped", issue_created: "managementUi.routineStatusIssueCreated", completed: "managementUi.routineStatusCompleted", failed: "statuses.failed" };
it.each(Object.entries(managementMessages).flatMap(([locale, messages]) => [false, true].flatMap(legacy => Object.entries(statusKeys).map(([status, statusKey]) => ({ locale, messages, legacy, status, statusKey })))))(
  "localizes routine overview/variables/secrets in $locale (production: $legacy, status: $status)", async ({ locale, messages, legacy, status, statusKey }) => {
    await i18n.changeLanguage(locale);
    fixture.value.routineRuns = [{ status, triggeredAt: new Date() }];
    const modules = legacy ? production : current;
    const host = document.createElement("div"), root = createRoot(host);
    try {
      await act(async () => { root.render(<><modules.OverviewSection /><modules.VariablesSection /><modules.SecretsSection /></>); });
      expect(host.textContent).toContain(messages.routineDefaultRequired);
      expect(host.querySelector("textarea")?.value).toBe("Original instructions <code>");
      expect(host.textContent).toContain("{{placeholders}}");
      expect(host.textContent).toContain("{{placeholder}}");
      expect(host.textContent).toContain("PAPERCLIP_*");
      expect(host.querySelector(`button[aria-label="${i18n.t("managementUi.routineTriggers", { count: 1 })}"]`)).not.toBeNull();
      expect(host.textContent).toContain(i18n.t(statusKey));
      expect(host.querySelector(`button[aria-label="${i18n.t("managementUi.routineLastRun", { status: i18n.t(statusKey) })}"]`)).not.toBeNull();
      await act(async () => { await i18n.changeLanguage(locale === "ja" ? "es" : "ja"); });
      expect(host.textContent).toContain(i18n.t("managementUi.routineDefaultRequired"));
      expect(fixture.value.setEditDraft).not.toHaveBeenCalled();
    } finally { await act(async () => { root.unmount(); }); }
  },
);
