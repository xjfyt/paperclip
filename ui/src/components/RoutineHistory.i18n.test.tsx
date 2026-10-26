// @vitest-environment jsdom

import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  Routine,
  RoutineRevision,
  RoutineRevisionSnapshotV1,
} from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoutineHistoryTab } from "./RoutineHistoryTab";

const mockRoutinesApi = vi.hoisted(() => ({
  listRevisions: vi.fn(),
  restoreRevision: vi.fn(),
}));

vi.mock("../api/routines", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../api/routines");
  return {
    ...actual,
    routinesApi: {
      ...((actual as { routinesApi?: Record<string, unknown> }).routinesApi ?? {}),
      ...mockRoutinesApi,
    },
  };
});

vi.mock("./MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: string }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, type = "button", disabled, ...props }: ComponentProps<"button">) => (
    <button type={type} onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: (props: ComponentProps<"div">) => <div data-testid="skeleton" {...props} />,
}));

const toastSpy = vi.fn();
vi.mock("../context/ToastContext", () => ({
  useToastActions: () => ({ pushToast: toastSpy }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function snapshotV1(overrides?: Partial<RoutineRevisionSnapshotV1["routine"]>): RoutineRevisionSnapshotV1 {
  return {
    version: 1,
    routine: {
      id: "routine-1",
      companyId: "company-1",
      projectId: null,
      goalId: null,
      parentIssueId: null,
      responsibleUserId: null,
      title: "Daily standup digest",
      description: "Summarize standup notes",
      assigneeAgentId: null,
      priority: "medium",
      status: "active",
      concurrencyPolicy: "coalesce_if_active",
      catchUpPolicy: "skip_missed",
      activityGatePolicy: "always",
      activityGateScope: "company",
      variables: [],
      env: null,
      ...overrides,
    },
    triggers: [],
  };
}

function createRevision(overrides: Partial<RoutineRevision> = {}): RoutineRevision {
  return {
    id: overrides.id ?? "revision-1",
    companyId: "company-1",
    routineId: "routine-1",
    revisionNumber: overrides.revisionNumber ?? 1,
    title: "Daily standup digest",
    description: "Summarize standup notes",
    snapshot: overrides.snapshot ?? snapshotV1(),
    changeSummary: null,
    restoredFromRevisionId: null,
    createdByAgentId: null,
    createdByUserId: "user-1",
    createdByRunId: null,
    createdAt: new Date("2026-05-01T12:00:00.000Z"),
    ...overrides,
  };
}

function createRoutine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: "routine-1",
    companyId: "company-1",
    projectId: null,
    goalId: null,
    parentIssueId: null,
    responsibleUserId: null,
    title: "Daily standup digest",
    description: "Summarize standup notes",
    assigneeAgentId: null,
    priority: "medium",
    status: "active",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
    activityGatePolicy: "always",
    activityGateScope: "company",
    variables: [],
    latestRevisionId: "revision-2",
    latestRevisionNumber: 2,
    createdByAgentId: null,
    createdByUserId: "user-1",
    updatedByAgentId: null,
    updatedByUserId: "user-1",
    lastTriggeredAt: null,
    lastEnqueuedAt: null,
    createdAt: new Date("2026-05-01T11:00:00.000Z"),
    updatedAt: new Date("2026-05-04T12:00:00.000Z"),
    ...overrides,
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}


import { i18n } from "../i18n";
import en from "../i18n/contributions/routineHistoryUi/en.json";
import zh from "../i18n/contributions/routineHistoryUi/zh-CN.json";
import es from "../i18n/contributions/routineHistoryUi/es.json";
import ja from "../i18n/contributions/routineHistoryUi/ja.json";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
beforeEach(() => { mockRoutinesApi.listRevisions.mockReset(); mockRoutinesApi.restoreRevision.mockReset(); toastSpy.mockClear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = makeQueryClient(); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });
const locales = [["en", en], ["zh-CN", zh], ["es", es], ["ja", ja]] as const;
const old = createRevision({ id: "revision-original-old", revisionNumber: 1, changeSummary: "客户摘要 Ω", snapshot: snapshotV1({ title: "客户旧标题 Ω", status: "archived", description: "原始正文 Ω", env: { PRIVATE_KEY: "never-show-this-secret" } }) });
old.snapshot.triggers.push({ id: "webhook-original", kind: "webhook", label: "客户 Webhook Ω", enabled: true, cronExpression: null, timezone: null, publicId: "public-original", signingMode: "bearer", replayWindowSec: null });
const current = createRevision({ id: "revision-original-current", revisionNumber: 2, snapshot: snapshotV1({ title: "客户新标题 Ω", description: "新正文 Ω" }) });
const routine = createRoutine({ latestRevisionId: current.id });
async function language(locale: string) { await act(async () => { await i18n.changeLanguage(locale); }); }
async function render(props: Partial<ComponentProps<typeof RoutineHistoryTab>> = {}) {
  await act(async () => root.render(<QueryClientProvider client={client}><RoutineHistoryTab routine={routine} isEditDirty={false} dirtyFields={[]} onDiscardEdits={vi.fn()} onSaveEdits={vi.fn()} agents={new Map()} projects={new Map()} onRestoreSecretMaterials={vi.fn()} {...props} /></QueryClientProvider>));
  await flush();
}
const button = (label: string) => Array.from(document.querySelectorAll("button")).find(b => b.textContent === label)!;
async function history() { mockRoutinesApi.listRevisions.mockResolvedValue([current, old]); await render(); await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="revision-row-1"]')!.click()); }
function inputValue(value: string) { const input = document.querySelector<HTMLInputElement>("#restore-change-summary")!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }

describe.each(locales)("routine history in %s", (locale, strings) => {
  it("renders revision and diff copy with actual resources while keeping user content and secrets protected", async () => {
    await language(locale);
    for (const [key, value] of Object.entries(strings)) expect(i18n.getResource(locale, "translation", `routineHistoryUi.${key}`)).toBe(value);
    await history();
    expect(host.textContent).toContain(strings.viewing.replace("{{revision}}", "1"));
    expect(host.textContent).toContain("客户旧标题 Ω");
    expect(i18n.exists("propertyLabels.archived")).toBe(true);
    expect(host.textContent).toContain(locale === "en" ? "archived" : i18n.t("propertyLabels.archived"));
    expect(host.textContent).toContain("客户摘要 Ω");
    expect(host.textContent).not.toContain("never-show-this-secret");
    await act(async () => button(strings.compare).click());
    expect(document.body.textContent).toContain(strings.compareTitle);
    expect(document.body.textContent).toContain(strings.envRemoved.replace("{{key}}", "PRIVATE_KEY"));
    expect(document.body.textContent).toContain("原始正文 Ω");
    expect(document.body.textContent).not.toContain("never-show-this-secret");
    expect(document.querySelector<HTMLSelectElement>(`select[aria-label="${strings.old}"]`)?.value).toBe(old.id);
    expect(document.querySelector<HTMLSelectElement>(`select[aria-label="${strings.new}"]`)?.value).toBe(current.id);
    expect(document.body.textContent).not.toContain("routineHistoryUi.");
    expect(mockRoutinesApi.restoreRevision).not.toHaveBeenCalled();
  });
  it("preserves summary and revision IDs through language switch and pending restore, then shows success", async () => {
    await language(locale); await history();
    let resolve!: (value: unknown) => void;
    mockRoutinesApi.restoreRevision.mockImplementation(() => new Promise(r => { resolve = r; }));
    await act(async () => button(strings.restoreNew).click());
    expect(document.body.textContent).toContain(strings.restoreDescription.replaceAll("{{target}}", "1").replace("{{next}}", "3").replace("{{current}}", "2"));
    expect(document.body.textContent).toContain(strings.recreateWebhook.replace("{{label}}", "客户 Webhook Ω"));
    await act(async () => { inputValue("  客户恢复理由 Ω  "); document.querySelector("#restore-change-summary")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })); });
    expect(mockRoutinesApi.restoreRevision).not.toHaveBeenCalled();
    await language(locale === "en" ? "ja" : "en");
    expect(document.querySelector<HTMLInputElement>("#restore-change-summary")?.value).toBe("  客户恢复理由 Ω  ");
    const active = locale === "en" ? ja : en;
    await act(async () => button(active.restoreAs.replace("{{revision}}", "3")).click());
    await flush();
    expect(mockRoutinesApi.restoreRevision).toHaveBeenCalledExactlyOnceWith("routine-1", old.id, { changeSummary: "客户恢复理由 Ω" });
    expect(button(active.restoring).disabled).toBe(true);
    await act(async () => button(active.restoring).click());
    expect(mockRoutinesApi.restoreRevision).toHaveBeenCalledTimes(1);
    const response = { routine: createRoutine({ latestRevisionId: "revision-new" }), revision: createRevision({ id: "revision-new", revisionNumber: 3 }), restoredFromRevisionId: old.id, restoredFromRevisionNumber: 1, secretMaterials: [] };
    await act(async () => resolve(response)); await flush();
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: active.restored.replace("{{from}}", "1").replace("{{to}}", "3"), body: active.restoredTriggers, tone: "success" }));
  });
  it("keeps failed restore retryable with localized fallback and original payload", async () => {
    await language(locale); await history();
    mockRoutinesApi.restoreRevision.mockRejectedValue("opaque failure");
    await act(async () => button(strings.restoreNew).click());
    await act(async () => inputValue("恢复说明 Ω"));
    const label = strings.restoreAs.replace("{{revision}}", "3");
    await act(async () => button(label).click()); await flush();
    expect(toastSpy).toHaveBeenCalledWith({ title: strings.restoreFailed, body: strings.restoreFallback, tone: "error" });
    expect(document.querySelector<HTMLInputElement>("#restore-change-summary")?.value).toBe("恢复说明 Ω");
    expect(button(label).disabled).toBe(false);
    await act(async () => button(label).click()); await flush();
    expect(mockRoutinesApi.restoreRevision).toHaveBeenCalledTimes(2);
    expect(mockRoutinesApi.restoreRevision).toHaveBeenLastCalledWith("routine-1", old.id, { changeSummary: "恢复说明 Ω" });
  });
  it("blocks historical selection with unsaved edits and retains save/discard callbacks", async () => {
    await language(locale); mockRoutinesApi.listRevisions.mockResolvedValue([current, old]);
    const onSaveEdits = vi.fn(), onDiscardEdits = vi.fn();
    await render({ isEditDirty: true, dirtyFields: [{ key: "title", label: "客户字段 Ω" }], onSaveEdits, onDiscardEdits });
    expect(host.textContent).toContain(strings.unsaved);
    expect(host.textContent).toContain("客户字段 Ω");
    expect(host.querySelector<HTMLButtonElement>('[data-testid="revision-row-1"]')?.disabled).toBe(true);
    await act(async () => button(strings.saveContinue).click());
    expect(onSaveEdits).toHaveBeenCalledTimes(1);
    const discard = i18n.t("stabilizationUi.discardChanges");
    expect(discard).not.toBe("stabilizationUi.discardChanges");
    await act(async () => button(discard).click());
    expect(onDiscardEdits).toHaveBeenCalledTimes(1);
    expect(mockRoutinesApi.restoreRevision).not.toHaveBeenCalled();
  });
  it("shows localized load failure and retries without restoring", async () => {
    await language(locale); mockRoutinesApi.listRevisions.mockRejectedValue("opaque failure"); await render(); await flush();
    expect(host.textContent).toContain(strings.loadFailed);
    expect(host.textContent).toContain(strings.loadFallback);
    mockRoutinesApi.listRevisions.mockResolvedValue([current, old]);
    await act(async () => button(i18n.t("common.retry")).click()); await flush();
    expect(host.textContent).toContain("客户摘要 Ω");
    expect(mockRoutinesApi.listRevisions).toHaveBeenCalledTimes(2);
    expect(mockRoutinesApi.restoreRevision).not.toHaveBeenCalled();
  });
});
