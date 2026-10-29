// @vitest-environment jsdom
import "../i18n/agent-run-metadata-test-resources";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  instanceGeneralSettingsSchema, instanceExperimentalSettingsWithManagedSchema,
  type AgentKeyCreated, type HeartbeatRun, type HeartbeatRunEvent, type WorkspaceOperation,
} from "@paperclipai/shared";
import type { ClaudeLoginResult } from "../api/agents";
import type { IssueForRun } from "../api/activity";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KeysTab, LogViewer, RunDetail } from "./AgentDetail";
import { TooltipProvider } from "../components/ui/tooltip";
import { i18n } from "../i18n";
import { queryKeys } from "../lib/queryKeys";
import { validateLocaleMessages } from "../i18n/locale-validation";
import en from "../i18n/contributions/agentSessionControlsUi/en.json";
import zh from "../i18n/contributions/agentSessionControlsUi/zh-CN.json";
import es from "../i18n/contributions/agentSessionControlsUi/es.json";
import ja from "../i18n/contributions/agentSessionControlsUi/ja.json";

type AgentsApi = typeof import("../api/agents").agentsApi;
type HeartbeatsApi = typeof import("../api/heartbeats").heartbeatsApi;
type ActivityApi = typeof import("../api/activity").activityApi;
type AccessApi = typeof import("../api/access").accessApi;
type SettingsApi = typeof import("../api/instanceSettings").instanceSettingsApi;
type ToolsApi = typeof import("../api/tools").toolsApi;
const retryCompany = vi.hoisted(() => ({ id: "company-original" }));
vi.mock("../context/CompanyContext", () => ({ useOptionalCompany: () => ({ selectedCompanyId: retryCompany.id }) }));
const api = vi.hoisted(() => ({
  retry: vi.fn<AgentsApi["retryFailedRun"]>(),
  login: vi.fn<AgentsApi["loginWithClaude"]>(), reset: vi.fn<AgentsApi["resetSession"]>(),
  listKeys: vi.fn<AgentsApi["listKeys"]>(), createKey: vi.fn<AgentsApi["createKey"]>(), revokeKey: vi.fn<AgentsApi["revokeKey"]>(),
  run: vi.fn<HeartbeatsApi["get"]>(), events: vi.fn<HeartbeatsApi["events"]>(),
  log: vi.fn<HeartbeatsApi["log"]>(), operations: vi.fn<HeartbeatsApi["workspaceOperations"]>(),
  issues: vi.fn<ActivityApi["issuesForRun"]>(), access: vi.fn<AccessApi["getCurrentBoardAccess"]>(), directory: vi.fn<AccessApi["listUserDirectory"]>(),
  general: vi.fn<SettingsApi["getGeneral"]>(), experimental: vi.fn<SettingsApi["getExperimental"]>(),
  decisions: vi.fn<ToolsApi["getRunDecisionLookup"]>(), copy: vi.fn<(text: string) => Promise<void>>(),
}));
vi.mock("../api/agents", () => ({ agentsApi: {
  retryFailedRun: api.retry, loginWithClaude: api.login, resetSession: api.reset,
  listKeys: api.listKeys, createKey: api.createKey, revokeKey: api.revokeKey,
} }));
vi.mock("../api/heartbeats", () => ({ heartbeatsApi: { get: api.run, events: api.events, log: api.log, workspaceOperations: api.operations } }));
vi.mock("../api/activity", () => ({ activityApi: { issuesForRun: api.issues } }));
vi.mock("../api/access", () => ({ accessApi: { getCurrentBoardAccess: api.access, listUserDirectory: api.directory } }));
vi.mock("../api/instanceSettings", () => ({ instanceSettingsApi: { getGeneral: api.general, getExperimental: api.experimental } }));
vi.mock("../api/tools", () => ({ toolsApi: { getRunDecisionLookup: api.decisions } }));
vi.mock("../lib/clipboard", () => ({ copyTextToClipboard: api.copy }));
vi.mock("../lib/router", async () => await import("react-router-dom"));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast: vi.fn() }) }));
vi.mock("../components/RunWorkspaceRecoverySurface", () => ({ RunWorkspaceRecoverySurface: () => null }));
vi.mock("../components/RunnerInspector", () => ({ RunnerInspector: () => null }));
vi.mock("../components/ScrollToBottom", () => ({ ScrollToBottom: () => null }));
vi.mock("../components/ai-connections/AiConnectionPoolRunDetails", () => ({ AiConnectionPoolRunDetails: () => null }));
vi.mock("../adapters", () => ({ getUIAdapter: () => null, onAdapterChange: () => () => {}, buildTranscript: () => [] }));
vi.mock("../components/transcript/RunTranscriptView", () => ({ RunTranscriptView: () => null }));

