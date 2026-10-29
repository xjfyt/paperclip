// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentChannelsPanel } from "./AgentChannelsPanel";
import { i18n } from "@/i18n";
import { agentChannelsMessages } from "@/i18n/agent-channels-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import { queryKeys } from "@/lib/queryKeys";

const { list, flags } = vi.hoisted(() => ({ list: vi.fn(), flags: { enabled: true, githubEnabled: true } }));
vi.mock("@/api/chatEndpoints", () => ({ chatEndpointsApi: { list } }));
vi.mock("@/lib/router", async () => import("react-router-dom"));
vi.mock("@/hooks/useChatConnectorsEnabled", () => ({ useChatConnectorsEnabled: () => flags, chatProviderVisible: () => true }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const endpoint = { id: "endpoint-wire-id", provider: "agentmail", assignedAgentId: "agent /原文", status: "provider_future_state", botLabel: "Customer <原文> identity" };
beforeEach(async () => {
  await i18n.changeLanguage("en"); vi.clearAllMocks(); flags.enabled = true; flags.githubEnabled = true;
  list.mockResolvedValue([]); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); await i18n.changeLanguage("en"); });
async function flush() { await act(async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function render(companyId = "company-wire-id", agentId = "agent /原文") {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><AgentChannelsPanel companyId={companyId} agentId={agentId} /></MemoryRouter></QueryClientProvider>));
  await flush();
}

describe.each(Object.entries(agentChannelsMessages))("agent channel presentation (%s)", (locale, messages) => {
  it("validates translated messages", () => {
    expect(validateLocaleMessages(messages, agentChannelsMessages.en)).toEqual([]);
    if (locale !== "en") for (const key of Object.keys(messages) as (keyof typeof messages)[]) expect(messages[key]).not.toBe(agentChannelsMessages.en[key]);
  });
  it("keeps original channel identity, status, links and request scope across live language changes", async () => {
    list.mockResolvedValue([endpoint, { ...endpoint, id: "other-agent", assignedAgentId: "other-agent" }, { ...endpoint, id: "archived", status: "archived" }]);
    await render();
    const link = container.querySelector<HTMLAnchorElement>(`a[href="/apps/chat/${endpoint.id}/settings"]`)!; link.focus();
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(container.textContent).toContain(messages.title); expect(container.textContent).toContain(messages.openConnection);
    expect(container.textContent).toContain(endpoint.botLabel); expect(container.textContent).toContain("AgentMail"); expect(container.textContent).toContain(endpoint.status);
    expect(container.querySelector(`a[href="/apps/chat/${endpoint.id}/settings"]`)).toBe(link); expect(document.activeElement).toBe(link);
    expect(container.querySelector('a[href="/apps?chatAgentId=agent%20%2F%E5%8E%9F%E6%96%87"]')).not.toBeNull();
    expect(container.querySelectorAll('a[href^="/apps/chat/"]')).toHaveLength(1);
    expect(list).toHaveBeenCalledExactlyOnceWith("company-wire-id");
  });
  it("keeps late reads company-scoped and filters a newer agent without borrowing the previous identity", async () => {
    let resolveOld!: (value: unknown[]) => void;
    list.mockImplementationOnce(() => new Promise(done => { resolveOld = done; }));
    list.mockResolvedValueOnce([{ ...endpoint, id: "new-company-endpoint" }, { ...endpoint, id: "new-agent-endpoint", assignedAgentId: "new-agent" }]);
    await render();
    await render("new-company-id");
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(container.querySelector('a[href="/apps/chat/new-company-endpoint/settings"]')).not.toBeNull();
    await act(async () => resolveOld([{ ...endpoint, id: "old-company-late-endpoint" }])); await flush();
    expect(container.querySelector('a[href="/apps/chat/old-company-late-endpoint/settings"]')).toBeNull();
    await render("new-company-id", "new-agent");
    expect(container.querySelector('a[href="/apps/chat/new-company-endpoint/settings"]')).toBeNull();
    expect(container.querySelector('a[href="/apps/chat/new-agent-endpoint/settings"]')).not.toBeNull();
    expect(list.mock.calls).toEqual([["company-wire-id"], ["new-company-id"]]);
  });
  it("localizes known channel states while retaining unknown provider names", async () => {
    list.mockResolvedValue(["draft", "verifying", "active", "paused", "attention", "revoked"].map(status => ({ ...endpoint, id: status, provider: "provider_future_id", status })));
    await render(); await act(async () => { await i18n.changeLanguage(locale); });
    for (const key of ["verifying", "attention", "revoked"] as const) expect(container.textContent).toContain(messages[key]);
    for (const status of ["draft", "active", "paused"]) expect(container.textContent).toContain(i18n.t(`statuses.${status}`));
    expect(container.textContent).toContain("provider_future_id"); expect(list).toHaveBeenCalledOnce();
  });
  it("translates loading and empty states without restarting the request", async () => {
    let resolve!: (value: unknown[]) => void; list.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    flags.enabled = false; flags.githubEnabled = false; await render();
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(container.textContent).toContain(messages.loading); expect(list).toHaveBeenCalledOnce();
    await act(async () => resolve([])); await flush();
    expect(container.textContent).toContain(messages.empty); expect(container.textContent).toContain(messages.connectAgentMail);
    expect(container.textContent).toContain(messages.openConnectors); expect(list).toHaveBeenCalledOnce();
  });
  it("shows the original read failure instead of a misleading empty state and retries only on click", async () => {
    list.mockRejectedValueOnce(new Error("Provider original failure /raw-path")); await render();
    const retry = container.querySelector("button")!; retry.focus();
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(messages.loadFailed);
    expect(container.textContent).toContain("Provider original failure /raw-path"); expect(container.textContent).not.toContain(messages.empty);
    expect(document.activeElement).toBe(retry); expect(retry.textContent).toBe(i18n.t("common.retry")); expect(list).toHaveBeenCalledOnce();
    await act(async () => retry.click()); await flush();
    expect(list.mock.calls).toEqual([["company-wire-id"], ["company-wire-id"]]);
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.textContent).toContain(messages.empty);
  });
  it("keeps stale connections visible when a refresh fails", async () => {
    list.mockResolvedValueOnce([{ ...endpoint, botLabel: null, providerAccountLabel: null }]); await render();
    list.mockRejectedValueOnce(new Error("Refresh failure"));
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.chatEndpoints.list("company-wire-id") }); }); await flush();
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(container.textContent).toContain(messages.loadFailed); expect(container.textContent).toContain("Refresh failure");
    expect(container.textContent).toContain(messages.providerIdentity); expect(container.querySelector(`a[href="/apps/chat/${endpoint.id}/settings"]`)).not.toBeNull();
    expect(list).toHaveBeenCalledTimes(2);
  });
});
