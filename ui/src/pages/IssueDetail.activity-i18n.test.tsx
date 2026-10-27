// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActivityEvent, Agent, Issue } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueDetailActivityTab } from "./IssueDetail";
import type { IssueRunLedger } from "../components/IssueRunLedger";
import { ApiError } from "../api/client";
import { i18n, issueActivityMessages } from "../i18n/issue-activity-test-resources";
import { reviewPolicyMessages } from "../i18n/review-policy-test-resources";

type ActivityApi = typeof import("../api/activity").activityApi;
type IssuesApi = typeof import("../api/issues").issuesApi;
const api = vi.hoisted(() => ({
  activity: vi.fn<ActivityApi["forIssue"]>(), runs: vi.fn<ActivityApi["runsForIssue"]>(),
  approvals: vi.fn<IssuesApi["listApprovals"]>(), document: vi.fn<IssuesApi["getDocument"]>(), cost: vi.fn<IssuesApi["getCostSummary"]>(),
  approvalAction: vi.fn<(id: string, action: "approve" | "reject") => void>(),
  ledger: vi.fn<(props: ComponentProps<typeof IssueRunLedger>) => void>(),
}));
vi.mock("../api/activity", () => ({ activityApi: { forIssue: api.activity, runsForIssue: api.runs } }));
vi.mock("../api/issues", () => ({ issuesApi: { listApprovals: api.approvals, getDocument: api.document, getCostSummary: api.cost } }));
// Exercise the actual tab's render callback; ledger grouping/polling is outside this display contract.
vi.mock("../components/IssueRunLedger", () => ({
  IssueRunLedger: (props: ComponentProps<typeof IssueRunLedger>) => {
    api.ledger(props);
    return <section>{props.activityEvents?.map(event => <article key={event.id} data-event-id={event.id}>{props.renderActivityEvent?.(event)}</article>)}</section>;
  },
}));
vi.mock("../components/IssueReferenceActivitySummary", () => ({ IssueReferenceActivitySummary: () => null }));
vi.mock("../components/IssueFieldChangeReceipt", () => ({ IssueFieldChangeReceipt: () => null }));
vi.mock("../components/IssueScheduledRetryCard", () => ({ IssueScheduledRetryCard: () => null }));

const date = new Date("2026-01-01T00:00:00Z");
const issue: Issue = {
  id: "issue-raw-id", companyId: "company-raw-id", projectId: null, projectWorkspaceId: null, goalId: null, parentId: null,
  title: "原文 issue title", description: null, status: "in_progress", workMode: "standard", priority: "high", reviewPolicy: null,
  assigneeAgentId: null, assigneeUserId: null, checkoutRunId: null, executionRunId: null, executionAgentNameKey: null,
  executionLockedAt: null, createdByAgentId: null, createdByUserId: null, responsibleUserId: null, issueNumber: 42,
  identifier: "PAP-42", requestDepth: 0, billingCode: null, assigneeAdapterOverrides: null, executionWorkspaceId: null,
  executionWorkspacePreference: null, executionWorkspaceSettings: null, startedAt: null, completedAt: null,
  cancelledAt: null, hiddenAt: null, createdAt: date, updatedAt: date,
};
const agent: Agent = {
  id: "agent-raw-id", name: "原文 <Agent> 日本語", companyId: issue.companyId, urlKey: "agent-ref", role: "engineer", title: null,
  icon: null, status: "active", reportsTo: null, capabilities: null, adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {},
  budgetMonthlyCents: 0, spentMonthlyCents: 0, pauseReason: null, pausedAt: null, permissions: { canCreateAgents: false },
  lastHeartbeatAt: null, metadata: null, createdAt: date, updatedAt: date,
};
function event(id: string, action: string, details: ActivityEvent["details"] = null): ActivityEvent {
  return { id, action, details, companyId: issue.companyId, actorType: "user", actorId: "user-raw-id", entityType: "issue",
    entityId: issue.id, agentId: null, runId: null, createdAt: date };
}
const events: ActivityEvent[] = [
  event("created", "issue.created"),
  event("status", "issue.updated", { status: "in_review", externalConversationState: "waiting", _previous: { status: "in_progress" } }),
  event("assignee", "issue.updated", { assigneeAgentId: agent.id }),
  event("review", "issue.updated", { reviewPolicy: "human_only" }),
  event("blocker", "issue.blockers_updated", { addedBlockedByIssues: [{ identifier: "RAW-123", title: "raw title" }] }),
  event("monitor", "issue.monitor_triggered", { serviceName: "raw_service 日本語" }),
  event("document", "issue.document_updated", { key: "AGENTS.md", title: "原文 <title>" }),
  event("unknown", "plugin.unknown_action", { status: "future_status", message: "Raw server diagnostic" }),
];
const agentMap = new Map([[agent.id, agent]]);
const userProfileMap = new Map([["user-raw-id", { label: "原文 Actor <name>", image: null }]]);
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const fetchMock = vi.fn<typeof fetch>();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.clearAllMocks();
  fetchMock.mockRejectedValue(new Error("Unexpected external request"));
  vi.stubGlobal("fetch", fetchMock);
  api.activity.mockResolvedValue(events); api.runs.mockResolvedValue([]); api.approvals.mockResolvedValue([]);
  api.document.mockRejectedValue(new ApiError("No saved document", 404, null));
  api.cost.mockResolvedValue({ issueId: issue.id, issueCount: 1, includeDescendants: true, costCents: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, runCount: 0, runtimeMs: 0 });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
});
afterEach(async () => {
  await act(async () => root.unmount()); client.clear(); container.remove();
  await i18n.changeLanguage("en"); vi.unstubAllGlobals();
});
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/{{(\w+)}}/g, (_match, key: string) => values[key]);
}
function actionText(id: string): string | null | undefined {
  // The true host renders actor identity, then the formatted action, then time.
  return container.querySelector(`[data-event-id="${id}"] > div > div`)?.children[1]?.textContent;
}

