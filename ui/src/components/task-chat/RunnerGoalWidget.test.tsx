// @vitest-environment jsdom
import { i18n, taskThreadGoalMessages } from "@/i18n/task-thread-goal-test-resources";
import { createRunnerGoalLocalError, runnerGoalErrorDescriptor } from "@/i18n/runner-goal-feedback";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerGoalProjection } from "@paperclipai/shared";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { RunnerGoalWidget, useRunnerGoalControl } from "./RunnerGoalWidget";

vi.mock("@/api/issues", () => ({ issuesApi: { getRunnerGoal: vi.fn(), actOnRunnerGoal: vi.fn() } }));
vi.mock("@/context/LiveUpdatesProvider", () => ({ useCompanyLiveEvent: vi.fn() }));

const projection: RunnerGoalProjection = {
  issueId: "issue-goal", agentId: "agent-goal", adapterType: "paperclip_runner", sessionId: "session-goal",
  capability: { availability: "available", verified: true, actions: ["set", "pause", "resume", "clear"], autonomousUpdates: true,
    persistentAcrossResume: true, maxObjectiveChars: 4_000, tokenBudgetControl: true, usageReporting: true },
  goal: { objective: "Original objective", status: "active", tokenBudget: null, tokensUsed: 20, elapsedSeconds: 2,
    iterations: 1, lastReason: null, createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:02Z",
    completedAt: null, workingNow: false },
  workingNow: false, activeRunId: null, pendingAction: null, revision: 7, observedAt: "2026-09-08T00:00:02Z",
};

const rejectionObserver = vi.fn();
function Harness({ agentId = "agent-goal" }: { agentId?: string }) {
  const control = useRunnerGoalControl("issue-goal", agentId);
  const [commandError, setCommandError] = useState<string | null>(null);
  return <>
    <button data-testid="pause-source" data-current-goal-agent={control.data?.agentId ?? ""} onClick={() => void control.executeAction("pause").catch(rejectionObserver)}>Pause fixture</button>
    <button onClick={() => void control.executeComposerCommand({ action: "create", objective: "Replacement objective" }).catch((error) => setCommandError(error.message))}>Request replacement</button>
    <button onClick={() => void control.executeComposerCommand({ action: "focus" }).catch((error) => setCommandError(error.message))}>Focus goal</button>
    {commandError ? <p role="alert">{commandError}</p> : null}
    <RunnerGoalWidget control={control} />
  </>;
}

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
function button(name: string) {
  const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) =>
    (node.getAttribute("aria-label") ?? node.textContent?.trim()) === name);
  if (!element) throw new Error(`Missing button: ${name}`);
  return element;
}
async function click(name: string) { await act(async () => { button(name).click(); }); }
async function objective(value: string) {
  await act(async () => {
    const field = document.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function render(agentId = "agent-goal") {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><Harness agentId={agentId} /></QueryClientProvider>);
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(queryKeys.issues.runnerGoal("issue-goal", "agent-goal"), projection);
  vi.mocked(issuesApi.getRunnerGoal).mockResolvedValue(projection);
  vi.mocked(issuesApi.actOnRunnerGoal).mockResolvedValue({ projection, accepted: true } as never);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

describe("session goal dialogs", () => {
  it("hides the widget after an expanded goal is cleared", async () => {
    await click("Focus goal");
    vi.mocked(issuesApi.actOnRunnerGoal).mockResolvedValue({
      accepted: true, projection: { ...projection, goal: null, revision: 8 },
    } as never);
    await click("Clear goal");
    await vi.waitFor(() => expect(document.querySelector('[data-testid="runner-goal-widget"]')).toBeNull());
  });

  it("does not show an empty card when /goal has no current goal to focus", async () => {
    await act(async () => {
      client.setQueryData(queryKeys.issues.runnerGoal("issue-goal", "agent-goal"), { ...projection, goal: null });
    });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="runner-goal-widget"]')).toBeNull());
    await click("Focus goal");
    expect(document.querySelector('[data-testid="runner-goal-widget"]')).toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Add an objective after /goal");
    expect(issuesApi.actOnRunnerGoal).not.toHaveBeenCalled();
  });

  it("keeps a pending goal action visible without a goal snapshot", async () => {
    await act(async () => {
      client.setQueryData(queryKeys.issues.runnerGoal("issue-goal", "agent-goal"), {
        ...projection, goal: null, pendingAction: "starting",
      });
    });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="runner-goal-widget"]')?.textContent).toContain("Starting"));
  });

  it("shows action errors without leaving behind an empty informational card", async () => {
    await act(async () => {
      client.setQueryData(queryKeys.issues.runnerGoal("issue-goal", "agent-goal"), { ...projection, goal: null });
    });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="runner-goal-widget"]')).toBeNull());
    vi.mocked(issuesApi.actOnRunnerGoal).mockRejectedValue(new Error("Session is unavailable."));
    await click("Request replacement");
    await vi.waitFor(() => expect(document.querySelector('[data-testid="runner-goal-widget"]')?.textContent).toContain("Session is unavailable."));
  });

  it("opens a prefilled in-app editor and saves with the reviewed revision", async () => {
    await click("Edit goal");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Edit session goal");
    expect(document.querySelector("textarea")?.value).toBe("Original objective");
    await objective("Revised objective");
    await click("Save goal");
    expect(issuesApi.actOnRunnerGoal).toHaveBeenCalledWith("issue-goal", expect.objectContaining({
      action: "edit", objective: "Revised objective", expectedRevision: 7, agentId: "agent-goal",
    }));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });

  it("requires explicit replacement confirmation and lets cancellation preserve the goal", async () => {
    await click("Request replacement");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Replace session goal?");
    expect(document.querySelector("textarea")?.value).toBe("Replacement objective");
    expect(issuesApi.actOnRunnerGoal).not.toHaveBeenCalled();
    await click("Cancel");
    expect(issuesApi.actOnRunnerGoal).not.toHaveBeenCalled();
    await click("Request replacement");
    await click("Replace goal");
    expect(issuesApi.actOnRunnerGoal).toHaveBeenCalledWith("issue-goal", expect.objectContaining({
      action: "replace", objective: "Replacement objective", confirmReplace: true, expectedRevision: 7,
    }));
  });

  it("rejects whitespace and retains edited text with a visible server error", async () => {
    vi.mocked(issuesApi.actOnRunnerGoal).mockRejectedValue(new Error("Goal changed; reopen the editor to review the latest goal."));
    await click("Edit goal");
    await objective("   ");
    expect(button("Save goal").disabled).toBe(true);
    await objective("Keep my draft");
    await click("Save goal");
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Goal changed"));
    expect(document.querySelector("textarea")?.value).toBe("Keep my draft");
    await click("Cancel");
    await click("Edit goal");
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Goal changed");
    await click("Cancel");
    await click("Request replacement");
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("Goal changed");
  });

  it("dismisses an editor when the selected agent changes", async () => {
    await click("Edit goal");
    await render("another-agent");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(issuesApi.actOnRunnerGoal).not.toHaveBeenCalled();
  });
});


