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

const localeVariants = Object.entries(managementMessages).flatMap(([locale, messages]) =>
  [false, true].map(legacy => ({ locale, messages, legacy })),
);
const policyCases = localeVariants.flatMap(variant =>
  ["coalesce_if_active", "always_enqueue", "skip_if_active"].map(policy => ({ ...variant, policy })),
);
it.each(policyCases)("localizes policy preview in $locale (production: $legacy, policy: $policy)", async ({ locale, messages, legacy, policy }) => {
  await i18n.changeLanguage(locale);
  const draft = { concurrencyPolicy: policy, catchUpPolicy: "skip_missed", activityGatePolicy: "require_external_activity", activityGateScope: "project" };
  const setDraft = vi.fn();
  fixture.value = { ...fixture.value, editDraft: draft, setEditDraft: setDraft,
    routine: { triggers: [{ id: "schedule-a", kind: "schedule", enabled: true, cronExpression: "0 * * * *", timezone: "UTC" }] } };
  const Section = legacy ? production.DeliverySection : current.DeliverySection;
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => { root.render(<Section />); });
    expect(host.querySelector(`[role="radiogroup"][aria-label="${messages.routineConcurrencyPolicy}"]`)).not.toBeNull();
    expect(host.querySelector(`[role="radiogroup"][aria-label="${messages.routineGateScope}"]`)).not.toBeNull();
    expect(host.textContent).toContain(messages.routineActivityHelp);
    expect(host.textContent).toContain(legacy ? messages.routineLegacyCompanyScopeHelp : messages.routineCompanyScopeHelp);
    expect(host.textContent).toContain(i18n.t("managementUi.routinePreviewHelp", { zone: "UTC" }));
    expect(host.textContent).toContain(messages.routineImmediately);
    expect(host.textContent).toContain(policy === "coalesce_if_active" ? messages.routineCoalesced : policy === "skip_if_active" ? messages.routineSkipped : messages.routineQueued);
    expect(host.querySelectorAll("span.tabular-nums")).toHaveLength(5);
    const enqueue = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(button => button.textContent?.includes(messages.routineEnqueueTitle));
    await act(async () => { enqueue!.click(); });
    expect(setDraft).toHaveBeenCalledTimes(1);
    expect(setDraft.mock.calls[0][0](draft)).toEqual({ ...draft, concurrencyPolicy: "always_enqueue" });
    await act(async () => { await i18n.changeLanguage(locale === "ja" ? "es" : "ja"); });
    expect(host.textContent).toContain(i18n.t("managementUi.routineNextFive"));
    expect(setDraft).toHaveBeenCalledTimes(1);
  } finally { await act(async () => { root.unmount(); }); }
});
it.each(localeVariants)("localizes unavailable scheduling in $locale (production: $legacy)", async ({ locale, messages, legacy }) => {
  await i18n.changeLanguage(locale);
  const Section = legacy ? production.DeliverySection : current.DeliverySection;
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => { root.render(<Section />); });
    expect(host.textContent).toContain(messages.routineGateHelp);
    expect(host.textContent).toContain(messages.routineNoPreview);
    const gate = host.querySelector(`[aria-label="${messages.routineAdvancedPolicy}"]`)!;
    expect([...gate.querySelectorAll<HTMLButtonElement>("button")].every(button => button.disabled)).toBe(true);
    expect(fixture.value.setEditDraft).not.toHaveBeenCalled();
  } finally { await act(async () => { root.unmount(); }); }
});
const signingCases = Object.entries(managementMessages).flatMap(([locale, messages]) =>
  ["bearer", "hmac_sha256", "github_hmac", "app_webhook", "fireflies_hmac", "none"].map(signingMode => ({ locale, messages, signingMode })),
);
it.each(signingCases)("localizes legacy trigger controls in $locale ($signingMode)", async ({ locale, messages, signingMode }) => {
  await i18n.changeLanguage(locale);
  const create = vi.fn(), setTrigger = vi.fn(), copy = vi.fn();
  const url = "https://example.invalid/webhook/test-only", secret = "test-only-secret";
  fixture.value = { ...fixture.value, routine: { triggers: [] },
    newTrigger: { kind: "webhook", signingMode, replayWindowSec: "300" }, setNewTrigger: setTrigger,
    createTrigger: { isPending: false, mutate: create }, updateTrigger: { mutate: vi.fn() }, deleteTrigger: { mutate: vi.fn() }, rotateTrigger: { mutate: vi.fn() },
    secretMessage: { titleKey: "routineDetailUi.webhookRestored", count: 1, entries: [{ webhookUrl: url, webhookSecret: secret }] }, copySecretValue: copy, setSecretMessage: vi.fn() };
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => { root.render(<production.TriggersSection />); });
    expect(host.textContent).toContain(messages.routineNoTriggers);
    expect(host.textContent).toContain(messages.routineSecretOnce);
    expect(host.querySelector<HTMLInputElement>(`[aria-label="${messages.routineNewWebhookUrl}"]`)?.value).toBe(url);
    expect(host.querySelector<HTMLInputElement>(`[aria-label="${messages.routineNewWebhookSecret}"]`)?.value).toBe(secret);
    await act(async () => { host.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click(); });
    const descriptionKeys: Record<string, string> = { bearer: "routineSigningBearer", hmac_sha256: "routineSigningHmac", github_hmac: "routineSigningGithub", app_webhook: "routineSigningApp", fireflies_hmac: "routineSigningLegacy", none: "routineSigningNone" };
    const values = signingMode === "bearer" ? { header: "Authorization: Bearer <secret>" }
      : signingMode === "hmac_sha256" ? { timestamp: "X-Paperclip-Timestamp", signature: "X-Paperclip-Signature: sha256=<hex>" }
      : signingMode === "github_hmac" ? { header: "X-Hub-Signature-256" }
      : { header: "X-Hub-Signature", header256: "X-Hub-Signature-256" };
    expect(host.textContent).toContain(i18n.t(`managementUi.${descriptionKeys[signingMode]}`, values));
    const secretCopy = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === messages.routineSecret)!;
    await act(async () => { secretCopy.click(); });
    expect(copy).toHaveBeenCalledWith(messages.routineWebhookSecret, secret);
    await act(async () => { await i18n.changeLanguage(locale === "ja" ? "es" : "ja"); });
    expect(host.textContent).toContain(i18n.t(`managementUi.${descriptionKeys[signingMode]}`, values));
    expect(host.textContent).toContain(i18n.t("routineDetailUi.webhookRestored", { count: 1 }));
    expect(setTrigger).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  } finally { await act(async () => { root.unmount(); }); }
});
it.each(Object.entries(managementMessages).flatMap(([locale]) => [1, 2].map(count => ({ locale, count }))))(
  "localizes legacy trigger counts in $locale ($count)", async ({ locale, count }) => {
    await i18n.changeLanguage(locale);
    fixture.value = { ...fixture.value, routine: { triggers: Array.from({ length: count }, (_, index) => ({ id: `trigger-${index}`, kind: "webhook" })) },
      newTrigger: { kind: "webhook", signingMode: "none" }, createTrigger: { isPending: false } };
    const host = document.createElement("div"), root = createRoot(host);
    try {
      await act(async () => { root.render(<production.TriggersSection />); });
      expect(host.textContent).toContain(i18n.t("managementUi.routineTriggerCount", { count }));
      expect(host.textContent).not.toContain("managementUi.");
    } finally { await act(async () => { root.unmount(); }); }
  },
);
