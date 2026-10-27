// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { ApiError } from "@/api/client";
import { RoutineDetail } from "./RoutineDetail";
import { RoutineDetail as ProductionRoutineDetail } from "./RoutineDetail.production";
import type { RoutineDetailContextValue } from "@/components/routine-sections/context";
import type { RoutineDetail as Routine } from "@paperclipai/shared";

const fixture = vi.hoisted(() => ({
  companyId: "company-1" as string | null,
  context: null as RoutineDetailContextValue | null,
  toast: vi.fn(), breadcrumbs: vi.fn(), copy: vi.fn(), submit: null as ((data: object) => void) | null,
  api: { get: vi.fn(), listRuns: vi.fn(), activity: vi.fn(), update: vi.fn(), run: vi.fn(), createTrigger: vi.fn(), updateTrigger: vi.fn(), deleteTrigger: vi.fn(), rotateTriggerSecret: vi.fn() },
}));
vi.mock("@/api/routines", () => ({ routinesApi: fixture.api }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: async () => [] } }));
vi.mock("@/api/projects", () => ({ projectsApi: { list: async () => [] } }));
vi.mock("@/api/secrets", () => ({ secretsApi: { list: async () => [], create: vi.fn() } }));
vi.mock("@/api/access", () => ({ accessApi: { listUserDirectory: async () => [] } }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: fixture.companyId }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: fixture.breadcrumbs }) }));
vi.mock("@/context/ToastContext", () => ({ useToastActions: () => ({ pushToast: fixture.toast }) }));
vi.mock("@/context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: false, setSidebarOpen: vi.fn() }) }));
vi.mock("@/hooks/useStreamlinedUiEnabled", () => ({ useStreamlinedUiEnabled: () => ({ enabled: false }) }));
vi.mock("@/lib/clipboard", () => ({ copyTextToClipboard: fixture.copy }));
vi.mock("@/components/MarkdownEditor", () => ({ MarkdownEditor: () => null }));
vi.mock("@/components/IssuesList", () => ({ IssuesList: () => null }));
vi.mock("@/api/issues", () => ({ issuesApi: { list: async () => [] } }));
vi.mock("@/components/RoutineOverview", () => ({ RoutineOverview: () => null }));
vi.mock("@/components/RoutineSubSidebar", () => ({ RoutineSubSidebar: () => null, RoutineSectionPicker: () => null }));
vi.mock("@/components/RoutineHistoryTab", () => ({ RoutineHistoryTab: () => null }));
vi.mock("@/components/RoutineRunVariablesDialog", () => ({ RoutineRunVariablesDialog: ({ onSubmit }: { onSubmit: (data: object) => void }) => { fixture.submit = onSubmit; return null; } }));
vi.mock("@/components/RoutineSectionHeading", async () => {
  const { useRoutineDetail } = await import("@/components/routine-sections/context");
  return { RoutineSectionHeading: ({ title }: { title: string }) => { fixture.context = useRoutineDetail(); return <h2>{title}</h2>; } };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root, client: QueryClient, routine: Routine;
const locales = ["en", "zh-CN", "es", "ja"];
const variants = locales.flatMap(locale => [false, true].map(production => ({ locale, production })));
const secret = { webhookUrl: "https://example.invalid/webhook/raw?x=A_B", webhookSecret: "Raw_Test-Secret<value>" };
function ctx() { return fixture.context!; }
async function mount(production: boolean, section = "triggers") {
  const Component = production ? ProductionRoutineDetail : RoutineDetail;
  await act(async () => { root.render(<MemoryRouter initialEntries={[`/routines/routine-1/${section}`]}>
    <QueryClientProvider client={client}><Routes><Route path="/routines/:routineId/:section" element={<Component />} /></Routes></QueryClientProvider>
  </MemoryRouter>); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
}
async function settle(action: () => void) {
  await act(async () => { action(); await new Promise(resolve => setTimeout(resolve, 10)); });
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.companyId = "company-1"; fixture.context = null; fixture.submit = null;
  window.history.replaceState({}, "", "/"); localStorage.clear(); sessionStorage.clear();
  routine = { id: "routine-1", companyId: "company-1", title: "User title 英語", description: "Original instructions", status: "paused", assigneeAgentId: "agent-1", projectId: null, triggers: [], variables: [], env: null, priority: "medium", concurrencyPolicy: "coalesce_if_active", catchUpPolicy: "skip_missed", activityGatePolicy: "always", activityGateScope: "company", latestRevisionId: "revision-1" } as unknown as Routine;
  fixture.api.get.mockImplementation(async () => routine);
  fixture.api.listRuns.mockResolvedValue([]); fixture.api.activity.mockResolvedValue([]);
  fixture.api.update.mockResolvedValue(routine); fixture.api.run.mockResolvedValue({});
  fixture.api.createTrigger.mockResolvedValue({ trigger: {}, secretMaterial: secret });
  fixture.api.updateTrigger.mockResolvedValue({}); fixture.api.deleteTrigger.mockResolvedValue({});
  fixture.api.rotateTriggerSecret.mockResolvedValue({ secretMaterial: secret }); fixture.copy.mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });

it.each(variants)("localizes real detail-host conflict, mutations and unknown errors in $locale (production: $production)", async ({ locale, production }) => {
  await i18n.changeLanguage(locale); await mount(production);
  expect(ctx()).toBeTruthy();
  fixture.api.update.mockRejectedValueOnce(new ApiError("RAW_CONFLICT", 409, {}));
  await settle(() => ctx().saveRoutine.mutate());
  expect(fixture.toast).toHaveBeenLastCalledWith({ title: i18n.t("routineDetailUi.changed"), body: i18n.t("routineDetailUi.conflictHelp"), tone: "warn" });
  expect(ctx().saveConflict).toBe(true);
  expect(fixture.api.update).toHaveBeenLastCalledWith("routine-1", expect.objectContaining({ title: routine.title, description: routine.description, baseRevisionId: "revision-1", concurrencyPolicy: "coalesce_if_active" }));
  const errors = [
    [() => ctx().saveRoutine.mutate(), fixture.api.update, "routineDetailUi.saveFailed", "routineDetailUi.cannotSave"],
    [() => fixture.submit!({}), fixture.api.run, "routineOps.runFailed", "routineOps.cannotRun"],
    [() => ctx().onToggleAutomation(), fixture.api.update, "routineOps.updateFailed", "routineOps.cannotUpdate"],
    [() => ctx().createTrigger.mutate(), fixture.api.createTrigger, "routineDetailUi.addTriggerFailed", "routineDetailUi.cannotCreateTrigger"],
    [() => ctx().updateTrigger.mutate({ id: "trigger-1", patch: { enabled: false } }), fixture.api.updateTrigger, "routineDetailUi.updateTriggerFailed", "routineDetailUi.cannotUpdateTrigger"],
    [() => ctx().deleteTrigger.mutate("trigger-1"), fixture.api.deleteTrigger, "routineDetailUi.deleteTriggerFailed", "routineDetailUi.cannotDeleteTrigger"],
    [() => ctx().rotateTrigger.mutate("trigger-1"), fixture.api.rotateTriggerSecret, "routineDetailUi.rotateFailed", "routineDetailUi.cannotRotate"],
  ] as const;
  for (const [action, api, title, fallback] of errors) {
    api.mockRejectedValueOnce(null); await settle(action);
    expect(fixture.toast).toHaveBeenLastCalledWith({ title: i18n.t(title), body: i18n.t(fallback), tone: "error" });
    api.mockRejectedValueOnce(new Error("UNKNOWN_PROVIDER detail_401 <raw>")); await settle(action);
    expect(fixture.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: i18n.t(title), body: "UNKNOWN_PROVIDER detail_401 <raw>" }));
  }
  await settle(() => ctx().onToggleAutomation());
  expect(fixture.api.update).toHaveBeenLastCalledWith("routine-1", { status: "active" });
  expect(fixture.toast).toHaveBeenLastCalledWith({ title: i18n.t("routineDetailUi.saved"), body: i18n.t("routineDetailUi.enabled"), tone: "success" });
  await settle(() => ctx().copySecretValue("Webhook URL", secret.webhookUrl));
  expect(fixture.copy).toHaveBeenCalledWith(secret.webhookUrl);
  expect(fixture.toast).toHaveBeenLastCalledWith({ title: i18n.t("routineDetailUi.copied", { label: "Webhook URL" }), tone: "success" });
});

it.each(variants)("keeps one-time credentials and semantic counts while switching locale in real host $locale (production: $production)", async ({ locale, production }) => {
  await i18n.changeLanguage(locale); await mount(production);
  await settle(() => ctx().rotateTrigger.mutate("trigger-1"));
  expect(host.textContent).toContain(i18n.t("routineDetailUi.webhookRotated"));
  expect(ctx().secretMessage).toEqual({ titleKey: "routineDetailUi.webhookRotated", entries: [secret] });
  for (const count of [1, 2]) {
    const entries = Array.from({ length: count }, (_, index) => ({ ...secret, webhookUrl: `${secret.webhookUrl}&index=${index}` }));
    await settle(() => ctx().onHistoryRestoreSecretMaterials({ secretMaterials: entries } as never));
    expect(host.textContent).toContain(i18n.t("routineDetailUi.webhookRestored", { count }));
    const calls = Object.fromEntries(Object.entries(fixture.api).map(([key, fn]) => [key, fn.mock.calls.length]));
    await act(async () => { await i18n.changeLanguage(i18n.language === "ja" ? "es" : "ja"); });
    expect(host.textContent).toContain(i18n.t("routineDetailUi.webhookRestored", { count }));
    expect(ctx().secretMessage).toEqual({ titleKey: "routineDetailUi.webhookRestored", count, entries });
    const visibleValues = [...host.querySelectorAll("input")].map(input => input.value).join(" ") + host.textContent;
    for (const entry of entries) { expect(visibleValues).toContain(entry.webhookUrl); expect(visibleValues).toContain(entry.webhookSecret); }
    for (const [key, fn] of Object.entries(fixture.api)) expect(fn).toHaveBeenCalledTimes(calls[key]);
  }
  expect(fixture.api.rotateTriggerSecret).toHaveBeenCalledTimes(1);
});

it.each(variants)("localizes no-agent guard without mutation in $locale (production: $production)", async ({ locale, production }) => {
  routine.assigneeAgentId = null; await i18n.changeLanguage(locale); await mount(production);
  await settle(() => ctx().onToggleAutomation());
  expect(fixture.toast).toHaveBeenLastCalledWith({ title: i18n.t("routineOps.agentRequired"), body: i18n.t("routineOps.setAgent"), tone: "warn" });
  expect(fixture.api.update).not.toHaveBeenCalled();
});
it.each(variants)("localizes no-company and load fallback in $locale (production: $production)", async ({ locale, production }) => {
  fixture.companyId = null; await i18n.changeLanguage(locale); await mount(production);
  expect(host.textContent).toContain(i18n.t(production ? "routineDetailUi.selectCompany" : "routineOps.selectOrg"));
  fixture.companyId = "company-1"; fixture.api.get.mockResolvedValue(null);
  await act(async () => { await client.invalidateQueries(); });
  await mount(production);
  expect(host.textContent).toContain(i18n.t("routineDetailUi.loadFailed"));
  fixture.api.get.mockRejectedValue(new Error("Unknown backend diagnostic"));
  await act(async () => { await client.invalidateQueries(); await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(host.textContent).toContain("Unknown backend diagnostic");
});
it.each(variants)("renders activity empty state and history heading in $locale (production: $production)", async ({ locale, production }) => {
  await i18n.changeLanguage(locale); await mount(production, "activity");
  expect(host.textContent).toContain(i18n.t("routineDetailUi.noActivity"));
  await settle(() => ctx().navigateToSection("history"));
  expect(host.querySelector("h2")?.textContent).toBe(i18n.t("workflow.history"));
});

it.each(variants)("localizes successful run/pause/trigger feedback in $locale (production: $production)", async ({ locale, production }) => {
  routine.status = "active"; await i18n.changeLanguage(locale); await mount(production);
  await settle(() => ctx().onToggleAutomation());
  expect(fixture.api.update).toHaveBeenLastCalledWith("routine-1", { status: "paused" });
  expect(fixture.toast).toHaveBeenLastCalledWith({ title: i18n.t("routineDetailUi.saved"), body: i18n.t("routineDetailUi.paused"), tone: "success" });
  fixture.api.createTrigger.mockResolvedValueOnce({ trigger: {} });
  await settle(() => ctx().createTrigger.mutate());
  expect(fixture.toast).toHaveBeenLastCalledWith({ title: i18n.t("routineDetailUi.triggerAdded"), body: i18n.t("routineDetailUi.scheduleSaved"), tone: "success" });
  await settle(() => ctx().createTrigger.mutate());
  expect(ctx().secretMessage).toEqual({ titleKey: "routineDetailUi.webhookCreated", entries: [secret] });
  await settle(() => ctx().updateTrigger.mutate({ id: "trigger-1", patch: { enabled: false } }));
  expect(fixture.api.updateTrigger).toHaveBeenCalledWith("trigger-1", { enabled: false });
  expect(fixture.toast).toHaveBeenLastCalledWith({ title: i18n.t("routineDetailUi.triggerSaved"), body: i18n.t("routineDetailUi.cadenceSaved"), tone: "success" });
  await settle(() => ctx().deleteTrigger.mutate("trigger-1"));
  expect(fixture.toast).toHaveBeenLastCalledWith({ title: i18n.t("routineDetailUi.triggerDeleted"), tone: "success" });
  await settle(() => fixture.submit!({ variables: { ORIGINAL: "raw_value" }, assigneeAgentId: "agent-raw" }));
  expect(fixture.api.run).toHaveBeenCalledWith("routine-1", { variables: { ORIGINAL: "raw_value" }, assigneeAgentId: "agent-raw" });
  expect(fixture.toast).toHaveBeenLastCalledWith({ title: i18n.t("routineDetailUi.runStarted"), tone: "success" });
  const mutationCounts = [fixture.api.update, fixture.api.createTrigger, fixture.api.updateTrigger, fixture.api.deleteTrigger, fixture.api.run].map(fn => fn.mock.calls.length);
  await act(async () => { await i18n.changeLanguage(locale === "ja" ? "es" : "ja"); });
  expect([fixture.api.update, fixture.api.createTrigger, fixture.api.updateTrigger, fixture.api.deleteTrigger, fixture.api.run].map(fn => fn.mock.calls.length)).toEqual(mutationCounts);
});

it.each(variants)("localizes dirty-field labels without resetting drafts in $locale (production: $production)", async ({ locale, production }) => {
  await i18n.changeLanguage(locale); await mount(production);
  const draft = { ...ctx().editDraft, title: "Draft title 原文", description: "Raw draft", projectId: "raw-project", assigneeAgentId: "raw-agent", priority: "high", concurrencyPolicy: "skip_if_active", catchUpPolicy: "enqueue_missed_with_cap", activityGatePolicy: "require_external_activity", activityGateScope: "project", variables: [{ name: "RAW_VAR" }], env: { RAW_ENV: { type: "plain", value: "raw-secret" } } } as unknown as RoutineDetailContextValue["editDraft"];
  await settle(() => ctx().setEditDraft(draft));
  const keys = ["title", "description", "projectId", "assigneeAgentId", "priority", "concurrencyPolicy", "catchUpPolicy", "activityGatePolicy", "activityGateScope", "variables", "env"];
  expect(ctx().dirtyFields).toEqual(keys.map(key => ({ key, label: i18n.t(`routineDetailUi.field_${key}`) })));
  await act(async () => { await i18n.changeLanguage(locale === "ja" ? "es" : "ja"); });
  expect(ctx().dirtyFields).toEqual(keys.map(key => ({ key, label: i18n.t(`routineDetailUi.field_${key}`) })));
  expect(ctx().editDraft).toEqual(draft);
  expect(fixture.api.update).not.toHaveBeenCalled();
});
