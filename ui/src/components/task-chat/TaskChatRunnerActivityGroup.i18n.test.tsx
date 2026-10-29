// @vitest-environment jsdom
import "@/i18n/task-thread-run-state-test-resources";
import "@/i18n/task-thread-activity-test-resources";
import "@/i18n/tool-activity-test-resources";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MemoryRouter } from "@/lib/router";
import { ThemeProvider } from "@/context/ThemeContext";
import { i18n } from "@/i18n";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import en from "@/i18n/contributions/runnerProviderActivityUi/en.json";
import zh from "@/i18n/contributions/runnerProviderActivityUi/zh-CN.json";
import es from "@/i18n/contributions/runnerProviderActivityUi/es.json";
import ja from "@/i18n/contributions/runnerProviderActivityUi/ja.json";
import { parsePaperclipRunnerStdoutLine } from "@/adapters/paperclip-runner";
import { TaskChatThreadView } from "./TaskChatThreadView";
import { TaskChatRunnerTurn } from "./TaskChatRunnerTurn";
import { TaskChatLiveTail } from "./TaskChatLiveTail";
import { TaskChatExpansionState } from "./expansion-state";
import { buildTurnSummary, settledRunChildren, transcriptToTaskChatItems } from "./transcript-adapter";
import { providerActivityPresentation } from "./task-chat-activity-presentation";
import type { TaskChatProviderActivityItem } from "./task-chat-model";

// Test only: runtime locales are composed separately by the integration owner.
const messages = { en, "zh-CN": zh, es, ja };
for (const [locale, runnerProviderActivityUi] of Object.entries(messages)) i18n.addResourceBundle(locale, "translation", { runnerProviderActivityUi }, true, true);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const variants: Array<[string, string, Record<string, string>?]> = [
  ["researchOpen", "research.updated", { action: "open_page" }], ["researchFind", "research.updated", { action: "find_in_page" }], ["researchWeb", "research.updated"],
  ["plan", "plan.updated"],
  ["delegationMessage", "delegation.updated", { action: "message" }], ["delegationResume", "delegation.updated", { action: "resume" }],
  ["delegationClose", "delegation.updated", { action: "close" }], ["delegationWait", "delegation.updated", { action: "wait" }], ["delegationStart", "delegation.updated"],
  ["modelSwitch", "model.route.changed"], ["modelVerify", "model.verified"], ["context", "context.updated"],
  ["artifactView", "artifact.viewed"], ["artifactGenerate", "artifact.updated"],
  ["reviewExit", "review.updated", { state: "exited" }], ["reviewEnter", "review.updated"],
  ["hook", "hook.updated"], ["memory", "memory.updated"], ["safety", "safety.updated"], ["terminal", "terminal.updated"], ["wait", "wait.updated"],
  ["notice", "provider.notice.recorded", { severity: "warning" }],
];
const states = [["running", "Running"], ["completed", "Completed"], ["failed", "Failed"], ["interrupted", "Interrupted"]] as const;
const ts = "2026-10-27T00:00:00Z";
// A provider summary identical to owned English must remain raw in every locale.
const rawSummary = "Updating the plan";
function fixture() {
  const samples = variants.flatMap(([prefix, eventType, extra]) => states.map(([status, suffix]) => ({
    key: prefix === "notice" ? status === "failed" ? "noticeError" : "notice" : `${prefix}${suffix}`,
    entry: parsePaperclipRunnerStdoutLine(JSON.stringify({ type: "paperclip.prp.event", event: { eventType,
      payload: { ...extra, planId: `${prefix}:${status}`, name: "Provider/name Ω", status, summary: rawSummary, title: "Provider title 原文" },
    } }), ts)[0],
  })));
  const entries = samples.map(sample => sample.entry);
  const items = transcriptToTaskChatItems(entries, { runId: "run", agentName: "原文 Agent", running: true });
  expect(items).toHaveLength(samples.length);
  return { entries, items, samples };
}
let root: Root;
let container: HTMLDivElement;
let memory: Map<string, boolean>;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); memory = new Map();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); await i18n.changeLanguage("en"); });
async function render(element: ReactNode) {
  await act(async () => root.render(<MemoryRouter><ThemeProvider><TaskChatExpansionState.Provider value={memory}>{element}</TaskChatExpansionState.Provider></ThemeProvider></MemoryRouter>));
}

