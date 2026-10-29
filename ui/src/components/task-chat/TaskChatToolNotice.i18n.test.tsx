// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskChatInteractionCard } from "./TaskChatInteractionCard";
import { TaskChatSystemNotice } from "./TaskChatSystemNotice";
import { pendingToolActionWriteInteraction, executedToolActionInteraction, failedToolActionInteraction } from "@/fixtures/issueThreadInteractionFixtures";
import { i18n, taskThreadToolMessages as messages } from "@/i18n/task-thread-tools-test-resources";
import { taskThreadNoticeMessages as notices } from "@/i18n/task-thread-notice-test-resources";
import "@/i18n/task-thread-interactions-test-resources";
import "@/i18n/task-thread-chrome-test-resources";
import { taskThreadFeedbackMessages as feedback } from "@/i18n/task-thread-feedback-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import { humanizeSystemNotice } from "@/lib/system-notice-humanizer";
import type { RequestConfirmationInteraction } from "@/lib/issue-thread-interactions";

vi.mock("@/components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <div>{children}</div> }));
vi.mock("@/components/MarkdownEditor", () => ({ MarkdownEditor: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Locale = keyof typeof messages;
const locales = Object.keys(messages) as Locale[];
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => { await i18n.changeLanguage("en"); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); await i18n.changeLanguage("en"); });
const language = async (locale: Locale) => { await act(async () => { await i18n.changeLanguage(locale); }); };
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent?.trim() === label || el.getAttribute("aria-label") === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };
async function renderTool(interaction: RequestConfirmationInteraction, accept = vi.fn(), reject = vi.fn()) {
  await act(async () => root.render(<TaskChatInteractionCard item={{ id: "original", kind: "interaction", interaction }} presentation="takeover" onAcceptInteraction={accept} onRejectInteraction={reject} />));
}
it.each(locales)("validates tools and notices in %s", locale => { expect(validateLocaleMessages(messages[locale], messages.en)).toEqual([]); expect(validateLocaleMessages(notices[locale], notices.en)).toEqual([]); });

it.each(locales)("keeps an open approval menu and exact always-allow wire through %s changes", async locale => {
  await language(locale); const accept = vi.fn(); const reject = vi.fn();
  const interaction = { ...pendingToolActionWriteInteraction, payload: { ...pendingToolActionWriteInteraction.payload, toolAction: { ...pendingToolActionWriteInteraction.payload.toolAction!, rememberActionScope: "raw:provider:scope", previewMarkdown: "Raw tool preview 用户 <raw>" } } };
  const before = JSON.stringify(interaction); await renderTool(interaction, accept, reject);
  expect(container.textContent).toContain("Raw tool preview 用户 <raw>");
  const options = button(messages[locale].approvalOptions);
  await act(async () => { options.focus(); options.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!; expect(menu).not.toBeNull();
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  const choice = menu.querySelector<HTMLElement>('[role="menuitem"]')!; expect(choice.textContent).toContain(messages[next].alwaysAllow); expect(choice.title).toBe("raw:provider:scope");
  expect(accept).not.toHaveBeenCalled(); expect(reject).not.toHaveBeenCalled();
  await act(async () => choice.click()); expect(accept).toHaveBeenCalledExactlyOnceWith(interaction, undefined, undefined, true);
  expect(JSON.stringify(interaction)).toBe(before);
});

it.each(locales)("keeps in-flight tool approval disabled through %s changes", async locale => {
  await language(locale); let finish!: () => void; const accept = vi.fn(() => new Promise<void>(resolve => { finish = resolve; })); const reject = vi.fn();
  await renderTool(pendingToolActionWriteInteraction, accept, reject); await click(messages[locale].approveRun);
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(button(messages[next].approving).disabled).toBe(true); expect(button(messages[next].decline).disabled).toBe(true);
  await click(messages[next].approving); expect(accept).toHaveBeenCalledExactlyOnceWith(pendingToolActionWriteInteraction, undefined, undefined, false); expect(reject).not.toHaveBeenCalled();
  await act(async () => finish()); expect(button(messages[next].approveRun).disabled).toBe(false);
});

it.each(locales)("rerenders retained tool rejection guidance without replacing the original cause in %s", async locale => {
  await language(locale);
  const cause = { body: { code: "interaction_audience_denied", error: "Provider raw denial 原文" }, extra: { identity: "raw-object" } };
  const before = JSON.stringify(cause); const accept = vi.fn().mockRejectedValue(cause);
  await renderTool(pendingToolActionWriteInteraction, accept); await click(messages[locale].approveRun);
  expect(container.textContent).toContain("Provider raw denial 原文");
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(container.textContent).toContain("Provider raw denial 原文"); expect(accept).toHaveBeenCalledTimes(1); expect(JSON.stringify(cause)).toBe(before);
  const unexpected = vi.fn().mockRejectedValue(new Error("Try again.")); await renderTool(pendingToolActionWriteInteraction, unexpected); await click(messages[next].approveRun);
  expect(container.textContent).toContain(`Try again. ${feedback[next].tryAgain}`);
  await language(locale); expect(container.textContent).toContain(`Try again. ${feedback[locale].tryAgain}`); expect(unexpected).toHaveBeenCalledTimes(1);
});

it.each(locales)("keeps results expanded and result JSON, URL and provider failures raw in %s", async locale => {
  await language(locale);
  const rawResult = { message: "Succeeded", value: "Provider 原文", identifier: "raw-1234", amount: "$1,234.00" };
  const interaction = { ...executedToolActionInteraction, result: { ...executedToolActionInteraction.result!, toolAction: { ...executedToolActionInteraction.result!.toolAction!, resultSummary: JSON.stringify(rawResult), resultHref: "https://example.com/raw/result", rememberedAction: true } } };
  await renderTool(interaction); await click(messages[locale].showResult);
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(button(messages[next].hideResult).getAttribute("aria-expanded")).toBe("true"); expect(JSON.parse(container.querySelector("pre")!.textContent!)).toEqual(rawResult);
  expect(container.querySelector('a[href="https://example.com/raw/result"]')?.textContent).toBe(messages[next].viewResult);
  const failure = { ...failedToolActionInteraction, result: { ...failedToolActionInteraction.result!, toolAction: { ...failedToolActionInteraction.result!.toolAction!, errorMessage: "The action could not complete." } } };
  await renderTool(failure); expect(container.textContent).toContain(messages[next].failed); expect(container.textContent).toContain("The action could not complete.");
  await renderTool({ ...failure, result: { ...failure.result, toolAction: { ...failure.result.toolAction, errorMessage: undefined } } });
  expect(container.textContent).toContain(messages[next].actionFailed);
});

const noticeCases = [
  ["claudeAuth", "Latest retry failure: `claude_auth_required`. Raw diagnostic"],
  ["missingBinding", "Latest retry failure: `configuration_incomplete`. Raw diagnostic"],
  ["workspaceProblem", "Latest retry failure: `workspace_validation_failed`. Raw diagnostic"],
  ["waitingOwner", "no live execution path. Recovery owner: [You](/RAW/agents/original)"],
  ["waitingRecoveryOwner", "no live execution path. Raw diagnostic"],
  ["systemUpdate", "Provider generic diagnostic <raw> 原文"],
] as const;
it.each(locales.flatMap(locale => noticeCases.map(([key, body]) => ({ locale, key, body }))))("localizes only the generated $key title in $locale", async ({ locale, key, body }) => {
  await language(locale);
  const canonical = humanizeSystemNotice({ body });
  await act(async () => root.render(<TaskChatSystemNotice item={{ id: "notice-raw", kind: "message", author: "system", text: body }} />));
  const title = notices[locale][key].replace("{{owner}}", "You"); expect(container.textContent).toContain(title);
  const disclosure = container.querySelector<HTMLButtonElement>("button[aria-expanded]")!; await act(async () => disclosure.click());
  expect(container.textContent).toContain(body);
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(disclosure.getAttribute("aria-expanded")).toBe("true"); expect(container.textContent).toContain(notices[next][key].replace("{{owner}}", "You")); expect(container.textContent).toContain(body);
  expect(humanizeSystemNotice({ body })).toEqual(canonical); expect(canonical.title).toBe(notices.en[key].replace("{{owner}}", "You"));
});

it.each(locales)("never translates a supplied notice title even when it matches local English in %s", async locale => {
  await language(locale); const displayTitle = vi.fn(() => "unexpected translation");
  const presentation = { kind: "system_notice" as const, title: "Task paused — workspace problem", tone: "warning" as const, detailsDefaultOpen: false };
  expect(humanizeSystemNotice({ body: "workspace failed validation", presentation, displayTitle }).title).toBe(presentation.title); expect(displayTitle).not.toHaveBeenCalled();
  await act(async () => root.render(<TaskChatSystemNotice item={{ id: "notice", kind: "message", author: "system", text: "Raw provider body", presentation }} />));
  expect(container.textContent).toContain(presentation.title);
});
