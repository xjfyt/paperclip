// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskChatCompactInteractionCard } from "./TaskChatCompactInteractionCard";
import { QuestionForm } from "./QuestionForm";
import { pendingRequestCheckboxConfirmationInteraction, pendingAskUserQuestionsInteraction } from "@/fixtures/issueThreadInteractionFixtures";
import { i18n, taskThreadFeedbackMessages as messages } from "@/i18n/task-thread-feedback-test-resources";
import "@/i18n/task-thread-interactions-test-resources";
import { questionFormMessages } from "@/i18n/question-form-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import { describeInteractionAudience } from "@/lib/interaction-audience";
import { describeInteractionResolutionFailure } from "@/lib/interaction-resolution-error";

vi.mock("@/components/MarkdownEditor", () => ({ MarkdownEditor: () => null }));
vi.mock("@/components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <div>{children}</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Locale = keyof typeof messages;
const locales = Object.keys(messages) as Locale[];
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => { await i18n.changeLanguage("en"); localStorage.clear(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); await i18n.changeLanguage("en"); });
const language = async (locale: Locale) => { await act(async () => { await i18n.changeLanguage(locale); }); };
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent?.trim() === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };
const errorText = () => container.querySelector('[data-testid="interaction-action-error"]')?.textContent ?? container.querySelector('[aria-live="assertive"]')?.textContent;
async function render(props: ComponentProps<typeof TaskChatCompactInteractionCard>) { await act(async () => root.render(<TaskChatCompactInteractionCard presentation="takeover" {...props} />)); }
const fill = (template: string, values: Record<string, string>) => template.replace(/{{(.*?)}}/g, (_, key: string) => values[key]);

it.each(locales)("validates feedback resources in %s", locale => expect(validateLocaleMessages(messages[locale], messages.en)).toEqual([]));

it.each(locales)("updates retained local submission failures in %s without clearing draft or resubmitting", async locale => {
  await language(locale); const cause = { status: 503, body: { code: "provider_unavailable" } };
  const accept = vi.fn().mockRejectedValue(cause);
  const interaction = { ...pendingRequestCheckboxConfirmationInteraction, payload: { ...pendingRequestCheckboxConfirmationInteraction.payload, acceptLabel: "Raw approve" } };
  await render({ interaction, draftKey: "feedback-draft", onAcceptInteraction: accept });
  const saved = localStorage.getItem("feedback-draft");
  await click("Raw approve"); expect(errorText()).toBe(messages[locale].submitFailed);
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(errorText()).toBe(messages[next].submitFailed); expect(localStorage.getItem("feedback-draft")).toBe(saved);
  expect(accept).toHaveBeenCalledExactlyOnceWith(interaction, undefined, interaction.payload.defaultSelectedOptionIds ?? []);
});

it.each(locales)("preserves provider errors and actor names that look like English system text in %s", async locale => {
  await language(locale);
  const raw = "Couldn't submit. Try again. 原文 <raw>";
  const cause = Object.assign(new Error(raw), { status: 403, body: { code: "interaction_creator_excluded" }, cause: { original: true } });
  const accept = vi.fn().mockRejectedValue(cause);
  const interaction = { ...pendingRequestCheckboxConfirmationInteraction, createdByAgentId: "agent-original", effectiveResolverPolicy: "not_creator" as const, requestedResolverPolicy: "not_creator" as const, payload: { ...pendingRequestCheckboxConfirmationInteraction.payload, acceptLabel: "Raw approve" } };
  await render({ interaction, presentation: "timeline", onAcceptInteraction: accept, agentMap: new Map([["agent-original", { id: "agent-original", name: "You" } as never]]) });
  expect(container.textContent).toContain(fill(messages[locale].exceptCreator, { creator: "You" }));
  await click("Raw approve"); expect(errorText()).toContain(raw);
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(errorText()).toContain(raw); expect(errorText()).toContain(fill(messages[next].exceptCreator, { creator: "You" }));
  expect(accept).toHaveBeenCalledTimes(1); expect(cause.message).toBe(raw); expect(cause.body.code).toBe("interaction_creator_excluded");
});

it.each(locales)("gives QuestionForm its original rejection object and retains the same draft in %s", async locale => {
  await language(locale);
  const cause = Object.assign(new Error("Provider raw error"), { code: "raw_code", cause: { sentinel: true } });
  const formatter = vi.fn((error: unknown) => `${messages[i18n.language as Locale].submitFailed} ${(error as Error).message}`);
  const submit = vi.fn().mockRejectedValue(cause);
  await act(async () => root.render(<QuestionForm id="question-original" draftKey="question-feedback-original"
    questionSet={{ schema: "paperclip.question_set.v1", questions: [{ id: "q-raw", prompt: "Raw prompt", answerMode: "single_select", options: [{ id: "raw-option", label: "Raw option" }] }] }}
    onSubmit={submit} formatActionError={formatter} />));
  await click("Raw option"); const saved = localStorage.getItem("question-feedback-original");
  await click(questionFormMessages[locale].submitAnswers);
  expect(formatter).toHaveBeenCalledWith(cause, "submit"); expect(errorText()).toContain("Provider raw error");
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(errorText()).toContain(messages[next].submitFailed); expect(formatter.mock.calls.at(-1)?.[0]).toBe(cause);
  expect(localStorage.getItem("question-feedback-original")).toBe(saved); expect(submit).toHaveBeenCalledTimes(1);
});

it.each(locales)("retains compact question failure codes instead of wrapping them in %s", async locale => {
  await language(locale);
  const submit = vi.fn().mockRejectedValue({ status: 403, body: { code: "interaction_human_only" } });
  const interaction = { ...pendingAskUserQuestionsInteraction, effectiveResolverPolicy: "human_only" as const, payload: { ...pendingAskUserQuestionsInteraction.payload, questions: [], questionSet: {
    schema: "paperclip.question_set.v1" as const, questions: [{ id: "q-raw", prompt: "Raw prompt", answerMode: "single_select" as const, options: [{ id: "raw-option", label: "Raw option" }] }] } } };
  await render({ interaction, draftKey: "compact-question-original", onSubmitInteractionAnswers: submit });
  await click("Raw option"); const saved = localStorage.getItem("compact-question-original");
  await click(questionFormMessages[locale].submitAnswers);
  expect(errorText()).toContain(messages[locale].audienceDenied); expect(errorText()).not.toContain(messages[locale].tryAgain);
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(errorText()).toContain(messages[next].audienceDenied); expect(errorText()).toContain(messages[next].boardOnly);
  expect(localStorage.getItem("compact-question-original")).toBe(saved); expect(submit).toHaveBeenCalledExactlyOnceWith(interaction, [{ questionId: "q-raw", optionIds: ["raw-option"] }]);
});

it.each(locales)("does not localize canonical audience or failure helpers in %s", async locale => {
  await language(locale);
  expect(describeInteractionAudience({ interaction: pendingAskUserQuestionsInteraction }).shortSummary).toBe("Anyone can respond");
  expect(describeInteractionResolutionFailure({}).message).toBe("Couldn't submit. Try again.");
});
