// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskChatQueuedMessages, reorderQueuedMessageEntries } from "./TaskChatQueuedMessages";
import { i18n, taskThreadQueueMessages as messages } from "@/i18n/task-thread-queue-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import type { IssueQueuedCommentQueue } from "@paperclipai/shared";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Locale = keyof typeof messages;
const locales = Object.keys(messages) as Locale[];
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => { await i18n.changeLanguage("en"); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); await i18n.changeLanguage("en"); vi.restoreAllMocks(); });
const language = async (locale: Locale) => { await act(async () => { await i18n.changeLanguage(locale); }); };
const nextLocale = (locale: Locale) => locale === "ja" ? "es" : "ja";
const click = async (el: HTMLElement) => { await act(async () => el.click()); };
const key = async (el: HTMLElement, value: string) => { await act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: value === "Space" ? " " : value, code: value, bubbles: true, cancelable: true })); }); };
const testId = (id: string) => container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
const queue: IssueQueuedCommentQueue = {
  issueId: "issue-raw", queueId: "queue-raw", state: "deferred", targetRunId: "run-raw", revision: "rev-1234", protocol: "paperclip_runner_v1", steeringDisposition: "available",
  executionWait: { reason: "remote_cleanup", message: "Sending queued messages." },
  entries: ["Steer", "Raw message 用户 $1,234.00"].map((body, position) => ({
    comment: { id: `raw-comment-${position + 1}`, companyId: "company-raw", issueId: "issue-raw", authorType: "user", authorAgentId: null, authorUserId: "user-raw", body, presentation: null, metadata: null, createdAt: new Date("2026-10-01T00:00:00Z"), updatedAt: new Date("2026-10-01T00:00:00Z") },
    position, canEdit: true, canDiscard: true,
  })),
};
async function render(overrides: Partial<ComponentProps<typeof TaskChatQueuedMessages>> = {}) {
  const props = { queue, onEdit: vi.fn(), onReorder: vi.fn().mockResolvedValue(undefined), onSteer: vi.fn().mockResolvedValue(undefined), onDiscard: vi.fn().mockResolvedValue(undefined), ...overrides };
  await act(async () => root.render(<TaskChatQueuedMessages {...props} />)); return props;
}
it.each(locales)("validates queue messages in %s", locale => expect(validateLocaleMessages(messages[locale], messages.en)).toEqual([]));
it.each(locales)("keeps raw queue bodies, an open menu and exact edit identity in %s", async locale => {
  await language(locale); const before = JSON.stringify(queue); const props = await render();
  expect(container.textContent).toContain(queue.executionWait!.message); expect(container.textContent).toContain(queue.entries[1].comment.body);
  const row = testId("task-chat-queued-message-raw-comment-1"); const menuButton = row.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
  await key(menuButton, "ArrowDown"); const menu = document.querySelector<HTMLElement>('[role="menu"]')!; expect(menu.textContent).toContain(messages[locale].edit);
  const next = nextLocale(locale); await language(next); expect(menu.textContent).toContain(messages[next].edit); expect(container.textContent).toContain("Sending queued messages.");
  expect(props.onEdit).not.toHaveBeenCalled(); expect(props.onSteer).not.toHaveBeenCalled(); expect(props.onReorder).not.toHaveBeenCalled(); expect(props.onDiscard).not.toHaveBeenCalled();
  await click(menu.querySelector<HTMLElement>('[role="menuitem"]')!); expect(props.onEdit).toHaveBeenCalledExactlyOnceWith("raw-comment-1"); expect(JSON.stringify(queue)).toBe(before);
});

it.each(locales)("retains pending discard and localized stable-code failure without replay in %s", async locale => {
  await language(locale); let reject!: (error: unknown) => void; const pending = new Promise<void>((_, r) => { reject = r; });
  const cause = { body: { details: { code: "queued_comment_already_dispatching" }, error: "Raw provider failure" }, traceId: "provider-raw" }; const before = JSON.stringify(cause);
  const onDiscard = vi.fn().mockReturnValue(pending); const props = await render({ onDiscard }); await click(testId("task-chat-queued-discard-raw-comment-1"));
  expect(container.textContent).toContain(messages[locale].discarding); const next = nextLocale(locale); await language(next);
  expect(container.textContent).toContain(messages[next].discarding); expect(testId("task-chat-queued-discard-raw-comment-1").disabled).toBe(true); expect(testId("task-chat-queued-message-raw-comment-1")).not.toBeNull();
  await click(testId("task-chat-queued-discard-raw-comment-1")); expect(onDiscard).toHaveBeenCalledExactlyOnceWith("raw-comment-1", "rev-1234");
  await act(async () => { reject(cause); await pending.catch(() => undefined); }); expect(container.textContent).toContain(messages[next].dispatching);
  await language(locale); expect(container.textContent).toContain(messages[locale].dispatching); expect(onDiscard).toHaveBeenCalledTimes(1); expect(props.onSteer).not.toHaveBeenCalled(); expect(JSON.stringify(cause)).toBe(before);
});

