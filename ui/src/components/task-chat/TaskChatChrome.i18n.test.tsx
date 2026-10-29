// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskChatPausedTakeover } from "./TaskChatPausedTakeover";
import { TaskChatTurnStatusIsland, type TaskChatTurnStatusModel } from "./TaskChatTurnStatusIsland";
import { TaskChatProjectCreatedCard } from "./TaskChatProjectCreatedCard";
import { TaskChatSkillCreatedCard } from "./TaskChatSkillCreatedCard";
import { TaskChatThinking } from "./TaskChatThinking";
import { TaskChatSystemNotice } from "./TaskChatSystemNotice";
import { TaskMessageScroller } from "./TaskMessageScroller";
import { i18n, taskThreadChromeMessages as messages } from "@/i18n/task-thread-chrome-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import type { TaskChatMessageItem, TaskChatProjectCreatedItem, TaskChatThinkingItem } from "./task-chat-model";

vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompany: null }) }));
vi.mock("@/components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <div>{children}</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Locale = keyof typeof messages;
const locales = Object.keys(messages) as Locale[];
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => { await i18n.changeLanguage("en"); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); await i18n.changeLanguage("en"); vi.restoreAllMocks(); });
const language = async (locale: Locale) => { await act(async () => { await i18n.changeLanguage(locale); }); };
const render = async (children: ReactNode) => { await act(async () => root.render(<MemoryRouter>{children}</MemoryRouter>)); };
const fill = (text: string, values: Record<string, string>) => text.replace(/{{(.*?)}}/g, (_, key: string) => values[key]);
it.each(locales)("validates chrome messages in %s", locale => expect(validateLocaleMessages(messages[locale], messages.en)).toEqual([]));

it.each(locales.flatMap(locale => (["leaf", "subtree"] as const).map(scope => ({ locale, scope }))))("keeps $scope paused through $locale hot-switch without resuming", async ({ locale, scope }) => {
  await language(locale); const resume = vi.fn();
  await render(<TaskChatPausedTakeover scope={scope} hasDraft error="Provider pause error <raw>" onResume={resume} />);
  expect(container.textContent).toContain(messages[locale][scope === "leaf" ? "taskPaused" : "subtreePaused"]);
  expect(container.textContent).toContain(messages[locale].draftSaved);
  const button = container.querySelector<HTMLButtonElement>("button")!; button.focus();
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(document.activeElement).toBe(button); expect(container.textContent).toContain("Provider pause error <raw>"); expect(resume).not.toHaveBeenCalled();
  expect(button.textContent).toContain(messages[next][scope === "leaf" ? "resumeTask" : "resumeSubtree"]);
  await act(async () => button.click()); expect(resume).toHaveBeenCalledExactlyOnceWith(expect.anything());
  await render(<TaskChatPausedTakeover scope={scope} pending onResume={resume} />);
  expect(button.disabled).toBe(true); expect(button.textContent).toContain(messages[next].resuming);
});

it.each(locales)("preserves pause and project navigation, created skill identity and raw names in %s", async locale => {
  await language(locale); const open = vi.fn();
  const project: TaskChatProjectCreatedItem = { id: "created-project", kind: "project_created", projectId: "project-raw", name: "Project created", description: "Raw project body 用户", timestamp: "2026-09-16T12:00:00Z", repositories: [{ id: "repo-id", name: "Repo name 原文", url: "https://example.com/raw/repo" }] };
  await render(<><TaskChatPausedTakeover scope="subtree" resumeHref="/tasks/raw-resume" /><TaskChatProjectCreatedCard item={project} /><TaskChatSkillCreatedCard item={{ id: "created-skill", kind: "skill_created", skillId: "skill-raw", name: "Skill created", description: "Raw skill body 用户", timestamp: "2026-09-16T12:00:00Z" }} onOpen={open} /></>);
  expect(container.textContent).toContain(messages[locale].projectCreated); expect(container.textContent).toContain(messages[locale].skillCreated);
  expect(container.querySelector('a[href="/tasks/raw-resume"]')?.textContent).toBe(messages[locale].resumeSubtree);
  expect(container.querySelector('a[href="/projects/project-raw"]')?.textContent).toBe("Project created");
  expect(container.querySelector('a[href="https://example.com/raw/repo"]')?.textContent).toBe("Repo name 原文");
  expect(container.textContent).toContain("Raw project body 用户"); expect(container.textContent).toContain("Raw skill body 用户");
  const next = locale === "ja" ? "es" : "ja"; await language(next); expect(open).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>("article button")!.click()); expect(open).toHaveBeenCalledExactlyOnceWith("skill-raw", "Skill created");
});

