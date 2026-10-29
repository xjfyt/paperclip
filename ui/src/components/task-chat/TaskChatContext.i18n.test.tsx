// @vitest-environment jsdom
import { act, forwardRef, useImperativeHandle, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskChatDescriptionBubble } from "./TaskChatDescriptionBubble";
import { TaskChatMarker } from "./TaskChatMarker";
import { TaskChatBlockerLinks, TaskChatLiveWorkLinks } from "./TaskChatBlockerLinks";
import { TaskChatPresentationProvider } from "./presentation-mode";
import { i18n, taskThreadContextMessages as messages } from "@/i18n/task-thread-context-test-resources";
import { taskThreadChromeMessages as chrome } from "@/i18n/task-thread-chrome-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import { credentialAccessNotice } from "@/lib/credential-access-notice";
import type { IssueChatLinkedRun } from "@/lib/issue-chat-messages";
import type { IssueRelationIssueSummary } from "@paperclipai/shared";
vi.mock("@/components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <div>{children}</div> }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompany: null }) }));
vi.mock("@/components/MarkdownEditor", () => ({ MarkdownEditor: forwardRef(function Editor({ value, onChange, placeholder, onSubmit }: { value: string; onChange: (value: string) => void; placeholder: string; onSubmit: () => void }, ref) {
  const textarea = useRef<HTMLTextAreaElement>(null); useImperativeHandle(ref, () => ({ focus: () => textarea.current?.focus() }));
  return <><textarea ref={textarea} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} /><button data-testid="submit-description" onClick={onSubmit}>Submit fixture</button></>;
}) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Locale = keyof typeof messages;
const locales = Object.keys(messages) as Locale[];
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
beforeEach(async () => { await i18n.changeLanguage("en"); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); await i18n.changeLanguage("en"); vi.restoreAllMocks(); });
const language = async (locale: Locale) => { await act(async () => { await i18n.changeLanguage(locale); }); };
const render = async (children: ReactNode) => { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>)); };
const click = async (el: HTMLElement) => { await act(async () => el.click()); };
const nextLocale = (locale: Locale) => locale === "ja" ? "es" : "ja";
const fill = (text: string, values: Record<string, string>) => text.replace(/{{(.*?)}}/g, (_, key: string) => values[key]);
it.each(locales)("validates task context copy in %s", locale => expect(validateLocaleMessages(messages[locale], messages.en)).toEqual([]));

it.each(locales)("retains the real description editor draft and focus through %s", async locale => {
  await language(locale); const save = vi.fn().mockResolvedValue(undefined); const brief = { description: "", author: "human" as const, onSave: save };
  await render(<TaskChatDescriptionBubble brief={brief} />); const ghost = container.querySelector<HTMLButtonElement>("button")!; expect(ghost.textContent).toBe(messages[locale].addDescription); await click(ghost);
  const input = container.querySelector<HTMLTextAreaElement>("textarea")!; const raw = "Raw description **原文** $1,234.00\nhttps://example.com/raw";
  await act(async () => { input.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, raw); input.dispatchEvent(new Event("input", { bubbles: true })); });
  const next = nextLocale(locale); await language(next); expect(container.querySelector("textarea")).toBe(input); expect(input.placeholder).toBe(messages[next].addDescription); expect(input.value).toBe(raw); expect(document.activeElement).toBe(input); expect(save).not.toHaveBeenCalled();
  await click(container.querySelector<HTMLButtonElement>('[data-testid="submit-description"]')!); expect(save).toHaveBeenCalledExactlyOnceWith(raw);
});

const blocker: IssueRelationIssueSummary = { id: "blocker-raw", identifier: "RAW-1234", title: "Running", status: "blocked", priority: "medium", assigneeAgentId: null, assigneeUserId: null };
it.each(locales.flatMap(locale => (["production", "streamlined"] as const).map(mode => ({ locale, mode }))))("localizes $mode blockers while retaining raw IDs, names and URLs in $locale", async ({ locale, mode }) => {
  await language(locale); const before = JSON.stringify(blocker);
  await render(<TaskChatPresentationProvider mode={mode}><TaskChatBlockerLinks directBlocker={blocker} ultimateBlocker={{ ...blocker, id: "root-raw", identifier: "RAW-5678" }} placement="bottom" /><TaskChatLiveWorkLinks liveWork={{ steps: [{ blocker, status: "running" }, { blocker: { ...blocker, id: "done-raw" }, status: "done" }], nowRunning: [{ ...blocker, id: "live-raw", identifier: "RAW-9012" }] }} placement="bottom" /></TaskChatPresentationProvider>);
  const links = [...container.querySelectorAll<HTMLAnchorElement>("a")].map(link => link.getAttribute("href")); const next = nextLocale(locale); await language(next);
  expect(container.textContent).toContain(messages[next][mode === "production" ? "blocked" : "stillBlocked"]); expect(container.textContent).toContain(messages[next][mode === "production" ? "ultimatelyBlocked" : "rootRemains"]); expect(container.textContent).toContain(messages[next].nowRunning);
  expect(container.textContent).toContain("Running"); expect(container.textContent).toContain("RAW-1234"); expect([...container.querySelectorAll("a")].map(link => link.getAttribute("href"))).toEqual(links); expect(JSON.stringify(blocker)).toBe(before);
  expect(container.querySelector(`[aria-label="${messages[next].running}"]`)).not.toBeNull(); expect(container.querySelector(`[aria-label="${messages[next].done}"]`)).not.toBeNull();
});

