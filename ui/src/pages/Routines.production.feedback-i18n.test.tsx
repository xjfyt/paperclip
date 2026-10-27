// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FolderListItem, RoutineListItem } from "@paperclipai/shared";
import { i18n } from "@/i18n";
import { Routines as StreamlinedRoutines } from "./Routines";
import enRoutineOps from "@/i18n/contributions/routineOps/en.json";
import zhRoutineOps from "@/i18n/contributions/routineOps/zh-CN.json";
import esRoutineOps from "@/i18n/contributions/routineOps/es.json";
import jaRoutineOps from "@/i18n/contributions/routineOps/ja.json";
import { Routines, buildRoutineGroups, buildRoutineSections, sortRoutines } from "./Routines.production";

type RowProps = ComponentProps<typeof import("@/components/RoutineList").RoutineListRow>;
type FolderRailProps = ComponentProps<typeof import("@/components/folders/FolderControls").FolderRail>;
type FolderFormProps = ComponentProps<typeof import("@/components/folders/FolderControls").FolderFormDialog>;
type DeleteProps = ComponentProps<typeof import("@/components/folders/FolderControls").DeleteFolderDialog>;
type BulkProps = ComponentProps<typeof import("@/components/folders/FolderControls").BulkBar>;
type RunProps = ComponentProps<typeof import("@/components/RoutineRunVariablesDialog").RoutineRunVariablesDialog>;
const fixture = vi.hoisted(() => ({
  companyId: "company-1" as string | null,
  rows: new Map<string, RowProps>(), rail: null as FolderRailProps | null,
  form: null as FolderFormProps | null, deletion: null as DeleteProps | null, bulk: null as BulkProps | null, run: null as RunProps | null,
  toast: vi.fn(), breadcrumbs: vi.fn(), issues: vi.fn(),
  routines: { list: vi.fn(), create: vi.fn(), update: vi.fn(), run: vi.fn() },
  folders: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), moveItem: vi.fn() },
}));
vi.mock("@/lib/router", async () => import("react-router-dom"));
vi.mock("@/api/routines", () => ({ routinesApi: fixture.routines }));
vi.mock("@/api/folders", () => ({ foldersApi: fixture.folders }));
vi.mock("@/api/agents", () => ({ agentsApi: { list: async () => [] } }));
vi.mock("@/api/projects", () => ({ projectsApi: { list: async () => [] } }));
vi.mock("@/api/access", () => ({ accessApi: { listUserDirectory: async () => ({ users: [] }) } }));
vi.mock("@/api/issues", () => ({ issuesApi: { list: async () => [], update: vi.fn() } }));
vi.mock("@/api/heartbeats", () => ({ heartbeatsApi: { liveRunsForCompany: async () => [] } }));
vi.mock("@/hooks/useStreamlinedUiEnabled", () => ({ useStreamlinedUiEnabled: () => ({ enabled: true }) }));
vi.mock("@/hooks/useSharedPolling", () => ({ useSharedPollingQuery: () => ({ enabled: false }), usePublishSharedQueryData: () => {} }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: fixture.companyId }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: fixture.breadcrumbs }) }));
vi.mock("@/context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: false }) }));
vi.mock("@/context/ToastContext", () => ({ useToastActions: () => ({ pushToast: fixture.toast }) }));
vi.mock("@/components/IssuesList", () => ({ IssuesList: (props: object) => { fixture.issues(props); return null; } }));
vi.mock("@/components/MarkdownEditor", () => ({ MarkdownEditor: () => null }));
vi.mock("@/components/InlineEntitySelector", () => ({ InlineEntitySelector: ({ noneLabel, searchPlaceholder }: { noneLabel: string; searchPlaceholder: string }) => <span>{noneLabel} {searchPlaceholder}</span> }));
vi.mock("@/components/RoutineVariablesEditor", () => ({ RoutineVariablesEditor: () => null, RoutineVariablesHint: () => null }));
vi.mock("@/components/RoutineRunVariablesDialog", () => ({ RoutineRunVariablesDialog: (props: RunProps) => { fixture.run = props; return null; } }));
vi.mock("@/components/RoutineList", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/RoutineList")>(),
  RoutineListRow: (props: RowProps) => {
    fixture.rows.set(props.routine.id, props);
    return <div data-routine={props.routine.id}><a href={props.href}>{props.routine.title}</a>{props.extraMenuItems}</div>;
  },
}));
vi.mock("@/components/folders/FolderControls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/folders/FolderControls")>();
  return {
    ...actual,
    FolderRail: (props: FolderRailProps) => { fixture.rail = props; return <actual.FolderRail {...props} />; },
    FolderFormDialog: (props: FolderFormProps) => { fixture.form = props; return <actual.FolderFormDialog {...props} />; },
    DeleteFolderDialog: (props: DeleteProps) => { fixture.deletion = props; return <actual.DeleteFolderDialog {...props} />; },
    BulkBar: (props: BulkProps) => { fixture.bulk = props; return <actual.BulkBar {...props} />; },
    MoveToMenu: ({ onMove, onCreateAndMove }: ComponentProps<typeof actual.MoveToMenu>) => <>
      <button data-move onClick={() => onMove("folder-1")}>test move</button>
      <button data-unfile onClick={() => onMove(null)}>test unfile</button>
      <button data-create-and-move onClick={onCreateAndMove}>test create and move</button>
    </>,
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root, client: QueryClient, routines: RoutineListItem[], folder: FolderListItem;
const locales = ["en", "zh-CN", "es", "ja"];
const expectedCreated: Record<string, string> = { en: "Routine created", "zh-CN": "例行任务已创建", es: "Rutina creada", ja: "ルーチンを作成しました" };
const rawDiagnostic = "UNKNOWN_PROVIDER detail_401 <raw>";
const mutations = () => [fixture.routines.create, fixture.routines.update, fixture.routines.run, fixture.folders.create, fixture.folders.update, fixture.folders.delete, fixture.folders.moveItem].map(fn => fn.mock.calls.length);
function Location() { const location = useLocation(); return <output data-location>{location.pathname}{location.search}</output>; }
function routine(overrides: Partial<RoutineListItem> = {}): RoutineListItem {
  return { id: "routine-1", companyId: "company-1", title: "User title 原文", status: "paused", assigneeAgentId: "agent-1", folderId: "folder-1", projectId: null, triggers: [], variables: [], priority: "medium", concurrencyPolicy: "coalesce_if_active", catchUpPolicy: "skip_missed", createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"), lastRun: null, activeIssue: null, ...overrides } as RoutineListItem;
}
async function settle(action: () => void = () => {}) {
  await act(async () => { action(); await new Promise(resolve => setTimeout(resolve, 10)); });
}
async function mount(search = "", production = true) {
  const Component = production ? Routines : StreamlinedRoutines;
  await act(async () => root.render(<MemoryRouter initialEntries={[`/routines${search}`]}><QueryClientProvider client={client}><Component /><Location /></QueryClientProvider></MemoryRouter>));
  await settle();
}
function button(text: string, within: ParentNode = document): HTMLButtonElement {
  const found = [...within.querySelectorAll("button")].find(element => element.textContent?.trim() === text);
  expect(found, `button ${text}`).toBeTruthy(); return found!;
}
function inputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function toast(title: string, body: string, tone = "error") {
  expect(fixture.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: i18n.t(title), body: i18n.t(body), tone }));
}
async function switchLanguage(locale: string) {
  const before = mutations();
  await act(async () => { await i18n.changeLanguage(locale); });
  expect(mutations()).toEqual(before);
}
beforeEach(() => {
  for (const [locale, routineOps] of Object.entries({ en: enRoutineOps, "zh-CN": zhRoutineOps, es: esRoutineOps, ja: jaRoutineOps })) {
    i18n.addResourceBundle(locale, "translation", { routineOps }, true, true);
  }
  vi.resetAllMocks(); fixture.companyId = "company-1"; fixture.rows.clear(); fixture.rail = null; fixture.form = null; fixture.deletion = null; fixture.bulk = null; fixture.run = null;
  window.history.replaceState({}, "", "/"); localStorage.clear(); sessionStorage.clear();
  routines = [routine()];
  folder = { id: "folder-1", companyId: "company-1", kind: "routine", name: "Customer folder 原文", color: null, position: 2, itemCount: 1 } as FolderListItem;
  fixture.routines.list.mockImplementation(async () => routines);
  fixture.folders.list.mockImplementation(async () => ({ kind: "routine", allCount: routines.length, unfiledCount: 0, folders: [folder] }));
  fixture.routines.create.mockResolvedValue(routine()); fixture.routines.update.mockResolvedValue(routine()); fixture.routines.run.mockResolvedValue({});
  fixture.folders.create.mockResolvedValue(folder); fixture.folders.update.mockResolvedValue(folder); fixture.folders.delete.mockResolvedValue({}); fixture.folders.moveItem.mockResolvedValue({});
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });

it.each(locales)("localizes actual production empty states and semantic counts in %s", async locale => {
  await i18n.changeLanguage(locale); routines = []; await mount();
  expect(host.textContent).toContain(i18n.t("routineOps.noActive"));
  expect(host.textContent).toContain(i18n.t("routineOps.count", { count: 0 }));
  routines = [routine({ folderId: null })];
  await act(async () => { await client.invalidateQueries(); }); await settle();
  await settle(() => fixture.rail!.onSelect("folder-1"));
  expect(host.textContent).toContain(i18n.t("routineOps.emptyFolder"));
  expect(host.textContent).toContain("Customer folder 原文");
  expect(host.querySelector("[data-location]")?.textContent).toBe("/routines?folder=folder-1");
  await switchLanguage(locale === "ja" ? "es" : "ja");
  expect(host.textContent).toContain(i18n.t("routineOps.emptyFolder"));
  expect(host.querySelector("[data-location]")?.textContent).toBe("/routines?folder=folder-1");
  fixture.companyId = null; await switchLanguage(locale);
  expect(host.textContent).toContain(i18n.t("routineOps.selectOrg"));
  expect(mutations()).toEqual([0, 0, 0, 0, 0, 0, 0]);
});

it.each(locales)("preserves draft and create payload/navigation while switching production locale from %s", async locale => {
  await i18n.changeLanguage(locale); await mount("?folder=folder-1");
  await settle(() => button(i18n.t("workflow.createRoutine")).click());
  const input = document.querySelector<HTMLTextAreaElement>("textarea")!;
  await settle(() => inputValue(input, "Draft title 原文"));
  await switchLanguage(locale === "ja" ? "es" : "ja");
  expect(input.value).toBe("Draft title 原文");
  expect(document.body.textContent).toContain(i18n.t("routineOps.for"));
  expect(document.body.textContent).toContain(i18n.t("routineOps.noResponsible"));
  const dialog = document.querySelector('[role="dialog"]')!;
  fixture.routines.create.mockRejectedValueOnce(null);
  await settle(() => button(i18n.t("routineOps.create"), dialog).click());
  expect(document.body.textContent).toContain(i18n.t("routineOps.createFailed"));
  fixture.routines.create.mockRejectedValueOnce(new Error(rawDiagnostic));
  await settle(() => button(i18n.t("routineOps.create"), dialog).click());
  expect(document.body.textContent).toContain(rawDiagnostic);
  fixture.routines.create.mockResolvedValueOnce(routine({ assigneeAgentId: null }));
  await switchLanguage(locale);
  await settle(() => button(i18n.t("routineOps.create"), dialog).click());
  expect(fixture.routines.create).toHaveBeenLastCalledWith("company-1", expect.objectContaining({ title: "Draft title 原文", folderId: "folder-1", assigneeAgentId: null, priority: "medium", concurrencyPolicy: "coalesce_if_active", catchUpPolicy: "skip_missed" }));
  toast("routineOps.created", "routineOps.draftSaved", "success");
  expect(fixture.toast.mock.lastCall![0].title).toBe(expectedCreated[locale]);
  expect(host.querySelector("[data-location]")?.textContent).toBe("/routines/routine-1?tab=triggers");
});

