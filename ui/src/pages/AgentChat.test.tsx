// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, AuthSession, Issue } from "@paperclipai/shared";
import type { TaskDetailSurface } from "./IssueDetail";
import type { agentChatsApi } from "../api/agentChats";
import type { agentsApi } from "../api/agents";
import type { authApi } from "../api/auth";
import { agentChatDraft } from "../lib/agent-chat-draft";
import { queryKeys } from "../lib/queryKeys";
import { AgentChat } from "./AgentChat";

const state = vi.hoisted(() => ({ companyId: "company-A", agentRef: "agent-A" }));
const chats = vi.hoisted(() => ({ get: vi.fn<typeof agentChatsApi.get>(), ensure: vi.fn<typeof agentChatsApi.ensure>() }));
const agents = vi.hoisted(() => ({ list: vi.fn<typeof agentsApi.list>(), get: vi.fn<typeof agentsApi.get>() }));
const auth = vi.hoisted(() => ({ getSession: vi.fn<typeof authApi.getSession>() }));
const surface = vi.hoisted(() => vi.fn<(props: ComponentProps<typeof TaskDetailSurface>) => void>());
vi.mock("../api/agentChats", () => ({ agentChatsApi: chats }));
vi.mock("../api/agents", () => ({ agentsApi: agents }));
vi.mock("../api/auth", () => ({ authApi: auth }));
vi.mock("../hooks/useAgentChatEnabled", () => ({ useAgentChatEnabled: () => ({ enabled: true, loaded: true }) }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.companyId }) }));
vi.mock("../lib/router", () => ({ useParams: () => ({ agentRef: state.agentRef }) }));
vi.mock("./IssueDetail", () => ({ TaskDetailSurface: (props: ComponentProps<typeof TaskDetailSurface>) => { surface(props); return null; } }));

function agent(id: string, companyId: string): Agent {
  return {
    id, companyId, name: id, urlKey: id, role: "engineer", title: null, icon: null,
    status: "active", reportsTo: null, capabilities: null, adapterType: "codex_local",
    adapterConfig: {}, runtimeConfig: {}, budgetMonthlyCents: 0, spentMonthlyCents: 0,
    pauseReason: null, pausedAt: null, permissions: { canCreateAgents: false },
    lastHeartbeatAt: null, metadata: null, createdAt: new Date(0), updatedAt: new Date(0),
  };
}
function session(userId = "user-1", id = "session-1"): AuthSession {
  return { session: { id, userId }, user: { id: userId, name: "User", email: null, image: null }, sentryDsn: null };
}
function issue(value: Agent, userId = "user-1"): Issue {
  return { ...agentChatDraft(value), id: `issue-${value.id}`, conversationUserId: userId };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("AgentChat creation identity", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  const a = agent("agent-A", "company-A");
  const b = agent("agent-B", "company-B");
  const currentEnsure = () => {
    const ensure = surface.mock.calls.at(-1)?.[0].conversation?.ensureIssue;
    if (!ensure) throw new Error("Conversation surface not rendered");
    return ensure;
  };
  async function render(value = a) {
    state.companyId = value.companyId;
    state.agentRef = value.id;
    surface.mockClear();
    await act(async () => root.render(<QueryClientProvider client={client}><AgentChat /></QueryClientProvider>));
    await vi.waitFor(() => expect(surface).toHaveBeenCalled());
    return currentEnsure();
  }
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
    chats.get.mockReset().mockResolvedValue(null);
    chats.ensure.mockReset();
    agents.list.mockReset().mockImplementation(async (companyId) => companyId === a.companyId ? [a] : [b]);
    auth.getSession.mockReset().mockResolvedValue(session());
    surface.mockClear();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
    localStorage.clear();
  });

  it("separates old-route creation from a new company and deduplicates the same scope", async () => {
    const pa = deferred<Issue>();
    const pb = deferred<Issue>();
    chats.ensure.mockImplementation((companyId) => companyId === a.companyId ? pa.promise : pb.promise);
    const ensureA = await render(a);
    const ensureB = await render(b);
    const firstB = ensureB();
    const secondB = ensureB();
    const firstA = ensureA();
    expect(chats.ensure.mock.calls).toEqual([[b.companyId, b.id], [a.companyId, a.id]]);
    await act(async () => { pa.resolve(issue(a)); pb.resolve(issue(b)); await Promise.all([firstA, firstB, secondB]); });
    expect(client.getQueryData(queryKeys.agentChats.detail(a.companyId, "user-1", a.id))).toEqual(issue(a));
    expect(client.getQueryData(queryKeys.agentChats.detail(b.companyId, "user-1", b.id))).toEqual(issue(b));
    await expect(ensureA()).resolves.toEqual(issue(a));
    expect(chats.ensure).toHaveBeenCalledTimes(2);
  });

  it("does not clear the new scope promise when the old scope fails", async () => {
    const pa = deferred<Issue>();
    const pb = deferred<Issue>();
    chats.ensure.mockImplementation((companyId) => companyId === a.companyId ? pa.promise : pb.promise);
    const ensureA = await render(a);
    const firstA = ensureA().catch((error: unknown) => error);
    const ensureB = await render(b);
    const firstB = ensureB();
    const rawError = new Error("Original creation failed 原文");
    await act(async () => { pa.reject(rawError); expect(await firstA).toBe(rawError); });
    const secondB = ensureB();
    expect(chats.ensure).toHaveBeenCalledTimes(2);
    await act(async () => { pb.resolve(issue(b)); await Promise.all([firstB, secondB]); });
    expect(client.getQueryData(queryKeys.agentChats.detail(a.companyId, "user-1", a.id))).toBeNull();
    expect(client.getQueryData(queryKeys.agentChats.detail(b.companyId, "user-1", b.id))).toEqual(issue(b));
  });

  it.each(["user", "session"] as const)("rejects stale %s identity before ensure dispatch and before caching a late response", async (change) => {
    const pending = deferred<Issue>();
    chats.ensure.mockReturnValue(pending.promise);
    const oldEnsure = await render(a);
    const first = oldEnsure().catch((error: unknown) => error);
    const nextSession = change === "user" ? session("user-2", "session-2") : session("user-1", "session-2");
    await act(async () => client.setQueryData(queryKeys.auth.session, nextSession));
    await expect(oldEnsure()).rejects.toBeInstanceOf(Error);
    expect(chats.ensure).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(issue(a)); expect(await first).toBeInstanceOf(Error); });
    expect(client.getQueryData(queryKeys.issues.detail(issue(a).id))).toBeUndefined();
    expect(client.getQueryData(queryKeys.agentChats.detail(a.companyId, "user-1", a.id))).toBeNull();
  });

  it.each(["company", "agent", "user"] as const)("rejects a mismatched %s receipt without polluting cache", async (field) => {
    const result = { ...issue(a), ...(field === "company" ? { companyId: b.companyId } : field === "agent" ? { conversationAgentId: b.id } : { conversationUserId: "user-2" }) };
    chats.ensure.mockResolvedValue(result);
    const ensure = await render(a);
    await expect(ensure()).rejects.toBeInstanceOf(Error);
    expect(client.getQueryData(queryKeys.issues.detail(result.id))).toBeUndefined();
    expect(client.getQueryData(queryKeys.agentChats.detail(a.companyId, "user-1", a.id))).toBeNull();
  });
});
