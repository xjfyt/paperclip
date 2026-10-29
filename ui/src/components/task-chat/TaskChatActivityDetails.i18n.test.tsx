// @vitest-environment jsdom
import "@/i18n/task-thread-run-state-test-resources";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskChatProtocolActivityRow, TaskChatProtocolActivityDetails } from "./TaskChatProtocolActivityRow";
import { TaskChatRunnerActivityGroup } from "./TaskChatRunnerActivityGroup";
import { TaskChatThreadView } from "./TaskChatThreadView";
import { TaskChatToolCard } from "./TaskChatToolCard";
import { TaskChatExpansionState } from "./expansion-state";
import { i18n, taskThreadActivityMessages as messages } from "@/i18n/task-thread-activity-test-resources";
import "@/i18n/tool-activity-test-resources";
import "@/i18n/completed-activity-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import type { TaskChatProviderActivityItem, TaskChatToolItem, TaskChatWorkspaceChangeItem, TaskChatWorkspaceFileItem } from "./task-chat-model";
vi.mock("@/components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <div>{children}</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Locale = keyof typeof messages;
const locales = Object.keys(messages) as Locale[];
let container: HTMLDivElement;
let root: Root;
let memory: Map<string, boolean>;
beforeEach(async () => { await i18n.changeLanguage("en"); container = document.createElement("div"); document.body.append(container); root = createRoot(container); memory = new Map(); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); await i18n.changeLanguage("en"); });
const language = async (locale: Locale) => { await act(async () => { await i18n.changeLanguage(locale); }); };
const render = async (children: ReactNode) => { await act(async () => root.render(<MemoryRouter><TaskChatExpansionState.Provider value={memory}>{children}</TaskChatExpansionState.Provider></MemoryRouter>)); };
const click = async (el: HTMLElement) => { await act(async () => el.click()); };
const nextLocale = (locale: Locale) => locale === "ja" ? "es" : "ja";
const research: TaskChatProviderActivityItem = { id: "research-raw", kind: "protocol", surface: "provider_activity", family: "research", eventType: "research.completed", status: "completed", title: "Provider title", summary: "Raw provider summary 原文", details: [{ label: "Query", value: "raw:query /raw/path" }, { label: "Warning", value: "Raw provider diagnostic 原文" }], steps: [], children: [], links: Array.from({ length: 6 }, (_, index) => ({ href: `https://example.com/raw/${index}`, label: "Show fewer results", description: "Raw provider description" })), output: "Provider output", outputTruncated: true };
it.each(locales)("validates activity detail copy in %s", locale => expect(validateLocaleMessages(messages[locale], messages.en)).toEqual([]));
it.each(locales.flatMap(locale => (["row", "default-group"] as const).map(host => ({ locale, host }))))("keeps $host research disclosure and expanded links through $locale", async ({ locale, host }) => {
  await language(locale); const before = JSON.stringify(research);
  await render(host === "row" ? <TaskChatProtocolActivityRow item={research} /> : <TaskChatRunnerActivityGroup item={{ id: "phase-raw", kind: "activity_phase", items: [research], summary: "Raw summary", active: false }} defaultExpanded />);
  const toggle = container.querySelector<HTMLButtonElement>(host === "row" ? '[data-testid="task-chat-protocol-activity-row"] button' : '[data-activity-item-id="research-raw"] button')!; await click(toggle);
  const more = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === messages[locale].moreResults_one.replace("{{number}}", "1"))!; await click(more);
  const next = nextLocale(locale); await language(next); expect(toggle.getAttribute("aria-expanded")).toBe("true"); expect(container.querySelectorAll(`ol[aria-label="${messages[next].sources}"] li`)).toHaveLength(6);
  expect(container.textContent).toContain(messages[next].query); expect(container.textContent).toContain(messages[next].fewerResults); expect(container.textContent).toContain(messages[next].additionalOutput); expect(container.textContent).toContain("raw:query /raw/path"); expect(container.textContent).toContain("Raw provider diagnostic 原文");
  expect([...container.querySelectorAll<HTMLAnchorElement>("a")].map(link => [link.getAttribute("href"), link.textContent])).toEqual(research.links.map(link => [link.href, link.label])); expect(JSON.stringify(research)).toBe(before);
});

it.each(locales)("formats file counts only for display while keeping paths, operations and numeric data raw in %s", async locale => {
  await language(locale); const item: TaskChatWorkspaceChangeItem = { id: "changes-raw", kind: "protocol", surface: "workspace_change", changeSetId: "change-1234", revision: 1234, source: "runner_verified", complete: true, files: Array.from({ length: 10 }, (_, index) => ({ path: `/raw/file-${index}.tsx`, operation: "modify", previousPath: null, additions: 1234, deletions: 5678, binary: false, diff: "Raw code diff" })), totals: { files: 10, additions: 12340, deletions: 56780 }, patchArtifactRef: null }; const before = JSON.stringify(item);
  await render(<TaskChatProtocolActivityDetails item={item} />); const next = nextLocale(locale); await language(next);
  expect(container.querySelectorAll(`ul[aria-label="${messages[next].changedFiles}"] li`)).toHaveLength(8); expect(container.textContent).toContain(messages[next].moreFiles_other.replace("{{number}}", "2")); expect(container.textContent).toContain(`+${new Intl.NumberFormat(next).format(1234)}`); expect(container.textContent).toContain("modify"); expect(container.textContent).toContain("/raw/file-0.tsx"); expect(container.textContent).not.toContain("Raw code diff"); expect(JSON.stringify(item)).toBe(before);
});

