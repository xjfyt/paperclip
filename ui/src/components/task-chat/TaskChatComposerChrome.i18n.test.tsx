// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposerAddMenu, ComposerModeChip, ComposerPrivacyChip } from "./ComposerAddMenu";
import { ComposerWorktreePicker } from "./ComposerWorktreePicker";
import { SearchableSelect } from "@/components/SearchableSelect";
import { i18n, taskThreadComposerMessages as messages } from "@/i18n/task-thread-composer-test-resources";
import { searchableSelectMessages as selectMessages } from "@/i18n/searchable-select-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import { workModeMetaFor } from "@/lib/work-mode-meta";
import type { ExecutionWorkspaceSummary } from "@paperclipai/shared";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Locale = keyof typeof messages;
const locales = Object.keys(messages) as Locale[];
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en"); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); await i18n.changeLanguage("en"); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const language = async (locale: Locale) => { await act(async () => { await i18n.changeLanguage(locale); }); };
const render = async (children: ReactNode) => { await act(async () => root.render(children)); };
const click = async (el: HTMLElement) => { await act(async () => el.click()); };
const key = async (el: HTMLElement, value: string) => { await act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })); }); };
const inputText = async (el: HTMLInputElement, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); }); };
const testId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const nextLocale = (locale: Locale) => locale === "ja" ? "es" : "ja";
it.each(locales)("validates composer and select dictionaries in %s", locale => { expect(validateLocaleMessages(messages[locale], messages.en)).toEqual([]); expect(validateLocaleMessages(selectMessages[locale], selectMessages.en)).toEqual([]); });

it.each(locales.flatMap(locale => [false, true].map(mobile => ({ locale, mobile }))))("keeps the Add menu open and focused in $locale mobile=$mobile with canonical mode requests", async ({ locale, mobile }) => {
  await language(locale); const change = vi.fn(); const attach = vi.fn(); const goal = vi.fn(); const privacy = vi.fn();
  await render(<ComposerAddMenu mode="standard" onModeChange={change} onAttachFile={attach} onGoal={goal} privacy={{ private: false, onChange: privacy }} mobile={mobile} triggerTestId="add-trigger" menuTestId="add-menu" />);
  if (mobile) await click(testId("add-trigger")); else await key(testId("add-trigger"), "ArrowDown");
  const menu = testId("add-menu"); expect(menu).not.toBeNull(); expect(menu.textContent).toContain(messages[locale].files); expect(menu.textContent).toContain(messages[locale].planDetail);
  await act(async () => testId("composer-add-ask").focus()); const focus = document.activeElement;
  const next = nextLocale(locale); await language(next); expect(testId("add-menu")).toBe(menu); expect(document.activeElement).toBe(focus); expect(menu.textContent).toContain(messages[next].askDetail);
  expect(change).not.toHaveBeenCalled(); expect(attach).not.toHaveBeenCalled(); expect(goal).not.toHaveBeenCalled(); expect(privacy).not.toHaveBeenCalled();
  await click(testId("composer-add-ask")); expect(change).toHaveBeenCalledExactlyOnceWith("ask"); expect(testId("add-menu")).toBeNull();
});

it.each(locales)("closes the mobile Add menu without firing actions in %s", async locale => {
  await language(locale); const change = vi.fn(); await render(<ComposerAddMenu mode="planning" onModeChange={change} mobile triggerTestId="add-trigger" />);
  await click(testId("add-trigger")); const next = nextLocale(locale); await language(next);
  await click(document.querySelector<HTMLElement>(`[aria-label="${messages[next].closeAdd}"]`)!); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(change).not.toHaveBeenCalled(); await vi.waitFor(() => expect(document.activeElement).toBe(testId("add-trigger")));
});

it.each(locales)("localizes chips without translating inherited privacy text or changing canonical metadata in %s", async locale => {
  await language(locale); const remove = vi.fn(); const privacy = vi.fn(); const inherited = "Only you and people you share with can read this task";
  await render(<><ComposerModeChip mode="planning" onRemove={remove} testId="mode-chip" /><ComposerPrivacyChip inherited={inherited} onRemove={privacy} /></>);
  const chip = testId("mode-chip"); chip.focus(); const next = nextLocale(locale); await language(next);
  expect(document.activeElement).toBe(chip); expect(chip.textContent).toContain(messages[next].plan); expect(chip.getAttribute("aria-label")).toBe(messages[next].removeMode.replace("{{mode}}", messages[next].plan));
  expect(testId("composer-private-chip").title).toBe(inherited); expect((testId("composer-private-chip") as HTMLButtonElement).disabled).toBe(true); expect(workModeMetaFor("planning").label).toBe("Plan mode");
  await click(chip); expect(remove).toHaveBeenCalledTimes(1); expect(privacy).not.toHaveBeenCalled();
  await render(<ComposerPrivacyChip onRemove={privacy} />); expect(testId("composer-private-chip").title).toBe(messages[next].privacyExplanation); await click(testId("composer-private-chip")); expect(privacy).toHaveBeenCalledTimes(1);
});

