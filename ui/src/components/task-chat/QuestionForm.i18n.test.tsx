// @vitest-environment jsdom
import { act, forwardRef, useImperativeHandle, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PaperclipQuestionSet } from "@paperclipai/adapter-utils";
import { QuestionForm, QuestionResponseSummary } from "./QuestionForm";
import { TaskChatComposerTakeoverActionsContext } from "./TaskChatComposerTakeoverContext";
import { i18n, questionFormMessages as messages } from "../../i18n/question-form-test-resources";
import { validateLocaleMessages } from "../../i18n/locale-validation";

const editor = vi.hoisted(() => ({ upload: undefined as ((file: File) => Promise<string>) | undefined }));
vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: forwardRef(function Editor({ value, onChange, placeholder, readOnly, onSubmit, imageUploadHandler }: {
    value: string; onChange: (value: string) => void; placeholder?: string; readOnly?: boolean;
    onSubmit?: () => void; imageUploadHandler?: (file: File) => Promise<string>;
  }, ref) {
    editor.upload = imageUploadHandler;
    useImperativeHandle(ref, () => ({ focus: () => {}, insertMarkdown: (value: string) => onChange(value) }));
    return <textarea value={value} placeholder={placeholder} readOnly={readOnly} onChange={event => onChange(event.target.value)}
      onKeyDown={event => { if (event.key === "Enter" && event.ctrlKey) onSubmit?.(); }} />;
  }),
}));
vi.mock("@/components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <div>{children}</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Locale = keyof typeof messages;
const locales = Object.keys(messages) as Locale[];
const nextLocale = (locale: Locale): Locale => locale === "ja" ? "es" : "ja";
const fill = (text: string, values: Record<string, string | number>) => text.replace(/{{(.*?)}}/g, (_, key: string) => String(values[key]));
const rawPrompt = 'Provider question 用户 <raw> & "quoted"';
function set(question: Partial<PaperclipQuestionSet["questions"][number]> = {}): PaperclipQuestionSet {
  return { schema: "paperclip.question_set.v1", questions: [{ id: "raw-question", prompt: rawPrompt, required: true, answerMode: "text", ...question }] };
}
let container: HTMLDivElement;
let root: Root;
const submit = vi.fn();
const cancel = vi.fn();
beforeEach(async () => {
  await i18n.changeLanguage("en"); localStorage.clear(); submit.mockReset(); cancel.mockReset(); editor.upload = undefined;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); await i18n.changeLanguage("en"); });
async function render(questionSet = set(), extra: Partial<ComponentProps<typeof QuestionForm>> = {}) {
  await act(async () => root.render(<QuestionForm id="form-original" draftKey="question-original" questionSet={questionSet} onSubmit={submit} {...extra} />));
}
const input = () => container.querySelector("textarea")!;
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === text)!;
async function edit(value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input(), value); input().dispatchEvent(new Event("input", { bubbles: true })); });
}
async function click(text: string) { await act(async () => button(text).click()); }
async function language(locale: Locale) { await act(async () => { await i18n.changeLanguage(locale); }); }
const draft = () => JSON.parse(localStorage.getItem("question-original")!);

it.each(locales)("has matching safe four-language resources in %s", locale => {
  expect(validateLocaleMessages(messages[locale], messages.en)).toEqual([]);
});

const validationCases: Array<{ name: string; value: string; validation: NonNullable<PaperclipQuestionSet["questions"][number]["textValidation"]>; key: keyof typeof messages.en; vars?: Record<string, number> }> = [
  { name: "minimum length", value: "abc", validation: { minLength: 4 }, key: "minLength_other", vars: { count: 4 } },
  { name: "maximum length", value: "abcd", validation: { maxLength: 3 }, key: "maxLength_other", vars: { count: 3 } },
  { name: "singular maximum length", value: "ab", validation: { maxLength: 1 }, key: "maxLength_one", vars: { count: 1 } },
  { name: "unsupported pattern", value: "abc", validation: { pattern: "(a+)+" }, key: "unsupportedPattern" },
  { name: "requested format", value: "abc", validation: { pattern: "^[0-9]$" }, key: "requestedFormat" },
  { name: "number", value: "hello", validation: { inputType: "number" }, key: "validNumber" },
  { name: "integer", value: "1.5", validation: { inputType: "integer" }, key: "validInteger" },
  { name: "minimum value", value: "2", validation: { inputType: "number", minimum: 3.5 }, key: "minimum", vars: { value: 3.5 } },
  { name: "maximum value", value: "5", validation: { inputType: "number", maximum: 4.5 }, key: "maximum", vars: { value: 4.5 } },
];
it.each(locales.flatMap(locale => validationCases.map(test => ({ locale, ...test }))))("renders $name validation in $locale and hot-switches without editing the draft", async ({ locale, value, validation, key, vars }) => {
  await language(locale);
  const questionSet = set({ initialText: value, textValidation: validation });
  const before = JSON.stringify(questionSet);
  await render(questionSet);
  expect(container.textContent).toContain(fill(messages[locale][key], vars ?? {}));
  expect(button(messages[locale].submitAnswers).disabled).toBe(true);
  const saved = localStorage.getItem("question-original");
  const next = nextLocale(locale); await language(next);
  expect(container.textContent).toContain(fill(messages[next][key], vars ?? {}));
  expect(input().value).toBe(value);
  expect(button(messages[next].submitAnswers).disabled).toBe(true);
  expect(localStorage.getItem("question-original")).toBe(saved);
  expect(submit).not.toHaveBeenCalled(); expect(JSON.stringify(questionSet)).toBe(before);
  expect(container.textContent).not.toContain("questionFormUi.");
});