it.each(Object.entries(messages))("validates all owned provider-state labels in %s", (locale, translated) => {
  expect(validateLocaleMessages(translated, en)).toEqual([]);
  expect(Object.keys(translated)).toHaveLength(86);
  if (locale !== "en") for (const key of Object.keys(en) as Array<keyof typeof en>) expect(translated[key]).not.toBe(en[key]);
});

// These are the actual three hosts TaskChatThread uses for settled, runner-live
// and legacy-live rows. None renders the provider items as a direct ProtocolCard.
it.each(["settled thread", "runner live", "legacy live"] as const)("hot-switches grouped provider rows in %s without changing wire values or open details", async (host) => {
  const { entries, items, samples } = fixture();
  const before = JSON.stringify({ entries, items });
  if (host === "settled thread") {
    await render(<TaskChatThreadView scroll={false} items={[{ id: "turn", kind: "turn", settled: true, standaloneHeader: true,
      items: settledRunChildren(items), summary: buildTurnSummary(entries), agentName: "原文 Agent" }]} />);
  } else if (host === "runner live") {
    await render(<TaskChatRunnerTurn runId="run" items={items} status="running" startedAtMs={null} agentName="原文 Agent" />);
  } else await render(<TaskChatLiveTail items={items} />);
  const toggle = container.querySelector<HTMLButtonElement>('[data-testid="task-chat-activity-phase-toggle"]')!;
  expect(toggle).toBeTruthy();
  await act(async () => toggle.click());
  expect(container.querySelectorAll("[data-activity-item-id]")).toHaveLength(samples.length);
  const firstDetails = container.querySelector<HTMLButtonElement>("li button")!;
  await act(async () => firstDetails.click());
  const firstRow = container.querySelector("[data-activity-row]");
  for (const locale of ["en", "zh-CN", "es", "ja", "en"] as const) {
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(container.querySelector('[data-testid="task-chat-activity-phase-toggle"]')).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("li button")).toBe(firstDetails);
    expect(firstDetails.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("[data-activity-row]")).toBe(firstRow);
    samples.forEach((sample, index) => {
      const row = container.querySelector(`[data-activity-row="${items[index].id}"]`)!;
      expect(row.textContent).toContain((messages[locale] as Record<string, string>)[sample.key]);
      expect(row.querySelector("[title]")?.getAttribute("title")).toBe(rawSummary);
    });
    expect(container.querySelector('[data-testid="task-chat-runner-activity-detail"]')?.textContent).toContain(rawSummary);
    expect(JSON.stringify({ entries, items })).toBe(before);
  }
});

it.each(Object.keys(messages))("preserves unknown tool names, provider text and canonical detail keys in %s", async (locale) => {
  const item: TaskChatProviderActivityItem = {
    id: "external", kind: "protocol", surface: "provider_activity", family: "tool_execution", eventType: "tool.execution.future",
    status: "running", title: "Provider title 原文", summary: "Updating the plan", details: [{ label: "Name", value: "vendor_future_Ω" }, { label: "Target", value: "/home/provider/raw" }],
    steps: [], children: [], links: [], transcriptIndex: 0,
  };
  const before = JSON.stringify(item);
  const english = providerActivityPresentation(item);
  await act(async () => { await i18n.changeLanguage(locale); });
  // The tool label is now localized separately; provider details remain raw.
  expect(providerActivityPresentation(item).detail).toBe(english.detail);
  expect(providerActivityPresentation(item).icon).toBe(english.icon);
  expect(JSON.stringify(item)).toBe(before);
});
