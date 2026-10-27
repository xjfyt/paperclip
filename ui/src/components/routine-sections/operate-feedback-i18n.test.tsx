// @vitest-environment jsdom
import { act } from "react";
import type { ActivityEvent } from "@paperclipai/shared";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { ActivitySection, RunsSection } from "./operate-sections";
import { RoutineDetailContext, type RoutineDetailContextValue } from "./context";
const fixture = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), toast: vi.fn(), props: null as Record<string, any> | null }));
vi.mock("@/api/issues", () => ({ issuesApi: { list: fixture.list, update: fixture.update } }));
vi.mock("@/context/ToastContext", () => ({ useToastActions: () => ({ pushToast: fixture.toast }) }));
vi.mock("../IssuesList", () => ({ IssuesList: (props: Record<string, unknown>) => { fixture.props = props; return null; } }));
vi.mock("../RoutineHistoryTab", () => ({ RoutineHistoryTab: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient, context: RoutineDetailContextValue;
const date = new Date("2026-10-25T14:05:00Z");
function activityEvent(id: string, action: string, details: Record<string, unknown>): ActivityEvent {
  return { id, action, details, createdAt: date, companyId: "company-1", actorType: "system", actorId: "fixture",
    entityType: "routine", entityId: "routine-1", agentId: null, runId: null };
}
async function render(children = <ActivitySection />) {
  await act(async () => { root.render(<QueryClientProvider client={client}><RoutineDetailContext.Provider value={context}>{children}</RoutineDetailContext.Provider></QueryClientProvider>); });
}
beforeEach(() => {
  vi.clearAllMocks(); fixture.list.mockResolvedValue([]);
  host = document.createElement("div"); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  context = { companyId: "company-1", routine: { id: "routine-1" }, agents: [], projects: [], activity: [] } as unknown as RoutineDetailContextValue;
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); await i18n.changeLanguage("en"); });
it.each(["en", "zh-CN", "es", "ja"])("localizes activity and keeps expanded diagnostic data on language change in %s", async locale => {
  await i18n.changeLanguage(locale);
  const actionKeys = {
    "routine.webhook_test_received": "testPassed", "routine.webhook_test_rejected": "testRejected", "routine.webhook_received": "webhookReceived", "routine.webhook_rejected": "webhookRejected",
    "routine.updated": "routineUpdated", "routine.trigger_created": "triggerAdded", "routine.trigger_updated": "triggerUpdated", "routine.trigger_deleted": "triggerRemoved", "routine.trigger_removed": "triggerRemoved", "routine.trigger_restored": "triggerRestored", "routine.trigger_setup_finished": "setupFinished", "routine.trigger_secret_rotated": "keyReplaced", "routine.run_created": "runCreated",
  };
  context.activity = Object.keys(actionKeys).map((action, index) => activityEvent(`event-${index}`, action,
    { rawKey: "RAW_abc<value>", webhookUrl: "https://example.invalid/raw?A_B" }));
  context.activity.push(
    activityEvent("run", "routine.run_triggered", { source: "schedule", status: "issue_created" }),
    activityEvent("changed", "routine.updated", { changeSummary: "Customer-authored changeSummary" }),
    activityEvent("unknown", "routine.unknown_diagnostic", { diagnosticCode: "UNKNOWN_401", count: 2 }),
  );
  await render();
  for (const [action, key] of Object.entries(actionKeys)) expect(host.querySelector(`[title="${action}"]`)?.textContent).toBe(i18n.t(`routineDetailUi.${key}`));
  for (const key of ["testPassedHelp", "testRejectedHelp", "authenticated", "rejectedHelp", "sourceSchedule", "taskCreated"]) expect(host.textContent).toContain(i18n.t(`routineDetailUi.${key}`));
  expect(host.textContent).toContain(date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }));
  expect(host.textContent).toContain(date.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" }));
  const firstButton = host.querySelector<HTMLButtonElement>("button")!;
  await act(async () => firstButton.click());
  const raw = JSON.stringify(context.activity![0].details, null, 2);
  expect(host.querySelector("pre")?.textContent).toBe(raw);
  await act(async () => { await i18n.changeLanguage(locale === "ja" ? "es" : "ja"); });
  expect(host.querySelector("button")).toBe(firstButton);
  expect(firstButton.getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelector("pre")?.textContent).toBe(raw);
  expect(host.textContent).toContain(i18n.t("routineDetailUi.testPassedHelp"));
  expect(host.textContent).toContain("Customer-authored changeSummary");
  expect(host.querySelector('[title="routine.unknown_diagnostic"]')?.textContent).toBe("Unknown diagnostic");
  expect(host.textContent).toContain("diagnostic code: UNKNOWN_401 · count: 2");
  expect(host.textContent).not.toContain("routineDetailUi.");
});
it.each(["en", "zh-CN", "es", "ja"])("localizes activity empty/loading and run update feedback in %s without changing payloads", async locale => {
  await i18n.changeLanguage(locale); await render();
  expect(host.textContent).toContain(i18n.t("routineDetailUi.noActivity"));
  await render(<ActivitySection isLoading />);
  expect(host.textContent).toContain(i18n.t("routineDetailUi.loadingActivity"));
  await render(<ActivitySection error={new Error("RAW_ACTIVITY_ERROR")} />);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("RAW_ACTIVITY_ERROR");
  await render(<RunsSection />);
  expect(fixture.props!.issueLinkState.issueDetailBreadcrumb).toEqual({ label: i18n.t("browserQa.runs"), href: "/routines/routine-1/runs" });
  fixture.update.mockRejectedValue(new Error("RAW_UPDATE_ERROR"));
  await act(async () => { fixture.props!.onUpdateIssue("issue-raw", { status: "done" }); await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(fixture.update).toHaveBeenCalledWith("issue-raw", { status: "done" });
  expect(fixture.toast).toHaveBeenCalledWith({ title: i18n.t("routineDetailUi.taskUpdateFailed"), body: "RAW_UPDATE_ERROR", tone: "error" });
  await act(async () => { await i18n.changeLanguage(locale === "ja" ? "es" : "ja"); });
  expect(fixture.props!.issueLinkState.issueDetailBreadcrumb.label).toBe(i18n.t("browserQa.runs"));
  expect(fixture.update).toHaveBeenCalledTimes(1);
});
