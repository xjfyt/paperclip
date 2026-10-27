// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { instanceGeneralSettingsSchema, instanceExperimentalSettingsWithManagedSchema,
  type AgentDetail as AgentDetailRecord, type AgentConfigRevision, type Company, type HeartbeatRun,
  type ResourceMemberships, type WorkspaceOperation } from "@paperclipai/shared";
import type { BuiltInAgentState } from "../api/builtInAgents";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentDetail, AgentOverview, AgentRevisionsTab, ConfigurationTab, LogViewer, RunDetail } from "./AgentDetail";
import { ThemeProvider } from "../context/ThemeContext";
import { TooltipProvider } from "../components/ui/tooltip";
import { queryKeys } from "../lib/queryKeys";
import { formatTokens } from "../lib/utils";
import { systemLabel } from "../i18n/system-labels";
import { validateLocaleMessages } from "../i18n/locale-validation";
import { agentPermissionSourcesMessages } from "../i18n/agent-permission-sources-test-resources";
import { agentDetailConfirmMessages } from "../i18n/agent-detail-confirm-test-resources";
import { i18n, agentDetailLabelsMessages as messages } from "../i18n/agent-detail-labels-test-resources";

type AgentsApi = typeof import("../api/agents").agentsApi;
type HeartbeatsApi = typeof import("../api/heartbeats").heartbeatsApi;
type AccessApi = typeof import("../api/access").accessApi;
type SettingsApi = typeof import("../api/instanceSettings").instanceSettingsApi;
const api = vi.hoisted(() => ({
  identity: vi.fn<AgentsApi["getIdentity"]>(), permissions: vi.fn<AgentsApi["updatePermissions"]>(),
  agent: vi.fn<AgentsApi["get"]>(), revisions: vi.fn<AgentsApi["listConfigRevisions"]>(),
  bundle: vi.fn<AgentsApi["instructionsBundle"]>(), create: vi.fn<AgentsApi["create"]>(),
  rollback: vi.fn<AgentsApi["rollbackConfigRevision"]>(), pause: vi.fn<AgentsApi["pause"]>(),
  invoke: vi.fn<AgentsApi["invoke"]>(), terminate: vi.fn<AgentsApi["terminate"]>(),
  run: vi.fn<HeartbeatsApi["get"]>(), runs: vi.fn<HeartbeatsApi["list"]>(),
  events: vi.fn<HeartbeatsApi["events"]>(), operations: vi.fn<HeartbeatsApi["workspaceOperations"]>(),
  operationLog: vi.fn<HeartbeatsApi["workspaceOperationLog"]>(),
  issues: vi.fn<typeof import("../api/activity").activityApi.issuesForRun>(),
  access: vi.fn<AccessApi["getCurrentBoardAccess"]>(), directory: vi.fn<AccessApi["listUserDirectory"]>(),
  general: vi.fn<SettingsApi["getGeneral"]>(), experimental: vi.fn<SettingsApi["getExperimental"]>(),
  decisions: vi.fn<typeof import("../api/tools").toolsApi.getRunDecisionLookup>(),
  builtIns: vi.fn<typeof import("../api/builtInAgents").builtInAgentsApi.list>(),
  memberships: vi.fn<typeof import("../api/resourceMemberships").resourceMembershipsApi.listMine>(),
}));
const context = vi.hoisted(() => ({
  closePanel: vi.fn(), setBreadcrumbs: vi.fn(), setSelectedCompanyId: vi.fn(), pushToast: vi.fn(), openNewIssue: vi.fn(),
}));
vi.mock("../api/agents", () => ({ agentsApi: { get: api.agent, getIdentity: api.identity, updatePermissions: api.permissions, listConfigRevisions: api.revisions,
  rollbackConfigRevision: api.rollback, pause: api.pause, invoke: api.invoke, terminate: api.terminate,
  instructionsBundle: api.bundle, create: api.create } }));
vi.mock("../api/heartbeats", () => ({ heartbeatsApi: { get: api.run, list: api.runs, events: api.events,
  workspaceOperations: api.operations, workspaceOperationLog: api.operationLog } }));
