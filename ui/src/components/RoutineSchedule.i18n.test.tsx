// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoutineTrigger } from "@paperclipai/shared";
import { i18n } from "../i18n";
import en from "../i18n/contributions/routineScheduleUi/en.json";
import zh from "../i18n/contributions/routineScheduleUi/zh-CN.json";
import es from "../i18n/contributions/routineScheduleUi/es.json";
import ja from "../i18n/contributions/routineScheduleUi/ja.json";
import { RoutineTriggerCard } from "./RoutineTriggerCard";
import { RoutineOverview, summarizeRoutineSchedule } from "./RoutineOverview";
import { RoutineDetailContext, type RoutineDetailContextValue } from "./routine-sections/context";
import { ScheduleEditor, getScheduleCronValidation } from "./ScheduleEditor";
import { describeCron } from "../lib/cron-readable";
vi.mock("@/components/IssueRow", () => ({ IssueRow: () => null }));
vi.mock("@/components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a> }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); await i18n.changeLanguage("en"); });
const locales = [["en", en], ["zh-CN", zh], ["es", es], ["ja", ja]] as const;
const schedule = { id: "trigger-original", kind: "schedule", label: "客户计划 Ω", enabled: true, cronExpression: "0 9 * * 1-5", timezone: "America/Los_Angeles", nextRunAt: new Date("2026-10-27T16:00:00Z"), lastResult: "Created execution issue task-123" } as RoutineTrigger;
const webhook = { ...schedule, id: "webhook-original", kind: "webhook", cronExpression: null, signingMode: "hmac_sha256", replayWindowSec: 300, webhookUrl: "https://example.invalid/private-hook", lastResult: "custom-result Ω" } as RoutineTrigger;
const button = (label: string) => Array.from(document.querySelectorAll("button")).find(b => b.textContent === label)!;
async function setLanguage(locale: string) { await act(async () => { await i18n.changeLanguage(locale); }); }
function setInput(input: HTMLInputElement, value: string) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }

