// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { Agent, ToolProfileWithDetails } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";
import { StepAssign } from "../pages/tools/profiles/ProfileWizard";
import { PermissionsPanel } from "../pages/apps/app-detail/PermissionsPanel";
import { i18n, selectorHostMessages } from "./selector-host-test-resources";
import { validateLocaleMessages } from "./locale-validation";

vi.mock("@/lib/router", async () => import("react-router-dom"));
const date = new Date("2026-01-01T00:00:00Z");
function agent(id: string, name: string): Agent {
  return { id, name, companyId: "company-1", urlKey: id, role: "engineer", title: "原文 title 日本語", icon: null,
    status: "active", reportsTo: null, capabilities: null, adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {},
    budgetMonthlyCents: 0, spentMonthlyCents: 0, pauseReason: null, pausedAt: null, permissions: { canCreateAgents: false },
    lastHeartbeatAt: null, metadata: null, createdAt: date, updatedAt: date };
}
const agents = [agent("agent-raw-1", "原文 <Agent> 日本語"), agent("agent-raw-2", "Second Agent")];
function profile(isCompanyDefault = false): ToolProfileWithDetails {
  return { id: isCompanyDefault ? "default-profile" : "profile-raw-id", companyId: "company-1", profileKey: "profile_wire",
    name: isCompanyDefault ? "原文 default profile" : "Profile <原文> 日本語", description: null, status: "active", defaultAction: "deny",
    newToolsReviewedAt: null, metadata: null, createdAt: date, updatedAt: date, entries: [],
    bindings: isCompanyDefault ? [] : [{ id: "binding-raw-id", companyId: "company-1", profileId: "profile-raw-id",
      targetType: "agent", targetId: agents[0].id, priority: 0, metadata: null, createdByAgentId: null, createdByUserId: null,
      createdAt: date, updatedAt: date }],
    summary: { accessMode: "selected", allowedToolCount: 0, allowedApplicationCount: 0, excludedToolCount: 0, totalToolCount: 0,
      assignmentCount: isCompanyDefault ? 0 : 1, appliesToAgentCount: isCompanyDefault ? 2 : 1, isCompanyDefault } };
}
const toggleAgent = vi.fn<(id: string) => void>();
const companyDefault = vi.fn<(value: boolean) => void>();
const saveAccess = vi.fn<ComponentProps<typeof PermissionsPanel>["onSaveAccess"]>();
const otherAction = vi.fn();
const fetchMock = vi.fn<typeof fetch>();
let root: Root;
let container: HTMLDivElement;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(async () => {
  await i18n.changeLanguage("en"); vi.clearAllMocks();
  fetchMock.mockRejectedValue(new Error("Unexpected external request")); vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  await i18n.changeLanguage("en"); vi.unstubAllGlobals();
});
async function render(node: ReactNode) {
  await act(async () => root.render(<MemoryRouter><TooltipProvider>{node}</TooltipProvider></MemoryRouter>));
}
async function openSelector() {
  const trigger = container.querySelector<HTMLButtonElement>('button[data-slot="popover-trigger"]') ?? container.querySelector("button");
  expect(trigger).not.toBeNull(); await act(async () => trigger?.click());
  const popover = document.body.querySelector<HTMLElement>('[data-slot="popover-content"]');
  expect(popover).not.toBeNull(); return popover!;
}
async function filter(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function permissionsProps(selected = new Set<string>(), editableAgentIds = agents.map(agent => agent.id)): ComponentProps<typeof PermissionsPanel> {
  return { connectionId: "connection-raw-id", appName: "原文 App", agents, access: { mode: "specific", agentIds: selected },
    install: { onAll: false, agentIds: new Set([agents[0].id]) }, readOnly: [], canChange: [], quarantined: [],
    enabledIds: new Set(), askFirstIds: new Set(), pending: false, onSaveAccess: saveAccess, onSetActionPermission: otherAction,
    onReviewQuarantined: otherAction, onRefreshActions: otherAction, refreshPending: false, actions: null,
    capabilities: { canConfigure: true, canCreateOrganizationGrant: true, canSetCompanyInstall: true, canConnectAsCurrentUser: true,
      canManageAgentInstalls: true, canViewOtherPersonalIdentities: true, editableAgentIds } };
}

describe.each(Object.entries(selectorHostMessages))("selector host overrides (%s)", (locale, messages) => {
  it("provides complete four-language messages and count/adapter placeholders", async () => {
    expect(validateLocaleMessages(messages, selectorHostMessages.en)).toEqual([]);
    await i18n.changeLanguage(locale);
    for (const count of [0, 1, 2]) expect(i18n.t("selectorHostUi.selectedAgents", { count }))
      .toBe((count === 1 ? messages.selectedAgents_one : messages.selectedAgents_other).replace("{{count}}", String(count)));
    for (const key of ["requiredAdapter", "unsupportedAdapter", "requiredUnsupportedAdapter"] as const) {
      expect(i18n.t(`selectorHostUi.${key}`, { adapter: "raw_adapter.v2" })).toBe(messages[key].replace("{{adapter}}", "raw_adapter.v2"));
    }
  });
  it("updates the actual profile assignment descriptions while keeping filter, focus, names and selected IDs", async () => {
    const profiles = [profile(), profile(true)]; const selected = new Set([agents[0].id]);
    const original = JSON.stringify({ profiles, agents });
    await render(<StepAssign agents={agents} profiles={profiles} selectedAgentIds={selected} onToggleAgent={toggleAgent}
      companyDefault={false} onCompanyDefault={companyDefault} />);
    const popover = await openSelector();
    const input = popover.querySelector<HTMLInputElement>("input")!;
    await filter(input, "原文"); input.focus(); input.setSelectionRange(0, 1);
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(document.body.querySelector('[data-slot="popover-content"]')).toBe(popover);
    expect(popover.querySelector("input")).toBe(input); expect(input.value).toBe("原文");
    expect(document.activeElement).toBe(input); expect([input.selectionStart, input.selectionEnd]).toEqual([0, 1]);
    expect(popover.textContent).toContain(messages.alreadyHasProfiles.replace("{{profiles}}", `${profiles[0].name} · ${messages.organizationDefault}`));
    expect(popover.textContent).toContain(agents[0].name);
    expect(popover.querySelector('[role="checkbox"]')?.getAttribute("data-state")).toBe("checked");
    expect(toggleAgent).not.toHaveBeenCalled(); expect(companyDefault).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    await filter(input, "Second Agent");
    await act(async () => popover.querySelector<HTMLButtonElement>('[role="checkbox"]')?.click());
    expect(toggleAgent).toHaveBeenCalledExactlyOnceWith(agents[1].id);
    expect([...selected]).toEqual([agents[0].id]); expect(JSON.stringify({ profiles, agents })).toBe(original);
  });
  it("translates the actual profile empty-context description without adding bindings", async () => {
    await render(<StepAssign agents={agents} profiles={[]} selectedAgentIds={new Set()} onToggleAgent={toggleAgent}
      companyDefault={false} onCompanyDefault={companyDefault} />);
    const popover = await openSelector();
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(popover.textContent).toContain(messages.noProfiles);
    expect(toggleAgent).not.toHaveBeenCalled(); expect(companyDefault).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("updates actual connection permissions, preserving required/disabled agents and raw selection payloads", async () => {
    const selected = new Set([agents[0].id]); const props = permissionsProps(selected);
    await render(<PermissionsPanel {...props} />);
    const popover = await openSelector();
    const input = popover.querySelector<HTMLInputElement>("input")!;
    await filter(input, "原文");
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(document.body.querySelector('[data-slot="popover-content"]')).toBe(popover);
    expect(input.value).toBe("原文");
    expect(container.textContent).toContain(messages.selectedAgents_one.replace("{{count}}", "1"));
    expect(popover.textContent).toContain(messages.requiredByInstall);
    expect(popover.querySelector<HTMLButtonElement>('[role="checkbox"]')?.disabled).toBe(true);
    expect(saveAccess).not.toHaveBeenCalled(); expect(otherAction).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    await filter(input, "Second Agent");
    expect(popover.textContent).toContain(agents[1].title);
    await act(async () => popover.querySelector<HTMLButtonElement>('[role="checkbox"]')?.click());
    expect(saveAccess).toHaveBeenCalledOnce();
    expect(saveAccess.mock.lastCall?.[0].mode).toBe("specific");
    expect([...(saveAccess.mock.lastCall?.[0].agentIds ?? [])]).toEqual(agents.map(agent => agent.id));
    expect([...selected]).toEqual([agents[0].id]);
  });
  it("keeps actual connection edit-access filtering while translating the empty prompt", async () => {
    await render(<PermissionsPanel {...permissionsProps(new Set(), [])} />);
    const popover = await openSelector();
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(container.textContent).toContain(messages.chooseAgents);
    expect(popover.textContent).toContain(messages.cannotEditAgents);
    expect(popover.querySelector('[role="checkbox"]')).toBeNull();
    expect(saveAccess).not.toHaveBeenCalled(); expect(otherAction).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
});
