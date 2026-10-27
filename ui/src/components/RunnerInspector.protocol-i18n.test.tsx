// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { HeartbeatRunEvent } from "@paperclipai/shared";
import { MemoryRouter } from "@/lib/router";
import { ThemeProvider } from "@/context/ThemeContext";
import { TaskChatRunnerActivityGroup } from "./task-chat/TaskChatRunnerActivityGroup";
import type { TaskChatActivityPhaseItem } from "./task-chat/task-chat-model";
import { ProductionSurfacePreview } from "./RunnerInspector";
import { i18n, taskProtocolInspectorMessages as messages } from "@/i18n/task-protocol-inspector-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";

// No mocked parser, adapter, Card or dialog. All events and inline previews are synthetic.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Locale = keyof typeof messages;
const locales = Object.keys(messages) as Locale[];
let root: Root; let host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); await i18n.changeLanguage("en"); });
async function language(locale: Locale) { await act(async () => { await i18n.changeLanguage(locale); }); }
const nextLocale = (locale: Locale): Locale => locale === "ja" ? "es" : "ja";
function event(eventType: string, payload: Record<string, unknown>): HeartbeatRunEvent {
  return { id: 1, companyId: "synthetic-company", runId: "synthetic-run", agentId: "synthetic-agent", seq: 1,
    eventType, stream: "stdout", level: "info", color: null, message: null,
    payload: { prpEvent: { eventType, payload } }, createdAt: new Date("2026-10-27T00:00:00Z") };
}
async function render(input: HeartbeatRunEvent) {
  await act(async () => root.render(<MemoryRouter><ThemeProvider><ProductionSurfacePreview event={input} runId="synthetic-run" /></ThemeProvider></MemoryRouter>));
}

it.each(locales)("has safe complete resource parity in %s", locale => {
  expect(validateLocaleMessages(messages[locale], messages.en)).toEqual([]);
});

const providerCases = [
  { type: "plan.updated", payload: { steps: [{ stepId: "s1", body: "Plan steps", status: "in_progress" }] }, label: "planSteps", raw: "Plan steps" },
  { type: "delegation.completed", payload: { children: [{ childId: "c1", role: "Delegated agents", status: "completed", summary: "Provider summary 原文" }] }, label: "delegatedAgents", raw: "Delegated agents" },
  { type: "research.completed", payload: { sources: [{ title: "Research sources", url: "https://example.invalid/synthetic", snippet: "Provider snippet 原文" }] }, label: "researchSources", raw: "Research sources" },
  { type: "tool.execution.completed", payload: { output: "Output truncated to 8 KiB.", outputTruncated: true }, label: null, raw: "Output truncated to 8 KiB." },
] satisfies Array<{ type: string; payload: Record<string, unknown>; label: keyof typeof messages.en | null; raw: string }>;

it.each(locales.flatMap(locale => providerCases.map(test => ({ locale, ...test }))))("real inspector preview renders $type and hot-switches from $locale without altering provider content", async ({ locale, type, payload, label, raw }) => {
  await language(locale);
  const input = event(type, { ...payload, summary: "Details", status: "completed" });
  const before = JSON.stringify(input);
  await render(input);
  expect(host.querySelector('[data-testid^="task-chat-provider-"]')).not.toBeNull();
  const check = (locale: Locale) => {
    if (label) expect(host.querySelector(`[aria-label="${messages[locale][label]}"]`)).not.toBeNull();
    expect(host.textContent).toContain(raw);
    expect(host.querySelector("header p")?.textContent).toBe("Details");
    if (type === "tool.execution.completed") {
      expect(host.querySelector("summary")?.textContent?.trim()).toBe(messages[locale].details);
      expect(host.querySelector("details p")?.textContent?.trim()).toBe(messages[locale].outputTruncated);
      expect(host.querySelector("pre")?.textContent).toBe("Output truncated to 8 KiB.");
    }
  };
  check(locale);
  const details = host.querySelector("details");
  if (details) { await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); }); }
  const next = nextLocale(locale); await language(next); check(next);
  if (details) expect(host.querySelector("details")!.open).toBe(true);
  expect(JSON.stringify(input)).toBe(before);
});