vi.mock("../api/access", () => ({ accessApi: { getCurrentBoardAccess: api.access, listUserDirectory: api.directory } }));
vi.mock("../api/instanceSettings", () => ({ instanceSettingsApi: { getGeneral: api.general, getExperimental: api.experimental } }));
vi.mock("../api/activity", () => ({ activityApi: { issuesForRun: api.issues } }));
vi.mock("../api/tools", () => ({ toolsApi: { getRunDecisionLookup: api.decisions } }));
vi.mock("../api/builtInAgents", () => ({ builtInAgentsApi: { list: api.builtIns } }));
vi.mock("../api/resourceMemberships", () => ({ resourceMembershipsApi: { listMine: api.memberships } }));
vi.mock("../lib/router", async () => await import("react-router-dom"));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ companies: [company], selectedCompanyId: company.id, setSelectedCompanyId: context.setSelectedCompanyId }), useOptionalCompany: () => null }));
vi.mock("../context/PanelContext", () => ({ usePanel: () => ({ closePanel: context.closePanel }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: context.setBreadcrumbs }) }));
vi.mock("../context/SidebarContext", () => ({ useSidebar: () => ({ isMobile: false }) }));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast: context.pushToast }) }));
vi.mock("../context/DialogContext", () => ({ useDialogActions: () => ({ openNewIssue: context.openNewIssue }) }));
vi.mock("../components/AgentCharacter", () => ({ AgentCharacter: () => null }));
vi.mock("../components/RunWorkspaceRecoverySurface", () => ({ RunWorkspaceRecoverySurface: () => null }));
vi.mock("../components/RunnerInspector", () => ({ RunnerInspector: () => null }));
vi.mock("../components/ScrollToBottom", () => ({ ScrollToBottom: () => null }));
vi.mock("../components/ai-connections/AiConnectionPoolRunDetails", () => ({ AiConnectionPoolRunDetails: () => null }));
vi.mock("../adapters", () => ({ getUIAdapter: () => null, onAdapterChange: () => () => {}, buildTranscript: () => [] }));
vi.mock("../components/transcript/RunTranscriptView", () => ({ RunTranscriptView: () => null }));
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
const locales = ["en", "zh-CN", "es", "ja"] as const;
const date = new Date("2026-01-01T00:00:00Z");
const company: Company = {
  id: "company-original", name: "Original company", description: null, status: "active", pauseReason: null,
  pausedAt: null, issuePrefix: "RAW", issueCounter: 1, budgetMonthlyCents: 0, spentMonthlyCents: 0,
  defaultResponsibleUserId: null, requireBoardApprovalForNewAgents: false, interactionResolverGovernance: {},
  feedbackDataSharingEnabled: false, feedbackDataSharingConsentAt: null, feedbackDataSharingConsentByUserId: null,
  feedbackDataSharingTermsVersion: null, logoAssetId: null, logoUrl: null, createdAt: date, updatedAt: date,
};
function makeAgent(overrides: Partial<AgentDetailRecord> = {}): AgentDetailRecord {
  return {
    id: "agent-original", companyId: company.id, name: 'Agent "用户" <raw>', urlKey: "raw-agent", role: "engineer",
    title: "Original engineer", icon: null, status: "active", reportsTo: null, capabilities: "Raw capability",
    adapterType: "codex_local", adapterConfig: { model: "raw-model" }, runtimeConfig: {}, budgetMonthlyCents: 0,
    spentMonthlyCents: 0, pauseReason: null, pausedAt: null, permissions: { canCreateAgents: false },
    lastHeartbeatAt: null, metadata: null, createdAt: date, updatedAt: date, chainOfCommand: [],
    access: { canAssignTasks: true, taskAssignSource: "explicit_grant", membership: null, grants: [] }, ...overrides,
  };
}
function revision(index: number, changedKeys: string[] = []): AgentConfigRevision {
  return { id: `revision-${index}-原文`, companyId: company.id, agentId: "agent-original", createdByAgentId: null,
    createdByUserId: "user-original", source: "raw_source", rolledBackFromRevisionId: null, changedKeys,
    beforeConfig: { model: "original-model" }, afterConfig: { model: "next-model" }, createdAt: date };
}
function operation(created: boolean): WorkspaceOperation {
  return { id: `operation-${created}`, companyId: company.id, executionWorkspaceId: "workspace-original",
    heartbeatRunId: "run-original", issueId: null, phase: "worktree_prepare", command: "git worktree add /tmp/raw 原文",
    cwd: "/tmp/raw", status: "succeeded", exitCode: 0, logStore: "local", logRef: created ? "log-original" : null,
    logBytes: null, logSha256: null, logCompressed: false, stdoutExcerpt: "stdout 内容 <raw>",
    stderrExcerpt: "stderr 内容 <raw>", metadata: { created, branchName: "branch-原文", baseRef: "main" },
    startedAt: date, finishedAt: date, createdAt: date, updatedAt: date };
}
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
function builtIn(agent = makeAgent()): BuiltInAgentState {
  return { agentId: agent.id, agent, status: "ready", pauseReason: null,
    definition: { key: "raw-system", displayName: 'System "原文"', featureKeys: ["rawFeature <tag>", "原始功能"],
      shortPurpose: "Raw purpose", defaultInstructions: "Raw instructions", defaultRole: "engineer" } };
}
const memberships: ResourceMemberships = { projectMemberships: {}, agentMemberships: {}, starredProjectIds: [],
  starredAgentIds: [], starredDocumentIds: [], projectStarredAt: {}, agentStarredAt: {}, documentStarredAt: {}, updatedAt: null };
