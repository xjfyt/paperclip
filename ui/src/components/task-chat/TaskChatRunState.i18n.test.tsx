// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "@/lib/router";
import { ThemeProvider } from "@/context/ThemeContext";
import { __secondTickInternals } from "@/hooks/useSecondTick";
import { TaskChatRunnerTurn } from "./TaskChatRunnerTurn";
import { TaskChatRunnerActivityGroup } from "./TaskChatRunnerActivityGroup";
import { TaskChatExpansionState } from "./expansion-state";
import { i18n, taskThreadRunStateMessages as messages } from "@/i18n/task-thread-run-state-test-resources";
import "@/i18n/tool-activity-test-resources";
import "@/i18n/completed-activity-test-resources";
import "@/i18n/task-thread-interactions-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import type { TaskChatActivityPhaseItem, TaskChatItem, TaskChatRuntimeRequestItem } from "./task-chat-model";
vi.mock("@/components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <div>{children}</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Locale = keyof typeof messages;
const locales = Object.keys(messages) as Locale[];
const now = 200_000_000;
let container: HTMLDivElement;
let root: Root;
let memory: Map<string, boolean>;
beforeEach(async () => { await i18n.changeLanguage("en"); vi.spyOn(Date, "now").mockReturnValue(now); container = document.createElement("div"); document.body.append(container); root = createRoot(container); memory = new Map(); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); await i18n.changeLanguage("en"); });
const language = async (locale: Locale) => { await act(async () => { await i18n.changeLanguage(locale); }); };
const render = async (children: ReactNode) => { await act(async () => root.render(<MemoryRouter><ThemeProvider><TaskChatExpansionState.Provider value={memory}>{children}</TaskChatExpansionState.Provider></ThemeProvider></MemoryRouter>)); };
const click = async (el: HTMLElement) => { await act(async () => el.click()); };
const nextLocale = (locale: Locale) => locale === "ja" ? "es" : "ja";
const number = (locale: Locale, value: number) => new Intl.NumberFormat(locale).format(value);
const fill = (template: string, values: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key]);
it.each(locales)("validates local run state copy in %s", locale => expect(validateLocaleMessages(messages[locale], messages.en)).toEqual([]));
it.each(locales.flatMap(locale => ["succeeded", "failed", "cancelled", "timed_out", "interrupted"].map(status => ({ locale, status }))))("displays terminal $status locally in $locale without changing the final provider text", async ({ locale, status }) => {
  await language(locale); const onDecision = vi.fn(); const items: TaskChatItem[] = [{ id: "final-raw", kind: "message", author: "agent", text: "Worked for 1m // provider $1,234.00", atMs: 1000 }]; const before = JSON.stringify(items);
  await render(<TaskChatRunnerTurn runId="run-raw" agentName="Working" items={items} status={status} startedAtMs={now - 74_040_000} finishedAtMs={now} onRuntimeRequestDecision={onDecision} />);
  const header = container.querySelector('[data-testid="task-chat-turn-status-header"]')!; const final = container.querySelector('[data-testid="task-chat-final-response"]')!; const next = nextLocale(locale); await language(next);
  const duration = fill(messages[next].minutes, { minutes: number(next, 1234) }); expect(header.textContent).toBe(fill(messages[next][status === "succeeded" ? "workedFor" : "stoppedAfter"], { duration }));
  expect(container.querySelector('[data-testid="task-chat-turn-status-header"]')).toBe(header); expect(container.querySelector('[data-testid="task-chat-final-response"]')).toBe(final); expect(final.textContent).toContain("Worked for 1m // provider $1,234.00"); expect(container.textContent).toContain("Working"); expect(container.querySelector('[data-testid="task-chat-current-activity"]')).toBeNull(); expect(__secondTickInternals.subscriberCount()).toBe(0); expect(onDecision).not.toHaveBeenCalled(); expect(JSON.stringify(items)).toBe(before);
});
it.each(locales)("keeps the live ticker and local fallback mounted through %s without actions or timer restart", async locale => {
  await language(locale); const intervals = vi.spyOn(globalThis, "setInterval"); const onDecision = vi.fn(); const items: TaskChatItem[] = [];
  await render(<TaskChatRunnerTurn runId="run-raw" agentName="Thinking" items={items} status="provider_unknown_state" startedAtMs={now - 65_000} activityUnavailable continuedAfterSteering onRuntimeRequestDecision={onDecision} />);
  const header = container.querySelector('[data-testid="task-chat-turn-status-header"]')!; const tail = container.querySelector('[data-testid="task-chat-current-activity-label"]')!; const timerCalls = intervals.mock.calls.length; expect(__secondTickInternals.subscriberCount()).toBe(1);
  const next = nextLocale(locale); await language(next); const duration = fill(messages[next].minutesSeconds, { minutes: "1", seconds: "5" }); const status = fill(messages[next].workingFor, { duration }); expect(header.textContent).toBe(fill(messages[next].continued, { status })); expect(tail.textContent).toBe(messages[next].thinking); expect(container.querySelector('[data-testid="task-chat-current-activity-label"]')).toBe(tail); expect(container.querySelector('[data-testid="task-chat-turn-status-header"]')).toBe(header); expect(container.textContent).toContain(messages[next].activityUnavailable); expect(intervals).toHaveBeenCalledTimes(timerCalls); expect(__secondTickInternals.subscriberCount()).toBe(1); expect(onDecision).not.toHaveBeenCalled(); expect(items).toEqual([]);
});
it.each(locales)("retains the pending request identity and never revives inline actions on locale change in %s", async locale => {
  await language(locale); const onDecision = vi.fn(); const request: TaskChatRuntimeRequestItem = { id: "request-row", kind: "protocol", surface: "runtime_request", runId: "run-raw", requestId: "request-raw-1234", requestKind: "command_approval", turnId: "turn-raw", requestType: "permission", status: "pending", prompt: "Working for 0s", choices: [{ key: "accept", label: "Thinking" }], fields: [] }; const items = [request]; const before = JSON.stringify(items);
  await render(<TaskChatRunnerTurn runId="run-raw" items={items} status="running" startedAtMs={null} onRuntimeRequestDecision={onDecision} />); const next = nextLocale(locale); await language(next);
  expect(container.querySelector('[data-testid="task-chat-turn-status-header"]')?.textContent).toBe(fill(messages[next].workingFor, { duration: fill(messages[next].seconds, { seconds: "0" }) })); expect(container.querySelector('[data-testid="task-chat-runtime-request"]')).toBeNull(); expect(onDecision).not.toHaveBeenCalled(); expect(items[0]).toBe(request); expect(JSON.stringify(items)).toBe(before);
});
it.each(locales)("keeps thinking history, focus and provider prose through %s", async locale => {
  await language(locale); const item: TaskChatActivityPhaseItem = { id: "phase-raw", kind: "activity_phase", summary: "provider summary", active: true, items: [{ id: "old-raw", kind: "thinking", streaming: false, lines: ["Thought // provider raw"] }, { id: "live-raw", kind: "thinking", streaming: true, lines: ["Thinking // provider raw"] }] }; const before = JSON.stringify(item);
  await render(<TaskChatRunnerActivityGroup item={item} />); const toggle = container.querySelector<HTMLButtonElement>('[data-testid="task-chat-activity-phase-toggle"]')!; expect(toggle.textContent).toContain(messages[locale].thinking); await click(toggle); const details = container.querySelector<HTMLButtonElement>('[data-activity-item-id="live-raw"] button')!; await click(details); details.focus(); const next = nextLocale(locale); await language(next);
  expect(toggle.getAttribute("aria-expanded")).toBe("true"); expect(details.getAttribute("aria-expanded")).toBe("true"); expect(document.activeElement).toBe(details); expect(container.querySelector('[data-activity-row="old-raw"]')?.textContent).toContain(messages[next].thought); expect(container.querySelector('[data-activity-row="live-raw"]')?.textContent).toContain(messages[next].thinking); expect(container.querySelector('[data-testid="task-chat-runner-activity-detail"]')?.textContent).toBe("Thinking // provider raw"); expect(JSON.stringify(item)).toBe(before);
});
it.each(locales)("formats usage only for display and keeps explicit labels and currency raw in %s", async locale => {
  await language(locale); const usage = { used: 12345, size: 67890, inputTokens: 12345, outputTokens: 67890, costUsd: 1234.5678 }; const item: TaskChatActivityPhaseItem = { id: "phase-usage", kind: "activity_phase", summary: "raw", active: false, items: [{ id: "usage-default", kind: "usage", usage }, { id: "usage-named", kind: "usage", usage, label: "Token usage", detail: "raw /path?id=1234" }] }; const before = JSON.stringify(item);
  await render(<TaskChatRunnerActivityGroup item={item} defaultExpanded />); const next = nextLocale(locale); await language(next); const defaultRow = container.querySelector('[data-activity-row="usage-default"]')!; const namedRow = container.querySelector('[data-activity-row="usage-named"]')!;
  expect(defaultRow.textContent).toContain(messages[next].tokenUsage); expect(namedRow.textContent).toContain("Token usage"); expect(defaultRow.textContent).toContain(fill(messages[next].contextUsage, { used: number(next, 12345), size: number(next, 67890) })); expect(defaultRow.textContent).toContain(`↑${number(next, 12345)} ↓${number(next, 67890)}`); expect(defaultRow.textContent).toContain("$1234.5678"); expect(JSON.stringify(item)).toBe(before);
});
