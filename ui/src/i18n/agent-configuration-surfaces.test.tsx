// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, AgentLifecycleState } from "@paperclipai/shared";
import { AgentLifecycleStatus, agentLifecycleRefetchInterval } from "../components/AgentLifecycleStatus";
import { PrimaryAgentIndicator, PrimaryAgentPresentationProvider, SetPrimaryAgentButton } from "../components/primary-agent/PrimaryAgentPresentation";
import { TooltipProvider } from "../components/ui/tooltip";
import { i18n } from "./index";
import { agentConfigurationMessages } from "./agent-configuration-test-resources";
import { validateLocaleMessages } from "./locale-validation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const previous = { id: "previous-id", name: "Previous 原文", companyId: "company-id", status: "active" } as Agent;
const agent = { id: "agent-id", name: "Agent <原文>", companyId: "company-id", status: "active" } as Agent;
const onChange = vi.fn();
const onRetry = vi.fn();
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en"); vi.clearAllMocks();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); await i18n.changeLanguage("en");
});
async function render(node: ReactNode) { await act(async () => root.render(<TooltipProvider>{node}</TooltipProvider>)); }

describe.each(Object.entries(agentConfigurationMessages))("agent configuration presentation (%s)", (locale, messages) => {
  it("validates all translated messages", () => {
    expect(validateLocaleMessages(messages, agentConfigurationMessages.en)).toEqual([]);
    if (locale !== "en") for (const key of Object.keys(messages) as (keyof typeof messages)[]) {
      expect(messages[key], key).not.toBe(agentConfigurationMessages.en[key]);
    }
  });
  it("localizes every pending lifecycle without changing diagnostics or retry identity", async () => {
    for (const [state, key] of [["preparing", "preparing"], ["verifying", "verifying"], ["pausing", "pausing"],
      ["resuming", "resuming"], ["terminating", "terminating"], ["cleaning_up", "cleaningUp"]] as const) {
      await render(<AgentLifecycleStatus agent={{ lifecycleState: state, lifecycleError: "Original provider failure /path/API_KEY" }} onRetry={onRetry} retryPending={false} refreshError />);
      const button = container.querySelector("button")!; button.focus();
      await act(async () => { await i18n.changeLanguage(locale); });
      expect(container.textContent).toContain(messages[key]); expect(container.textContent).toContain(messages[`${key}Help`]);
      expect(container.textContent).toContain(messages.lifecycleRefreshError);
      expect(container.textContent).toContain("Original provider failure /path/API_KEY");
      expect(container.querySelector("button")).toBe(button); expect(document.activeElement).toBe(button);
      expect(agentLifecycleRefetchInterval(state)).toBe(2000);
    }
    expect(onRetry).not.toHaveBeenCalled();
    await act(async () => container.querySelector("button")!.click()); expect(onRetry).toHaveBeenCalledOnce();
    await render(<AgentLifecycleStatus agent={{ lifecycleState: "preparing", lifecycleError: "Original failure" }} onRetry={onRetry} retryPending />);
    expect(container.textContent).toContain(messages.retrying); expect(container.querySelector("button")!.disabled).toBe(true);
    const future = "provider_future_state" as AgentLifecycleState;
    expect(renderToStaticMarkup(<AgentLifecycleStatus agent={{ lifecycleState: future, lifecycleError: null }} onRetry={onRetry} retryPending={false} />)).toBe("");
    expect(agentLifecycleRefetchInterval(future)).toBe(30000);
  });
  it("keeps the primary confirmation open across language changes and submits the original agent ID once", async () => {
    await render(<PrimaryAgentPresentationProvider value={{ companyId: "company-id", primaryAgentId: previous.id, primaryAgent: previous, onChange }}>
      <PrimaryAgentIndicator agentId={previous.id} /><SetPrimaryAgentButton agent={agent} />
    </PrimaryAgentPresentationProvider>);
    await act(async () => container.querySelector("button")!.click());
    const dialog = document.body.querySelector('[role="alertdialog"]')!;
    const confirm = [...dialog.querySelectorAll("button")].find(button => button.textContent === "Set as my primary")!;
    confirm.focus();
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(document.body.querySelector('[role="alertdialog"]')).toBe(dialog);
    expect(document.activeElement).toBe(confirm); expect(confirm.textContent).toBe(messages.setPrimary);
    expect(dialog.textContent).toContain(messages.changePrimaryTitle);
    expect(dialog.textContent).toContain(messages.changePrimaryDescription.replace("{{name}}", agent.name));
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(messages.myPrimary);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => confirm.click()); expect(onChange).toHaveBeenCalledExactlyOnceWith(agent.id);
  });
  it("localizes loading, pending and retry buttons without executing callbacks on language changes", async () => {
    for (const [state, expected] of [[{ loading: true }, messages.loadingPrimary], [{ pendingAgentId: agent.id }, messages.settingPrimary], [{ error: "Original backend error", onRetry }, messages.retryPrimary]] as const) {
      await render(<PrimaryAgentPresentationProvider value={{ companyId: "company-id", primaryAgentId: null, primaryAgent: null, onChange, ...state }}><SetPrimaryAgentButton agent={agent} /></PrimaryAgentPresentationProvider>);
      await act(async () => { await i18n.changeLanguage(locale); });
      expect(container.textContent).toContain(expected);
    }
    expect(onChange).not.toHaveBeenCalled(); expect(onRetry).not.toHaveBeenCalled();
    await act(async () => container.querySelector("button")!.click()); expect(onRetry).toHaveBeenCalledOnce();
  });
});
