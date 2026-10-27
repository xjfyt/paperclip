// @vitest-environment jsdom
import { act, useState, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import en from "../i18n/contributions/routineListUi/en.json";
import zh from "../i18n/contributions/routineListUi/zh-CN.json";
import es from "../i18n/contributions/routineListUi/es.json";
import ja from "../i18n/contributions/routineListUi/ja.json";
import { RoutineListRow, formatLastRunTimestamp, formatRoutineRunStatus, nextRoutineStatus, type RoutineListRowItem } from "./RoutineList";
import { DropdownMenuItem } from "./ui/dropdown-menu";

vi.mock("@/lib/router", () => ({ Link: ({ to, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => <a href={to} {...props} /> }));
// Test-only composition; integration generates the runtime locale files.
const messages = { en, "zh-CN": zh, es, ja };
for (const [locale, routineListUi] of Object.entries(messages)) i18n.addResourceBundle(locale, "translation", { routineListUi }, true, true);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const locales = ["en", "zh-CN", "es", "ja"] as const;
const timestamp = "2026-10-27T16:37:29.123Z";
const routine: RoutineListRowItem = {
  id: "routine-original", title: "客户标题_Ω {{untouched}}", status: "active", projectId: "project-original", assigneeAgentId: "agent-original",
  lastRun: { triggeredAt: timestamp, status: "issue_created" },
};
const projects = new Map([["project-original", { name: "项目原名_Ω" }]]);
const agents = new Map([["agent-original", { name: "智能体原名_Ω" }]]);
const statusKeys = {
  received: "managementUi.routineStatusReceived", coalesced: "managementUi.routineStatusCoalesced",
  skipped: "managementUi.routineStatusSkipped", issue_created: "managementUi.routineStatusIssueCreated",
  completed: "managementUi.routineStatusCompleted", failed: "statuses.failed",
};
const callbacks = { onRunNow: vi.fn(), onToggleEnabled: vi.fn(), onToggleArchived: vi.fn(), onSelectChange: vi.fn() };
const base = { routine, projectById: projects, agentById: agents, runningRoutineId: null as string | null, statusMutationRoutineId: null as string | null, href: "/routines/routine-original/overview", ...callbacks };
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); await i18n.changeLanguage("en"); });
async function language(locale: string) { await act(async () => { await i18n.changeLanguage(locale); }); }
async function render(props: Partial<typeof base> & { runNowButton?: boolean; selected?: boolean; selectMode?: boolean; configureLabel?: string; hideArchiveAction?: boolean; disableRunNow?: boolean; disableToggle?: boolean } = {}) {
  await act(async () => root.render(<RoutineListRow {...base} {...props} />));
}
function menuItem(label: string) { return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === label)!; }
function button(label: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label)!; }
async function openMenu() {
  const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
}
function expectNoActions() { for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled(); }