it.each(locales)("localizes production run, enable and move errors while retaining backend diagnostics in %s", async locale => {
  await i18n.changeLanguage(locale); await mount();
  const row = () => fixture.rows.get("routine-1")!;
  await settle(() => row().onToggleEnabled?.(routine({ assigneeAgentId: null }), false));
  toast("routineOps.agentRequired", "routineOps.setAgent", "warn");
  expect(fixture.routines.update).not.toHaveBeenCalled();
  await settle(() => row().onRunNow?.(routines[0]!));
  expect(fixture.run!.open).toBe(true);
  const runPayload = { variables: { RAW_VAR: "Original value" }, assigneeAgentId: "raw-agent", projectId: "raw-project" };
  const cases = [
    [() => row().onToggleEnabled?.(routines[0]!, false), fixture.routines.update, "routineOps.updateFailed", "routineOps.cannotUpdate"],
    [() => fixture.run!.onSubmit(runPayload), fixture.routines.run, "routineOps.runFailed", "routineOps.cannotRun"],
    [() => host.querySelector<HTMLButtonElement>("[data-move]")!.click(), fixture.folders.moveItem, "routineOps.moveFailed", "routineOps.cannotMove"],
  ] as const;
  for (const [action, api, title, body] of cases) {
    api.mockRejectedValueOnce(null); await settle(action); toast(title, body);
    api.mockRejectedValueOnce(new Error(rawDiagnostic)); await settle(action);
    expect(fixture.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: i18n.t(title), body: rawDiagnostic }));
  }
  expect(fixture.routines.update).toHaveBeenLastCalledWith("routine-1", { status: "active" });
  expect(fixture.routines.run).toHaveBeenLastCalledWith("routine-1", runPayload);
  expect(fixture.folders.moveItem).toHaveBeenLastCalledWith("company-1", { kind: "routine", itemId: "routine-1", folderId: "folder-1" });
  await settle(() => host.querySelector<HTMLButtonElement>("[data-unfile]")!.click());
  expect(fixture.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: i18n.t("routineOps.movedOne"), body: i18n.t("routineOps.movedTo", { title: "User title 原文", folder: i18n.t("commonUi.unfiled") }), action: expect.objectContaining({ label: i18n.t("routineOps.undo") }) }));
  const undo = fixture.toast.mock.lastCall![0].action.onClick;
  await switchLanguage(locale === "ja" ? "es" : "ja");
  await settle(undo);
  expect(fixture.folders.moveItem).toHaveBeenLastCalledWith("company-1", { kind: "routine", itemId: "routine-1", folderId: "folder-1" });
});

