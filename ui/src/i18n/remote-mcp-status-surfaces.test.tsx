// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { i18n } from "./index";
import { remoteMcpStatusMessages } from "./remote-mcp-status-test-resources";
import { validateLocaleMessages } from "./locale-validation";
import { TooltipProvider } from "../components/ui/tooltip";
import { RemoteMcpConnectionSetup } from "../features/connections/remote-mcp/RemoteMcpConnectionSetup";
import { RemoteMcpAccountChoice } from "../features/connections/remote-mcp/RemoteMcpAccountChoice";
import { remoteMcpProviders } from "../features/connections/remote-mcp/providers";
import type { RemoteMcpSetupActions, RemoteMcpSetupState } from "../features/connections/remote-mcp/types";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/pages/apps/AppLogo", () => ({ AppLogo: () => null }));
afterEach(async () => { await i18n.changeLanguage("en"); });
const initial: RemoteMcpSetupState = { step: "connect", grantKind: "user", setupComplete: false, url: "https://customer.example/mcp?token=fixture", auth: "none", token: "fixture", headers: [{ id: "header-id", name: "X-Customer", value: "raw-secret" }], connectStatus: "idle", connected: false, identity: null, allAgents: false, agentIds: ["agent-id"], permissions: {}, tools: [], notice: null, refreshing: false };
function actions(): RemoteMcpSetupActions { return { edit: vi.fn(), navigate: vi.fn(), connect: vi.fn(), cancelConnect: vi.fn(), openProvider: vi.fn(), saveExit: vi.fn(), resumeDraft: vi.fn(), finish: vi.fn(), refresh: vi.fn(), reconnect: vi.fn(), disconnect: vi.fn() }; }
it.each(Object.entries(remoteMcpStatusMessages))("validates remote MCP status resources in %s", (locale, messages) => {
  expect(validateLocaleMessages(messages, remoteMcpStatusMessages.en)).toEqual([]);
  for (const [key, value] of Object.entries(messages)) { expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i); if (locale !== "en") expect(value).not.toBe(remoteMcpStatusMessages.en[key as keyof typeof messages]); }
  expect(messages.openAgainHelp.match(/<0\/>/g)).toHaveLength(1);
});
it.each(["en", "zh-CN", "es", "ja"])("renders controlled error and waiting states in %s without changing credentials or actions", async locale => {
  await i18n.changeLanguage(locale);
  const a = actions(); const snapshot = JSON.stringify(initial);
  // Presentation fixtures include rejected/unreachable; they do not prove a production request emits those states.
  for (const [status, key] of [["invalid_url", "remoteMcpStatusUi.invalidUrlTitle"], ["oauth_failed", "connectionOAuthUi.callbackIncomplete"], ["rejected", "remoteMcpStatusUi.credentialsRejected"], ["unreachable", "remoteMcpStatusUi.unreachable"], ["cancelled", "remoteMcpStatusUi.cancelled"], ["sign_in", "remoteMcpStatusUi.waitingHelp"]] as const) {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<TooltipProvider><RemoteMcpConnectionSetup provider={remoteMcpProviders.arcade} state={{ ...initial, connectStatus: status, notice: { key: "remoteMcpStatusUi.savedCredentials" } }} actions={a} agents={[]} companyId="" connectionId="connection-id" authorizationUrl="https://auth.example/authorize?state=raw" /></TooltipProvider>);
    expect(host.textContent).toContain(i18n.t(key));
    expect(host.textContent).toContain(i18n.t("remoteMcpStatusUi.savedCredentials"));
    if (status === "sign_in") { expect(host.querySelector('a')?.getAttribute('href')).toBe("https://auth.example/authorize?state=raw"); expect(host.querySelector('a')?.textContent).toBe(i18n.t("remoteMcpStatusUi.openAgain")); }
  }
  expect(JSON.stringify(initial)).toBe(snapshot); for (const callback of Object.values(a)) expect(callback).not.toHaveBeenCalled();
});
it.each(["en", "zh-CN", "es", "ja"])("retranslates account reuse and notice descriptors from %s without selecting or changing names", async locale => {
  await i18n.changeLanguage(locale);
  const onSelect = vi.fn(), onConnectNew = vi.fn(), onCancel = vi.fn();
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const name = "Customer <strong>私のアカウント</strong>";
  try {
    await act(async () => root.render(<RemoteMcpAccountChoice providerName="Composio" upstreamServiceName="Customer API" connections={[{ id: "saved-id", name }]} error={{ key: "remoteMcpStatusUi.reuseFailed" }} onSelect={onSelect} onConnectNew={onConnectNew} onCancel={onCancel} />));
    await act(async () => { await i18n.changeLanguage(locale === "ja" ? "zh-CN" : "ja"); });
    expect(host.textContent).toContain(i18n.t("remoteMcpStatusUi.reuseFailed"));
    expect(host.textContent).toContain(i18n.t("remoteMcpStatusUi.externalAccountHelp", { provider: "Composio", app: "Customer API" }));
    expect(host.textContent).toContain(name); expect(host.querySelector('strong')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled(); expect(onConnectNew).not.toHaveBeenCalled(); expect(onCancel).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label]')!.click());
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("saved-id");
    const a = actions(); const raw = "Provider raw diagnostic <read/write>";
    await act(async () => root.render(<TooltipProvider><RemoteMcpConnectionSetup provider={remoteMcpProviders.arcade} state={{ ...initial, notice: raw }} actions={a} agents={[]} companyId="" connectionId="saved-id" /></TooltipProvider>));
    await act(async () => { await i18n.changeLanguage("es"); });
    expect(host.textContent).toContain(raw); for (const callback of Object.values(a)) expect(callback).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