describe.each(locales)("routine scheduling in %s", (locale, strings) => {
  it("uses actual translated resources and keeps schedule counts and protocol data", async () => {
    await setLanguage(locale);
    for (const [key, value] of Object.entries(strings)) expect(i18n.getResource(locale, "translation", `routineScheduleUi.${key}`)).toBe(value);
    const summary = summarizeRoutineSchedule([schedule]);
    expect(summary.label).toBe(strings.schedules_one.replace("{{count}}", "1"));
    expect(summary.detail).toBe("0 9 * * 1-5 · America/Los_Angeles");
    expect(summary.nextRunAt?.toISOString()).toBe("2026-10-27T16:00:00.000Z");
    expect(summarizeRoutineSchedule([webhook]).label).toBe(strings.webhooks_one.replace("{{count}}", "1"));
    const context = { routine: { id: "routine-original", companyId: "company-original", status: "active", title: "客户标题 Ω", description: "客户说明 Ω", assigneeAgentId: null, triggers: [schedule] }, routineRuns: [], currentAssignee: null, hasLiveRun: false } as unknown as RoutineDetailContextValue;
    await act(async () => root.render(<RoutineDetailContext.Provider value={context}><RoutineOverview /></RoutineDetailContext.Provider>));
    expect(host.textContent).toContain(strings.schedules_one.replace("{{count}}", "1"));
    expect(host.textContent).toContain(strings.noAgent);
    expect(host.textContent).toContain("客户说明 Ω");
    expect(host.textContent).toContain("America/Los_Angeles");
    expect(host.querySelector(`a[href="/routines/routine-original/runs"]`)).not.toBeNull();
    expect(host.textContent).not.toContain("routineScheduleUi.");
  });
  it("renders trigger controls and preserves cron, timezone, signing and callback IDs", async () => {
    await setLanguage(locale); const onSave = vi.fn(), onDelete = vi.fn(), onRotate = vi.fn();
    await act(async () => root.render(<RoutineTriggerCard key={schedule.id} trigger={schedule} onSave={onSave} onDelete={onDelete} onRotate={onRotate} />));
    expect(host.textContent).toContain(strings.taskCreated);
    expect(host.textContent).toContain(strings.weekdayAt.replace("{{time}}", "09:00"));
    expect(host.textContent).toContain("客户计划 Ω");
    await act(async () => button(strings.saveTrigger).click());
    expect(onSave).toHaveBeenLastCalledWith(schedule.id, { label: schedule.label, cronExpression: schedule.cronExpression, timezone: "America/Los_Angeles" });
    await act(async () => root.render(<RoutineTriggerCard key={webhook.id} trigger={webhook} onSave={onSave} onDelete={onDelete} onRotate={onRotate} />));
    expect(host.textContent).toContain(strings.webhookHelp);
    expect(host.textContent).toContain("custom-result Ω");
    expect(host.querySelector<HTMLInputElement>(`#webhook-url-${webhook.id}`)?.value).toBe(webhook.webhookUrl);
    await act(async () => button(strings.saveTrigger).click());
    expect(onSave).toHaveBeenLastCalledWith(webhook.id, { label: webhook.label, signingMode: "hmac_sha256", replayWindowSec: 300 });
    await act(async () => button(strings.rotate).click());
    expect(onRotate).toHaveBeenCalledExactlyOnceWith(webhook.id);
    await act(async () => root.render(<RoutineTriggerCard key={webhook.id} trigger={webhook} disabled onSave={onSave} onDelete={onDelete} onRotate={onRotate} />));
    expect(button(strings.saveTrigger)).toBeUndefined();
    expect(button(strings.rotate)).toBeUndefined();
    expect(onDelete).not.toHaveBeenCalled();
  });
  it("renders localized validation while keeping invalid custom cron drafts out of callbacks", async () => {
    await setLanguage(locale); const onChange = vi.fn(), onValidityChange = vi.fn();
    await act(async () => root.render(<ScheduleEditor value="0 8-18/2 * * 1-5" onChange={onChange} onValidityChange={onValidityChange} />));
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${strings.cron}"]`)!;
    expect(input.value).toBe("0 8-18/2 * * 1-5");
    expect(host.textContent).toContain(strings.validCron);
    await act(async () => setInput(input, "0 8-18/2 *"));
    expect(host.textContent).toContain(strings.fieldCount.replace("{{count}}", "3"));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
    await setLanguage(locale === "en" ? "ja" : "en");
    expect(input.value).toBe("0 8-18/2 *");
    expect(host.textContent).toContain((locale === "en" ? ja : en).fieldCount.replace("{{count}}", "3"));
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })); });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => setInput(input, "15 8-18/2 * * 1-5"));
    expect(onChange).toHaveBeenLastCalledWith("15 8-18/2 * * 1-5");
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });
  it("changes a localized weekday without changing the cron time or protocol day", async () => {
    await setLanguage(locale); const onChange = vi.fn();
    await act(async () => root.render(<ScheduleEditor value="15 9 * * 1" onChange={onChange} />));
    const tuesday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date("2026-01-06T00:00:00Z"));
    await act(async () => button(tuesday).click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith("15 9 * * 2");
  });
  it("localizes cron descriptions without changing next-fire instants", async () => {
    await setLanguage("en"); const reference = getScheduleCronValidation("0 8-18/2 * * 1-5").nextFires.map(d => d.toISOString());
    await setLanguage(locale);
    expect(getScheduleCronValidation("0 8-18/2 * * 1-5").nextFires.map(d => d.toISOString())).toEqual(reference);
    expect(describeCron("*/15 * * * *")).toBe(strings.everyMinutes.replace("{{amount}}", "15"));
    expect(describeCron("0 14 * * *")).toBe(strings.daily.replace("{{time}}", "14:00"));
    expect(describeCron("not a cron")).toBeNull();
  });
});