const confirmT = (key: keyof typeof agentDetailConfirmMessages.en, values = {}) => i18n.t(`agentDetailConfirmUi.${key}`, values);
const t = (key: keyof typeof messages.en, values = {}) => i18n.t(`agentDetailLabelsUi.${key}`, values);
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  Object.values(api).forEach(mock => mock.mockReset()); Object.values(context).forEach(mock => mock.mockReset());
  api.bundle.mockResolvedValue({ agentId: "agent-original", companyId: company.id, mode: "managed", rootPath: "/tmp/raw-instructions",
    managedRootPath: "/tmp/raw-instructions", entryFile: "AGENTS.md", resolvedEntryPath: "/tmp/raw-instructions/AGENTS.md",
    editable: true, warnings: [], legacyPromptTemplateActive: false, legacyBootstrapPromptTemplateActive: false, files: [] });
  api.identity.mockResolvedValue(null); api.permissions.mockResolvedValue(makeAgent());
  api.agent.mockResolvedValue(makeAgent()); api.revisions.mockResolvedValue([]); api.rollback.mockResolvedValue(makeAgent());
  api.pause.mockResolvedValue(makeAgent({ status: "paused" })); api.runs.mockResolvedValue([]);
  api.run.mockResolvedValue(makeRun({ errorCode: null })); api.events.mockResolvedValue([]); api.operations.mockResolvedValue([]);
  api.issues.mockResolvedValue([]); api.directory.mockResolvedValue({ users: [] }); api.builtIns.mockResolvedValue([]);
  api.memberships.mockResolvedValue(memberships);
  api.access.mockResolvedValue({ user: null, userId: "operator", isInstanceAdmin: false, companyIds: [company.id], source: "session", keyId: null });
  api.general.mockResolvedValue(instanceGeneralSettingsSchema.parse({}));
  api.experimental.mockResolvedValue(instanceExperimentalSettingsWithManagedSchema.parse({ enableBuiltInAgents: true }));
  api.decisions.mockResolvedValue({ runId: "run-original", decisions: [] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.restoreAllMocks(); });
function LocationProbe() { const location = useLocation(); return <output data-location={location.pathname} />; }
async function mount(node: ReactNode, path = "/agents/raw-agent/revisions") {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><TooltipProvider>
    {node}<LocationProbe />
  </TooltipProvider></MemoryRouter></QueryClientProvider>));
  await waitFor(() => expect(client.isFetching()).toBe(0));
}
function page() { return <Routes>
  <Route path="/agents/raw-copy/dashboard" element={<div>Duplicated route</div>} />
  <Route path="/agents/:agentId/:tab" element={<AgentDetail />} />
  <Route path="/agents/:agentId/:tab/:runId" element={<AgentDetail />} />
</Routes>; }
async function waitFor(assertion: () => void) {
  for (let attempt = 0; ; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    try { assertion(); return; } catch (error) { if (attempt >= 29) throw error; }
  }
}
async function language(locale: typeof locales[number]) { await act(async () => { await i18n.changeLanguage(locale); }); }
function button(label: string, host: ParentNode = container) {
  const result = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(candidate => candidate.textContent?.trim() === label);
  expect(result, label).toBeDefined(); return result!;
}
function reads() { return [api.identity, api.agent, api.revisions, api.run, api.runs, api.events, api.operations, api.operationLog,
  api.issues, api.directory, api.access, api.general, api.experimental, api.builtIns, api.memberships, api.decisions].map(mock => mock.mock.calls.length); }
function noWrites() { for (const mock of [api.permissions, api.rollback, api.pause, api.invoke, api.terminate, api.create, context.openNewIssue]) expect(mock).not.toHaveBeenCalled(); }

it.each(locales)("validates complete sentence placeholders in %s", locale => {
  expect(validateLocaleMessages(messages[locale], messages.en)).toEqual([]);
});