it.each(locales)("keeps real folder rename draft and localized failure feedback in %s", async locale => {
  await i18n.changeLanguage(locale); await mount();
  const folderButton = button("Customer folder 原文", host.querySelector("nav")!);
  await settle(() => folderButton.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  const input = host.querySelector<HTMLInputElement>("nav input")!;
  await settle(() => inputValue(input, "Renamed folder 原文"));
  await switchLanguage(locale === "ja" ? "es" : "ja");
  expect(input.value).toBe("Renamed folder 原文");
  expect(fixture.folders.update).not.toHaveBeenCalled();
  fixture.folders.update.mockRejectedValueOnce(null);
  await settle(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(fixture.folders.update).toHaveBeenLastCalledWith("company-1", "folder-1", { name: "Renamed folder 原文" });
  toast("routineOps.folderSaveFailed", "routineOps.cannotUpdateFolder");
  fixture.folders.update.mockRejectedValueOnce(new Error(rawDiagnostic));
  await settle(() => fixture.rail!.onRename(folder, "Second name 原文"));
  expect(fixture.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: i18n.t("routineOps.folderSaveFailed"), body: rawDiagnostic }));
  await switchLanguage(locale);
  await settle(() => fixture.rail!.onCreate());
  fixture.folders.create.mockRejectedValueOnce(null);
  await settle(() => fixture.form!.onSubmit({ name: "Raw created folder", color: null }));
  toast("routineOps.saveFolderFailed", "routineOps.cannotSaveFolder");
  await settle(() => fixture.form!.onSubmit({ name: "Raw created folder", color: null }));
  expect(fixture.folders.create).toHaveBeenLastCalledWith("company-1", { kind: "routine", name: "Raw created folder", color: null });
  expect(fixture.toast).toHaveBeenLastCalledWith({ title: i18n.t("routineOps.folderCreated"), body: folder.name, tone: "success" });
});