it.each(locales.flatMap(locale => [false, true].map(withPreview => ({ locale, withPreview }))))("real inspector file preview with content=$withPreview survives language switch from $locale", async ({ locale, withPreview }) => {
  await language(locale);
  const input = event("workspace.file.referenced", { referenceId: "synthetic-ref", source: "runner_verified", path: "synthetic/Preview.txt", displayName: "Preview", presentation: "code", preview: withPreview ? "Preview truncated by the runner." : null, previewTruncated: true });
  const before = JSON.stringify(input);
  await render(input);
  const button = host.querySelector<HTMLButtonElement>('button')!;
  expect(button.textContent).toBe(messages[locale].preview);
  await act(async () => button.click());
  const check = (locale: Locale) => {
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector("h2")!.textContent).toBe("Preview");
    expect(dialog.textContent).toContain("synthetic/Preview.txt");
    expect(dialog.textContent).toContain(messages[locale].previewTruncated);
    if (withPreview) expect(dialog.querySelector("pre")!.textContent).toBe("Preview truncated by the runner.");
    else expect(dialog.textContent).toContain(messages[locale].previewUnavailable);
  };
  check(locale); const next = nextLocale(locale); await language(next); check(next);
  expect(host.querySelector("button")!.textContent).toBe(messages[next].preview);
  expect(JSON.stringify(input)).toBe(before);
  const close = document.querySelector<HTMLButtonElement>('[role="dialog"] button')!;
  await act(async () => close.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it.each(locales)("real inspector result keeps blocker and verification wire raw across locale switch from %s", async locale => {
  await language(locale);
  const input = event("run.result.proposed", { summary: "Run result", reportedWorkDisposition: "blocked", blocker: { reasonCode: "Blocked", unblockAction: "Run ended", scope: "task_wide" }, verification: [{ commandOrCheck: "Verification results", status: "passed", detail: "Details" }], completionClaim: { objectiveSatisfied: false, remainingWork: [{ description: "blocks completion", blocksCompletion: true }] }, artifacts: [{ kind: "document", ref: "raw/ref", title: "Preview" }] });
  const before = JSON.stringify(input); await render(input);
  const check = (locale: Locale) => {
    const card = host.querySelector('[data-testid="task-chat-run-result"]')!;
    expect(card.querySelector("h3")?.textContent ?? card.querySelector("header")!.textContent).toContain(messages[locale].runResult);
    expect(card.querySelector("header p")!.textContent).toBe("Run result");
    expect(card.querySelectorAll("strong")[1].textContent).toBe(messages[locale].blockedReason.replace("{{reason}}", "Blocked"));
    expect(card.querySelector(`[aria-label="${messages[locale].verificationResults}"]`)!.textContent).toContain("Verification results");
    expect(card.textContent).toContain("blocks completion" + messages[locale].blocksCompletion);
    for (const raw of ["Run ended", "Details", "Preview", "blocked"]) expect(card.textContent).toContain(raw);
  };
  check(locale); await language(nextLocale(locale)); check(nextLocale(locale)); expect(JSON.stringify(input)).toBe(before);
});

it.each(locales)("real inspector terminal keeps raw status/reason while translating its title from %s", async locale => {
  await language(locale);
  const input = event("run.terminal", { turnTerminalState: "failed", runTerminalState: "failed", reportedWorkDisposition: "blocked", stopReason: { code: "Run ended" } });
  const before = JSON.stringify(input); await render(input);
  for (const target of [locale, nextLocale(locale)]) {
    await language(target);
    const card = host.querySelector('[data-testid="task-chat-run-terminal"]')!;
    expect(card.querySelector("header")!.textContent).toContain(messages[target].runEnded);
    expect(card.querySelector("header p")!.textContent).toBe("blocked · Run ended");
    expect(card.textContent).toContain("failed");
  }
  expect(JSON.stringify(input)).toBe(before);
});

it("keeps the production inspector selection-to-preview wiring reachable from AgentDetail RunDetail", () => {
  const page = readFileSync("src/pages/AgentDetail.tsx", "utf8");
  const inspector = readFileSync("src/components/RunnerInspector.tsx", "utf8");
  expect(page).toMatch(/onClick=\{\(\) => setInspectorOpen\(true\)\}[\s\S]*?workflow\.inspectRun/);
  expect(page).toMatch(/<RunnerInspector[\s\S]*?runId=\{run.id\}[\s\S]*?open=\{inspectorOpen\}/);
  expect(inspector).toContain('const selectedEvents = selectedOperation?.events ?? [];');
  expect(inspector).toContain('selectedEvents.length ? selectedEvents.map((event) => {');
  expect(inspector).toContain('<ProductionSurfacePreview event={event} runId={runId} />');
  expect(inspector).toContain('candidate.kind === "protocol"');
  expect(inspector).toContain('if (item) return <TaskChatProtocolCard item={item} />');
});


it.each(locales.flatMap(locale => (["allowed", "rejected"] as const).map(decision => ({ locale, decision }))))("explicit Lab-style Group fixture translates only permission prefix ($decision, $locale)", async ({ locale, decision }) => {
  // Capability test only: no claim that a production adapter supplies item.decision.
  await language(locale);
  const item: TaskChatActivityPhaseItem = { id: "fixture-phase", kind: "activity_phase", summary: "", active: false, items: [{ id: "fixture-tool", kind: "tool", name: "exec_command", status: "completed", detail: "Permission", decision }] };
  const before = JSON.stringify(item);
  await act(async () => root.render(<TaskChatRunnerActivityGroup item={item} defaultExpanded />));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-activity-item-id="fixture-tool"] button')!.click());
  for (const target of [locale, nextLocale(locale)]) {
    await language(target);
    const detail = host.querySelector('[data-testid="task-chat-runner-activity-detail"]')!;
    expect(detail.querySelector("p")!.textContent).toBe(messages[target].permissionDecision.replace("{{decision}}", decision));
    expect(detail.querySelector("pre")!.textContent).toBe("Permission");
  }
  expect(JSON.stringify(item)).toBe(before);
});