it.each(locales)("keeps marker disclosure, raw label/detail and explicit retry through %s", async locale => {
  await language(locale); const retry = vi.fn(); const item = { id: "marker-raw", kind: "marker" as const, variant: "interrupted" as const, label: "Run failed", detail: "Provider raw diagnostic <raw> 原文", collapsible: true, runHref: "/agents/raw/runs/run-1234", planHref: "/tasks/raw-plan" };
  await render(<TaskChatMarker item={item} onTryAgain={retry} />); const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!; await click(toggle);
  const next = nextLocale(locale); await language(next); expect(toggle.getAttribute("aria-expanded")).toBe("true"); expect(container.textContent).toContain(item.label); expect(container.textContent).toContain(item.detail); expect(retry).not.toHaveBeenCalled();
  expect(container.querySelector('a[href="/agents/raw/runs/run-1234"]')?.textContent).toBe(messages[next].viewRun); expect(container.querySelector('a[href="/tasks/raw-plan"]')?.textContent).toBe(messages[next].viewPlan);
  const button = container.querySelector<HTMLButtonElement>('[data-testid="task-chat-run-failed-try-again"]')!; expect(button.textContent).toBe(chrome[next].tryAgain); await click(button); expect(retry).toHaveBeenCalledExactlyOnceWith();
  await render(<TaskChatMarker item={item} onTryAgain={retry} tryAgainPending />); expect(button.disabled).toBe(true); expect(button.textContent).toBe(chrome[next].tryingAgain);
});

const run: IssueChatLinkedRun = { runId: "run-raw", agentId: "agent/raw", agentName: "This agent", status: "failed", createdAt: "2026-10-01T00:00:00Z", startedAt: null, responsibleUserId: "user-raw", resultJson: { configurationIncomplete: { selectionFailure: "ai_connection_credential_not_shared", credentialAccess: { connectionName: "an AI credential" } } } };
it.each(locales.flatMap(locale => (["self", "named", "responsible"] as const).map(kind => ({ locale, kind }))))("uses explicit $kind credential provenance, not English names, in $locale", async ({ locale, kind }) => {
  await language(locale); const source = kind === "responsible" ? { ...run, agentName: undefined, resultJson: null, error: "This credential is not shared with the responsible user" } : run;
  const currentUser = kind === "self" ? "user-raw" : "other-raw"; const userLabels = kind === "named" ? new Map([["user-raw", "you"]]) : undefined;
  const canonical = credentialAccessNotice(source, currentUser, userLabels)!; const display = credentialAccessNotice(source, currentUser, userLabels, { includeDisplaySource: true })!;
  const { displaySource, ...original } = display; expect(original).toEqual(canonical); expect(canonical).not.toHaveProperty("displaySource"); expect(displaySource?.deniedUserKind).toBe(kind);
  const retry = vi.fn(); await render(<TaskChatMarker item={{ id: "credential-raw", kind: "marker", variant: "interrupted", label: "Raw", credentialAccess: display, runHref: "/raw/run" }} onTryAgain={retry} />);
  const next = nextLocale(locale); await language(next);
  const values = { agent: kind === "responsible" ? messages[next].thisAgent : "This agent", credential: kind === "responsible" ? messages[next].aiCredential : "an AI credential", user: kind === "responsible" ? messages[next].responsibleUser : "you" };
  expect(container.textContent).toContain(fill(messages[next][kind === "self" ? "credentialSelf" : "credentialUser"], values)); expect(container.querySelector('a[href="/agents/agent%2Fraw/runtime"]')?.textContent).toBe(messages[next].changeConnection);
  expect(container.querySelector('[data-testid="task-chat-run-failed-try-again"]')).toBeNull(); expect(retry).not.toHaveBeenCalled(); expect(credentialAccessNotice(source, currentUser, userLabels)).toEqual(canonical);
});