it.each(locales)("localizes bulk plural counts and errors without replaying selected moves on switch in %s", async locale => {
  await i18n.changeLanguage(locale); routines.push(routine({ id: "routine-2", title: "Second title 原文" })); await mount();
  await settle(() => button(i18n.t("routineOps.select"), host).click());
  for (const entry of routines) await settle(() => fixture.rows.get(entry.id)!.onSelectChange?.(entry, true));
  expect(fixture.bulk!.selectedCount).toBe(2);
  await switchLanguage(locale === "ja" ? "es" : "ja");
  expect(fixture.bulk!.selectedCount).toBe(2);
  fixture.folders.moveItem.mockRejectedValueOnce(null);
  await settle(() => fixture.bulk!.onMove(null));
  toast("routineOps.moveManyFailed", "routineOps.cannotMoveMany");
  expect(fixture.bulk!.selectedCount).toBe(2);
  fixture.folders.moveItem.mockRejectedValueOnce(new Error(rawDiagnostic));
  await settle(() => fixture.bulk!.onMove(null));
  expect(fixture.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: i18n.t("routineOps.moveManyFailed"), body: rawDiagnostic }));
  await switchLanguage(locale);
  await settle(() => fixture.bulk!.onMove(null));
  expect(fixture.toast).toHaveBeenLastCalledWith({ title: i18n.t("routineOps.moved"), body: i18n.t("routineOps.filed", { count: 2 }), tone: "success" });
  expect(fixture.rows.get("routine-1")!.selected).toBe(false);
  expect(fixture.rows.get("routine-1")!.selectMode).toBe(false);
  for (const entry of routines) expect(fixture.folders.moveItem).toHaveBeenCalledWith("company-1", { kind: "routine", itemId: entry.id, folderId: null });
  await settle(() => button(i18n.t("routineOps.select"), host).click());
  await settle(() => fixture.rows.get("routine-1")!.onSelectChange?.(routines[0]!, true));
  await settle(() => fixture.bulk!.onMove("folder-1"));
  expect(fixture.toast).toHaveBeenLastCalledWith({ title: i18n.t("routineOps.moved"), body: i18n.t("routineOps.filed", { count: 1 }), tone: "success" });
});

it.each(locales)("keeps production filter, sort, folder order and user labels stable in %s", async locale => {
  await i18n.changeLanguage(locale);
  localStorage.setItem("paperclip:routines-view:company-1", JSON.stringify({ groupBy: "folder", sortField: "title", sortDir: "desc", collapsedGroups: [] }));
  routines = [routine({ title: "A original" }), routine({ id: "routine-2", title: "Z original" }), routine({ id: "hidden", folderId: null })];
  await mount("?folder=folder-1");
  const order = () => [...host.querySelectorAll("[data-routine]")].map(node => node.getAttribute("data-routine"));
  expect(order()).toEqual(["routine-2", "routine-1"]);
  const stored = localStorage.getItem("paperclip:routines-view:company-1");
  await switchLanguage(locale === "ja" ? "es" : "ja");
  expect(order()).toEqual(["routine-2", "routine-1"]);
  expect(localStorage.getItem("paperclip:routines-view:company-1")).toBe(stored);
  expect(host.querySelector("[data-location]")?.textContent).toBe("/routines?folder=folder-1");
  expect(host.querySelector('a[href="/routines/routine-1"]')?.textContent).toBe("A original");
  const grouped = buildRoutineGroups([routine({ folderId: "later" }), routine({ id: "second", folderId: "first" })], "folder", new Map(), new Map(), new Map([["later", { name: "A label", position: 5 }], ["first", { name: "Z label", position: 1 }]]));
  expect(grouped.map(group => group.key)).toEqual(["first", "later"]);
  expect(grouped.map(group => group.label)).toEqual(["Z label", "A label"]);
  expect(buildRoutineGroups([routine({ folderId: "missing" })], "folder", new Map(), new Map(), new Map())[0]?.label).toBe(i18n.t("routineOps.unknownFolder"));
  expect(buildRoutineSections([routine({ originKind: "built_in_agent_bundle" })], "none", new Map(), new Map(), new Map())[0]?.label).toBe(i18n.t("routineOps.builtIn"));
  expect(sortRoutines(routines.slice(0, 2), "title", "asc").map(entry => entry.title)).toEqual(["A original", "Z original"]);
});

it.each(locales)("localizes production create-and-move and deletion outcomes without mutating user names in %s", async locale => {
  await i18n.changeLanguage(locale); await mount();
  await settle(() => host.querySelector<HTMLButtonElement>("[data-create-and-move]")!.click());
  expect(fixture.form!.open).toBe(true);
  fixture.folders.moveItem.mockRejectedValueOnce(null);
  await settle(() => fixture.form!.onSubmit({ name: "New folder 原文", color: null }));
  toast("routineOps.folderMoveFailed", "routineOps.cannotMoveMany");
  expect(fixture.folders.create).toHaveBeenCalledWith("company-1", { kind: "routine", name: "New folder 原文", color: null });
  expect(fixture.folders.moveItem).toHaveBeenCalledWith("company-1", { kind: "routine", itemId: "routine-1", folderId: "folder-1" });
  await settle(() => fixture.rail!.onDelete(folder));
  fixture.folders.delete.mockRejectedValueOnce(null);
  await settle(() => fixture.deletion!.onConfirm());
  toast("routineOps.folderDeleteFailed", "routineOps.cannotDeleteFolder");
  expect(fixture.deletion!.open).toBe(true);
  await switchLanguage(locale === "ja" ? "es" : "ja");
  expect(fixture.deletion!.folder!.name).toBe("Customer folder 原文");
  fixture.folders.delete.mockRejectedValueOnce(new Error(rawDiagnostic));
  await settle(() => fixture.deletion!.onConfirm());
  expect(fixture.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: i18n.t("routineOps.folderDeleteFailed"), body: rawDiagnostic }));
  await switchLanguage(locale);
  await settle(() => fixture.deletion!.onConfirm());
  toast("routineOps.folderDeleted", "routineOps.movedUnfiled", "success");
  expect(fixture.folders.delete).toHaveBeenLastCalledWith("company-1", "folder-1");
});