it.each(locales)("updates actual page warnings and avatar in %s without changing raw chain, navigation or pause cancellation", async locale => {
  const agent = makeAgent({ orgChainHealth: {
    status: "invalid_org_chain", reason: "missing_manager", fullChain: [{ id: "agent-original", companyId: company.id,
      name: 'Agent "用户" <raw>', status: "active", reportsTo: "manager-raw", depth: 0, relation: "self" }],
    firstInvalidAncestor: null, invalidAncestors: [], repairGuidance: "Server repair guidance 原文",
  } });
  api.agent.mockResolvedValue(agent); api.builtIns.mockResolvedValue([builtIn(agent)]);
  await mount(page());
  await waitFor(() => expect(container.querySelector('[role="note"] strong')?.textContent).toBe("RawFeature <tag>, 原始功能"));
  expect(button(systemLabel("Assign Task")).disabled).toBe(true);
  expect(button(systemLabel("Run now")).disabled).toBe(true);
  await act(async () => button(systemLabel("Pause")).click());
  const dialog = document.querySelector('[role="alertdialog"]'); expect(dialog).not.toBeNull();
  const counts = reads(); const avatar = container.querySelector('[role="img"]');
  await language(locale);
  expect(container.textContent).toContain(t("invalidReportingChain", { name: agent.name }));
  expect(container.textContent).toContain("Server repair guidance 原文");
  expect(container.querySelector('[role="img"]')).toBe(avatar);
  expect(avatar?.getAttribute("aria-label")).toBe(t("avatar", { name: agent.name }));
  const feature = "RawFeature <tag>, 原始功能";
  expect(container.querySelector('[role="note"] strong')?.textContent).toBe(feature);
  expect(container.querySelector("tag")).toBeNull();
  expect(container.querySelector('[role="note"] .leading-snug')?.textContent).toBe(t("builtInWarning", { feature }).replace(/<\/?0>/g, ""));
  expect(document.querySelector('[role="alertdialog"]')).toBe(dialog);
  expect(dialog?.textContent).toContain(t("pauseWarning", { feature, featureLower: feature.toLowerCase() }));
  expect(dialog?.querySelector('[data-slot="alert-dialog-title"]')?.textContent).toBe(confirmT("pauseTitle", { name: 'System "原文"' }));
  expect(button(confirmT("pauseAnyway"), dialog!)).toBeDefined();
  expect(button(i18n.t("commonUi.cancel"), dialog!)).toBeDefined();
  expect(reads()).toEqual(counts); noWrites();
  await act(async () => button(i18n.t("commonUi.cancel"), dialog!).click());
  expect(document.querySelector('[role="alertdialog"]')).toBeNull(); noWrites();
  expect(container.querySelector("output")?.getAttribute("data-location")).toBe("/agents/raw-agent/revisions");
  expect(context.setSelectedCompanyId).not.toHaveBeenCalled();
});

it.each(locales)("keeps the built-in pause action explicitly confirmed in %s", async locale => {
  api.builtIns.mockResolvedValue([builtIn()]);
  await mount(page());
  await waitFor(() => expect(container.querySelector('[role="note"] strong')?.textContent).toBe("RawFeature <tag>, 原始功能"));
  await language(locale);
  await act(async () => button(systemLabel("Pause")).click());
  expect(api.pause).not.toHaveBeenCalled();
  await act(async () => button(confirmT("pauseAnyway"), document.querySelector('[role="alertdialog"]')!).click());
  await waitFor(() => expect(api.pause).toHaveBeenCalledExactlyOnceWith("agent-original", company.id));
  expect(api.terminate).not.toHaveBeenCalled(); expect(api.invoke).not.toHaveBeenCalled();
});

it.each(locales.flatMap(locale => [0, 1, 2].map(count => ({ locale, count }))))("updates $count revision summaries in $locale while keeping raw keys and exact restore IDs", async ({ locale, count }) => {
  const rows = Array.from({ length: count }, (_, index) => revision(index, index ? ["adapterConfig.model", "原始键"] : []));
  api.revisions.mockResolvedValue(rows);
  await mount(<AgentRevisionsTab agent={makeAgent()} companyId={company.id} />);
  await waitFor(() => expect(container.textContent).toContain(i18n.t("routineHistoryUi.total", { count })));
  const counts = reads(); await language(locale);
  expect(container.textContent).toContain(i18n.t("routineHistoryUi.total", { count }));
  if (count > 0) expect(container.textContent).toContain(t("revisionUnchanged"));
  if (count > 1) expect(container.textContent).toContain(t("revisionChanged", { changes: "adapterConfig.model, 原始键" }));
  for (const row of rows) { expect(container.textContent).toContain(row.id.slice(0, 8)); expect(container.textContent).toContain(row.source); }
  expect(reads()).toEqual(counts); noWrites();
  if (count > 0) {
    await act(async () => button(i18n.t("commonUi.restore")).click());
    await waitFor(() => expect(api.rollback).toHaveBeenCalledExactlyOnceWith("agent-original", rows[0].id, company.id));
  }
});