describe("session goal source localization", () => {
  const locales = ["en", "zh-CN", "es", "ja"] as const;
  afterEach(async () => { await i18n.changeLanguage("en"); });
  it.each(locales)("validates goal copy and exact local Error provenance in %s", async locale => {
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(validateLocaleMessages(taskThreadGoalMessages[locale], taskThreadGoalMessages.en)).toEqual([]);
    const local = createRunnerGoalLocalError("selectAgent"); expect(local.message).toBe(taskThreadGoalMessages.en.selectAgent); expect(Object.keys(local)).toEqual([]);
    expect(runnerGoalErrorDescriptor(local)).toEqual({ key: "taskThreadGoalUi.selectAgent" }); expect(runnerGoalErrorDescriptor(new Error(local.message))).toBeNull();
  });
  it.each(locales)("retains raw objective and numeric request identity while editing through %s", async locale => {
    await act(async () => { await i18n.changeLanguage(locale); });
    let reject!: (cause: unknown) => void; const pending = new Promise<never>((_, r) => { reject = r; });
    const cause = Object.assign(new Error(taskThreadGoalMessages.en.selectAgent), { code: "provider_code", cause: { raw: true } });
    vi.mocked(issuesApi.actOnRunnerGoal).mockReturnValue(pending);
    await click(taskThreadGoalMessages[locale].edit); const draft = "Raw objective **原文** $1,234.00"; await objective(draft);
    const field = document.querySelector<HTMLTextAreaElement>("textarea")!; field.focus(); const next = locale === "ja" ? "es" : "ja";
    await act(async () => { await i18n.changeLanguage(next); }); expect(document.querySelector("textarea")).toBe(field); expect(document.activeElement).toBe(field); expect(field.value).toBe(draft); expect(issuesApi.actOnRunnerGoal).not.toHaveBeenCalled();
    await click(taskThreadGoalMessages[next].save); await vi.waitFor(() => expect(issuesApi.actOnRunnerGoal).toHaveBeenCalledTimes(1));
    const request = vi.mocked(issuesApi.actOnRunnerGoal).mock.calls[0][1]; expect(request).toMatchObject({ agentId: "agent-goal", expectedRevision: 7, action: "edit", objective: draft }); expect(typeof request.requestId).toBe("string");
    await act(async () => { await i18n.changeLanguage(locale); }); expect(button(taskThreadGoalMessages[locale].savingPending).disabled).toBe(true); expect(field.value).toBe(draft); expect(issuesApi.actOnRunnerGoal).toHaveBeenCalledTimes(1);
    await act(async () => { reject(cause); await pending.catch(() => undefined); }); await vi.waitFor(() => expect(button(taskThreadGoalMessages[locale].save).disabled).toBe(false));
    expect(document.body.textContent).toContain(cause.message); expect(field.value).toBe(draft); expect(cause.code).toBe("provider_code"); expect(vi.mocked(issuesApi.actOnRunnerGoal).mock.calls[0][1]).toBe(request);
  });
  it.each(locales)("rerenders retained local failures but rethrows the same Error in %s", async locale => {
    await act(async () => { await i18n.changeLanguage(locale); client.setQueryData(queryKeys.issues.runnerGoal("issue-goal", "agent-goal"), { ...projection, agentId: null }); });
    await vi.waitFor(() => expect(container.querySelector<HTMLElement>('[data-testid="pause-source"]')?.dataset.currentGoalAgent).toBe(""));
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="pause-source"]')!.click());
    await vi.waitFor(() => expect(rejectionObserver).toHaveBeenCalledTimes(1)); const error = rejectionObserver.mock.calls[0][0]; expect(error.message).toBe(taskThreadGoalMessages.en.selectAgent); expect(runnerGoalErrorDescriptor(error)).toEqual({ key: "taskThreadGoalUi.selectAgent" });
    expect(container.textContent).toContain(taskThreadGoalMessages[locale].selectAgent); const next = locale === "ja" ? "es" : "ja";
    await act(async () => { await i18n.changeLanguage(next); }); expect(container.textContent).toContain(taskThreadGoalMessages[next].selectAgent); expect(rejectionObserver.mock.calls[0][0]).toBe(error); expect(rejectionObserver).toHaveBeenCalledTimes(1); expect(issuesApi.actOnRunnerGoal).not.toHaveBeenCalled();
  });
  it.each(locales)("preserves a provider Error object whose message matches local copy in %s", async locale => {
    await act(async () => { await i18n.changeLanguage(locale); });
    const cause = Object.assign(new Error(taskThreadGoalMessages.en.unsupported), { code: "provider-raw", cause: { nested: "original" } });
    vi.mocked(issuesApi.actOnRunnerGoal).mockRejectedValue(cause); await click("Pause fixture"); await vi.waitFor(() => expect(rejectionObserver).toHaveBeenCalledExactlyOnceWith(cause));
    const next = locale === "ja" ? "es" : "ja"; await act(async () => { await i18n.changeLanguage(next); });
    expect(container.textContent).toContain(cause.message); expect(runnerGoalErrorDescriptor(cause)).toBeNull(); expect(cause.cause).toEqual({ nested: "original" }); expect(issuesApi.actOnRunnerGoal).toHaveBeenCalledTimes(1);
  });
  it.each(locales)("formats display numbers without translating goal status, objective or provider reason in %s", async locale => {
    const data = { ...projection, pendingAction: "pausing" as const, goal: { ...projection.goal!, status: "usage_limited" as const, objective: "Session goal", lastReason: "The goal action could not be applied.", tokensUsed: 12345, tokenBudget: 67890, elapsedSeconds: 3660, iterations: 1234 } }; const before = JSON.stringify(data);
    await act(async () => { await i18n.changeLanguage(locale); client.setQueryData(queryKeys.issues.runnerGoal("issue-goal", "agent-goal"), data); });
    await vi.waitFor(() => expect(container.textContent).toContain("usage limited")); expect(container.textContent).toContain("Session goal"); expect(container.textContent).toContain(data.goal.lastReason); expect(container.textContent).toContain(taskThreadGoalMessages[locale].pausing);
    expect(container.textContent).toContain(new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 0 }).format(12345)); expect(container.textContent).toContain(new Intl.NumberFormat(locale).format(1234)); expect(JSON.stringify(data)).toBe(before); expect(issuesApi.actOnRunnerGoal).not.toHaveBeenCalled();
  });
});