it.each(locales)("keeps optimistic delivery hidden through locale and polling, then restores only the latest queue in %s", async locale => {
  await language(locale); let reject!: (error: unknown) => void; const delivery = new Promise<void>((_, r) => { reject = r; }); const onSteer = vi.fn().mockReturnValue(delivery);
  const props = await render({ onSteer }); await click(testId("task-chat-queued-steer-raw-comment-1")); expect(testId("task-chat-queued-message-raw-comment-1")).toBeNull();
  const next = nextLocale(locale); await language(next); expect(container.textContent).toContain(messages[next].steering); expect(onSteer).toHaveBeenCalledExactlyOnceWith("raw-comment-1", "rev-1234");
  await render({ ...props, queue: { ...queue, entries: [...queue.entries] } }); expect(testId("task-chat-queued-message-raw-comment-1")).toBeNull();
  await render({ ...props, queue: { ...queue, revision: "rev-raw-next", entries: [queue.entries[1]] } });
  await act(async () => { reject(new Error("Provider 原文")); await delivery.catch(() => undefined); });
  expect(testId("task-chat-queued-message-raw-comment-1")).toBeNull(); expect(testId("task-chat-queued-message-raw-comment-2")).not.toBeNull(); expect(container.textContent).toContain(messages[next].steerFailed);
  await language(locale); expect(container.textContent).toContain(messages[locale].steerFailed); expect(onSteer).toHaveBeenCalledTimes(1);
});

it.each(locales)("preserves legacy interrupt and immutable response semantics in %s", async locale => {
  await language(locale); const entry = { ...queue.entries[0], canEdit: false, canDiscard: false, comment: { ...queue.entries[0].comment, body: "Accepted: Raw plan\n\n{\"revision\":\"raw-1234\"}" }, source: { kind: "interaction" as const, interactionId: "interaction-raw", interactionKind: "request_confirmation", requiresFreshSession: true } };
  const onInterrupt = vi.fn().mockResolvedValue(undefined); const props = await render({ queue: { ...queue, entries: [entry], protocol: "legacy" }, onInterrupt });
  const next = nextLocale(locale); await language(next); expect(container.textContent).toContain("Accepted: Raw plan"); expect(testId("task-chat-queued-discard-raw-comment-1").disabled).toBe(true);
  const drag = container.querySelector<HTMLButtonElement>('[aria-roledescription]')!; expect(drag.disabled).toBe(true); expect(drag.getAttribute("aria-roledescription")).toBe(messages[next].sortable); expect(reorderQueuedMessageEntries([entry, queue.entries[1]], "raw-comment-1", "raw-comment-2")).toBeNull();
  expect(props.onSteer).not.toHaveBeenCalled(); expect(onInterrupt).not.toHaveBeenCalled(); await click(testId("task-chat-queued-interrupt-raw-comment-1")); expect(onInterrupt).toHaveBeenCalledExactlyOnceWith(); expect(props.onSteer).not.toHaveBeenCalled();
});

it.each(locales)("localizes drag instructions and cancellation without altering raw drag identity in %s", async locale => {
  await language(locale); const props = await render(); const drag = container.querySelector<HTMLButtonElement>('[aria-roledescription]')!;
  const instructionId = drag.getAttribute("aria-describedby")!; expect(document.getElementById(instructionId)?.textContent).toContain(messages[locale].dragInstructions);
  await act(async () => drag.focus()); await key(drag, "Space"); expect(document.body.textContent).toContain(messages[locale].dragOver.replace("{{id}}", "raw-comment-1").replace("{{over}}", "raw-comment-1"));
  const next = nextLocale(locale); await language(next); expect(document.getElementById(instructionId)?.textContent).toContain(messages[next].dragInstructions);
  await key(drag, "Escape"); expect(document.body.textContent).toContain(messages[next].dragCancel.replace("{{id}}", "raw-comment-1")); expect(props.onReorder).not.toHaveBeenCalled(); expect(props.onSteer).not.toHaveBeenCalled(); expect(props.onDiscard).not.toHaveBeenCalled();
});

it.each(locales)("keeps a keyboard reorder and numeric positions canonical through %s", async locale => {
  await language(locale);
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const id = this.dataset.testid;
    if (id === "task-chat-queued-message-raw-comment-1") return new DOMRect(0, 0, 300, 44);
    if (id === "task-chat-queued-message-raw-comment-2") return new DOMRect(0, 44, 300, 44);
    return originalRect.call(this);
  });
  const before = JSON.stringify(queue); const props = await render(); const drag = container.querySelector<HTMLButtonElement>('[aria-roledescription]')!;
  await act(async () => drag.focus()); await key(drag, "Space");
  const next = nextLocale(locale); await language(next); await key(drag, "ArrowDown"); await key(drag, "Space");
  await vi.waitFor(() => expect(props.onReorder).toHaveBeenCalledExactlyOnceWith(["raw-comment-2", "raw-comment-1"], "rev-1234"));
  expect(container.textContent).toContain(messages[next].moved.replace("{{position}}", new Intl.NumberFormat(next).format(2)).replace("{{total}}", new Intl.NumberFormat(next).format(2)));
  expect(JSON.stringify(queue)).toBe(before); expect(reorderQueuedMessageEntries(queue.entries, "raw-comment-1", "raw-comment-2")?.map(entry => entry.position)).toEqual([0, 1]);
  expect(props.onSteer).not.toHaveBeenCalled(); expect(props.onDiscard).not.toHaveBeenCalled();
});