it.each(locales)("translates actual workspace descriptions in %s while retaining open logs, commands and streams", async locale => {
  const operations = [operation(true), operation(false)]; api.operations.mockResolvedValue(operations);
  api.events.mockResolvedValue([{ id: 1, companyId: company.id, runId: "run-original", agentId: "agent-original", seq: 1,
    eventType: "status", stream: "system", level: "info", color: null, message: "Raw event 原文", payload: null, createdAt: date }]);
  api.operationLog.mockResolvedValue({ operationId: operations[0].id, store: "local", logRef: "log-original",
    content: JSON.stringify({ ts: date.toISOString(), stream: "stderr", chunk: "raw log <原文>" }) + "\n" });
  await mount(<LogViewer run={makeRun({ errorCode: null })} adapterType="codex_local" />);
  await waitFor(() => expect(container.textContent).toContain(t("workspaceCreated")));
  await act(async () => button(systemLabel("Show full log")).click());
  await waitFor(() => expect(container.textContent).toContain("raw log <原文>"));
  const counts = reads(); await language(locale);
  for (const key of ["workspaceCreated", "workspaceReused"] as const) expect(container.textContent).toContain(t(key));
  for (const key of ["stderrExcerpt", "stdoutExcerpt"]) expect(container.textContent).toContain(i18n.t(`agentSessionControlsUi.${key}`));
  for (const raw of [operations[0].command!, operations[0].cwd!, "branch-原文", "main", "stdout 内容 <raw>", "stderr 内容 <raw>", "[stderr]", "raw log <原文>"]) expect(container.textContent).toContain(raw);
  expect(button(systemLabel("Hide full log"))).toBeDefined();
  expect(reads()).toEqual(counts); noWrites();
  expect(api.operationLog).toHaveBeenCalledExactlyOnceWith(operations[0].id);
});

it.each(locales)("updates token unit, signal and identity fallback in %s without translating run data or changing selected run", async locale => {
  const identity = { id: "identity-none", revision: 1, responsibleUserId: null, messageId: null, parentContextId: null,
    cause: "raw_cause", status: "raw_status", acceptedAt: date, github: null };
  const run = makeRun({ errorCode: null, signal: "SIGTERM 原文", usageJson: { inputTokens: 1234, outputTokens: 56 },
    responsibleUserId: "person-original", identityHistory: [identity, { ...identity, id: "identity-known", responsibleUserId: "person-original" },
      { ...identity, id: "identity-id", responsibleUserId: "unknown-user-id" }] });
  api.run.mockResolvedValue(run); api.runs.mockResolvedValue([run]);
  api.directory.mockResolvedValue({ users: [{ principalId: "person-original", status: "active",
    user: { id: "person-original", name: 'Person "用户" <raw>', email: "raw@example.test", image: null } }] });
  await mount(page(), "/agents/raw-agent/runs/run-original");
  await waitFor(() => expect(container.querySelector('a[href="/agents/raw-agent/runs"]')).not.toBeNull());
  await waitFor(() => expect(container.textContent).toContain('Person "用户" <raw>'));
  const selected = container.querySelector('a[href="/agents/raw-agent/runs"]'); expect(selected).not.toBeNull();
  const details = container.querySelector<HTMLDetailsElement>('[data-testid="run-identity-history"]')!;
  details.open = true;
  const counts = reads(); await language(locale);
  expect(selected?.textContent).toContain(t("tokenCount", { tokens: formatTokens(1290) }));
  expect(container.textContent).toContain(t("signal", { signal: run.signal }));
  expect(details.textContent).toContain(t("noResponsiblePerson"));
  for (const raw of ['Person "用户" <raw>', "unknown-user-id", "raw_cause", "raw_status", run.error!]) expect(container.textContent).toContain(raw);
  expect(container.querySelector('[data-testid="run-identity-history"]')).toBe(details); expect(details.open).toBe(true);
  expect(container.querySelector('a[href="/agents/raw-agent/runs"]')).toBe(selected);
  expect(container.querySelector("output")?.getAttribute("data-location")).toBe("/agents/raw-agent/runs/run-original");
  expect(reads()).toEqual(counts); noWrites();
  expect(api.directory).toHaveBeenCalledExactlyOnceWith(company.id);
});

it.each([{ exitCode: 0, signal: "SIGTERM" }, { exitCode: 1, signal: null }])("retains the existing signal display gate for $exitCode / $signal", async ({ exitCode, signal }) => {
  const run = makeRun({ errorCode: null, exitCode, signal }); api.run.mockResolvedValue(run);
  await mount(<RunDetail run={run} agentRouteId="raw-agent" adapterType="codex_local" adapterConfig={{}} />);
  for (const locale of locales) { await language(locale); expect(container.textContent).not.toContain(t("signal", { signal: run.signal })); }
  expect(api.directory).not.toHaveBeenCalled(); noWrites();
});

it.each(locales)("validates the additional confirmation contribution in %s", locale => {
  expect(validateLocaleMessages(agentDetailConfirmMessages[locale], agentDetailConfirmMessages.en)).toEqual([]);
});