const locales = ["en", "zh-CN", "es", "ja"] as const;
const messages = { en, "zh-CN": zh, es, ja };
for (const locale of locales) i18n.addResourceBundle(locale, "translation", { agentSessionControlsUi: messages[locale] }, true, true);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeRun(overrides: Partial<HeartbeatRun> = {}): HeartbeatRun {
  return {
    id: "run-original", companyId: "company-original", agentId: "agent-original",
    scopeKind: "company", issueId: null, invocationSource: "on_demand", triggerDetail: "manual", status: "failed",
    responsibleUserId: null, startedAt: null, finishedAt: null, error: "Original failure <raw>", wakeupRequestId: null,
    exitCode: 1, signal: null, usageJson: null, resultJson: null, sessionIdBefore: "session-before-原文",
    sessionIdAfter: "session-after-日本語", logStore: null, logRef: null, logBytes: null, logSha256: null,
    logCompressed: false, stdoutExcerpt: null, stderrExcerpt: null, errorCode: "claude_auth_required",
    externalRunId: null, processPid: null, processStartedAt: null, lastOutputAt: null, lastOutputSeq: 0,
    lastOutputStream: null, lastOutputBytes: null, retryOfRunId: null, processLossRetryCount: 0,
    livenessState: null, livenessReason: null, continuationAttempt: 0, lastUsefulActionAt: null,
    nextAction: null, contextSnapshot: null, createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"), ...overrides,
  };
}
function makeIssue(index: number): IssueForRun {
  return { issueId: `issue-original-${index}`, identifier: `RAW-${index}`, title: `原始 task ${index}`, status: "todo", priority: "medium" };
}
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const t = (key: keyof typeof en) => i18n.t(`agentSessionControlsUi.${key}`);
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
beforeEach(async () => {
  retryCompany.id = "company-original";
  await i18n.changeLanguage("en");
  Object.values(api).forEach(mock => mock.mockReset());
  api.run.mockResolvedValue(makeRun()); api.events.mockResolvedValue([]); api.operations.mockResolvedValue([]);
  api.issues.mockResolvedValue([]); api.listKeys.mockResolvedValue([]); api.reset.mockResolvedValue(undefined);
  api.copy.mockResolvedValue(undefined);
  api.access.mockResolvedValue({ user: null, userId: "operator", isInstanceAdmin: false, companyIds: ["company-original"], source: "session", keyId: null });
  api.general.mockResolvedValue(instanceGeneralSettingsSchema.parse({}));
  api.experimental.mockResolvedValue(instanceExperimentalSettingsWithManagedSchema.parse({}));
  api.directory.mockResolvedValue({ users: [] });
  api.decisions.mockResolvedValue({ runId: "run-original", decisions: [] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear(); container.remove(); vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});
async function mount(node: ReactNode) {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><TooltipProvider>{node}</TooltipProvider></MemoryRouter></QueryClientProvider>));
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
function button(text: string) {
  const result = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(candidate => candidate.textContent?.trim() === text);
  if (!result) throw new Error(`Missing action: ${text}`);
  return result;
}
async function click(text: string) { await act(async () => button(text).click()); await flush(); }
async function renderRun() { await mount(<RunDetail run={makeRun()} agentRouteId="original-route" adapterType="claude_local" adapterConfig={{}} />); }
async function openSession() {
  const result = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(candidate => candidate.textContent?.startsWith(i18n.t("workflow.session")));
  expect(result).toBeDefined();
  await act(async () => result!.click()); await flush();
}
function reads() { return [api.run, api.issues, api.events, api.operations, api.general, api.experimental, api.decisions].map(mock => mock.mock.calls.length); }
async function switchLanguage(locale: (typeof locales)[number]) { await act(async () => { await i18n.changeLanguage(locale); }); await flush(); }
function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it.each(locales)("validates session-control messages and plural placeholders in %s", locale => {
  expect(validateLocaleMessages(messages[locale], en)).toEqual([]);
});

it.each(locales)("keeps explicit Claude login pending across a live language change in %s", async locale => {
  await switchLanguage(locale);
  const pending = deferred<ClaudeLoginResult>(); api.login.mockReturnValue(pending.promise);
  await renderRun();
  expect(api.login).not.toHaveBeenCalled();
  await click(t("claudeLogin"));
  expect(button(t("claudeLoginPending")).disabled).toBe(true);
  const requestCounts = reads();
  await switchLanguage(locale === "ja" ? "zh-CN" : "ja");
  expect(button(t("claudeLoginPending")).disabled).toBe(true);
  expect(reads()).toEqual(requestCounts);
  expect(api.login).toHaveBeenCalledExactlyOnceWith("agent-original", "company-original");
  const result: ClaudeLoginResult = { exitCode: 0, signal: null, timedOut: false,
    loginUrl: "https://example.test/claude/auth?state=literal", stdout: "claude login --example\n原文 stdout",
    stderr: "Raw diagnostic <script>literal</script>" };
  await act(async () => pending.resolve(result)); await flush();
  expect(button(t("claudeLogin")).disabled).toBe(false);
  expect(container.querySelector('a[href="https://example.test/claude/auth?state=literal"]')?.textContent).toBe(result.loginUrl);
  expect(Array.from(container.querySelectorAll("pre")).map(pre => pre.textContent)).toEqual([result.stdout, result.stderr]);
  expect(container.querySelector("script")).toBeNull();
  await switchLanguage(locale);
  expect(Array.from(container.querySelectorAll("pre")).map(pre => pre.textContent)).toEqual([result.stdout, result.stderr]);
  expect(reads()).toEqual(requestCounts);
  expect(api.login).toHaveBeenCalledTimes(1);
});

it.each(locales.flatMap(locale => [1, 2].map(count => ({ locale, count }))))("confirms only the original $count task sessions in $locale", async ({ locale, count }) => {
  await switchLanguage(locale); api.issues.mockResolvedValue(Array.from({ length: count }, (_, index) => makeIssue(index + 1)));
  const pending = deferred<void>(); api.reset.mockReturnValue(pending.promise);
  await renderRun(); await openSession();
  expect(container.textContent).toContain(t("sessionChanged"));
  expect(container.textContent).toContain(t("sessionBefore")); expect(container.textContent).toContain(t("sessionAfter"));
  expect(container.textContent).toContain("session-before-原文"); expect(container.textContent).toContain("session-after-日本語");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await click(t("clearSession"));
  expect(confirm).toHaveBeenCalledExactlyOnceWith(i18n.t("agentSessionControlsUi.clearSessionConfirm", { count }));
  expect(api.reset).not.toHaveBeenCalled();
  confirm.mockReturnValue(true); await click(t("clearSession"));
  expect(button(t("clearSessionPending")).disabled).toBe(true);
  const requestCounts = reads();
  await switchLanguage(locale === "ja" ? "zh-CN" : "ja");
  expect(button(t("clearSessionPending")).disabled).toBe(true); expect(reads()).toEqual(requestCounts);
  expect(api.reset).toHaveBeenCalledTimes(count);
  for (let index = 1; index <= count; index++) expect(api.reset).toHaveBeenNthCalledWith(index, "agent-original", `issue-original-${index}`, "company-original");
  expect(api.login).not.toHaveBeenCalled();
  await act(async () => pending.resolve(undefined)); await flush();
  expect(button(t("clearSession")).disabled).toBe(false);
  expect(api.reset).toHaveBeenCalledTimes(count);
});

it.each(locales.flatMap(locale => [false, true].map(raw => ({ locale, raw }))))("keeps local fallbacks distinct from raw errors in $locale (raw=$raw)", async ({ locale, raw }) => {
  await switchLanguage(locale); api.issues.mockResolvedValue([makeIssue(1)]);
  const loginError = raw ? new Error(en.claudeLoginFailed) : "untyped failure";
  const resetError = raw ? new Error("agentSessionControlsUi.clearSessionFailed") : "untyped failure";
  api.login.mockRejectedValue(loginError); api.reset.mockRejectedValue(resetError);
  await renderRun(); await click(t("claudeLogin")); await openSession();
  vi.spyOn(window, "confirm").mockReturnValue(true); await click(t("clearSession"));
  const checkErrors = () => {
    expect(container.textContent).toContain(raw ? en.claudeLoginFailed : t("claudeLoginFailed"));
    expect(container.textContent).toContain(raw ? "agentSessionControlsUi.clearSessionFailed" : t("clearSessionFailed"));
  };
  await waitFor(checkErrors);
  const requestCounts = reads(); await switchLanguage(locale === "ja" ? "zh-CN" : "ja"); checkErrors();
  expect(reads()).toEqual(requestCounts); expect(api.login).toHaveBeenCalledTimes(1); expect(api.reset).toHaveBeenCalledTimes(1);
});

it.each(locales)("preserves key-name drafts and hidden fictional tokens while switching %s", async locale => {
  await switchLanguage(locale);
  // Deliberately fictional. Boolean assertions avoid including even this value in failure logs.
  const fictionalToken = "not-a-real-key-for-ui-testing";
  const created: AgentKeyCreated = { id: "key-original", name: "原始 key name", scope: { kind: "standard" }, token: fictionalToken, createdAt: new Date("2026-01-01T00:00:00Z") };
  api.createKey.mockResolvedValue(created);
  await mount(<KeysTab agentId="agent-original" companyId="company-original" />);
  const input = container.querySelector("input")!;
  await act(async () => setInput(input, "原始 key name"));
  const listReads = api.listKeys.mock.calls.length;
  await switchLanguage(locale === "ja" ? "zh-CN" : "ja");
  expect(container.querySelector("input")).toBe(input);
  expect(input.value).toBe("原始 key name"); expect(api.createKey).not.toHaveBeenCalled(); expect(api.listKeys).toHaveBeenCalledTimes(listReads);
  await click(i18n.t("commonUi.create"));
  await waitFor(() => expect(Boolean(container.querySelector("code"))).toBe(true));
  expect(api.createKey).toHaveBeenCalledExactlyOnceWith("agent-original", "原始 key name", "company-original");
  const code = container.querySelector("code")!;
  expect(code.textContent === fictionalToken).toBe(true);
  const visibility = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(candidate => candidate.title === t("hideKey"))!;
  expect(visibility.getAttribute("aria-label")).toBe(t("hideKey"));
  await act(async () => visibility.click()); await flush();
  expect(code.textContent === "•".repeat(fictionalToken.length)).toBe(true);
  const finalListReads = api.listKeys.mock.calls.length;
  await switchLanguage(locale);
  expect(container.querySelector("code")).toBe(code);
  expect(visibility.title).toBe(t("showKey")); expect(visibility.getAttribute("aria-label")).toBe(t("showKey"));
  expect(code.textContent === "•".repeat(fictionalToken.length)).toBe(true);
  expect(api.listKeys).toHaveBeenCalledTimes(finalListReads); expect(api.createKey).toHaveBeenCalledTimes(1);
  expect(api.revokeKey).not.toHaveBeenCalled(); expect(api.copy).not.toHaveBeenCalled();
  await act(async () => visibility.click()); await flush(); expect(code.textContent === fictionalToken).toBe(true);
  const copy = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(candidate => candidate.title === i18n.t("workflow.copy"))!;
  await act(async () => copy.click()); await flush();
  expect(api.copy.mock.calls.length === 1 && api.copy.mock.calls[0]?.[0] === fictionalToken).toBe(true);
});

it.each(locales.flatMap(locale => [false, true].map(json => ({ locale, json }))))("localizes failure headings without changing log bodies in $locale (JSON=$json)", async ({ locale, json }) => {
  await switchLanguage(locale);
  const run = makeRun({ stderrExcerpt: "stderr 原文 <tag>", stdoutExcerpt: "stdout 原文 --literal",
    resultJson: json ? { command: "claude login", raw: "保持 <tag>" } : null });
  const event: HeartbeatRunEvent = { id: 1, companyId: run.companyId, runId: run.id, agentId: run.agentId, seq: 1,
    eventType: "status", stream: "system", level: "info", color: null, message: "Original event", payload: null, createdAt: run.createdAt };
  api.events.mockResolvedValue([event]);
  await mount(<LogViewer run={run} adapterType="claude_local" />);
  await waitFor(() => expect(container.textContent).toContain(t("stderrExcerpt")));
  expect(container.textContent).toContain(t(json ? "adapterResultJson" : "stdoutExcerpt"));
  const bodies = Array.from(container.querySelectorAll("pre")).map(pre => pre.textContent);
  expect(bodies).toEqual([run.stderrExcerpt, json ? JSON.stringify(run.resultJson, null, 2) : run.stdoutExcerpt]);
  const requestCounts = reads(); await switchLanguage(locale === "ja" ? "zh-CN" : "ja");
  expect(container.textContent).toContain(t("stderrExcerpt")); expect(container.textContent).toContain(t(json ? "adapterResultJson" : "stdoutExcerpt"));
  expect(Array.from(container.querySelectorAll("pre")).map(pre => pre.textContent)).toEqual(bodies);
  expect(container.querySelector("tag")).toBeNull(); expect(reads()).toEqual(requestCounts);
  expect(api.login).not.toHaveBeenCalled(); expect(api.reset).not.toHaveBeenCalled();
});

const metadataCopy = {
  en: { statuses: ["Running", "Succeeded", "Failed", "skipped"], responsible: "the responsible user" },
  "zh-CN": { statuses: ["运行中", "成功", "失败", "已跳过"], responsible: "负责用户" },
  es: { statuses: ["En ejecución", "Exitoso", "Fallido", "omitido"], responsible: "la persona responsable" },
  ja: { statuses: ["実行中", "成功", "失敗", "スキップ"], responsible: "担当ユーザー" },
};
it.each(Object.entries(metadataCopy))("localizes real RunDetail operation badges and missing responsible user in %s", async (locale, copy) => {
  await i18n.changeLanguage(locale);
  const run = makeRun({ status: "succeeded", error: null, errorCode: null, responsibleUserId: "responsible-用户" });
  const statuses = ["running", "succeeded", "failed", "skipped", "future_phase_unknown"];
  const date = new Date("2026-01-01T00:00:00Z");
  const operations: WorkspaceOperation[] = statuses.map((status, index) => ({
    id: `operation-${index}`, companyId: run.companyId, heartbeatRunId: run.id, executionWorkspaceId: "workspace-原文", issueId: null,
    phase: "worktree_prepare", command: `echo raw-command-${index} 用户`, cwd: "/tmp/raw-cwd", status: status as WorkspaceOperation["status"],
    exitCode: null, logStore: null, logRef: null, logBytes: null, logSha256: null, logCompressed: false,
    stdoutExcerpt: null, stderrExcerpt: null, metadata: { branchName: "branch-原文" },
    startedAt: date, finishedAt: date, createdAt: date, updatedAt: date,
  }));
  const original = JSON.stringify({ run, operations });
  api.run.mockResolvedValue(run); api.operations.mockResolvedValue(operations);
  // The actual LogViewer only exposes workspace operations once a log event exists.
  api.events.mockResolvedValue([{ id: 1, companyId: run.companyId, runId: run.id, agentId: run.agentId, seq: 1,
    eventType: "status", stream: "system", level: "info", color: null, message: "Raw event 用户", payload: null, createdAt: date }]);
  await mount(<RunDetail run={run} agentRouteId="original-route" adapterType="claude_local" adapterConfig={{}} />);
  await waitFor(() => expect(container.textContent).toContain("raw-command-4"));
  const badge = (index: number) => [...container.querySelectorAll("span")].find(span => span.textContent === `echo raw-command-${index} 用户`)!.closest(".rounded-md")!.querySelector<HTMLElement>('[data-slot="badge"]')!;
  const responsible = () => container.querySelector('[data-testid="run-detail-on-behalf-of"] span');
  const assertStatuses = (expected: typeof copy) => {
    expect(statuses.map((_, index) => badge(index).textContent)).toEqual([...expected.statuses, "future phase_unknown"]);
    operations.forEach(operation => { expect(container.textContent).toContain(operation.command); });
    expect(container.textContent).toContain("/tmp/raw-cwd");
    expect(container.textContent).toContain("branch-原文");
    expect(container.textContent).not.toContain("agentRunMetadataUi.");
  };
  assertStatuses(copy);
  expect(responsible()?.textContent).toBe(copy.responsible);
  const colors = statuses.map((_, index) => badge(index).className);
  ["text-blue-700", "text-green-700", "text-red-700", "text-yellow-700", "text-muted-foreground"].forEach((color, index) => expect(colors[index]).toContain(color));
  const requests = [...reads(), api.directory.mock.calls.length];
  const next = locale === "ja" ? "es" : "ja";
  await switchLanguage(next);
  assertStatuses(metadataCopy[next]);
  expect(responsible()?.textContent).toBe(metadataCopy[next].responsible);
  expect(statuses.map((_, index) => badge(index).className)).toEqual(colors);
  expect([...reads(), api.directory.mock.calls.length]).toEqual(requests);
  expect(api.directory).toHaveBeenCalledExactlyOnceWith("company-original");
  expect(api.operations).toHaveBeenCalledExactlyOnceWith("run-original");
  const directoryKey = queryKeys.access.companyUserDirectory(run.companyId);
  await act(async () => { client.setQueryData(directoryKey, { users: [{ principalId: run.responsibleUserId, user: { name: "Name 用户 <original>", email: "raw@example.test" } }] }); });
  await flush();
  expect(responsible()?.textContent).toBe("Name 用户 <original>");
  await switchLanguage(locale as typeof locales[number]);
  expect(responsible()?.textContent).toBe("Name 用户 <original>");
  assertStatuses(copy);
  await act(async () => { client.setQueryData(directoryKey, { users: [{ principalId: run.responsibleUserId, user: { name: null, email: "raw@example.test" } }] }); });
  await flush();
  expect(responsible()?.textContent).toBe("raw@example.test");
  await act(async () => { client.setQueryData(queryKeys.runDetail(run.id), { ...run, responsibleUserId: null }); });
  await flush();
  expect(container.querySelector('[data-testid="run-detail-on-behalf-of"]')).toBeNull();
  expect([...reads(), api.directory.mock.calls.length]).toEqual(requests);
  expect(api.login).not.toHaveBeenCalled(); expect(api.reset).not.toHaveBeenCalled();
  expect(JSON.stringify({ run, operations })).toBe(original);
});

 it("retry boundary prevents same-act duplicate requests on the real RunDetail", async () => {
  client.setQueryData(queryKeys.auth.session, null);
  const pending = deferred<Awaited<ReturnType<AgentsApi["retryFailedRun"]>>>(); api.retry.mockReturnValue(pending.promise);
  await renderRun();
  const retry = button(i18n.t("workflow.retry"));
  await act(async () => { retry.click(); retry.click(); });
  await waitFor(() => expect(api.retry).toHaveBeenCalled());
  expect(api.retry).toHaveBeenCalledExactlyOnceWith("agent-original", "run-original", "company-original");
  await act(async () => pending.resolve({ runId: null, issueId: null })); await flush();
});

let retryNavigate: ReturnType<typeof useNavigate>;
let retryLocation = "";
function RetryRouterProbe() {
  retryNavigate = useNavigate(); const location = useLocation();
  retryLocation = location.pathname + location.search + location.hash;
  return null;
}
async function renderRetryRun(run = makeRun()) {
  await mount(<><RetryRouterProbe /><RunDetail run={run} agentRouteId="original-route" adapterType="claude_local" adapterConfig={{}} /></>);
}
it.each(["company", "route", "same-path", "user", "session", "clear", "remove", "unmount"])("retry boundary ignores late RunDetail success after %s", async change => {
  client.setQueryData(queryKeys.auth.session, { user: { id: "u1" }, session: { id: "s1", userId: "u1" } });
  const pending = deferred<Awaited<ReturnType<AgentsApi["retryFailedRun"]>>>(); api.retry.mockReturnValue(pending.promise);
  await renderRetryRun(); await click(i18n.t("workflow.retry"));
  if (change === "company") { retryCompany.id = "company-new"; await renderRetryRun(); }
  if (change === "route") await act(async () => { await retryNavigate("/new?query#hash"); });
  if (change === "same-path") await act(async () => { await retryNavigate("/"); });
  if (change === "unmount") await mount(<RetryRouterProbe />);
  if (change === "user" || change === "session") client.setQueryData(queryKeys.auth.session, { user: { id: change === "user" ? "u2" : "u1" }, session: { id: "s2" } });
  if (change === "clear") client.clear();
  if (change === "remove") client.removeQueries({ queryKey: queryKeys.auth.session, exact: true });
  const path = retryLocation;
  await act(async () => pending.resolve({ runId: "late-successor", issueId: null })); await flush();
  expect(retryLocation).toBe(path);
});
it("retry boundary keeps a new RunDetail attempt pending after router A-B-A and old settlement", async () => {
  client.setQueryData(queryKeys.auth.session, null);
  const old = deferred<Awaited<ReturnType<AgentsApi["retryFailedRun"]>>>();
  const next = deferred<Awaited<ReturnType<AgentsApi["retryFailedRun"]>>>();
  api.retry.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await renderRetryRun(); await click(i18n.t("workflow.retry"));
  await act(async () => { await retryNavigate("/other"); }); await act(async () => { await retryNavigate(-1); });
  await click(i18n.t("workflow.retry"));
  expect(api.retry).toHaveBeenCalledTimes(2);
  await act(async () => old.resolve({ runId: "old", issueId: null })); await flush();
  expect(retryLocation).toBe("/"); expect(button(i18n.t("managementUi.retrying")).disabled).toBe(true);
  await act(async () => next.resolve({ runId: "new", issueId: null })); await flush();
  expect(retryLocation).toBe("/agents/original-route/runs/new");
});

it("retry boundary retains the original run cache and suppresses old inline errors after a run change", async () => {
  client.setQueryData(queryKeys.auth.session, null);
  const old = deferred<Awaited<ReturnType<AgentsApi["retryFailedRun"]>>>();
  const next = deferred<Awaited<ReturnType<AgentsApi["retryFailedRun"]>>>();
  api.retry.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await renderRetryRun(); await click(i18n.t("workflow.retry"));
  const newer = makeRun({ id: "run-new", agentId: "agent-new" });
  api.run.mockImplementation(async id => id === newer.id ? newer : makeRun());
  await renderRetryRun(newer); await click(i18n.t("workflow.retry"));
  expect(api.retry.mock.calls).toEqual([["agent-original", "run-original", "company-original"], ["agent-new", "run-new", "company-original"]]);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await act(async () => old.reject(new Error("Stale server error 原文"))); await flush();
  expect(container.textContent).not.toContain("Stale server error 原文");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.heartbeats("company-original", "agent-original") });
  expect(invalidate).not.toHaveBeenCalledWith({ queryKey: queryKeys.heartbeats("company-original", "agent-new") });
  expect(button(i18n.t("managementUi.retrying")).disabled).toBe(true);
  await act(async () => next.reject(new Error("Current server error 原文"))); await flush();
  expect(container.textContent).toContain("Current server error 原文");
});

it.each(["clear", "remove", "session"])("retry boundary rejects RunDetail clicks before auth %s commits", async change => {
  client.setQueryData(queryKeys.auth.session, { user: { id: "u1" }, session: { id: "s1" } });
  api.retry.mockResolvedValue({ runId: null, issueId: null });
  await renderRetryRun(); const retry = button(i18n.t("workflow.retry"));
  await act(async () => {
    if (change === "clear") client.clear();
    if (change === "remove") client.removeQueries({ queryKey: queryKeys.auth.session, exact: true });
    if (change === "session") client.setQueryData(queryKeys.auth.session, { user: { id: "u1" }, session: { id: "s2" } });
    retry.click();
  });
  expect(api.retry).not.toHaveBeenCalled();
});