it.each(locales)("preserves provider labels, child status, output and summaries in %s", async locale => {
  await language(locale); const item: TaskChatProviderActivityItem = { ...research, family: "delegation", details: [{ label: "Error", value: "Warning" }], steps: [{ id: "step-1234", label: "Plan steps", status: "completed" }], children: [{ id: "child-raw", title: "Delegated agents", status: "provider_custom_status", metadata: "raw/id-1234", summary: "Raw child summary" }], output: "Raw code output $1,234.00", outputTruncated: true }; const before = JSON.stringify(item);
  await render(<TaskChatProtocolActivityDetails item={item} />); const next = nextLocale(locale); await language(next);
  expect(container.querySelector(`[aria-label="${messages[next].planSteps}"]`)).not.toBeNull(); expect(container.querySelector(`[aria-label="${messages[next].delegatedAgents}"]`)).not.toBeNull(); expect(container.textContent).toContain(messages[next].outputTruncated);
  for (const raw of ["Error", "Warning", "Plan steps", "Delegated agents", "provider_custom_status", "raw/id-1234", item.output]) expect(container.textContent).toContain(raw); expect(JSON.stringify(item)).toBe(before);
});

it.each(locales)("translates file preview fallback but never preview code or path in %s", async locale => {
  await language(locale); const item: TaskChatWorkspaceFileItem = { id: "file-raw", kind: "protocol", surface: "workspace_file", referenceId: "reference-raw", source: "runner_verified", path: "/raw/file-1234.ts", displayName: "Preview unavailable.", mediaType: "text/plain", presentation: "code", line: 1234, preview: null, previewTruncated: true };
  await render(<TaskChatProtocolActivityDetails item={item} />); expect(container.textContent).toContain(messages[locale].previewUnavailable); const next = nextLocale(locale); await language(next); expect(container.textContent).toContain(messages[next].previewTruncated); expect(container.textContent).toContain(item.path);
  await render(<TaskChatProtocolActivityDetails item={{ ...item, preview: "Preview unavailable. // raw code $1,234.00" }} />); expect(container.textContent).toContain("Preview unavailable. // raw code $1,234.00");
});

it.each(locales.flatMap(locale => (["card", "thread"] as const).map(host => ({ locale, host }))))("keeps $host tool details open without translating names, decision or code in $locale", async ({ locale, host }) => {
  await language(locale); const item: TaskChatToolItem = { id: "tool-raw", kind: "tool", name: "Changed", rawName: "provider_custom_tool", status: "interrupted", decision: "allowed", target: "/raw/path-1234.ts", detail: "Interrupted // provider raw", diff: { path: "/raw/path-1234.ts", added: 1234, removed: 5678 } }; const before = JSON.stringify(item);
  await render(host === "card" ? <TaskChatToolCard item={item} /> : <TaskChatThreadView items={[item]} scroll={false} />);
  const toggle = container.querySelector<HTMLButtonElement>('[data-testid="task-chat-tool-card"] button')!; await click(toggle); const next = nextLocale(locale); await language(next);
  expect(toggle.getAttribute("aria-expanded")).toBe("true"); expect(container.textContent).toContain(messages[next].interrupted); expect(container.textContent).toContain(messages[next].changed); expect(container.textContent).toContain("Changed"); expect(container.textContent).toContain("allowed"); expect(container.textContent).toContain(item.detail); expect(container.textContent).toContain(`+${new Intl.NumberFormat(next).format(1234)}`); expect(JSON.stringify(item)).toBe(before);
});

it.each(locales)("localizes only absent notice content and leaves supplied provider text raw in %s", async locale => {
  await language(locale); const item: TaskChatProviderActivityItem = { ...research, family: "provider_notice", summary: undefined, details: [{ label: "Severity", value: "warning" }, { label: "Code", value: "provider_raw_code" }] };
  await render(<TaskChatProtocolActivityRow item={item} />); expect(container.textContent).toContain(messages[locale].emptyNotice); const details = container.querySelector<HTMLDetailsElement>("details")!; details.open = true; const next = nextLocale(locale); await language(next); expect(details.open).toBe(true); expect(container.textContent).toContain(messages[next].warning); expect(details.querySelector("summary")?.textContent).toBe(messages[next].details);
  await render(<TaskChatProtocolActivityRow item={{ ...item, summary: "The provider reported a notice without a message." }} />); expect(container.textContent).toContain("The provider reported a notice without a message."); expect(container.textContent).toContain("provider_raw_code");
});
