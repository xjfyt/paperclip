// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { ManagementUiError } from "@/i18n/management-errors";
import { queryKeys } from "@/lib/queryKeys";
import { RoutineDetailContext, type RoutineDetailContextValue } from "../routine-sections/context";
import { RoutineTriggers } from "./RoutineTriggers";
import type { RoutineDetail, RoutineTrigger } from "@paperclipai/shared";
import type { TriggerDraft } from "./TriggerWizard";
const fixture = vi.hoisted(() => ({ api: { get: vi.fn(), createTrigger: vi.fn(), updateTrigger: vi.fn(), rotateTriggerSecret: vi.fn() }, wizard: null as Record<string, any> | null }));
vi.mock("@/api/routines", () => ({ routinesApi: fixture.api }));
vi.mock("./TriggerCard", () => ({ RoutineTriggerCard: ({ title, summary, expanded, editLabel, onEdit, onRemove, children }: { title: string; summary: string; expanded: boolean; editLabel?: string; onEdit: () => void; onRemove: () => void; children: ReactNode }) => <article><h3>{title}</h3><p>{summary}</p><button onClick={onEdit}>{editLabel ?? "test-edit"}</button><button onClick={onRemove}>test-remove</button>{expanded && children}</article> }));
vi.mock("./TriggerWizard", async importOriginal => ({ ...await importOriginal<typeof import("./TriggerWizard")>(), RoutineTriggerWizard: (props: Record<string, unknown>) => { fixture.wizard = props; return <div data-testid="wizard" />; } }));
vi.mock("./WebhookFields", () => ({ CopyField: ({ label, value }: { label: string; value: string }) => <label>{label}<input readOnly value={value} /></label>, AgentInstructions: ({ value }: { value: string }) => <pre>{value}</pre> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient, routine: RoutineDetail;
const url = "https://example.invalid/raw?Value=A_B", secret = "RAW-secret<value>";
const locales = ["en", "zh-CN", "es", "ja"];
function trigger(patch: Record<string, unknown> = {}): RoutineTrigger { return { id: "trigger-1", kind: "webhook", enabled: true, setupPending: false, signingMode: "bearer", webhookUrl: url, ...patch } as RoutineTrigger; }
async function render(query = "") {
  const value = { routine, routineId: routine.id, companyId: routine.companyId, secretMessage: null, setSecretMessage: vi.fn() } as unknown as RoutineDetailContextValue;
  await act(async () => { root.render(<MemoryRouter initialEntries={[`/routines/routine-1/triggers${query}`]}><QueryClientProvider client={client}><RoutineDetailContext.Provider value={value}><RoutineTriggers /></RoutineDetailContext.Provider></QueryClientProvider></MemoryRouter>); await new Promise(resolve => setTimeout(resolve, 10)); });
}
async function click(label: string, scope: ParentNode = host) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === label);
  expect(button, label).toBeTruthy();
  await act(async () => { button!.click(); await new Promise(resolve => setTimeout(resolve, 10)); });
}
async function switchLanguage() { await act(async () => { await i18n.changeLanguage(i18n.language === "ja" ? "es" : "ja"); }); }
beforeEach(() => {
  vi.clearAllMocks(); fixture.wizard = null; sessionStorage.clear();
  routine = { id: "routine-1", companyId: "company-1", title: "Customer title 英文", status: "active", triggers: [] } as unknown as RoutineDetail;
  fixture.api.get.mockImplementation(async () => routine);
  fixture.api.updateTrigger.mockImplementation(async (id, patch) => {
    routine = { ...routine, triggers: patch.archived ? routine.triggers.filter(item => item.id !== id) : routine.triggers.map(item => item.id === id ? { ...item, ...patch } : item) };
    return { id, ...patch };
  });
  fixture.api.rotateTriggerSecret.mockResolvedValue({ secretMaterial: { webhookUrl: url, webhookSecret: secret } });
  fixture.api.createTrigger.mockResolvedValue({ trigger: trigger({ setupPending: true }), secretMaterial: { webhookUrl: url, webhookSecret: secret } });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); await i18n.changeLanguage("en"); });

