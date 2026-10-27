// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { completedActivityMessages, i18n } from "@/i18n/completed-activity-test-resources";
import { ThemeProvider } from "@/context/ThemeContext";
import { MemoryRouter } from "@/lib/router";
import { TaskChatThreadView } from "./TaskChatThreadView";
import { TaskChatRunnerTurn } from "./TaskChatRunnerTurn";
import { TaskChatLiveTail } from "./TaskChatLiveTail";
import { TaskChatExpansionState } from "./expansion-state";
import { settledRunChildren } from "./transcript-adapter";
import type { TaskChatItem, TaskChatProviderActivityItem, TaskChatToolItem } from "./task-chat-model";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const tool = (id: string, name: string, status: TaskChatToolItem["status"] = "completed"): TaskChatToolItem => ({
  id, kind: "tool", name, status, target: `/raw/路径/${id}`, detail: `Raw output ${id}`,
});
const notice = (id: string, summary: string, severity = "info"): TaskChatProviderActivityItem => ({
  id, kind: "protocol", surface: "provider_activity", family: "provider_notice", status: "informational",
  title: "Raw provider title", eventType: "provider.notice.recorded", summary,
  details: [{ label: "Severity", value: severity }], steps: [], children: [], links: [],
});
const boundary = (id: string): TaskChatItem => ({
  id, kind: "message", author: "agent", text: `Raw boundary ${id}`, channel: "progress", interstitial: true,
});
function fixture(): TaskChatItem[] {
  return [
    tool("read-failed", "read", "failed"), tool("command", "bash", "failed"),
    tool("edit-failed", "edit", "interrupted"), notice("same-owned", "Ran commands"),
    tool("web", "web_search"), boundary("one"),
    tool("read", "read"), tool("command-two", "bash"), tool("edit", "edit"),
    notice("info", "Raw info"), notice("warning", "Raw warning", "warning"), notice("error", "Raw error", "error"),
    boundary("two"), notice("raw", "Provider CASE, Ran commands, 原文"), boundary("three"),
    tool("live", "bash", "in_progress"),
  ];
}
let root: Root;
let container: HTMLDivElement;
let memory: Map<string, boolean>;
const external = vi.fn(() => { throw new Error("Unexpected external request"); });
beforeEach(async () => {
  await i18n.changeLanguage("en");
  container = document.body.appendChild(document.createElement("div")); root = createRoot(container);
  memory = new Map(); external.mockClear(); vi.stubGlobal("fetch", external);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); await i18n.changeLanguage("en");
});
async function render(element: ReactNode) {
  await act(async () => root.render(<MemoryRouter><ThemeProvider><TaskChatExpansionState.Provider value={memory}>{element}</TaskChatExpansionState.Provider></ThemeProvider></MemoryRouter>));
}
const interpolate = (template: string, values: Record<string, string>) =>
  template.replace(/{{(\w+)}}/g, (_, key: string) => values[key]);