it.each(locales)("keeps a pending production creation single-shot and translates completion in %s", async locale => {
  await i18n.changeLanguage(locale === "ja" ? "es" : "ja"); await mount();
  let complete!: (value: RoutineListItem) => void;
  fixture.routines.create.mockImplementationOnce(() => new Promise<RoutineListItem>(resolve => { complete = resolve; }));
  await settle(() => button(i18n.t("workflow.createRoutine")).click());
  await settle(() => inputValue(document.querySelector<HTMLTextAreaElement>("textarea")!, "Pending raw title"));
  await settle(() => button(i18n.t("routineOps.create"), document.querySelector('[role="dialog"]')!).click());
  expect(fixture.routines.create).toHaveBeenCalledTimes(1);
  await switchLanguage(locale);
  expect(button(i18n.t("routineOps.creating")).disabled).toBe(true);
  expect(document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Pending raw title");
  await settle(() => complete(routine({ assigneeAgentId: "agent-1" })));
  toast("routineOps.created", "routineOps.addTrigger", "success");
  expect(fixture.toast.mock.lastCall![0].title).toBe(expectedCreated[locale]);
  expect(fixture.routines.create).toHaveBeenCalledTimes(1);
});

it.each(locales)("refreshes the recent-run breadcrumb label without changing its production route in %s", async locale => {
  await i18n.changeLanguage(locale === "ja" ? "es" : "ja"); await mount("?tab=runs");
  await switchLanguage(locale);
  expect(fixture.issues.mock.lastCall![0].issueLinkState).toEqual({ issueDetailBreadcrumb: { label: i18n.t("commonUi.recentRuns"), href: "/routines?tab=runs" }, issueDetailSource: "issues" });
  expect(host.querySelector("[data-location]")?.textContent).toBe("/routines?tab=runs");
  expect(mutations()).toEqual([0, 0, 0, 0, 0, 0, 0]);
});


it.each(locales.flatMap(locale => [true, false].map(production => ({ locale, production }))))("localizes folder placement and singular/plural folder-header counts in $locale (production: $production)", async ({ locale, production }) => {
  await i18n.changeLanguage(locale); await mount("", production);
  const headerCounts = () => [...host.querySelectorAll("span.text-muted-foreground")].map(node => node.textContent);
  expect(headerCounts()).toContain(i18n.t("routineOps.count", { count: 1 }));
  routines = [...routines, routine({ id: "routine-2", title: "Second title 原文" })];
  await act(async () => { await client.invalidateQueries(); }); await settle();
  expect(headerCounts()).toContain(i18n.t("routineOps.count", { count: 2 }));
  await settle(() => fixture.rail!.onSelect("folder-1"));
  expect(headerCounts()).toContain(i18n.t("routineOps.count", { count: 2 }));
  routines = routines.slice(0, 1);
  await act(async () => { await client.invalidateQueries(); }); await settle();
  expect(headerCounts()).toContain(i18n.t("routineOps.count", { count: 1 }));
  await settle(() => button(i18n.t("workflow.createRoutine")).click());
  const expected: Record<string, string> = { en: "filed in", "zh-CN": "归入", es: "archivada en", ja: "分類先" };
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(expected[locale]);
  const input = document.querySelector<HTMLTextAreaElement>("textarea")!;
  await settle(() => inputValue(input, "Unchanged folder draft 原文"));
  const nextLocale = locale === "ja" ? "es" : "ja";
  await switchLanguage(nextLocale);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(expected[nextLocale]);
  expect(input.value).toBe("Unchanged folder draft 原文");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Customer folder 原文");
  expect(host.querySelector("[data-location]")?.textContent).toBe("/routines?folder=folder-1");
  expect(mutations()).toEqual([0, 0, 0, 0, 0, 0, 0]);
});
