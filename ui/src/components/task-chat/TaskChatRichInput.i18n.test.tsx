// @vitest-environment jsdom
import { act, forwardRef, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuestionForm } from "./QuestionForm";
import { TaskChatRichInput } from "./TaskChatRichInput";
import { i18n, taskRichInputMessages as messages } from "../../i18n/task-rich-input-test-resources";
import { validateLocaleMessages } from "../../i18n/locale-validation";

const editor = vi.hoisted(() => ({ upload: undefined as ((file: File) => Promise<string>) | undefined }));
// Real Form and RichInput; only the rich editor is replaced. No external uploads.
vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: forwardRef(function Editor({ value, onChange, imageUploadHandler }: {
    value: string; onChange: (value: string) => void; imageUploadHandler?: (file: File) => Promise<string>;
  }, ref) {
    editor.upload = imageUploadHandler;
    useImperativeHandle(ref, () => ({ focus: () => {}, insertMarkdown: (markdown: string) => onChange(value + markdown) }));
    return <textarea value={value} onChange={event => onChange(event.target.value)} />;
  }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Locale = keyof typeof messages;
const locales = Object.keys(messages) as Locale[];
const nextLocale = (locale: Locale): Locale => locale === "ja" ? "es" : "ja";
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en"); localStorage.clear(); editor.upload = undefined;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); await i18n.changeLanguage("en"); });
async function language(locale: Locale) { await act(async () => { await i18n.changeLanguage(locale); }); }
const file = () => new File(["fixture"], "用户[raw].png", { type: "image/png" });
const alert = () => container.querySelector('[role="alert"]')?.textContent;
const submitButton = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === i18n.t("questionFormUi.submitAnswers"))!;

it.each(locales)("validates resource parity in %s", locale => {
  expect(validateLocaleMessages(messages[locale], messages.en)).toEqual([]);
});

it.each(locales.flatMap(locale => ["non-error", "raw", "english-collision"].map(kind => ({ locale, kind }))))("actual Form upload failure retains $kind correctly across language changes from $locale", async ({ locale, kind }) => {
  await language(locale);
  const failure = kind === "non-error" ? { code: "upload_rejected" } : new Error(kind === "english-collision" ? messages.en.uploadFailed : "Provider 原文 <raw> & filename.png");
  let reject!: (reason: unknown) => void;
  const upload = vi.fn(() => new Promise<string>((_, rejectUpload) => { reject = rejectUpload; }));
  const submit = vi.fn();
  const questionSet = { schema: "paperclip.question_set.v1" as const, questions: [{ id: "question-原文", prompt: "Provider prompt 原文", required: true, answerMode: "text" as const, initialText: "Exact answer 原文\n" }] };
  const original = JSON.stringify(questionSet);
  await act(async () => root.render(<QuestionForm id="upload-form" draftKey="upload-draft" questionSet={questionSet} onSubmit={submit} imageUploadHandler={upload} />));
  // The production form does not enable attachment controls; upload is via editor.
  expect(container.querySelector('input[type="file"]')).toBeNull();
  expect(container.textContent).not.toContain(messages[locale].dropPasteImage);
  const draftBefore = localStorage.getItem("upload-draft");
  const image = file();
  let caught: unknown;
  let pending!: Promise<void>;
  await act(async () => { pending = editor.upload!(image).then(() => {}, error => { caught = error; }); });
  expect(submitButton().disabled).toBe(true);
  expect(upload).toHaveBeenCalledExactlyOnceWith(image);
  await act(async () => { reject(failure); await pending; });
  expect(caught).toBe(failure);
  expect(alert()).toBe(failure instanceof Error ? failure.message : messages[locale].uploadFailed);
  expect(submitButton().disabled).toBe(false);
  const next = nextLocale(locale); await language(next);
  expect(alert()).toBe(failure instanceof Error ? failure.message : messages[next].uploadFailed);
  expect(container.querySelector("textarea")!.value).toBe("Exact answer 原文\n");
  expect(localStorage.getItem("upload-draft")).toBe(draftBefore);
  expect(submit).not.toHaveBeenCalled();
  expect(JSON.stringify(questionSet)).toBe(original);
  const url = "/api/attachments/原文?token=opaque";
  upload.mockResolvedValueOnce(url);
  await act(async () => { expect(await editor.upload!(image)).toBe(url); });
  expect(alert()).toBeUndefined();
  expect(upload).toHaveBeenCalledTimes(2);
  expect(submit).not.toHaveBeenCalled();
  await act(async () => submitButton().click());
  expect(submit).toHaveBeenCalledExactlyOnceWith({ schema: "paperclip.question_response.v1", answers: { "question-原文": { text: "Exact answer 原文\n" } } });
});

it.each(locales)("isolated controls=true capability translates controls/default aria and preserves filename in %s", async locale => {
  await language(locale);
  const change = vi.fn();
  const upload = vi.fn().mockResolvedValue("/opaque/image-url");
  const render = async (attachAriaLabel?: string) => {
    await act(async () => root.render(<TaskChatRichInput value="Original text" onChange={change} imageUploadHandler={upload} showImageAttachControls attachAriaLabel={attachAriaLabel} />));
  };
  await render();
  const check = (locale: Locale) => {
    expect(container.querySelector("button")!.textContent).toBe(messages[locale].attachImage);
    expect(container.textContent).toContain(messages[locale].dropPasteImage);
    expect(container.querySelector('input[type="file"]')!.getAttribute("aria-label")).toBe(messages[locale].attachImage);
  };
  check(locale);
  const next = nextLocale(locale); await language(next); check(next);
  await render("Provider aria 原文");
  expect(container.querySelector("input")!.getAttribute("aria-label")).toBe("Provider aria 原文");
  const image = file();
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.defineProperty(input, "files", { configurable: true, value: [image] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(upload).toHaveBeenCalledExactlyOnceWith(image);
  expect(change).toHaveBeenCalledExactlyOnceWith("Original text\n\n![用户\\[raw\\].png](/opaque/image-url)\n\n");
  expect(container.querySelector("input")!.value).toBe("");
});

it("keeps absent-handler entry guards and default hidden controls unchanged", async () => {
  await act(async () => root.render(<TaskChatRichInput value="" onChange={vi.fn()} showImageAttachControls />));
  expect(editor.upload).toBeUndefined();
  expect(container.querySelector("input")).toBeNull();
  expect(container.querySelector("button")).toBeNull();
  expect(alert()).toBeUndefined();
  await act(async () => root.render(<TaskChatRichInput value="" onChange={vi.fn()} imageUploadHandler={vi.fn()} />));
  expect(editor.upload).toBeTypeOf("function");
  expect(container.querySelector("input")).toBeNull();
  expect(container.querySelector("button")).toBeNull();
});