it.each(["settled thread", "runner live", "legacy live"] as const)("hot-switches summaries and full ARIA in actual %s without changing raw data or expansion", async (host) => {
  const items = fixture();
  const before = JSON.stringify(items);
  const onDecision = vi.fn();
  if (host === "settled thread") {
    await render(<TaskChatThreadView scroll={false} items={[{ id: "turn", kind: "turn", settled: true, standaloneHeader: true,
      agentName: "Agent 原文", summary: { toolCount: 8, added: 0, removed: 0 }, items: settledRunChildren(items) }]} />);
  } else if (host === "runner live") {
    await render(<TaskChatRunnerTurn runId="raw-run" items={items} status="running" startedAtMs={null} agentName="Agent 原文" onRuntimeRequestDecision={onDecision} />);
  } else await render(<TaskChatLiveTail items={items} onRuntimeRequestDecision={onDecision} />);
  const toggles = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="task-chat-activity-phase-toggle"]')];
  expect(toggles).toHaveLength(4);
  const first = toggles[0];
  const title = first.querySelector<HTMLElement>("[data-completed-summary] [title]")!;
  const countFor = (count: number, messages: typeof completedActivityMessages.en) =>
    messages[count === 1 ? "count_one" : "count_other"].replace("{{count}}", String(count));
  for (const locale of ["en", "zh-CN", "es", "ja", "en"] as const) {
    await act(async () => { await i18n.changeLanguage(locale); });
    const m = completedActivityMessages[locale];
    expect(container.querySelector('[data-testid="task-chat-activity-phase-toggle"]')).toBe(first);
    expect(first.querySelector("[data-completed-summary] [title]")).toBe(title);
    const expected = [m.checkedFiles, "Ran commands", m.workedFiles_continuation, m.searchedWeb_continuation].join(m.separator);
    const accessible = [m.checkedFiles_continuation, "Ran commands", m.workedFiles_continuation, m.searchedWeb_continuation].join(m.separator);
    expect(title.textContent).toBe(m.andMore.replace("{{activities}}", [m.checkedFiles, "Ran commands"].join(m.separator)));
    expect(title.title).toBe(expected);
    expect(first.getAttribute("aria-label")).toBe(interpolate(m.expandCompleted, { summary: accessible, countLabel: countFor(5, m) }));
    expect(toggles[1].querySelector("[title]")?.getAttribute("title"))
      .toBe([m.providerError, m.readFiles_continuation, m.ranCommands_continuation, m.editedFiles_continuation].join(m.separator));
    expect(toggles[2].querySelector("[title]")?.getAttribute("title")).toBe("Provider CASE, Ran commands, 原文");
    expect(toggles[2].getAttribute("aria-label")).toBe(interpolate(m.expandCompleted, { summary: "Provider CASE, Ran commands, 原文", countLabel: countFor(1, m) }));
    if (host !== "settled thread") expect(toggles[3].getAttribute("aria-label"))
      .toBe(interpolate(m.expandActive, { countLabel: countFor(1, m) }));
    expect(JSON.stringify(items)).toBe(before);
  }
  await act(async () => { first.click(); toggles[3].click(); });
  const detailButton = container.querySelector<HTMLButtonElement>("li button")!;
  await act(async () => detailButton.click());
  detailButton.focus();
  const detail = container.querySelector('[data-testid="task-chat-runner-activity-detail"]');
  const history = container.querySelector('[data-testid="task-chat-runner-activity-list"]');
  const savedExpansion = [...memory.entries()];
  for (const locale of ["zh-CN", "es", "ja", "en"] as const) {
    await act(async () => { await i18n.changeLanguage(locale); });
    const m = completedActivityMessages[locale];
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(first.getAttribute("aria-label")).toBe(interpolate(m.collapseCompleted, {
      summary: [m.checkedFiles_continuation, "Ran commands", m.workedFiles_continuation, m.searchedWeb_continuation].join(m.separator), countLabel: countFor(5, m),
    }));
    expect(container.querySelector('[data-testid="task-chat-runner-activity-list"]')).toBe(history);
    expect(history?.getAttribute("aria-label")).toBe(m.history);
    expect(first.textContent).toContain(countFor(5, m));
    expect(toggles[3].textContent).toContain(countFor(1, m));
    if (host !== "settled thread") expect(toggles[3].getAttribute("aria-label"))
      .toBe(interpolate(m.collapseActive, { countLabel: countFor(1, m) }));
    expect(container.querySelector("li button")).toBe(detailButton);
    expect(document.activeElement).toBe(detailButton);
    expect(container.querySelector('[data-testid="task-chat-runner-activity-detail"]')).toBe(detail);
    expect(detail?.textContent).toContain("Raw output read-failed");
    expect([...memory.entries()]).toEqual(savedExpansion);
    expect(JSON.stringify(items)).toBe(before);
    expect(onDecision).not.toHaveBeenCalled(); expect(external).not.toHaveBeenCalled();
  }
});
