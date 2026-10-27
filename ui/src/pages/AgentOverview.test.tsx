// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HEARTBEAT_RUN_STATUSES, type AgentDetail, type AgentPublicIdentity, type AgentRuntimeState, type HeartbeatRun, type Issue } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentOverview } from "./AgentDetail";
import { i18n } from "../i18n";
import { validateLocaleMessages } from "../i18n/locale-validation";
import { queryKeys } from "../lib/queryKeys";
import en from "../i18n/contributions/agentOverviewUi/en.json";
import zh from "../i18n/contributions/agentOverviewUi/zh-CN.json";
import es from "../i18n/contributions/agentOverviewUi/es.json";
import ja from "../i18n/contributions/agentOverviewUi/ja.json";

type AgentsApi = typeof import("../api/agents").agentsApi;
type IssuesApi = typeof import("../api/issues").issuesApi;
const api = vi.hoisted(() => ({
  identity: vi.fn<AgentsApi["getIdentity"]>(), issue: vi.fn<IssuesApi["get"]>(),
  copy: vi.fn<(text: string) => Promise<void>>(),
}));
vi.mock("../api/agents", () => ({ agentsApi: { getIdentity: api.identity } }));
vi.mock("../api/issues", () => ({ issuesApi: { get: api.issue } }));
vi.mock("../lib/clipboard", () => ({ copyTextToClipboard: api.copy }));
vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a> };
});
vi.mock("../components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <div>{children}</div> }));

const locales = ["en", "zh-CN", "es", "ja"] as const;
const messages = { en, "zh-CN": zh, es, ja };
for (const locale of locales) i18n.addResourceBundle(locale, "translation", { agentOverviewUi: messages[locale] }, true, true);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const date = new Date("2026-08-31T12:00:00Z");
function makeAgent(overrides: Partial<AgentDetail> = {}): AgentDetail {
  return {
    id: "agent-1", companyId: "company-1", name: "Codex Coder", urlKey: "codexcoder", role: "engineer",
    title: "Product engineer", icon: null, status: "active", reportsTo: null,
    capabilities: "Builds and verifies product changes.", adapterType: "codex_local",
    adapterConfig: { model: "gpt-5.6-sol" }, runtimeConfig: {}, budgetMonthlyCents: 0, spentMonthlyCents: 0,
    pauseReason: null, pausedAt: null, permissions: { canCreateAgents: false }, lastHeartbeatAt: null,
    metadata: null, createdAt: date, updatedAt: date, chainOfCommand: [],
    access: { canAssignTasks: true, taskAssignSource: "explicit_grant", membership: null, grants: [] }, ...overrides,
  };
}
function makeIssue(index = 1, overrides: Partial<Issue> = {}): Issue {
  return {
    id: `issue-${index}`, companyId: "company-1", projectId: null, projectWorkspaceId: null, goalId: null, parentId: null,
    title: index === 1 ? "Simplify agent information architecture" : `原始 task ${index}`, description: null,
    status: "in_progress", workMode: "standard", priority: "high", reviewPolicy: null,
    assigneeAgentId: "agent-1", assigneeUserId: null, checkoutRunId: null, executionRunId: null,
    executionAgentNameKey: null, executionLockedAt: null, createdByAgentId: null, createdByUserId: null,
    responsibleUserId: null, issueNumber: index + 41, identifier: `PAP-${index + 41}`, requestDepth: 0, billingCode: null,
    assigneeAdapterOverrides: null, executionWorkspaceId: null, executionWorkspacePreference: null,
    executionWorkspaceSettings: null, startedAt: null, completedAt: null, cancelledAt: null, hiddenAt: null,
    createdAt: date, updatedAt: date, ...overrides,
  };
}
function makeRuntime(): AgentRuntimeState {
  return {
    agentId: "agent-1", companyId: "company-1", adapterType: "codex_local", sessionId: "session-raw-id",
    sessionDisplayId: "codex-session-42", stateJson: {}, lastRunId: null, lastRunStatus: null,
    totalInputTokens: 0, totalOutputTokens: 0, totalCachedInputTokens: 0, totalCostCents: 0,
    lastError: null, createdAt: date, updatedAt: date,
  };
}
function makeRun(status: HeartbeatRun["status"]): HeartbeatRun {
  return {
    id: "run-original", companyId: "company-1", agentId: "agent-1", scopeKind: "issue", issueId: "issue-1",
    invocationSource: "on_demand", triggerDetail: "manual", status, responsibleUserId: null,
    startedAt: null, finishedAt: null, error: null, wakeupRequestId: null, exitCode: null, signal: null,
    usageJson: null, resultJson: null, sessionIdBefore: null, sessionIdAfter: null,
    logStore: null, logRef: null, logBytes: null, logSha256: null, logCompressed: false,
    stdoutExcerpt: null, stderrExcerpt: null, errorCode: null, externalRunId: null, processPid: null,
    processStartedAt: null, lastOutputAt: null, lastOutputSeq: 0, lastOutputStream: null, lastOutputBytes: null,
    retryOfRunId: null, processLossRetryCount: 0, livenessState: null, livenessReason: null,
    continuationAttempt: 0, lastUsefulActionAt: null, nextAction: null, contextSnapshot: { issueId: "issue-1" },
    createdAt: date, updatedAt: date,
  };
}
function props(overrides: Partial<ComponentProps<typeof AgentOverview>> = {}): ComponentProps<typeof AgentOverview> {
  return { agent: makeAgent(), runs: [], assignedIssues: [makeIssue()], runtimeState: makeRuntime(), directReportCount: 2,
    skillNames: ["Design Guide", "Check PR"], agentRouteId: "codexcoder", ...overrides };
}
function row(host: HTMLElement, label: string): HTMLElement {
  const name = Array.from(host.querySelectorAll("span")).find(span => span.textContent === label);
  if (!name?.parentElement) throw new Error(`Missing overview row: ${label}`);
  return name.parentElement;
}
function runStatusText(status: HeartbeatRun["status"]) {
  return i18n.t(status === "scheduled_retry" || status === "interrupted" ? `agentOverviewUi.runStatus.${status}` : `statuses.${status}`);
}
let client: QueryClient;
let container: HTMLDivElement;
let root: Root | null;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  api.identity.mockReset().mockResolvedValue(null); api.issue.mockReset(); api.copy.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = null;
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  client.clear(); container.remove(); await i18n.changeLanguage("en");
});
function renderStatic(options: Partial<ComponentProps<typeof AgentOverview>> = {}) {
  container.innerHTML = renderToStaticMarkup(<QueryClientProvider client={client}><AgentOverview {...props(options)} /></QueryClientProvider>);
  return container;
}
async function mount(options: Partial<ComponentProps<typeof AgentOverview>> = {}) {
  root = createRoot(container);
  await act(async () => root?.render(<QueryClientProvider client={client}><AgentOverview {...props(options)} /></QueryClientProvider>));
  await flush();
}
async function flush() { await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); }); }
async function waitFor(assertion: () => void) {
  let error: unknown;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { assertion(); return; } catch (caught) { error = caught; await flush(); }
  }
  throw error;
}