it.each(locales)("preserves provider captions, pagination, filters, custom inputs and response wire in %s", async locale => {
  await language(locale);
  const options = Array.from({ length: 9 }, (_, index) => ({ id: `raw-${index}`, label: `Provider option ${index} 用户`, description: `Description ${index}`, recommended: index === 0 }));
  const questionSet: PaperclipQuestionSet = { schema: "paperclip.question_set.v1", title: "Provider title", description: "Provider context 原文", submitLabel: "Provider submit 原文", questions: [
    { id: "select-原文", header: "Provider header", prompt: rawPrompt, helpText: "Provider help", required: true, answerMode: "single_select", options, customAnswer: { enabled: true, label: "Provider custom", placeholder: "Provider placeholder" } },
    { id: "text-原文", prompt: "Second question 原文", required: false, answerMode: "text" },
  ] };
  const before = JSON.stringify(questionSet);
  await render(questionSet);
  const check = (locale: Locale) => {
    expect(container.textContent).toContain(messages[locale].recommended);
    expect(container.querySelector(`nav[aria-label="${messages[locale].pagination}"]`)?.textContent).toContain(fill(messages[locale].pageOfTotal, { page: 1, total: 2 }));
    expect(container.querySelector(`button[aria-label="${messages[locale].previousQuestion}"]`)).not.toBeNull();
    const filter = container.querySelector<HTMLInputElement>("input")!;
    expect(filter.placeholder).toBe(messages[locale].filterChoices);
    expect(filter.getAttribute("aria-label")).toBe(fill(messages[locale].filterQuestionChoices, { prompt: rawPrompt }));
    expect(container.querySelector('[role="region"]')?.getAttribute("aria-label")).toBe(messages[locale].context);
    for (const raw of [rawPrompt, "Provider context 原文", "Provider header", "Provider help", "Provider option 0 用户", "Provider custom"]) expect(container.textContent).toContain(raw);
  };
  check(locale);
  await click("Provider custom"); expect(input().placeholder).toBe("Provider placeholder");
  await edit("Custom answer 原文\n");
  const next = nextLocale(locale); await language(next); check(next);
  expect(input().value).toBe("Custom answer 原文\n"); expect(input().placeholder).toBe("Provider placeholder");
  await click(messages[next].next);
  expect(input().placeholder).toBe(messages[next].writeYourAnswer);
  expect(container.textContent).toContain(messages[next].writeAnswer);
  await edit("  Exact text 用户\n");
  await click("Provider submit 原文");
  expect(submit).toHaveBeenCalledExactlyOnceWith({ schema: "paperclip.question_response.v1", answers: { "select-原文": { selectedOptionIds: [], customText: "Custom answer 原文\n" }, "text-原文": { text: "  Exact text 用户\n" } } });
  expect(localStorage.getItem("question-original")).toBeNull();
  expect(JSON.stringify(questionSet)).toBe(before);
});

it.each(locales)("keeps custom-answer validation, earlier required-answer error and retry semantics in %s", async locale => {
  await language(locale);
  const questionSet: PaperclipQuestionSet = { schema: "paperclip.question_set.v1", questions: [
    { id: "first", prompt: rawPrompt, required: true, answerMode: "multi_select", options: [{ id: "raw-option", label: "Provider option" }], customAnswer: { enabled: true } },
    { id: "last", prompt: "Last 原文", required: false, answerMode: "text" },
  ] };
  await render(questionSet);
  await click("Provider option"); await click(messages[locale].other);
  expect(input().placeholder).toBe(messages[locale].typeAnswer);
  expect(container.textContent).toContain(messages[locale].customRequired);
  expect(button(messages[locale].next).disabled).toBe(true);
  await click(messages[locale].other); await click("Provider option");
  await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${messages[locale].nextQuestion}"]`)!.click());
  // The rich editor shortcut can ask the form to send while an earlier answer is missing.
  await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })); });
  expect(container.querySelector('[aria-live="assertive"]')?.textContent).toContain(fill(messages[locale].questionNeedsAnswer, { number: 1 }));
  const next = nextLocale(locale); await language(next);
  expect(container.querySelector('[aria-live="assertive"]')?.textContent).toContain(fill(messages[next].questionNeedsAnswer, { number: 1 }));
  expect(submit).not.toHaveBeenCalled();
  await click("Provider option"); await click(messages[next].next);
  await click(i18n.t("taskComposerUi.skip"));
  expect(submit).toHaveBeenCalledExactlyOnceWith({ schema: "paperclip.question_response.v1", answers: { first: { selectedOptionIds: ["raw-option"], customText: undefined } } });
});