it.each(locales.flatMap(locale => [false, true].map(raw => ({ locale, raw }))))("retains pause failure source after switching to $locale (raw=$raw)", async ({ locale, raw }) => {
  api.builtIns.mockResolvedValue([builtIn()]);
  api.pause.mockRejectedValue(raw ? new Error("Action failed") : { code: "opaque_failure" });
  await mount(page());
  await waitFor(() => expect(container.querySelector('[role="note"] strong')).not.toBeNull());
  await act(async () => button(systemLabel("Pause")).click());
  await act(async () => button(confirmT("pauseAnyway"), document.querySelector('[role="alertdialog"]')!).click());
  await waitFor(() => expect(container.textContent).toContain("Action failed"));
  const counts = reads(); await language(locale);
  const failure = container.querySelector("p.text-destructive");
  expect(failure?.textContent).toBe(raw ? "Action failed" : i18n.t("managementUi.actionFailed"));
  expect(api.pause).toHaveBeenCalledExactlyOnceWith("agent-original", company.id);
  expect(api.terminate).not.toHaveBeenCalled(); expect(reads()).toEqual(counts);
});

async function openDuplicate() {
  // Match the accessible value directly; names can contain quotes or CSS syntax.
  const menu = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find(candidate => candidate.getAttribute("aria-label") === i18n.t("browserQa.openActions", { name: makeAgent().name }));
  expect(menu).toBeDefined(); await act(async () => menu!.click());
  await waitFor(() => expect(button(confirmT("duplicateAgent"), document.body)).toBeDefined());
}

it.each(locales)("uses the latest %s duplicate confirmation with raw names and cancellation makes no requests", async locale => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await mount(page()); await waitFor(() => expect(container.querySelector("h1")?.textContent).toBe(makeAgent().name));
  await openDuplicate();
  const counts = reads(); await language(locale);
  await act(async () => button(confirmT("duplicateAgent"), document.body).click());
  expect(confirm).toHaveBeenCalledExactlyOnceWith(confirmT("duplicateConfirm", { name: makeAgent().name, nextName: `${makeAgent().name} Copy` }));
  expect(api.bundle).not.toHaveBeenCalled(); noWrites(); expect(context.pushToast).not.toHaveBeenCalled();
  expect(reads()).toEqual(counts);
  expect(container.querySelector("output")?.getAttribute("data-location")).toBe("/agents/raw-agent/revisions");
});

it.each(locales)("keeps explicit duplicate payload and pending state unchanged through a switch to %s", async locale => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const created = makeAgent({ id: "copy-original-id", urlKey: "raw-copy", name: 'Copied "原文"' });
  let resolve!: (agent: Awaited<ReturnType<AgentsApi["create"]>>) => void;
  api.create.mockReturnValue(new Promise(done => { resolve = done; }));
  await mount(page()); await waitFor(() => expect(container.querySelector("h1")?.textContent).toBe(makeAgent().name));
  await openDuplicate(); await act(async () => button(confirmT("duplicateAgent"), document.body).click());
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
  expect(api.bundle).toHaveBeenCalledExactlyOnceWith("agent-original", company.id);
  expect(api.create).toHaveBeenCalledExactlyOnceWith(company.id, {
    name: `${makeAgent().name} Copy`, role: "engineer", adapterType: "codex_local", adapterConfig: { model: "raw-model" },
    runtimeConfig: {}, defaultEnvironmentId: null, budgetMonthlyCents: 0,
    permissions: { canCreateAgents: false, canCreateSkills: true }, title: "Original engineer", capabilities: "Raw capability",
  });
  await openDuplicate(); const pending = button(confirmT("duplicateAgent"), document.body); expect(pending.disabled).toBe(true);
  const counts = reads(); await language(locale);
  expect(button(confirmT("duplicateAgent"), document.body)).toBe(pending); expect(pending.disabled).toBe(true);
  await act(async () => pending.click()); expect(confirm).toHaveBeenCalledTimes(1); expect(api.create).toHaveBeenCalledTimes(1);
  expect(reads()).toEqual(counts); expect(context.pushToast).not.toHaveBeenCalled();
  await act(async () => resolve(created));
  await waitFor(() => expect(context.pushToast).toHaveBeenCalledExactlyOnceWith({ title: confirmT("duplicateSuccess"), body: created.name, tone: "success" }));
  expect(container.querySelector("output")?.getAttribute("data-location")).toBe("/agents/raw-copy/dashboard");
  expect(api.pause).not.toHaveBeenCalled(); expect(api.terminate).not.toHaveBeenCalled();
});