describe.each(Object.entries(issueActivityMessages))("actual IssueDetailActivityTab (%s)", (locale, messages) => {
  it("switches event phrases without remounting rows, refetching, mutating data, or invoking actions", async () => {
    const original = JSON.stringify({ events, issue, agent });
    await act(async () => root.render(<QueryClientProvider client={client}><IssueDetailActivityTab
      issue={issue} issueId={issue.id} companyId={issue.companyId} issueStatus={issue.status} childIssues={[]}
      agentMap={agentMap} hasLiveRuns={false} currentUserId={null} userProfileMap={userProfileMap}
      pendingApprovalAction={null} onApprovalAction={api.approvalAction}
    /></QueryClientProvider>));
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); });
    await vi.waitFor(() => expect(actionText("created")).toBe(issueActivityMessages.en.actions.issue_created));
    const rows = Array.from(container.querySelectorAll("article"));
    const reads = [api.activity, api.runs, api.approvals, api.document, api.cost];
    for (const read of reads) expect(read).toHaveBeenCalledOnce();
    await act(async () => { await i18n.changeLanguage(locale); });
    const switchedRows = Array.from(container.querySelectorAll("article"));
    expect(switchedRows).toHaveLength(rows.length);
    switchedRows.forEach((row, index) => expect(row).toBe(rows[index]));
    expect(actionText("created")).toBe(messages.actions.issue_created);
    expect(actionText("status")).toBe(fill(messages.statusChangedFrom, { from: messages.status.in_progress, to: messages.status.idle }));
    expect(actionText("assignee")).toBe(fill(messages.assigneeChanged, { name: agent.name }));
    expect(actionText("review")).toBe(fill(messages.reviewPolicyChanged, { policy: reviewPolicyMessages[locale as keyof typeof reviewPolicyMessages].humanOnlyValue }));
    expect(actionText("blocker")).toBe(fill(messages.relations.blockerAddedNamed, { name: "RAW-123" }));
    expect(actionText("monitor")).toBe(fill(messages.monitorServices.issue_monitor_triggered, { service: "raw_service 日本語" }));
    expect(actionText("document")).toBe(fill(messages.documents.issue_document_updated, { document: "AGENTS.md (原文 <title>)" }));
    expect(actionText("unknown")).toBe("plugin unknown action");
    expect(container.querySelector("[title]")?.getAttribute("title")).toBe("原文 Actor <name>");
    for (const read of reads) expect(read).toHaveBeenCalledOnce();
    expect(api.activity).toHaveBeenCalledWith(issue.id); expect(api.runs).toHaveBeenCalledWith(issue.id);
    expect(api.ledger.mock.lastCall?.[0].activityEvents).toEqual(events);
    expect(api.ledger.mock.lastCall?.[0].issueStatus).toBe(issue.status);
    expect(JSON.stringify({ events, issue, agent })).toBe(original);
    expect(api.approvalAction).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
});