it.each(locales.flatMap(locale => ["submit", "cancel"].flatMap(action => [false, true].map(raw => ({ locale, action, raw })))))("keeps $action failure and raw=$raw error across language changes in $locale", async ({ locale, action, raw }) => {
  await language(locale);
  const originalError = "Server/provider 原始 error <raw>";
  const handler = action === "submit" ? submit : cancel;
  handler.mockRejectedValueOnce(raw ? new Error(originalError) : { code: "raw_failure" });
  await render(set({ initialText: "Original answer 原文" }), { onCancel: cancel });
  await click(action === "submit" ? messages[locale].submitAnswers : i18n.t("commonUi.cancel"));
  const key = action === "submit" ? "submitFailed" : "cancelFailed";
  expect(container.querySelector('[aria-live="assertive"]')?.textContent).toContain(raw ? originalError : messages[locale][key]);
  expect(draft().answers["raw-question"].text).toBe("Original answer 原文");
  const next = nextLocale(locale); await language(next);
  expect(container.querySelector('[aria-live="assertive"]')?.textContent).toContain(raw ? originalError : messages[next][key]);
  await edit("Retry answer 原文");
  expect(container.querySelector('[aria-live="assertive"]')?.textContent).toContain(raw ? originalError : messages[next][key]);
  await click(action === "submit" ? messages[next].submitAnswers : i18n.t("commonUi.cancel"));
  expect(handler).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem("question-original")).toBeNull();
});

it.each(locales)("preserves takeover dismissal and upload blocking without auto-submitting in %s", async locale => {
  await language(locale);
  const dismiss = vi.fn(); let finish!: (url: string) => void;
  const upload = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  await act(async () => root.render(<TaskChatComposerTakeoverActionsContext.Provider value={{ skipButton: null, dismiss, headerSlot: null, controlsSlot: null, setHeaderClaimed: vi.fn() }}>
    <QuestionForm id="form-original" draftKey="question-original" questionSet={set({ initialText: "Answer 原文" })} onSubmit={submit} imageUploadHandler={upload} />
  </TaskChatComposerTakeoverActionsContext.Provider>));
  const file = new File(["fixture"], "用户.png", { type: "image/png" });
  let pending!: Promise<string>;
  await act(async () => { pending = editor.upload!(file); });
  expect(button(messages[locale].submitAnswers).disabled).toBe(true);
  expect(button(i18n.t("commonUi.cancel")).disabled).toBe(true);
  await language(nextLocale(locale));
  await act(async () => { finish("/raw-upload-receipt"); await pending; });
  expect(input().value).toBe("Answer 原文"); expect(upload).toHaveBeenCalledExactlyOnceWith(file);
  expect(submit).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
  await click(i18n.t("commonUi.cancel")); expect(dismiss).toHaveBeenCalledTimes(1);
  expect(draft().answers["raw-question"].text).toBe("Answer 原文");
});

it.each(locales)("translates empty and unanswered fallbacks without translating response data in %s", async locale => {
  await language(locale); await render({ schema: "paperclip.question_set.v1", questions: [] });
  expect(container.textContent).toBe(messages[locale].noQuestions);
  const questionSet: PaperclipQuestionSet = { schema: "paperclip.question_set.v1", questions: [
    { id: "empty", prompt: "Provider empty prompt", header: "Provider header", required: false, answerMode: "text" },
    { id: "answered", prompt: "Provider answered prompt", required: false, answerMode: "multi_select", options: [{ id: "raw", label: "Provider label 原文" }] },
  ] };
  await act(async () => root.render(<QuestionResponseSummary questionSet={questionSet} response={{ schema: "paperclip.question_response.v1", answers: { answered: { selectedOptionIds: ["raw", "unknown-option"], customText: "Exact custom 原文" } } }} />));
  expect(container.querySelector("dd")?.textContent).toBe(messages[locale].noAnswer);
  expect(container.textContent).toContain("Provider label 原文, unknown-option, Exact custom 原文");
  await language(nextLocale(locale)); expect(container.querySelector("dd")?.textContent).toBe(messages[nextLocale(locale)].noAnswer);
  expect(container.textContent).toContain("Provider header"); expect(container.textContent).toContain("Provider empty prompt");
});