it.each(locales)("localizes actual trigger parent empty/count/status/removal and preserves IDs in %s", async locale => {
  await i18n.changeLanguage(locale); await render();
  expect(host.textContent).toContain(i18n.t("routineTriggerHostUi.empty"));
  expect(host.textContent).toContain(i18n.t("managementUi.routineTriggerCount", { count: 0 }));
  const cases = [
    [trigger({ setupPending: true }), "routineTriggerHostUi.unfinished"],
    [trigger({ enabled: false }), "statuses.paused"],
    [trigger({ kind: "api" }), "routineTriggerHostUi.apiSummary"],
    [trigger({ lastWebhookDelivery: { status: "rejected" } }), "routineTriggerHostUi.authFailed"],
    [trigger({ lastWebhookDelivery: { status: "received", test: false } }), "routineTriggerHostUi.receiving"],
    [trigger(), "routineTriggerHostUi.waiting"],
  ] as const;
  for (const [value, key] of cases) {
    routine = { ...routine, triggers: [value] };
    await act(async () => { client.setQueryData(queryKeys.routines.detail(routine.id), routine); await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(host.textContent).toContain(i18n.t(key));
  }
  await click("test-remove");
  expect(fixture.api.updateTrigger).toHaveBeenLastCalledWith("trigger-1", { archived: true });
  expect(host.querySelector('[role="status"]')?.textContent).toContain(i18n.t("routineTriggerHostUi.webhookRemoved"));
  await switchLanguage();
  expect(host.querySelector('[role="status"]')?.textContent).toContain(i18n.t("routineTriggerHostUi.webhookRemoved"));
  expect(fixture.api.updateTrigger).toHaveBeenCalledTimes(1);
  await click(i18n.t("routineOps.undo"));
  expect(fixture.api.updateTrigger).toHaveBeenLastCalledWith("trigger-1", { archived: false });
});

it.each(locales)("keeps expanded settings, raw values and deferred errors on language switch in %s", async locale => {
  await i18n.changeLanguage(locale); routine.triggers = [trigger({ kind: "schedule", cronExpression: "0 8 * * *", timezone: "Asia/Tokyo" })]; await render();
  await click("test-edit");
  expect(host.textContent).toContain(i18n.t("routineTriggerHostUi.timezone"));
  fixture.api.updateTrigger.mockRejectedValueOnce(null);
  await click(i18n.t("routineTriggerHostUi.saveSchedule"));
  expect(fixture.api.updateTrigger).toHaveBeenCalledWith("trigger-1", { cronExpression: "0 8 * * *", timezone: "Asia/Tokyo" });
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("routineTriggerHostUi.saveScheduleFailed"));
  await switchLanguage();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("routineTriggerHostUi.saveScheduleFailed"));
  expect([...host.querySelectorAll("input")].map(input => input.value)).toContain("Asia/Tokyo");
  expect(fixture.api.updateTrigger).toHaveBeenCalledTimes(1);
  fixture.api.updateTrigger.mockRejectedValueOnce(new Error("RAW_SCHEDULE_DIAGNOSTIC"));
  await click(i18n.t("routineTriggerHostUi.saveSchedule")); await switchLanguage();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("RAW_SCHEDULE_DIAGNOSTIC");
  fixture.api.updateTrigger.mockRejectedValueOnce(null);
  await click(i18n.t("routineTriggerHostUi.pause"));
  expect(host.textContent).toContain(i18n.t("routineTriggerHostUi.saveFailed"));
  await switchLanguage(); expect(host.textContent).toContain(i18n.t("routineTriggerHostUi.saveFailed"));
});

