// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskChatCompactInteractionCard } from "./TaskChatCompactInteractionCard";
import { TaskChatInteractionCard } from "./TaskChatInteractionCard";
import { TaskChatBubbleActions } from "./TaskChatBubbleActions";
import { pendingRequestCheckboxConfirmationInteraction, expiredSecretProposalInteraction, pendingAskUserQuestionsInteraction, pendingSuggestedTasksInteraction, pendingRequestItemVerdictsInteraction } from "@/fixtures/issueThreadInteractionFixtures";
import { i18n, taskThreadInteractionMessages as messages } from "@/i18n/task-thread-interactions-test-resources";
import * as interactionFixtures from "@/fixtures/issueThreadInteractionFixtures";
import type { IssueThreadInteraction } from "@/lib/issue-thread-interactions";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import { taskThreadReceiptMessages as receipts } from "@/i18n/task-thread-receipts-test-resources";
import { taskInteractionSummary, taskQuestionExpirationReason } from "@/i18n/task-interaction-display";
import { buildIssueThreadInteractionSummary } from "@/lib/issue-thread-interactions";
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


it.each(locales)("keeps suggested-task filters, selected client keys and raw task copy through %s changes", async locale => {
  await language(locale); const accept = vi.fn(); const reject = vi.fn();
  const interaction = { ...pendingSuggestedTasksInteraction, title: null, payload: { ...pendingSuggestedTasksInteraction.payload,
    tasks: Array.from({ length: 11 }, (_, index) => ({ clientKey: `raw-${index}`, title: `Raw task ${index}`, description: "User description 原文" })) } };
  const before = JSON.stringify(interaction);
  await render({ interaction, draftKey: "suggest-original", onAcceptInteraction: accept, onRejectInteraction: reject });
  expect(container.textContent).toContain(messages[locale].selectTasks);
  const filter = container.querySelector<HTMLInputElement>("input")!; await edit(filter, "Raw task 1"); filter.focus();
  await act(async () => container.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  filter.focus(); const saved = localStorage.getItem("suggest-original");
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(filter.placeholder).toBe(messages[next].filterTasks); expect(filter.value).toBe("Raw task 1"); expect(document.activeElement).toBe(filter);
  expect(localStorage.getItem("suggest-original")).toBe(saved); expect(accept).not.toHaveBeenCalled(); expect(reject).not.toHaveBeenCalled();
  await click(messages[next].createSelected);
  expect(accept).toHaveBeenCalledExactlyOnceWith(interaction, interaction.payload.tasks.map(task => task.clientKey).filter(key => key !== "raw-1"));
  expect(JSON.stringify(interaction)).toBe(before);
});

it.each(locales)("keeps item pagination and decisions while changing %s, submitting only canonical enums", async locale => {
  await language(locale); const submit = vi.fn();
  const interaction = { ...pendingRequestItemVerdictsInteraction, title: null, payload: { ...pendingRequestItemVerdictsInteraction.payload, reasonLabel: undefined } };
  await render({ interaction, draftKey: "verdict-original", onSubmitInteractionVerdicts: submit });
  expect(container.querySelector(`[aria-label="${messages[locale].itemPagination}"]`)).not.toBeNull();
  await click(messages[locale].verdict.approve); await click(messages[locale].verdict.reject);
  const input = container.querySelector<HTMLTextAreaElement>("textarea")!; await edit(input, "  Raw rejection 用户  "); input.focus();
  const saved = localStorage.getItem("verdict-original");
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(input.value).toBe("  Raw rejection 用户  "); expect(document.activeElement).toBe(input); expect(localStorage.getItem("verdict-original")).toBe(saved);
  expect(container.textContent).toContain(interaction.payload.items[1].label); expect(button(messages[next].nextItem).disabled).toBe(true);
  expect(submit).not.toHaveBeenCalled(); await click(messages[next].submitRejectionReason);
  expect(container.textContent).toContain(interaction.payload.items[2].label);
  await click(messages[next].applyCount.replace("{{number}}", "2"));
  expect(submit).toHaveBeenCalledExactlyOnceWith(interaction, [{ id: interaction.payload.items[0].id, verdict: "approve" }, { id: interaction.payload.items[1].id, verdict: "reject", reason: "Raw rejection 用户" }]);
  expect(localStorage.getItem("verdict-original")).toBeNull();
});

it.each(locales)("keeps receipt disclosures and request-supplied English labels raw in %s", async locale => {
  await language(locale);
  const interaction = { ...expiredSecretProposalInteraction, status: "rejected" as const, payload: { ...expiredSecretProposalInteraction.payload, rejectLabel: "Approve", prompt: "Original prompt 原文" }, result: { version: 1 as const, outcome: "rejected" as const, reason: "Original reason 原文" } };
  await render({ interaction, presentation: "timeline" });
  const details = container.querySelector("details")!;
  await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
  expect(details.querySelector("summary")?.textContent).toBe(receipts[locale].selectedLabel.replace("{{label}}", "Approve"));
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(details.open).toBe(true); expect(details.querySelector("summary")?.textContent).toBe(receipts[next].selectedLabel.replace("{{label}}", "Approve"));
  expect(details.textContent).toContain("Original prompt 原文"); expect(details.textContent).toContain("Original reason 原文");
  expect(details.textContent).not.toContain("taskThreadReceiptsUi.");
});

it.each(locales)("keeps canonical summaries unchanged and unknown expiration values raw in %s", async locale => {
  await language(locale);
  expect(validateLocaleMessages(receipts[locale], receipts.en)).toEqual([]);
  expect(buildIssueThreadInteractionSummary(expiredSecretProposalInteraction)).toBe("Confirmation expired");
  expect(taskInteractionSummary(expiredSecretProposalInteraction)).toBe(receipts[locale].confirmationExpired);
  expect(taskQuestionExpirationReason("future_provider_expiry")).toBe("future_provider_expiry");
  expect(taskQuestionExpirationReason("superseded_by_newer_interaction")).toBe(receipts[locale].supersededInteraction);
});

it.each(locales)("does not prettify or translate an unknown interaction status in %s", async locale => {
  await language(locale);
  const interaction = { ...expiredSecretProposalInteraction, status: "provider_future_status" as typeof expiredSecretProposalInteraction.status };
  await render({ interaction });
  expect(container.querySelector('[data-testid="interaction-status-badge"]')?.textContent).toBe("provider_future_status");
});


it("keeps the opt-in English receipt semantically identical to every existing interaction fixture", () => {
  const kinds = ["suggest_tasks", "ask_user_questions", "request_confirmation", "request_checkbox_confirmation", "request_item_verdicts", "connection_intent"];
  for (const [name, value] of Object.entries(interactionFixtures)) {
    if (!value || typeof value !== "object" || !("kind" in value) || !kinds.includes(String(value.kind))) continue;
    const interaction = value as IssueThreadInteraction;
    expect(taskInteractionSummary(interaction), name).toBe(buildIssueThreadInteractionSummary(interaction));
  }
});
