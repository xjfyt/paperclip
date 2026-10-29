// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskChatCompactInteractionCard } from "./TaskChatCompactInteractionCard";
import { TaskChatInteractionCard } from "./TaskChatInteractionCard";
import { TaskChatBubbleActions } from "./TaskChatBubbleActions";
import { pendingRequestCheckboxConfirmationInteraction, expiredSecretProposalInteraction, pendingAskUserQuestionsInteraction } from "@/fixtures/issueThreadInteractionFixtures";
import { i18n, taskThreadInteractionMessages as messages } from "@/i18n/task-thread-interactions-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import { formatDate } from "@/i18n";

vi.mock("@/components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <div>{children}</div> }));
vi.mock("@/components/MarkdownEditor", () => ({ MarkdownEditor: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Locale = keyof typeof messages;
const locales = Object.keys(messages) as Locale[];
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en"); localStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); localStorage.clear(); await i18n.changeLanguage("en"); vi.restoreAllMocks(); });
const language = async (locale: Locale) => { await act(async () => { await i18n.changeLanguage(locale); }); };
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent?.trim() === label || el.getAttribute("aria-label") === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };
async function render(props: ComponentProps<typeof TaskChatCompactInteractionCard>) {
  await act(async () => root.render(<TaskChatCompactInteractionCard presentation="takeover" {...props} />));
}
async function edit(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it.each(locales)("validates the %s contribution", locale => expect(validateLocaleMessages(messages[locale], messages.en)).toEqual([]));

it.each(locales)("keeps checkbox filters, focus, IDs and callback identity across %s locale changes", async locale => {
  await language(locale);
  const accept = vi.fn(); const reject = vi.fn();
  const interaction = { ...pendingRequestCheckboxConfirmationInteraction, title: null, payload: {
    ...pendingRequestCheckboxConfirmationInteraction.payload, prompt: "Approve <raw> 用户", acceptLabel: undefined, rejectLabel: undefined,
    defaultSelectedOptionIds: ["id-0"], minSelected: 1, maxSelected: 3,
    options: Array.from({ length: 11 }, (_, index) => ({ id: `id-${index}`, label: `Raw option ${index}`, description: "Provider original description" })),
  } };
  const before = JSON.stringify(interaction);
  await render({ interaction, draftKey: "checkbox-original", onAcceptInteraction: accept, onRejectInteraction: reject });
  expect(container.textContent).toContain(messages[locale].chooseOptions);
  const filter = container.querySelector<HTMLInputElement>(`input[placeholder="${messages[locale].filterOptions}"]`)!;
  await edit(filter, "Raw option 1"); filter.focus();
  const saved = localStorage.getItem("checkbox-original");
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(document.activeElement).toBe(filter); expect(filter.value).toBe("Raw option 1"); expect(filter.placeholder).toBe(messages[next].filterOptions);
  expect(localStorage.getItem("checkbox-original")).toBe(saved);
  expect(container.textContent).toContain("Approve <raw> 用户"); expect(container.textContent).toContain("Provider original description");
  expect(accept).not.toHaveBeenCalled(); expect(reject).not.toHaveBeenCalled();
  await click(messages[next].confirmSelection);
  expect(accept).toHaveBeenCalledExactlyOnceWith(interaction, undefined, ["id-0"]);
  expect(JSON.stringify(interaction)).toBe(before); expect(localStorage.getItem("checkbox-original")).toBeNull();
});

it.each(locales)("localizes secret metadata in %s without changing secret labels, bindings or user copy", async locale => {
  await language(locale);
  const interaction = { ...expiredSecretProposalInteraction, status: "pending" as const, title: null, payload: { ...expiredSecretProposalInteraction.payload, rejectLabel: undefined, acceptLabel: undefined } };
  const accept = vi.fn(); const reject = vi.fn();
  const before = JSON.stringify(interaction);
  await render({ interaction, onAcceptInteraction: accept, onRejectInteraction: reject });
  for (const key of ["confirmation", "secret", "binding", "why", "expires", "approve", "reject"] as const) expect(container.textContent).toContain(messages[locale][key]);
  const proposal = interaction.payload.secretProposal!;
  for (const raw of [proposal.sourceSecretLabel, proposal.configPath, proposal.targetAgentName, proposal.justification, interaction.payload.prompt]) expect(container.textContent).toContain(raw);
  expect(container.textContent).toContain(formatDate(new Date(proposal.expiresAt), { dateStyle: "medium", timeStyle: "short" }));
  await click(messages[locale].approve); expect(accept).toHaveBeenCalledExactlyOnceWith(interaction); expect(reject).not.toHaveBeenCalled();
  expect(JSON.stringify(interaction)).toBe(before);
});

it.each(locales)("keeps decline drafts, custom copy and raw failures in %s", async locale => {
  await language(locale);
  const reject = vi.fn().mockRejectedValueOnce(new Error("Provider raw failure <raw>"));
  const interaction = { ...pendingRequestCheckboxConfirmationInteraction, payload: { ...pendingRequestCheckboxConfirmationInteraction.payload,
    rejectLabel: "Provider reject", rejectRequiresReason: true, rejectReasonLabel: "Provider reason", declineReasonPlaceholder: "Provider placeholder" } };
  await render({ interaction, draftKey: "decline-original", onRejectInteraction: reject });
  await click("Provider reject");
  const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await edit(input, "  User reason 原文  "); input.focus();
  const saved = localStorage.getItem("decline-original");
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(input.value).toBe("  User reason 原文  "); expect(input.placeholder).toBe("Provider placeholder"); expect(document.activeElement).toBe(input);
  expect(localStorage.getItem("decline-original")).toBe(saved); expect(reject).not.toHaveBeenCalled();
  await click("Provider reject"); expect(reject).toHaveBeenCalledExactlyOnceWith(interaction, "User reason 原文");
  expect(container.textContent).toContain("Provider raw failure <raw>"); expect(input.value).toBe("  User reason 原文  ");
});

it.each(locales)("localizes unanswered-question navigation in %s without submitting it", async locale => {
  await language(locale); const review = vi.fn(); const submit = vi.fn();
  const interaction = pendingAskUserQuestionsInteraction;
  await act(async () => root.render(<TaskChatInteractionCard item={{ id: "item", kind: "interaction", interaction }} showUnansweredQuestion onReviewRequest={review} onSubmitInteractionAnswers={submit} />));
  expect(container.textContent).toContain(messages[locale].unansweredQuestion);
  const question = container.querySelector<HTMLButtonElement>("button")!;
  expect(question.getAttribute("aria-label")).toContain(interaction.payload.questions[0].prompt);
  await act(async () => question.click()); expect(review).toHaveBeenCalledExactlyOnceWith(interaction.id); expect(submit).not.toHaveBeenCalled();
});

it.each(locales)("localizes message details in %s while copying only raw message text", async locale => {
  await language(locale); const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const raw = "Platform-generated acknowledgement. Raw 用户 <content>";
  await act(async () => root.render(<TaskChatBubbleActions copyText={raw} fastResponse />));
  await click(messages[locale].messageDetails);
  expect(document.body.textContent).toContain(messages[locale].platformAcknowledgement);
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(document.body.textContent).toContain(messages[next].platformAcknowledgement);
  expect(writeText).not.toHaveBeenCalled(); await click(messages[next].copyMessage);
  expect(writeText).toHaveBeenCalledExactlyOnceWith(raw);
});

it.each(locales)("preserves an unparseable expiry value in %s", async locale => {
  await language(locale);
  const interaction = { ...expiredSecretProposalInteraction, payload: { ...expiredSecretProposalInteraction.payload,
    secretProposal: { ...expiredSecretProposalInteraction.payload.secretProposal!, expiresAt: "Provider expiry <raw>" } } };
  await render({ interaction });
  expect(container.textContent).toContain(messages[locale].expires);
  expect(container.textContent).toContain("Provider expiry <raw>");
});

it.each(locales)("keeps an in-flight approval fenced while changing %s locale", async locale => {
  await language(locale);
  let finish!: () => void;
  const accept = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const interaction = { ...expiredSecretProposalInteraction, status: "pending" as const, payload: { ...expiredSecretProposalInteraction.payload, acceptLabel: undefined } };
  await render({ interaction, onAcceptInteraction: accept });
  await click(messages[locale].approve);
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  const approval = button(messages[next].approve); expect(approval.disabled).toBe(true);
  await act(async () => approval.click()); expect(accept).toHaveBeenCalledExactlyOnceWith(interaction);
  await act(async () => finish()); expect(approval.disabled).toBe(false);
});

it.each(locales)("keeps the failed copy state visible through a %s language switch", async locale => {
  await language(locale); const writeText = vi.fn().mockRejectedValue(new Error("clipboard unavailable"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await act(async () => root.render(<TaskChatBubbleActions copyText="Exact raw message" />));
  await click(messages[locale].copyMessage);
  expect(button(messages[locale].copyFailed)).toBeDefined();
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(button(messages[next].copyFailed)).toBeDefined();
  expect(writeText).toHaveBeenCalledExactlyOnceWith("Exact raw message");
});
