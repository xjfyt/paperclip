// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TranscriptEntry } from "@/adapters";
import { ThemeProvider } from "@/context/ThemeContext";
import { MemoryRouter } from "@/lib/router";
import { i18n, taskProtocolRuntimeMessages } from "@/i18n/task-protocol-runtime-test-resources";
import { TaskChatProtocolCard, type TaskChatProtocolCardProps } from "./TaskChatProtocolCard";
import { TaskChatRunnerTurn } from "./TaskChatRunnerTurn";
import { buildTurnTimelineRows, transcriptToTaskChatItems } from "./transcript-adapter";
import type { TaskChatRuntimeRequestItem } from "./task-chat-model";
let root: Root; let host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => {
  await act(async () => { root.unmount(); }); host.remove();
  await act(async () => { await i18n.changeLanguage("en"); });
  vi.unstubAllGlobals();
});
function request(overrides: Partial<TaskChatRuntimeRequestItem> = {}): TaskChatRuntimeRequestItem {
  return { id: "original-card", kind: "protocol", surface: "runtime_request", runId: "original-run", requestId: "original-request",
    requestKind: "user_input", turnId: "original-turn", requestType: "input", status: "pending", prompt: "Provider prompt Ω <tag>",
    choices: [{ key: "decline", label: "Deny" }], fields: [], ...overrides };
}
async function render(item: TaskChatRuntimeRequestItem, onDecision?: TaskChatProtocolCardProps["onRuntimeRequestDecision"]) {
  await act(async () => { root.render(<MemoryRouter><ThemeProvider><TaskChatProtocolCard item={item} onRuntimeRequestDecision={onDecision} /></ThemeProvider></MemoryRouter>); });
}
function button(text: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll("button")).find(node => node.textContent === text);
  expect(found, text).toBeDefined(); return found!;
}
it.each(Object.entries(taskProtocolRuntimeMessages))("preserves explicit provider labels and action wire while local controls switch in %s", async (locale, messages) => {
  await act(async () => { await i18n.changeLanguage(locale); });
  const onDecision = vi.fn<NonNullable<TaskChatProtocolCardProps["onRuntimeRequestDecision"]>>().mockResolvedValue(undefined);
  const item = request({ fields: [{ name: "original-field", label: "Response", placeholder: "Runtime input" }] });
  const original = JSON.stringify(item);
  await render(item, onDecision);
  expect(host.querySelector("label span")?.textContent).toBe("Response");
  expect(host.querySelector("textarea")?.placeholder).toBe("Runtime input");
  expect(host.textContent).toContain(messages.runtimeInput);
  await act(async () => { button(messages.deny).click(); });
  expect(onDecision).toHaveBeenCalledExactlyOnceWith(item, { action: "decline" });
  await render({ ...item, requestId: "second-request" }, onDecision);
  await act(async () => { button(messages.cancel).click(); });
  expect(onDecision).toHaveBeenLastCalledWith({ ...item, requestId: "second-request" }, { action: "cancel" });
  const permission = request({ requestId: "permission", requestType: "permission", requestKind: "permission_approval", choices: [{ key: "accept_for_session", label: "Allow for session" }] });
  await render(permission, onDecision);
  expect(host.textContent).toContain(messages.runtimePermission);
  expect(button("Allow for session").disabled).toBe(false);
  await act(async () => { button("Allow for session").click(); });
  expect(onDecision).toHaveBeenLastCalledWith(permission, { action: "accept_for_session" });
  expect(onDecision).toHaveBeenCalledTimes(3); expect(JSON.stringify(item)).toBe(original);
});

it.each(Object.entries(taskProtocolRuntimeMessages))("renders closed question receipts through the actual adapter and runner in %s", async (locale, messages) => {
  await act(async () => { await i18n.changeLanguage(locale); });
  for (const status of ["resolved", "cancelled", "expired"] as const) {
    for (const recorded of [false, true]) {
      const entry: Extract<TranscriptEntry, { kind: "runtime_request" }> = {
        kind: "runtime_request", ts: "2026-10-27T00:00:00Z", requestId: `original-${status}-${recorded}`, requestKind: "user_input",
        turnId: "original-turn", requestType: "input", status, prompt: "Provider prompt Ω", choices: [], fields: [],
        questionSet: { schema: "paperclip.question_set.v1", ...(recorded ? { title: "Runtime input" } : {}),
          questions: [{ id: "original-question", prompt: "Provider question Ω", required: true, answerMode: "single_select",
            options: [{ id: "original-option", label: "Questions answered" }] }] },
        response: recorded ? { schema: "paperclip.question_response.v1", answers: { "original-question": { selectedOptionIds: ["original-option"], customText: "Original answer Ω" } } } : null,
      };
      const original = JSON.stringify(entry);
      const items = transcriptToTaskChatItems([entry], { runId: "original-run", agentName: "Original agent", running: false });
      expect(buildTurnTimelineRows(items, false)).toHaveLength(1);
      const onDecision = vi.fn();
      await act(async () => { root.render(<MemoryRouter><ThemeProvider><TaskChatRunnerTurn runId="original-run" startedAtMs={null} agentName="Original agent" items={items} status="succeeded" onRuntimeRequestDecision={onDecision} /></ThemeProvider></MemoryRouter>); });
      const receipt = host.querySelector<HTMLDetailsElement>('[data-testid="task-chat-runtime-request"]')!;
      const labelKey = status === "resolved" ? "questionsAnswered" : status === "cancelled" ? "questionsCancelled" : "questionsExpired";
      expect(receipt.querySelector("summary")?.textContent).toBe(messages[labelKey]);
      expect(receipt.open).toBe(false);
      await act(async () => { receipt.querySelector("summary")!.click(); });
      expect(receipt.open).toBe(true);
      expect(receipt.textContent).toContain("Provider prompt Ω"); expect(receipt.textContent).toContain("Provider question Ω");
      if (recorded) { expect(receipt.textContent).toContain("Questions answered"); expect(receipt.textContent).toContain("Original answer Ω"); }
      else expect(receipt.textContent).toContain(status === "resolved" ? messages.legacyAnswers : messages[`noAnswers_${status}`]);
      const nextLocale = locale === "ja" ? "es" : "ja";
      await act(async () => { await i18n.changeLanguage(nextLocale); });
      expect(receipt.open).toBe(true);
      expect(receipt.querySelector("summary")?.textContent).toBe(taskProtocolRuntimeMessages[nextLocale][labelKey]);
      expect(receipt.textContent).toContain(recorded ? "Runtime input" : taskProtocolRuntimeMessages[nextLocale].runtimeInput);
      expect(onDecision).not.toHaveBeenCalled(); expect(JSON.stringify(entry)).toBe(original);
      await act(async () => { receipt.querySelector("summary")!.click(); await i18n.changeLanguage(locale); });
    }
  }
});

it.each(Object.entries(taskProtocolRuntimeMessages))("localizes known receipt statuses without permitting closed actions in %s", async (locale, messages) => {
  await act(async () => { await i18n.changeLanguage(locale); });
  expect(Object.keys(messages).sort()).toEqual(Object.keys(taskProtocolRuntimeMessages.en).sort());
  for (const status of ["pending", "resolved", "expired", "cancelled"] as const) {
    await render(request({ requestType: "permission", status }));
    expect(host.textContent).toContain(messages[`status_${status}`]);
    expect(Array.from(host.querySelectorAll("button")).every(button => button.disabled)).toBe(true);
    if (status === "pending") expect(host.textContent).toContain(messages.resolveInSession);
  }
});
