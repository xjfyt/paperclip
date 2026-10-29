// @vitest-environment jsdom
import { act, forwardRef, useImperativeHandle, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InlineEditor } from "./InlineEditor";
import { TaskChatDescriptionBubble } from "./task-chat/TaskChatDescriptionBubble";
import * as autosave from "@/hooks/useAutosaveIndicator";
import { i18n, inlineEditorMessages as messages } from "@/i18n/inline-editor-test-resources";
import "@/i18n/task-thread-context-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
vi.mock("./MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
// Only the rich-editor leaf is replaced; both hosts and the autosave hook run
// unchanged in the interaction tests below. MarkdownEditor is outside this scope.
vi.mock("./MarkdownEditor", () => ({ MarkdownEditor: forwardRef(function Editor({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }, ref) {
  const input = useRef<HTMLTextAreaElement>(null); useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }));
  return <textarea ref={input} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />;
}) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Locale = keyof typeof messages;
const locales = Object.keys(messages) as Locale[];
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => { await i18n.changeLanguage("en"); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); await i18n.changeLanguage("en"); });
const language = async (locale: Locale) => { await act(async () => { await i18n.changeLanguage(locale); }); };
const render = async (children: ReactNode) => { await act(async () => root.render(children)); };
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const nextLocale = (locale: Locale) => locale === "ja" ? "es" : "ja";
const inputText = async (input: HTMLTextAreaElement, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); };
it.each(locales)("validates inline editor copy in %s", locale => expect(validateLocaleMessages(messages[locale], messages.en)).toEqual([]));
it.each(locales)("localizes only absent placeholder and preserves explicit labels and text in %s", async locale => {
  await language(locale); const save = vi.fn(); await render(<InlineEditor value="" onSave={save} />); expect(container.textContent).toBe(messages[locale].placeholder); const display = container.firstElementChild; const next = nextLocale(locale); await language(next); expect(container.firstElementChild).toBe(display); expect(container.textContent).toBe(messages[next].placeholder); expect(save).not.toHaveBeenCalled();
  await render(<InlineEditor value="" placeholder="Click to edit..." onSave={save} />); expect(container.textContent).toBe("Click to edit..."); await render(<InlineEditor value="Saved // provider raw 原文" onSave={save} />); expect(container.textContent).toBe("Saved // provider raw 原文"); expect(save).not.toHaveBeenCalled();
});
it.each(locales)("keeps single-line draft, selection and explicit save payload through %s", async locale => {
  await language(locale); const save = vi.fn().mockResolvedValue(undefined); await render(<InlineEditor value="Original raw" onSave={save} />); await click(container.firstElementChild as HTMLElement); const input = container.querySelector("textarea")!; const raw = "  Raw **原文** $1,234.00 /path?id=1234  "; await inputText(input, raw); input.setSelectionRange(3, 12); const next = nextLocale(locale); await language(next);
  expect(container.querySelector("textarea")).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe(raw); expect([input.selectionStart, input.selectionEnd]).toEqual([3, 12]); expect(save).not.toHaveBeenCalled(); await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))); expect(save).toHaveBeenCalledExactlyOnceWith(raw.trim());
});
it.each(locales.flatMap(locale => (["inline", "description"] as const).map(host => ({ locale, host }))))("does not reset $host autosave debounce, focus or request on locale $locale", async ({ locale, host }) => {
  vi.useFakeTimers(); await language(locale); let resolve!: () => void; const pending = new Promise<void>(done => { resolve = done; }); const save = vi.fn(() => pending);
  await render(host === "inline" ? <InlineEditor value="" multiline defaultEditing onSave={save} /> : <TaskChatDescriptionBubble brief={{ description: "", author: "human", onSave: save }} />);
  if (host === "description") await click(container.querySelector<HTMLButtonElement>('[data-testid="task-chat-description-ghost"]')!); await tick(32); const input = container.querySelector("textarea")!; await act(async () => input.focus()); const raw = "Raw markdown **原文** $1,234.00\nhttps://example.com/raw"; await inputText(input, raw); input.setSelectionRange(4, 14); await tick(800); expect(save).not.toHaveBeenCalled(); const next = nextLocale(locale); await language(next);
  expect(container.querySelector("textarea")).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe(raw); expect([input.selectionStart, input.selectionEnd]).toEqual([4, 14]); expect(save).not.toHaveBeenCalled(); await tick(100); expect(save).toHaveBeenCalledExactlyOnceWith(raw); expect(save.mock.results[0].value).toBe(pending); await language(locale); expect(save).toHaveBeenCalledTimes(1); expect(input.value).toBe(raw); expect(document.activeElement).toBe(input); await act(async () => resolve()); expect(save).toHaveBeenCalledTimes(1);
});
// These four enum branches are display-only snapshots; the real hook's timing,
// pending promise and request identity are exercised above, not mocked there.
it.each(locales.flatMap(locale => (["idle", "saving", "saved", "error"] as const).map(state => ({ locale, state }))))("renders owned $state chrome in $locale without translating the caller placeholder", async ({ locale, state }) => {
  const runSave = vi.fn(); const markDirty = vi.fn(); const reset = vi.fn(); vi.spyOn(autosave, "useAutosaveIndicator").mockReturnValue({ state, runSave, markDirty, reset }); await language(locale); const save = vi.fn(); await render(<InlineEditor value="" placeholder="Could not save" multiline defaultEditing onSave={save} />); const input = container.querySelector("textarea")!; const next = nextLocale(locale); await language(next); expect(container.textContent).toBe(messages[next][state]); expect(input.placeholder).toBe("Could not save"); expect(container.querySelector("textarea")).toBe(input); expect(runSave).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});