const workspace: ExecutionWorkspaceSummary = { id: "workspace-raw-1234", name: "New worktree", mode: "isolated_workspace", status: "active", cwd: "/raw/path", branchName: "raw/branch-1234", projectWorkspaceId: null, lastUsedAt: new Date("2026-10-01T00:00:00Z") };
it.each(locales)("retains worktree query, focus and raw workspace identity across %s", async locale => {
  await language(locale); const change = vi.fn(); const retry = vi.fn(); const before = JSON.stringify(workspace);
  await render(<ComposerWorktreePicker mode="reuse_existing" workspaceId={workspace.id} workspaces={[workspace]} onChange={change} loading={false} error={false} onRetry={retry} />);
  expect(container.textContent).toContain(workspace.name); await click(container.querySelector<HTMLButtonElement>('[role="combobox"]')!);
  const input = document.querySelector<HTMLInputElement>("input")!; await inputText(input, "raw/branch"); input.focus();
  const next = nextLocale(locale); await language(next); expect(document.activeElement).toBe(input); expect(input.value).toBe("raw/branch"); expect(input.placeholder).toBe(messages[next].searchWorktrees);
  const option = document.querySelector<HTMLElement>('[role="option"]')!; expect(option.textContent).toContain(workspace.name); expect(option.textContent).toContain(workspace.branchName); expect(change).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
  await click(option); expect(change).toHaveBeenCalledExactlyOnceWith("reuse_existing", workspace.id); expect(JSON.stringify(workspace)).toBe(before);
});

it.each(locales)("translates worktree defaults and explicit retry without changing canonical mode in %s", async locale => {
  await language(locale); const change = vi.fn(); const retry = vi.fn();
  const picker = (loading: boolean, error: boolean) => <ComposerWorktreePicker mode="shared_workspace" workspaceId="" workspaces={[]} onChange={change} loading={loading} error={error} onRetry={retry} />;
  await render(picker(true, false)); await click(container.querySelector<HTMLButtonElement>('[role="combobox"]')!); expect(document.body.textContent).toContain(messages[locale].loadingWorktrees);
  const next = nextLocale(locale); await language(next); await render(picker(false, true)); expect(document.body.textContent).toContain(messages[next].loadFailed); expect(retry).not.toHaveBeenCalled();
  const retryButton = document.querySelector<HTMLButtonElement>('[role="status"] button')!; await click(retryButton); expect(retry).toHaveBeenCalledTimes(1); expect(change).not.toHaveBeenCalled();
  await render(picker(false, false)); expect(document.body.textContent).toContain(messages[next].noWorktrees);
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(el => el.textContent?.includes(messages[next].modes.isolated_workspace.label))!;
  await click(option); expect(change).toHaveBeenCalledExactlyOnceWith("isolated_workspace", "");
});

it.each(locales)("localizes selector defaults but keeps explicit copy and option objects raw in %s", async locale => {
  await language(locale); const change = vi.fn(); const raw = { key: "raw-key", value: "raw-id", label: "No options found." };
  const selector = (loading: boolean, explicit = false) => <SearchableSelect value="" groups={[{ id: "raw-group", label: "Loading...", options: [raw] }]} onValueChange={change} placeholder="Raw placeholder" loading={loading} {...(explicit ? { searchPlaceholder: "Search...", loadingMessage: "Loading...", emptyMessage: "No options found." } : {})} />;
  await render(selector(true)); await click(container.querySelector<HTMLButtonElement>('[role="combobox"]')!); expect(document.body.textContent).toContain(selectMessages[locale].loading);
  const input = document.querySelector<HTMLInputElement>("input")!; const next = nextLocale(locale); await language(next); expect(input.placeholder).toBe(selectMessages[next].search); expect(document.body.textContent).toContain(selectMessages[next].loading);
  await render(selector(false)); await inputText(input, "not-a-match"); expect(document.body.textContent).toContain(selectMessages[next].empty);
  await render(selector(false, true)); expect(input.value).toBe("not-a-match"); expect(input.placeholder).toBe("Search..."); expect(document.body.textContent).toContain("No options found."); expect(change).not.toHaveBeenCalled();
  await inputText(input, ""); await click(document.querySelector<HTMLElement>('[role="option"]')!); expect(change).toHaveBeenCalledExactlyOnceWith("raw-id", raw);
});
