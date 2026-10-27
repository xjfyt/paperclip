// @vitest-environment jsdom
import "@/i18n/question-form-test-resources";
import { act, forwardRef, StrictMode, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MarkdownEditorRef } from "@/components/MarkdownEditor";
import { ThemeProvider } from "@/context/ThemeContext";
import { MemoryRouter } from "@/lib/router";
import { loadDraft, loadStructuredDraft, saveStructuredDraft } from "@/lib/composer-draft";
import { i18n } from "@/i18n/task-protocol-runtime-test-resources";
import { TaskChatProtocolCard, type TaskChatProtocolCardProps } from "./TaskChatProtocolCard";
import type { TaskChatRuntimeRequestItem } from "./task-chat-model";

vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: forwardRef<MarkdownEditorRef, { value: string; onChange: (value: string) => void }>(function Editor({ value, onChange }, ref) {
    useImperativeHandle(ref, () => ({ focus() {}, insertMarkdown(markdown) { onChange(value + markdown); }, clear() { onChange(""); } }));
    return <textarea data-testid="answer-editor" value={value} onChange={event => onChange(event.target.value)} />;
  }),
}));
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); await i18n.changeLanguage("en"); }); host.remove(); localStorage.clear(); vi.unstubAllGlobals();
});
const originalDraft = { page: 1, answers: { shared: { selectedOptionIds: ["original-option"], customText: "Original custom Ω" }, notes: { text: "Original notes Ω" } }, customActive: { shared: true } };
function request(overrides: Partial<TaskChatRuntimeRequestItem> = {}): TaskChatRuntimeRequestItem {
  return { id: "original-card", kind: "protocol", surface: "runtime_request", runId: "original-run", requestId: "original-request", turnId: "original-turn",
    requestKind: "runtime", requestType: "input", status: "pending", prompt: "Original prompt", choices: [], fields: [],
    questionSet: { schema: "paperclip.question_set.v1", submitLabel: "Send original", questions: [
      { id: "shared", prompt: "Original options", answerMode: "single_select", required: true, options: [{ id: "original-option", label: "Original option" }], customAnswer: { enabled: true, label: "Other original" } },
      { id: "notes", prompt: "Original notes", answerMode: "text", required: true, initialText: "Original default" },
    ] }, ...overrides };
}
function deferred() {
  let resolve!: () => void; let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
async function render(item: TaskChatRuntimeRequestItem, draftKey: string, onDecision: NonNullable<TaskChatProtocolCardProps["onRuntimeRequestDecision"]>, presentation: "timeline" | "takeover" = "takeover") {
  await act(async () => { root.render(<StrictMode><MemoryRouter><ThemeProvider><TaskChatProtocolCard item={item} draftKey={draftKey} presentation={presentation} onRuntimeRequestDecision={onDecision} /></ThemeProvider></MemoryRouter></StrictMode>); });
}
function button(text: string) {
  const found = Array.from(host.querySelectorAll("button")).find(node => node.textContent?.trim() === text);
  expect(found, text).toBeDefined(); return found!;
}
async function edit(text: string) {
  const field = host.querySelector<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it.each(["submit", "cancel"] as const)("keeps structured %s failures visible and drafts intact until actual success", async action => {
  const pending = deferred();
  const onDecision = vi.fn<NonNullable<TaskChatProtocolCardProps["onRuntimeRequestDecision"]>>().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
  saveStructuredDraft("original-draft", originalDraft);
  const item = request(); const original = JSON.stringify(item);
  await render(item, "original-draft", onDecision, "timeline");
  expect(host.querySelector("textarea")?.value).toBe("Original notes Ω");
  await act(async () => { button(action === "submit" ? "Send original" : "Cancel").click(); });
  expect(onDecision).toHaveBeenCalledExactlyOnceWith(item, action === "submit" ? { action: "submit", response: { schema: "paperclip.question_response.v1", answers: originalDraft.answers } } : { action: "cancel" });
  await act(async () => { await i18n.changeLanguage("ja"); });
  expect(onDecision).toHaveBeenCalledTimes(1);
  const cause = new Error("Original server diagnostic Ω <tag>");
  await act(async () => { pending.reject(cause); });
  expect(loadStructuredDraft("original-draft", null)).toEqual(originalDraft);
  expect(host.querySelectorAll('[role="alert"], [aria-live="assertive"] > div')).toHaveLength(1);
  expect(host.querySelector('[role="alert"], [aria-live="assertive"] > div')?.textContent).toBe(cause.message);
  expect(host.querySelector("textarea")?.value).toBe("Original notes Ω");
  await act(async () => { await i18n.changeLanguage("en"); });
  await act(async () => { button(action === "submit" ? "Send original" : "Cancel").click(); });
  expect(onDecision).toHaveBeenCalledTimes(2);
  expect(loadDraft("original-draft")).toBe("");
  expect(host.querySelector('[role="alert"], [aria-live="assertive"] > div')).toBeNull(); expect(JSON.stringify(item)).toBe(original);
});

it("does not erase structured answers on a non-Error runtime rejection", async () => {
  saveStructuredDraft("non-error-draft", originalDraft);
  const onDecision = vi.fn<NonNullable<TaskChatProtocolCardProps["onRuntimeRequestDecision"]>>().mockRejectedValue({ original: "opaque-failure" });
  await render(request(), "non-error-draft", onDecision);
  await act(async () => { button("Send original").click(); });
  expect(loadStructuredDraft("non-error-draft", null)).toEqual(originalDraft);
  expect(host.querySelector('[role="alert"], [aria-live="assertive"] > div')?.textContent).toBe("The answers could not be submitted.");
  expect(host.textContent).not.toContain("opaque-failure"); expect(onDecision).toHaveBeenCalledTimes(1);
});

it.each([false, true])("isolates restored drafts across request/run/turn scopes (structured=%s)", async structured => {
  const first = structured ? originalDraft : { answer: "Original A Ω" };
  const second = structured ? { ...originalDraft, answers: { ...originalDraft.answers, notes: { text: "Original B Ω" } } } : { answer: "Original B Ω" };
  saveStructuredDraft("draft-A", first); saveStructuredDraft("draft-B", second);
  const onDecision = vi.fn();
  const itemA = request(structured ? {} : { questionSet: null, requestKind: "user_input" });
  const itemB = { ...itemA, runId: "run-B", turnId: "turn-B" };
  await render(itemA, "draft-A", onDecision);
  await render(itemB, "draft-B", onDecision);
  expect(host.querySelector("textarea")?.value).toBe("Original B Ω");
  expect(loadStructuredDraft("draft-A", null)).toEqual(first);
  expect(loadStructuredDraft("draft-B", null)).toEqual(second);
  await edit("New B Ω");
  await render(itemA, "draft-A", onDecision);
  expect(host.querySelector("textarea")?.value).toBe(structured ? "Original notes Ω" : "Original A Ω");
  expect(onDecision).not.toHaveBeenCalled();
});

it.each(["success", "failure"] as const)("ignores late %s after same-key unmount and remount without inventing a failure", async outcome => {
  saveStructuredDraft("shared-draft", originalDraft);
  const old = deferred();
  const onDecision = vi.fn<NonNullable<TaskChatProtocolCardProps["onRuntimeRequestDecision"]>>().mockReturnValueOnce(old.promise);
  const item = request(); await render(item, "shared-draft", onDecision);
  await act(async () => { button("Send original").click(); });
  await act(async () => { root.render(<div />); });
  await render(item, "shared-draft", onDecision);
  await edit("New same-key draft Ω"); const latest = loadDraft("shared-draft");
  await act(async () => { if (outcome === "success") old.resolve(); else old.reject(new Error("Old request error")); });
  expect(loadDraft("shared-draft")).toBe(latest);
  expect(host.querySelector("textarea")?.value).toBe("New same-key draft Ω");
  expect(host.querySelector('[role="alert"], [aria-live="assertive"] > div')).toBeNull(); expect(button("Send original").disabled).toBe(false);
  expect(onDecision).toHaveBeenCalledTimes(1);
});

it.each(["structured", "legacy", "permission"] as const)("dispatches only one %s attempt for two clicks in the same act", async mode => {
  const pending = deferred();
  const onDecision = vi.fn<NonNullable<TaskChatProtocolCardProps["onRuntimeRequestDecision"]>>().mockReturnValue(pending.promise);
  saveStructuredDraft("double-draft", mode === "structured" ? originalDraft : { answer: "Original answer" });
  const item = request(mode === "structured" ? {} : mode === "legacy" ? { questionSet: null, requestKind: "user_input" } : { questionSet: null, requestType: "permission", requestKind: "permission_approval", choices: [{ key: "accept", label: "Original allow" }] });
  await render(item, "double-draft", onDecision);
  const action = button(mode === "structured" ? "Send original" : mode === "legacy" ? "Submit response" : "Original allow");
  const draft = loadDraft("double-draft");
  await act(async () => { action.click(); action.click(); });
  expect(onDecision).toHaveBeenCalledTimes(1); expect(loadDraft("double-draft")).toBe(draft);
  await act(async () => { pending.resolve(); });
  expect(loadDraft("double-draft")).toBe("");
  expect(action.disabled).toBe(true);
});

it.each(["success", "failure"] as const)("defensively fences a late %s when only run/turn identity changes with the same draft key", async outcome => {
  saveStructuredDraft("same-scope-key", { answer: "Original A" });
  const old = deferred(); const next = deferred();
  const onDecision = vi.fn<NonNullable<TaskChatProtocolCardProps["onRuntimeRequestDecision"]>>().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const itemA = request({ questionSet: null, requestKind: "user_input" });
  await render(itemA, "same-scope-key", onDecision);
  await act(async () => { button("Submit response").click(); });
  const itemB = { ...itemA, runId: "run-B", turnId: "turn-B" };
  await render(itemB, "same-scope-key", onDecision);
  expect(host.querySelector("textarea")?.disabled).toBe(false);
  await edit("New B answer");
  const latest = loadDraft("same-scope-key");
  await act(async () => { button("Submit response").click(); });
  expect(onDecision).toHaveBeenLastCalledWith(itemB, { action: "submit", values: { answer: "New B answer" } });
  await act(async () => { if (outcome === "success") old.resolve(); else old.reject(new Error("Old scoped error")); });
  expect(loadDraft("same-scope-key")).toBe(latest); expect(host.querySelector('[role="alert"], [aria-live="assertive"] > div')).toBeNull();
  expect(host.querySelector("textarea")?.disabled).toBe(true);
  await act(async () => { next.resolve(); });
  expect(loadDraft("same-scope-key")).toBe(""); expect(onDecision).toHaveBeenCalledTimes(2);
});


it("lets the structured form persist its initial schema without a legacy parent overwrite", async () => {
  const item = request({ questionSet: { schema: "paperclip.question_set.v1", questions: [
    { id: "shared", prompt: "Original question", answerMode: "text", required: true, initialText: "Original initial Ω" },
  ] } });
  await render(item, "fresh-structured", vi.fn());
  expect(loadStructuredDraft("fresh-structured", null)).toEqual({ page: 0, answers: { shared: { text: "Original initial Ω" } }, customActive: {} });
});

it("keeps an attempt fenced across locale and equivalent question object refreshes", async () => {
  saveStructuredDraft("refresh-draft", originalDraft);
  const pending = deferred(); const onDecision = vi.fn().mockReturnValue(pending.promise);
  const item = request(); await render(item, "refresh-draft", onDecision);
  await act(async () => { button("Send original").click(); });
  await act(async () => { await i18n.changeLanguage("ja"); });
  await render(structuredClone(item), "refresh-draft", onDecision);
  expect(button("Send original").disabled).toBe(true);
  expect(onDecision).toHaveBeenCalledTimes(1);
  await act(async () => { pending.reject(new Error("Original refresh error")); });
  expect(host.textContent).toContain("Original refresh error");
  expect(loadStructuredDraft("refresh-draft", null)).toEqual(originalDraft);
});

it.each(["success", "failure"] as const)("fences a late cancel %s after reopening the same draft", async outcome => {
  saveStructuredDraft("cancel-draft", originalDraft);
  const pending = deferred(); const onDecision = vi.fn().mockReturnValue(pending.promise);
  const item = request(); await render(item, "cancel-draft", onDecision, "timeline");
  await act(async () => { button("Cancel").click(); button("Cancel").click(); });
  expect(onDecision).toHaveBeenCalledExactlyOnceWith(item, { action: "cancel" });
  await act(async () => { root.render(<div />); });
  await render(item, "cancel-draft", onDecision, "timeline");
  await edit("Reopened cancel draft Ω"); const latest = loadDraft("cancel-draft");
  await act(async () => { if (outcome === "success") pending.resolve(); else pending.reject(new Error("Old cancel error")); });
  expect(loadDraft("cancel-draft")).toBe(latest);
  expect(host.textContent).not.toContain("Old cancel error"); expect(button("Cancel").disabled).toBe(false);
});

it.each(["success", "failure"] as const)("protects both structured drafts when a pending request switches before late %s", async outcome => {
  saveStructuredDraft("pending-A", originalDraft);
  const draftB = { ...originalDraft, answers: { ...originalDraft.answers, notes: { text: "Original B notes" } } };
  saveStructuredDraft("pending-B", draftB);
  const old = deferred(); const next = deferred();
  const onDecision = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const itemA = request(); await render(itemA, "pending-A", onDecision);
  await act(async () => { button("Send original").click(); });
  const itemB = request({ requestId: "request-B" }); await render(itemB, "pending-B", onDecision);
  expect(host.querySelector("textarea")?.value).toBe("Original B notes");
  await edit("New B notes Ω"); const latest = loadDraft("pending-B");
  await act(async () => { button("Send original").click(); });
  expect(onDecision).toHaveBeenCalledTimes(2);
  await act(async () => { if (outcome === "success") old.resolve(); else old.reject(new Error("Old A failure")); });
  expect(loadStructuredDraft("pending-A", null)).toEqual(originalDraft);
  expect(loadDraft("pending-B")).toBe(latest);
  expect(button("Send original").disabled).toBe(true); expect(host.textContent).not.toContain("Old A failure");
  await act(async () => { next.resolve(); });
  expect(loadDraft("pending-B")).toBe("");
});
