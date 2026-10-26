// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";
import { i18n } from "./index";
import "./connection-access-test-resources";
import { RemoteMcpConnectionSetup } from "../features/connections/remote-mcp/RemoteMcpConnectionSetup";
import { remoteMcpProviders } from "../features/connections/remote-mcp/providers";
import type { RemoteMcpSetupActions, RemoteMcpSetupState } from "../features/connections/remote-mcp/types";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/pages/apps/AppLogo", () => ({ AppLogo: () => null }));
afterEach(async () => { await i18n.changeLanguage("en"); });
it.each(["en", "zh-CN", "es", "ja"])("retranslates the remote MCP access seam from %s without editing credentials or permissions", async locale => {
  await i18n.changeLanguage(locale);
  const state: RemoteMcpSetupState = { step: "connect", grantKind: "user", setupComplete: false, url: "https://customer.example/mcp", auth: "none", token: "fixture-token", headers: [], connectStatus: "idle", connected: false, identity: null, allAgents: false, agentIds: ["agent-id"], permissions: { "write-action": "ask_first", "read-action": "allowed", "unknown-action": "off" }, tools: [], notice: null, refreshing: false };
  const original = JSON.stringify(state);
  const actions: RemoteMcpSetupActions = { edit: vi.fn(), navigate: vi.fn(), connect: vi.fn(), cancelConnect: vi.fn(), openProvider: vi.fn(), saveExit: vi.fn(), resumeDraft: vi.fn(), finish: vi.fn(), refresh: vi.fn(), reconnect: vi.fn(), disconnect: vi.fn() };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<TooltipProvider><RemoteMcpConnectionSetup provider={remoteMcpProviders.zapier} state={state} actions={actions} agents={[{ id: "agent-id", name: "Customer Agent" }]} companyId="" connectionId="connection-id" /></TooltipProvider>));
    expect(container.textContent).toContain(i18n.t("connectionAccessUi.summaryPersonal"));
    expect(container.textContent).toContain(i18n.t("connectionAccessUi.summarySelected", { count: 1 }));
    const change = Array.from(container.querySelectorAll('button')).find(button => button.textContent === i18n.t("connectionAccessUi.change"))!;
    await act(async () => change.click());
    await act(async () => { await i18n.changeLanguage(locale === "ja" ? "zh-CN" : "ja"); });
    expect(container.textContent).toContain(i18n.t("connectionAccessUi.summaryPersonal"));
    expect(container.textContent).toContain(i18n.t("connectionAccessUi.summarySelected", { count: 1 }));
    expect(container.textContent).toContain(i18n.t("connectionAccessUi.identityHeading"));
    expect(change.textContent).toBe(i18n.t("connectionAccessUi.change"));
    expect(change.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector<HTMLInputElement>('input[id$="-url"]')?.value).toBe(state.url);
    expect(JSON.stringify(state)).toBe(original);
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); container.remove(); }
});