describe("AgentOverview", () => {
  it("prioritizes identity, capability, runtime, skills, tasks, and scoped Audit entry points", () => {
    const markup = renderStatic().innerHTML;
    expect(markup).toContain("Identity"); expect(markup).toContain("Capabilities"); expect(markup).toContain("Harness / Runtime");
    expect(markup).toContain("Design Guide"); expect(markup).toContain("Simplify agent information architecture");
    expect(markup).toContain("PAP-42"); expect(markup).toContain('href="/activity/costs?agentId=agent-1"');
    expect(markup).not.toContain("Run Activity"); expect(markup).not.toContain("Tasks by Status");
  });

  it.each(locales)("validates overview message shapes and interpolation in %s", locale => {
    expect(validateLocaleMessages(messages[locale], en)).toEqual([]);
  });

  it.each(locales.flatMap(locale => [0, 1, 2].map(extra => ({ locale, extra }))))("renders the empty title and exact overflow counts in $locale (extra=$extra)", async ({ locale, extra }) => {
    await i18n.changeLanguage(locale);
    const skills = Array.from({ length: 8 + extra }, (_, index) => `Skill 原文 ${index}`);
    const issues = Array.from({ length: 6 + extra }, (_, index) => makeIssue(index + 1));
    renderStatic({ agent: makeAgent({ title: null }), skillNames: skills, assignedIssues: issues });
    expect(row(container, i18n.t("commonUi.title")).textContent).toContain(messages[locale].titleNotSet);
    const skillSection = container.querySelector('[aria-labelledby="agent-skills-heading"]')!;
    const taskSection = container.querySelector('[aria-labelledby="agent-recent-tasks-heading"]')!;
    for (const skill of skills.slice(0, 8)) expect(skillSection.textContent).toContain(skill);
    for (const issue of issues.slice(0, 6)) expect(taskSection.textContent).toContain(issue.title);
    if (extra) {
      expect(skillSection.textContent).toContain(i18n.t("agentOverviewUi.moreSkills", { count: extra }));
      expect(taskSection.textContent).toContain(i18n.t("agentOverviewUi.moreTasks", { count: extra }));
      expect(skillSection.textContent).not.toContain(skills[8]); expect(taskSection.textContent).not.toContain(issues[6].title);
    } else {
      expect(skillSection.textContent).not.toContain(i18n.t("agentOverviewUi.moreSkills", { count: 0 }));
      expect(taskSection.textContent).not.toContain(i18n.t("agentOverviewUi.moreTasks", { count: 0 }));
    }
  });

  it.each(locales.flatMap(locale => HEARTBEAT_RUN_STATUSES.map(status => ({ locale, status }))))("translates only the last-run display for $status in $locale", async ({ locale, status }) => {
    await i18n.changeLanguage(locale);
    const run = makeRun(status); renderStatic({ runs: [run] });
    expect(row(container.querySelector<HTMLElement>('[aria-labelledby="agent-runtime-heading"]')!, i18n.t("workflow.lastRun")).textContent).toContain(`${runStatusText(status)} · `);
    expect(run.status).toBe(status);
    expect(container.querySelector('a[href="/agents/codexcoder/runs/run-original"]')).not.toBeNull();
    expect(container.querySelector('a[href="/issues/PAP-42"]')).not.toBeNull();
    expect(api.issue).not.toHaveBeenCalled();
  });

  it.each(locales)("switches the actual overview live without mutating identity, links or original text in %s", async locale => {
    await i18n.changeLanguage(locale);
    const agent = makeAgent({ title: "Original <b>职称</b>", adapterConfig: { model: "raw-model/<literal>" } });
    const manager = makeAgent({ id: "manager-original", urlKey: "manager-key", name: "负责人 <literal>" });
    const runtime = { ...makeRuntime(), sessionDisplayId: "session 日本語 <literal>" };
    const skills = Array.from({ length: 9 }, (_, index) => `技能 <literal> ${index}`);
    const issues = Array.from({ length: 7 }, (_, index) => makeIssue(index + 1));
    const run = makeRun("scheduled_retry");
    const identity: AgentPublicIdentity = { algorithm: "Ed25519", keyId: "fictional-public-key-id-for-overview",
      publicKeyPem: "-----BEGIN PUBLIC KEY-----\nFICTIONAL-OVERVIEW-TEST-ONLY\n-----END PUBLIC KEY-----\n", createdAt: date.toISOString() };
    api.identity.mockResolvedValue(identity);
    await mount({ agent, reportsToAgent: manager, runtimeState: runtime, skillNames: skills, assignedIssues: issues, runs: [run] });
    await waitFor(() => expect(container.querySelector('button[aria-label]')?.getAttribute("aria-label")).toBe(i18n.t("workflow.copyPublicKey")));
    const copy = container.querySelector<HTMLButtonElement>('button[aria-label]')!;
    const hrefs = Array.from(container.querySelectorAll("a")).map(link => link.getAttribute("href"));
    expect(api.identity).toHaveBeenCalledExactlyOnceWith("agent-1", "company-1");
    expect(api.copy).not.toHaveBeenCalled();
    for (const nextLocale of locales) {
      await act(async () => { await i18n.changeLanguage(nextLocale); }); await flush();
      expect(container.querySelector('button[aria-label]')).toBe(copy);
      expect(copy.getAttribute("aria-label")).toBe(i18n.t("workflow.copyPublicKey")); expect(copy.title).toBe(i18n.t("workflow.copyPublicKey"));
      expect(container.textContent).toContain(agent.title); expect(container.textContent).toContain(manager.name);
      expect(container.textContent).toContain("raw-model/<literal>"); expect(container.textContent).toContain(runtime.sessionDisplayId);
      expect(container.textContent).toContain(skills[0]); expect(container.textContent).toContain(issues[0].title);
      expect(row(container.querySelector<HTMLElement>('[aria-labelledby="agent-runtime-heading"]')!, i18n.t("workflow.lastRun")).textContent).toContain(runStatusText(run.status));
      expect(container.textContent).toContain(i18n.t("agentOverviewUi.moreTasks", { count: 1 }));
      expect(container.textContent).toContain(i18n.t("agentOverviewUi.moreSkills", { count: 1 }));
      expect(Array.from(container.querySelectorAll("a")).map(link => link.getAttribute("href"))).toEqual(hrefs);
      expect(container.querySelector("literal, b")).toBeNull(); expect(api.identity).toHaveBeenCalledTimes(1);
      expect(api.issue).not.toHaveBeenCalled(); expect(api.copy).not.toHaveBeenCalled();
      expect(client.getQueryData([...queryKeys.agents.identity(agent.id), run.id, run.status])).toEqual(identity);
    }
    await act(async () => copy.click()); await flush();
    expect(api.copy.mock.calls.length === 1 && api.copy.mock.calls[0]?.[0] === identity.publicKeyPem).toBe(true);
    expect(run.status).toBe("scheduled_retry"); expect(agent.title).toBe("Original <b>职称</b>");
  });
});