describe.each(locales)("shared routine list row in %s", (locale) => {
  it("localizes labels, ARIA and timestamps while preserving original user text and time source", async () => {
    await language(locale); const strings = messages[locale];
    expect(Object.keys(strings).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(strings)) {
      expect(i18n.getResource(locale, "translation", `routineListUi.${key}`)).toBe(value);
      expect(value.match(/{{.*?}}/g)).toEqual(en[key as keyof typeof en].match(/{{.*?}}/g));
    }
    await render({ runNowButton: true, selected: true, selectMode: true });
    for (const text of [routine.title, "项目原名_Ω", "智能体原名_Ω", new Date(timestamp).toLocaleString(locale), i18n.t(statusKeys.issue_created), strings.on]) expect(host.textContent).toContain(text);
    expect(host.querySelector('input[type="checkbox"]')?.getAttribute("aria-label")).toBe(strings.select.replace("{{title}}", routine.title));
    expect(host.querySelector('[role="switch"]')?.getAttribute("aria-label")).toBe(strings.disableNamed.replace("{{title}}", routine.title));
    expect(host.querySelector('[aria-haspopup="menu"]')?.getAttribute("aria-label")).toBe(i18n.t("liveUi.moreActions", { name: routine.title }));
    expect(button(i18n.t("commonUi.runNow"))).toBeDefined();
    expect(host.querySelector("a")?.getAttribute("href")).toBe(base.href);
    expect(formatLastRunTimestamp(new Date(timestamp))).toBe(new Date(timestamp).toLocaleString(locale));
    expect(routine.lastRun?.triggeredAt).toBe(timestamp);
    expectNoActions();
  });
  it("retains selected rows, order, open menu and caller-owned draft through live language changes", async () => {
    await language(locale); const extra = vi.fn();
    function Harness() {
      const [selected, setSelected] = useState(false);
      return <>
        <input aria-label="Customer draft" defaultValue="客户草稿_Ω" />
        <RoutineListRow {...base} selectMode selected={selected} onSelectChange={(item, value) => { callbacks.onSelectChange(item, value); setSelected(value); }}
          managedByLabel="用户管理标签_Ω" secondaryDetails="用户补充说明_Ω" extraMenuItems={<DropdownMenuItem onClick={extra}>用户菜单_Ω</DropdownMenuItem>} />
        <RoutineListRow {...base} routine={{ ...routine, id: "second-original", title: "Second Ω" }} href="/routines/second-original/overview" />
      </>;
    }
    await act(async () => root.render(<Harness />));
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => checkbox.click());
    expect(callbacks.onSelectChange).toHaveBeenCalledExactlyOnceWith(routine, true);
    const draft = host.querySelector<HTMLInputElement>('input[aria-label="Customer draft"]')!;
    draft.value = "已输入但未提交_Ω";
    await openMenu(); const menu = document.querySelector('[role="menu"]');
    const rows = [...host.querySelectorAll<HTMLAnchorElement>("a")].filter(link => link.parentElement === host);
    expect(rows).toHaveLength(2);
    await language(locale === "en" ? "ja" : "en");
    expect(checkbox.checked).toBe(true); expect(draft.value).toBe("已输入但未提交_Ω");
    expect(host.textContent).toContain(new Date(timestamp).toLocaleString(i18n.language));
    expect(document.querySelector('[role="menu"]')).toBe(menu);
    expect(host.querySelector('[aria-haspopup="menu"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(menuItem(i18n.t("shell.edit"))?.getAttribute("href")).toBe(base.href);
    for (const key of ["commonUi.runNow", "commonUi.pause", "commonUi.archive"]) expect(menuItem(i18n.t(key))).toBeDefined();
    expect(menuItem("用户菜单_Ω")).toBeDefined();
    expect(host.textContent).toContain("用户管理标签_Ω"); expect(host.textContent).toContain("用户补充说明_Ω");
    expect([...host.querySelectorAll<HTMLAnchorElement>("a")].filter(link => link.parentElement === host)).toEqual(rows);
    expect(callbacks.onSelectChange).toHaveBeenCalledTimes(1);
    for (const action of [callbacks.onRunNow, callbacks.onToggleEnabled, callbacks.onToggleArchived, extra]) expect(action).not.toHaveBeenCalled();
    await act(async () => document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[aria-haspopup="menu"]')?.getAttribute("aria-expanded")).toBe("false");
    await language(locale); await openMenu();
    await act(async () => menuItem("用户菜单_Ω").click()); expect(extra).toHaveBeenCalledTimes(1);
  });
  it("passes identical routine objects and enabled state only after explicit localized actions", async () => {
    await language(locale); await render({ runNowButton: true });
    await act(async () => button(i18n.t("commonUi.runNow")).click());
    expect(callbacks.onRunNow).toHaveBeenCalledExactlyOnceWith(routine);
    await openMenu(); await act(async () => menuItem(i18n.t("commonUi.runNow")).click());
    expect(callbacks.onRunNow).toHaveBeenCalledTimes(2); expect(callbacks.onRunNow).toHaveBeenLastCalledWith(routine);
    await openMenu(); await act(async () => menuItem(i18n.t("commonUi.pause")).click());
    expect(callbacks.onToggleEnabled).toHaveBeenCalledExactlyOnceWith(routine, true);
    await openMenu(); await act(async () => menuItem(i18n.t("commonUi.archive")).click());
    expect(callbacks.onToggleArchived).toHaveBeenCalledExactlyOnceWith(routine);
    await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    expect(callbacks.onToggleEnabled).toHaveBeenCalledTimes(2); expect(callbacks.onToggleEnabled).toHaveBeenLastCalledWith(routine, true);
    expect(callbacks.onSelectChange).not.toHaveBeenCalled();
  });
  it("localizes archived and pending states without lifting guards or changing restore payload", async () => {
    await language(locale); const archived = { ...routine, status: "archived" };
    await render({ routine: archived, runNowButton: true, configureLabel: "客户配置_Edit", statusMutationRoutineId: routine.id });
    expect(host.textContent).toContain(i18n.t("propertyLabels.archived"));
    expect(button(i18n.t("commonUi.runNow")).disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true);
    await openMenu(); expect(menuItem("客户配置_Edit")?.getAttribute("href")).toBe(base.href);
    for (const key of ["commonUi.runNow", "routineListUi.enable", "commonUi.restore"]) expect(menuItem(i18n.t(key))?.getAttribute("aria-disabled")).toBe("true");
    await language(locale === "en" ? "ja" : "en");
    expect(menuItem("客户配置_Edit")).toBeDefined(); expect(menuItem(i18n.t("commonUi.restore"))?.getAttribute("aria-disabled")).toBe("true"); expectNoActions();
    await render({ routine: archived, runNowButton: true, configureLabel: "客户配置_Edit" });
    await act(async () => menuItem(i18n.t("commonUi.restore")).click());
    expect(callbacks.onToggleArchived).toHaveBeenCalledExactlyOnceWith(archived);
    await render({ runningRoutineId: routine.id, runNowButton: true, disableToggle: true, hideArchiveAction: true });
    expect(button(i18n.t("stabilizationUi.running")).disabled).toBe(true);
    await act(async () => button(i18n.t("stabilizationUi.running")).click()); await openMenu();
    expect(menuItem(i18n.t("stabilizationUi.running"))?.getAttribute("aria-disabled")).toBe("true");
    expect(menuItem(i18n.t("commonUi.pause"))?.getAttribute("aria-disabled")).toBe("true");
    expect(menuItem(i18n.t("commonUi.archive"))).toBeUndefined();
    expect(callbacks.onRunNow).not.toHaveBeenCalled(); expect(callbacks.onToggleEnabled).not.toHaveBeenCalled();
  });
  it("handles draft, missing identities and all known run statuses without rewriting unknown data", async () => {
    await language(locale);
    const draft = { ...routine, status: "paused", projectId: null, assigneeAgentId: null, lastRun: null };
    await render({ routine: draft });
    for (const text of [messages[locale].never, messages[locale].noDefaultAgent, i18n.t("commonUi.noProject"), i18n.t("statuses.draft")]) expect(host.textContent).toContain(text);
    expect(host.querySelector('[role="switch"]')?.getAttribute("aria-label")).toBe(messages[locale].enableNamed.replace("{{title}}", routine.title));
    await openMenu(); await act(async () => menuItem(i18n.t("routineListUi.enable")).click());
    expect(callbacks.onToggleEnabled).toHaveBeenCalledExactlyOnceWith(draft, false);
    await render({ routine: { ...routine, status: "paused", lastRun: { triggeredAt: timestamp, status: null } }, projectById: new Map(), agentById: new Map() });
    for (const text of [i18n.t("statuses.paused"), messages[locale].off, i18n.t("routineOps.unknownProject"), i18n.t("routineOps.unknownAgent")]) expect(host.textContent).toContain(text);
    expect(host.textContent).not.toContain(" · null");
    for (const [status, key] of Object.entries(statusKeys)) {
      await render({ routine: { ...routine, lastRun: { triggeredAt: timestamp, status } } });
      expect(host.textContent).toContain(` · ${i18n.t(key)}`); expect(formatRoutineRunStatus(status)).toBe(i18n.t(key));
    }
    for (const status of ["provider_custom_status_Ω", "constructor", "__proto__"]) {
      await render({ routine: { ...routine, lastRun: { triggeredAt: timestamp, status } } });
      expect(host.textContent).toContain(` · ${status}`); expect(formatRoutineRunStatus(status)).toBe(status);
    }
    expect(formatRoutineRunStatus(null)).toBeNull(); expect(document.body.textContent).not.toMatch(/routineListUi\.|managementUi\./);
    expect(callbacks.onRunNow).not.toHaveBeenCalled(); expect(callbacks.onToggleArchived).not.toHaveBeenCalled();
    expect(nextRoutineStatus("archived", true)).toBe("active"); expect(nextRoutineStatus("active", false)).toBe("paused");
  });
});