it.each(locales)("localizes key replacement and connection results without mutating on language change in %s", async locale => {
  await i18n.changeLanguage(locale); routine.triggers = [trigger()]; await render(); await click("test-edit");
  await click(i18n.t("routineTriggerHostUi.replace"));
  let dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain(i18n.t("routineTriggerHostUi.replaceHelp"));
  fixture.api.rotateTriggerSecret.mockRejectedValueOnce(null);
  await click(i18n.t("routineTriggerHostUi.replace"), dialog);
  expect(dialog.textContent).toContain(i18n.t("routineTriggerHostUi.replaceFailed"));
  await switchLanguage();
  expect(dialog.textContent).toContain(i18n.t("routineTriggerHostUi.replaceFailed"));
  expect(fixture.api.rotateTriggerSecret).toHaveBeenCalledTimes(1);
  await click(i18n.t("routineTriggerHostUi.replace"), dialog);
  expect(fixture.api.rotateTriggerSecret).toHaveBeenLastCalledWith("trigger-1");
  expect([...host.querySelectorAll("input")].map(input => input.value)).toEqual([url, `Bearer ${secret}`]);
  const prompt = host.querySelector("pre")?.textContent;
  await switchLanguage();
  expect(host.querySelector("pre")?.textContent).toBe(prompt);
  expect([...host.querySelectorAll("input")].map(input => input.value)).toEqual([url, `Bearer ${secret}`]);
  expect(fixture.api.rotateTriggerSecret).toHaveBeenCalledTimes(2);
  await click(i18n.t("routineTriggerHostUi.check")); dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain(i18n.t("routineTriggerHostUi.checkHelp"));
  expect(dialog.textContent).toContain(i18n.t("routineTriggerHostUi.waitingEvent"));
  for (const status of ["received", "rejected"] as const) {
    routine = { ...routine, triggers: [trigger({ lastWebhookDelivery: { status, receivedAt: `RAW-${status}`, test: false } })] };
    await act(async () => { client.setQueryData(queryKeys.routines.detail(routine.id), routine); await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(dialog.textContent).toContain(i18n.t(`routineTriggerHostUi.${status}`));
    await switchLanguage(); expect(dialog.textContent).toContain(i18n.t(`routineTriggerHostUi.${status}`));
  }
  expect(fixture.api.updateTrigger).not.toHaveBeenCalled();
});

it.each(locales)("localizes route fallbacks and typed local errors without changing persisted drafts in %s", async locale => {
  await i18n.changeLanguage(locale); await render("?triggerSetup=missing");
  expect(host.textContent).toContain(i18n.t("routineTriggerHostUi.unavailable"));
  await click(i18n.t("routineTriggerHostUi.back")); await click(i18n.t("managementUi.routineAddTrigger"));
  expect(fixture.wizard).toBeTruthy();
  const draft = { ...fixture.wizard!.initialDraft, kind: "webhook", sender: "github", time: "09:15", weekday: "Monday", timezone: "Europe/Madrid" } as TriggerDraft;
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota"); });
  expect(() => fixture.wizard!.onSaveExit(draft)).toThrow(ManagementUiError);
  try { fixture.wizard!.onSaveExit(draft); } catch (error) { expect((error as ManagementUiError).translationKey).toBe("routineTriggerHostUi.draftSaveFailed"); }
  setItem.mockRestore();
  await expect(fixture.wizard!.onFinish(draft)).rejects.toMatchObject({ translationKey: "routineTriggerHostUi.createBeforeFinish" });
  await act(async () => fixture.wizard!.onSaveExit(draft));
  expect(JSON.parse(sessionStorage.getItem("routine-trigger-draft:company-1:routine-1:new")!)).toEqual(draft);
  expect(fixture.api.createTrigger).not.toHaveBeenCalled(); expect(fixture.api.updateTrigger).not.toHaveBeenCalled();
  await switchLanguage();
  expect(JSON.parse(sessionStorage.getItem("routine-trigger-draft:company-1:routine-1:new")!)).toEqual(draft);
});