it.each(locales.flatMap(locale => [false, true].map(raw => ({ locale, raw }))))("keeps duplicate local fallback separate from server text in $locale (raw=$raw)", async ({ locale, raw }) => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  api.create.mockRejectedValue(raw ? new Error("Failed to duplicate agent") : { code: "opaque_failure" });
  await mount(page()); await waitFor(() => expect(container.querySelector("h1")?.textContent).toBe(makeAgent().name));
  await openDuplicate(); await act(async () => button(confirmT("duplicateAgent"), document.body).click());
  await waitFor(() => expect(context.pushToast).toHaveBeenCalledExactlyOnceWith({ title: confirmT("duplicateFailedTitle"), body: "Failed to duplicate agent", tone: "error" }));
  const counts = reads(); await language(locale);
  expect(container.querySelector("p.text-destructive")?.textContent).toBe(raw ? "Failed to duplicate agent" : confirmT("duplicateFailed"));
  expect(api.create).toHaveBeenCalledTimes(1); expect(context.pushToast).toHaveBeenCalledTimes(1); expect(reads()).toEqual(counts);
});

it.each(locales)("retains disabled pause controls while an explicit request is pending in %s", async locale => {
  api.builtIns.mockResolvedValue([builtIn()]);
  let resolve!: (agent: Awaited<ReturnType<AgentsApi["pause"]>>) => void;
  api.pause.mockReturnValue(new Promise(done => { resolve = done; }));
  await mount(page()); await waitFor(() => expect(container.querySelector('[role="note"] strong')).not.toBeNull());
  await act(async () => button(systemLabel("Pause")).click());
  await act(async () => button(confirmT("pauseAnyway"), document.querySelector('[role="alertdialog"]')!).click());
  await waitFor(() => expect(button(systemLabel("Pause")).disabled).toBe(true));
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  const counts = reads(); await language(locale);
  const pending = button(systemLabel("Pause")); expect(pending.disabled).toBe(true);
  await act(async () => pending.click());
  expect(api.pause).toHaveBeenCalledExactlyOnceWith("agent-original", company.id); expect(reads()).toEqual(counts);
  expect(api.terminate).not.toHaveBeenCalled();
  await act(async () => resolve(makeAgent({ status: "paused" })));
});

it.each(locales)("validates permission and source messages in %s", locale => {
  expect(validateLocaleMessages(agentPermissionSourcesMessages[locale], agentPermissionSourcesMessages.en)).toEqual([]);
});

const permissionCases = [
  { source: "ceo_role", key: "taskAssignCeoRole", role: "ceo", create: false, assign: true, skills: undefined },
  { source: "agent_creator", key: "taskAssignAgentCreator", role: "engineer", create: true, assign: true, skills: false },
  { source: "explicit_grant", key: "taskAssignExplicitGrant", role: "engineer", create: false, assign: true, skills: true },
  { source: "simple_default", key: "taskAssignSimpleDefault", role: "engineer", create: false, assign: true, skills: undefined },
  { source: "none", key: "taskAssignNone", role: "engineer", create: false, assign: false, skills: false },
  { source: "explicit_grant", key: "taskAssignExplicitGrant", role: "ceo", create: true, assign: false, skills: false },
  { source: "none", key: "taskAssignNone", role: "engineer", create: true, assign: false, skills: true },
  { source: "simple_default", key: "taskAssignSimpleDefault", role: "engineer", create: false, assign: false, skills: false },
] as const;
it.each(locales.flatMap(locale => permissionCases.flatMap(config => [false, true].map(pending => ({ locale, config, pending })))))
("keeps permission explanation, lock and payload independent in $locale ($config.source / $config.role / pending=$pending)", async ({ locale, config, pending }) => {
  const agent = makeAgent({ role: config.role, permissions: { canCreateAgents: config.create, canCreateSkills: config.skills },
    access: { canAssignTasks: config.assign, taskAssignSource: config.source, membership: null, grants: [] } });
  const mutate = vi.fn<(permissions: Parameters<AgentsApi["updatePermissions"]>[1]) => void>();
  const onDirtyChange = vi.fn(); const onSaveActionChange = vi.fn(); const onCancelActionChange = vi.fn(); const onSavingChange = vi.fn();
  await mount(<ConfigurationTab agent={agent} companyId={company.id} content="permissions"
    onDirtyChange={onDirtyChange} onSaveActionChange={onSaveActionChange} onCancelActionChange={onCancelActionChange}
    onSavingChange={onSavingChange} updatePermissions={{ mutate, isPending: pending }} />);
  const switches = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]')); expect(switches).toHaveLength(3);
  const counts = reads(); const dirtyCalls = onDirtyChange.mock.calls.length; await language(locale);
  expect(container.textContent).toContain(agentPermissionSourcesMessages[locale][config.key]);
  expect(Array.from(container.querySelectorAll('[role="switch"]'))).toEqual(switches);
  expect(switches.map(control => control.getAttribute("aria-checked"))).toEqual([String(config.create), String(config.skills !== false), String(config.assign)]);
  expect(switches.map(control => control.disabled)).toEqual([pending, pending, pending || config.role === "ceo" || config.create]);
  expect(agent.access.taskAssignSource).toBe(config.source); expect(agent.role).toBe(config.role);
  expect(reads()).toEqual(counts); expect(onDirtyChange).toHaveBeenCalledTimes(dirtyCalls); expect(mutate).not.toHaveBeenCalled(); noWrites();
  for (const [index, control] of switches.entries()) {
    mutate.mockClear(); await act(async () => control.click());
    if (control.disabled) { expect(mutate).not.toHaveBeenCalled(); continue; }
    const expected = index === 0
      ? { canCreateAgents: !config.create, canCreateSkills: config.skills !== false, canAssignTasks: !config.create ? true : config.assign }
      : index === 1
        ? { canCreateAgents: config.create, canCreateSkills: config.skills === false, canAssignTasks: config.assign }
        : { canCreateAgents: config.create, canCreateSkills: config.skills !== false, canAssignTasks: !config.assign };
    expect(mutate).toHaveBeenCalledExactlyOnceWith(expected);
  }
});

