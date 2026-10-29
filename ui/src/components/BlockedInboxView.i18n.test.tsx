// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Issue, IssueBlockedInboxAttention } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockedInboxView } from "./BlockedInboxView";
import { blockedInboxMessages, i18n } from "../i18n/blocked-inbox-test-resources";
import { blockedSeverityDisplay, stoppedAgeDisplay } from "../i18n/blocked-inbox-display";
import { validateLocaleMessages } from "../i18n/locale-validation";
import { defaultIssueFilterState } from "../lib/issue-filters";
const state = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../api/issues", () => ({ issuesApi: { list: state.list } }));
vi.mock("@/lib/router", () => ({ Link: ({ children, to, disableIssueQuicklook: _quicklook, issuePrefetch: _prefetch, ...props }: ComponentProps<"a"> & { to: string; disableIssueQuicklook?: boolean; issuePrefetch?: Issue | null }) => <a {...props} href={to}>{children}</a> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const attention = {
  kind: "blocked", state: "needs_attention", reason: "pending_board_decision", severity: "high", stoppedSinceAt: "2026-10-28T00:00:00Z",
  owner: { type: "external", agentId: null, userId: null, label: "Raw owner <b> Ω" }, action: { label: "Raw action", detail: null },
  sourceIssue: null, leafIssue: null, recoveryIssue: null, approvalId: null, interactionId: null, sampleIssueIdentifier: null,
  redaction: { externalDetailsRedacted: false, secretFieldsOmitted: true },
} satisfies IssueBlockedInboxAttention;
const issue = {
  id: "issue1", companyId: "c1", identifier: "PAP-42", title: "Raw title <b> Ω", status: "blocked", priority: "medium", workMode: "standard", issueNumber: 42,
  blockedInboxAttention: attention, createdAt: new Date("2026-10-27T00:00:00Z"), updatedAt: new Date("2026-10-28T00:00:00Z"),
} as Issue;
const props = {
  companyId: "c1", searchQuery: "", agentNameById: new Map<string, string>(), issueLinkState: null, groupBy: "blocker_type", sortBy: "urgency",
  issueFilters: defaultIssueFilterState, currentUserId: "viewer", liveIssueIds: new Set<string>(), subtreeLiveCounts: new Map<string, number>(), workspaceFilterContext: {},
  showStatusColumn: true, showIdentifierColumn: true, showUpdatedColumn: true,
} satisfies ComponentProps<typeof BlockedInboxView>;
let host: HTMLDivElement, root: Root, client: QueryClient;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function language(locale: string) { await act(async () => { await i18n.changeLanguage(locale); }); }
async function render(patch: Partial<ComponentProps<typeof BlockedInboxView>> = {}) { await act(async () => root.render(<QueryClientProvider client={client}><BlockedInboxView {...props} {...patch} /></QueryClientProvider>)); await flush(); }
beforeEach(() => { state.list.mockReset().mockResolvedValue([issue]); host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } }); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); client.clear(); await language("en"); });
describe.each(Object.entries(blockedInboxMessages))("actual blocked inbox %s", (locale, strings) => {
  it("localizes groups, reason severity and empty state without translating raw titles/owners", async () => {
    expect(validateLocaleMessages(strings, blockedInboxMessages.en)).toEqual([]);
    await language(locale); await render();
    expect(host.textContent).toContain(strings.variant.needs_decision);
    expect(host.querySelector('[data-severity="high"]')?.getAttribute("aria-label")).toContain(strings.severity.high);
    for (const raw of [issue.title, attention.owner.label, "PAP-42"]) expect(host.textContent).toContain(raw);
    expect(host.querySelector("b")).toBeNull();
    expect(host.querySelector('[data-testid="blocked-row-age"]')?.textContent).toBe(stoppedAgeDisplay(attention.stoppedSinceAt));
    await render({ searchQuery: "no match" }); expect(host.textContent).toContain(strings.noMatch);
    state.list.mockResolvedValue([]); await render({ companyId: "empty" });
    expect(host.textContent).toContain(strings.empty); expect(host.textContent).toContain(strings.emptyHint);
    expect(host.textContent).not.toContain("blockedInboxUi.");
  });
});
it("keeps collapse, focus and row identity across languages without re-fetching", async () => {
  await render(); const group = host.querySelector('[data-testid="blocked-inbox-group-needs_decision"]')!;
  const button = group.querySelector("button")!; button.focus();
  await act(async () => button.click()); const reads = state.list.mock.calls.length;
  for (const [locale, strings] of Object.entries(blockedInboxMessages)) {
    await language(locale);
    expect(host.querySelector('[data-testid="blocked-inbox-group-needs_decision"]')).toBe(group);
    expect(group.querySelector("button")).toBe(button); expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.textContent).toContain(strings.variant.needs_decision); expect(document.activeElement).toBe(button);
    expect(host.querySelector("a")).toBeNull(); expect(state.list).toHaveBeenCalledTimes(reads);
  }
  await act(async () => button.click()); expect(host.textContent).toContain(issue.title);
});
it("hot-translates the failed read and retains provider diagnostics with explicit same-company retry", async () => {
  state.list.mockRejectedValue(new Error("Raw provider <b> diagnostic")); await render();
  for (const [locale, strings] of Object.entries(blockedInboxMessages)) {
    await language(locale);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(strings.loadError);
    expect(host.textContent).toContain("Raw provider <b> diagnostic"); expect(host.querySelector("b")).toBeNull();
    expect(state.list).toHaveBeenCalledTimes(1);
  }
  state.list.mockResolvedValue([]);
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click()); await flush();
  expect(state.list).toHaveBeenCalledTimes(2); expect(state.list.mock.calls.every(call => call[0] === "c1")).toBe(true);
  expect(host.textContent).toContain(blockedInboxMessages.ja.empty);
  expect(blockedSeverityDisplay("future" as never)).toBe("future");
});