it.each(locales)("keeps the plan popover pinned, raw steps and numeric state unchanged in %s", async locale => {
  await language(locale);
  const model: TaskChatTurnStatusModel = { segments: [{ kind: "plan", currentStepIndex: 1, complete: false, steps: [{ id: "raw-0", label: "Approved raw step", status: "completed" }, { id: "raw-1", label: "Provider raw step 用户", status: "in_progress" }] }, { kind: "workspace_diff", files: 1234, additions: 5678, deletions: 1234 }] };
  const before = JSON.stringify(model); await render(<TaskChatTurnStatusIsland model={model} />);
  const button = container.querySelector<HTMLButtonElement>("button")!;
  expect(button.textContent).toContain(fill(messages[locale].filesChanged_other, { number: new Intl.NumberFormat(locale).format(1234) }));
  await act(async () => button.click()); expect(document.querySelector(`[aria-label="${messages[locale].turnChecklist}"]`)).not.toBeNull();
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(document.querySelector(`[aria-label="${messages[next].turnChecklist}"]`)?.textContent).toContain("Provider raw step 用户");
  expect(button.textContent).toContain(`+${new Intl.NumberFormat(next).format(5678)}`); expect(JSON.stringify(model)).toBe(before);
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector(`[aria-label="${messages[next].turnChecklist}"]`)).toBeNull();
});

it.each(locales)("keeps reasoning and system disclosure bodies raw while translating their local controls in %s", async locale => {
  await language(locale); const retry = vi.fn();
  const thinking: TaskChatThinkingItem = { id: "thinking", kind: "thinking", lines: ["Reasoning raw body 原文"], streaming: true };
  const notice: TaskChatMessageItem = { id: "notice", kind: "message", author: "system", text: "No live execution path. Provider diagnostic 原文", presentation: { kind: "system_notice", title: "No live execution path" } };
  await render(<><TaskChatThinking item={thinking} /><TaskChatSystemNotice item={notice} onTryAgainNoLiveExecutionPath={retry} /></>);
  const reasoningButton = container.querySelector<HTMLButtonElement>('[data-testid="task-chat-thinking"] button')!;
  await act(async () => reasoningButton.click());
  const disclosure = container.querySelector<HTMLButtonElement>('[data-testid="task-chat-system-notice"] button[aria-expanded]')!;
  await act(async () => disclosure.click());
  const next = locale === "ja" ? "es" : "ja"; await language(next);
  expect(reasoningButton.getAttribute("aria-expanded")).toBe("true"); expect(disclosure.getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain(thinking.lines[0]); expect(container.textContent).toContain(notice.text); expect(retry).not.toHaveBeenCalled();
  const retryButton = container.querySelector<HTMLButtonElement>('[data-testid="task-chat-no-live-path-try-again"]')!;
  expect(retryButton.textContent).toBe(messages[next].tryAgain); await act(async () => retryButton.click()); expect(retry).toHaveBeenCalledExactlyOnceWith();
});

it.each(locales)("updates scroll-to-latest accessibility copy without moving the viewport in %s", async locale => {
  await language(locale); await render(<TaskMessageScroller contentKey="same"><div>Raw messages 用户</div></TaskMessageScroller>);
  const viewport = container.querySelector<HTMLElement>('[data-testid="task-chat-scroller"]')!;
  Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 1000 }); Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 400 });
  await act(async () => { viewport.scrollTop = 100; viewport.dispatchEvent(new Event("scroll", { bubbles: true })); });
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${messages[locale].scrollLatest}"]`)!;
  expect(button).not.toBeNull();
  const next = locale === "ja" ? "es" : "ja"; await language(next); expect(viewport.scrollTop).toBe(100); expect(button.getAttribute("aria-label")).toBe(messages[next].scrollLatest);
  await act(async () => button.click()); expect(viewport.scrollTop).toBe(1000);
});

it("does not reopen a dismissed plan through Escape focus restoration without a locale change", async () => {
  const model: TaskChatTurnStatusModel = { segments: [{ kind: "plan", currentStepIndex: 0, complete: false, steps: [{ id: "step", label: "Raw step", status: "in_progress" }] }] };
  await render(<TaskChatTurnStatusIsland model={model} />);
  const button = container.querySelector<HTMLButtonElement>("button")!;
  await act(async () => button.click());
  expect(document.querySelector(`[aria-label="${messages.en.turnChecklist}"]`)).not.toBeNull();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector(`[aria-label="${messages.en.turnChecklist}"]`)).toBeNull();
  expect(document.activeElement).toBe(button);
});