it.each(locales)("preserves the actual permissions page request and pending lock across a switch to %s", async locale => {
  const agent = makeAgent({ access: { canAssignTasks: false, taskAssignSource: "none", membership: null, grants: [] } });
  api.agent.mockResolvedValue(agent);
  let resolve!: (agent: Awaited<ReturnType<AgentsApi["updatePermissions"]>>) => void;
  api.permissions.mockReturnValue(new Promise(done => { resolve = done; }));
  await mount(page(), "/agents/raw-agent/permissions");
  await waitFor(() => expect(container.querySelectorAll('[role="switch"]')).toHaveLength(3));
  const assign = container.querySelectorAll<HTMLButtonElement>('[role="switch"]')[2];
  await act(async () => assign.click());
  await waitFor(() => expect(assign.disabled).toBe(true));
  const counts = reads(); await language(locale);
  expect(container.textContent).toContain(agentPermissionSourcesMessages[locale].taskAssignNone);
  expect(container.querySelector("h1")?.textContent).toBe(agent.name);
  expect(container.querySelectorAll('[role="switch"]')[2]).toBe(assign);
  await act(async () => assign.click());
  expect(api.permissions).toHaveBeenCalledExactlyOnceWith("agent-original", { canCreateAgents: false, canCreateSkills: true, canAssignTasks: true }, company.id);
  expect(reads()).toEqual(counts); expect(container.querySelector("output")?.getAttribute("data-location")).toBe("/agents/raw-agent/permissions");
  await act(async () => resolve(agent));
});

const runSourceCases = [
  { source: "timer", key: "sourceTimer" }, { source: "assignment", key: "sourceAssignment" },
  { source: "on_demand", key: "sourceOnDemand" }, { source: "automation", key: "sourceAutomation" },
  { source: "future_source 原文", key: null }, { source: "constructor", key: null },
] as const;
it.each(locales.flatMap(locale => runSourceCases.flatMap(config => ["overview", "run-list"].map(host => ({ locale, config, host })))))
("renders $config.source at the real $host host in $locale without changing the wire source", async ({ locale, config, host }) => {
  const run = makeRun({ errorCode: null, contextSnapshot: null, error: "Original failure 原文" });
  // Model an additive future server source explicitly without asserting it is a known union member.
  Object.defineProperty(run, "invocationSource", { value: config.source, configurable: true });
  api.run.mockResolvedValue(run); api.runs.mockResolvedValue([run]);
  if (host === "overview") {
    await mount(<ThemeProvider><AgentOverview agent={makeAgent()} runs={[run]} assignedIssues={[]} directReportCount={0} skillNames={[]} agentRouteId="raw-agent" /></ThemeProvider>);
  } else {
    await mount(page(), "/agents/raw-agent/runs/run-original");
  }
  const href = host === "overview" ? "/agents/raw-agent/runs/run-original" : "/agents/raw-agent/runs";
  const runLink = () => Array.from(container.querySelectorAll<HTMLAnchorElement>(`a[href="${href}"]`))
    .find(anchor => anchor.querySelector('[data-slot="badge"]'));
  await waitFor(() => expect(runLink()).toBeDefined());
  const link = runLink()!;
  const counts = reads(); await language(locale);
  expect(link.textContent).toContain(config.key ? agentPermissionSourcesMessages[locale][config.key] : config.source);
  expect(link.textContent).toContain(run.id.slice(0, 8)); expect(link.textContent).toContain(run.error!);
  expect(runLink()).toBe(link);
  expect(run.invocationSource).toBe(config.source); expect(reads()).toEqual(counts); noWrites();
});
