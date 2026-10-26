// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { i18n } from "./index";
import { remoteMcpFormMessages } from "./remote-mcp-form-test-resources";
import { validateLocaleMessages } from "./locale-validation";
import { TooltipProvider } from "../components/ui/tooltip";
import { RemoteMcpConnectionSetup } from "../features/connections/remote-mcp/RemoteMcpConnectionSetup";
import { remoteMcpProviderDisplay, remoteMcpProviders } from "../features/connections/remote-mcp/providers";
import type { RemoteMcpSetupActions, RemoteMcpSetupState } from "../features/connections/remote-mcp/types";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/pages/apps/AppLogo", () => ({ AppLogo: () => null }));
afterEach(async () => { await i18n.changeLanguage("en"); });
const initial: RemoteMcpSetupState = { step: "connect", grantKind: "user", setupComplete: false, url: "https://customer.example/mcp?token=fixture", managementUrl: "https://executor.sh/customer/integrations", auth: "bearer", token: "secret-fixture", headers: [{ id: "header-id", name: "X-Customer", value: "raw-secret" }], connectStatus: "idle", connected: false, identity: null, allAgents: false, agentIds: ["agent-id"], permissions: {}, tools: [], notice: null, refreshing: false };
function actions(): RemoteMcpSetupActions { return { edit: vi.fn(), navigate: vi.fn(), connect: vi.fn(), cancelConnect: vi.fn(), openProvider: vi.fn(), saveExit: vi.fn(), resumeDraft: vi.fn(), finish: vi.fn(), refresh: vi.fn(), reconnect: vi.fn(), disconnect: vi.fn() }; }
it.each(Object.entries(remoteMcpFormMessages))("validates remote MCP form resources in %s", (locale, messages) => {
  expect(validateLocaleMessages(messages, remoteMcpFormMessages.en)).toEqual([]);
  for (const [key, value] of Object.entries(messages)) { expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i); if (locale !== "en") expect(value).not.toBe(remoteMcpFormMessages.en[key as keyof typeof messages]); }
});
it.each(["en", "zh-CN", "es", "ja"])("renders the four provider forms and help in %s without translating values", async locale => {
  await i18n.changeLanguage(locale);
  const original = JSON.stringify(remoteMcpProviders);
  for (const provider of Object.values(remoteMcpProviders)) {
    const host = document.createElement("div"), a = actions();
    host.innerHTML = renderToStaticMarkup(<TooltipProvider><RemoteMcpConnectionSetup provider={provider} state={initial} actions={a} agents={[]} companyId="" connectionId="draft-id" /></TooltipProvider>);
    const copy = remoteMcpProviderDisplay(provider, i18n.t);
    for (const instruction of copy.instructions) expect(host.textContent).toContain(instruction);
    expect(host.textContent).toContain(copy.urlHelp); expect(host.textContent).toContain(copy.authHelp);
    expect(host.querySelector('input[id$="-url"]')?.getAttribute('placeholder')).toBe(copy.placeholder);
    expect(host.querySelector('input[id$="-url"]')?.getAttribute('value')).toBe(initial.url);
    expect(host.querySelector('input[id$="-token"]')?.getAttribute('type')).toBe("password");
    expect(host.querySelector('input[id$="-token"]')?.getAttribute('value')).toBe(initial.token);
    expect(host.querySelector('input[id$="-name"]')?.getAttribute('placeholder')).toBe(provider.id === "arcade" ? "Arcade-User-ID" : i18n.t("remoteMcpFormUi.headerPlaceholder"));
    expect(Array.from(host.querySelectorAll('select[id$="-auth"] option'), option => option.getAttribute('value'))).toEqual(provider.supportsBrowserAuth ? ["auto", "bearer", "headers", "none"] : ["bearer", "headers", "none"]);
    expect(host.textContent).toContain(i18n.t("remoteMcpFormUi.noAdditionalAuth"));
    expect(host.querySelector(`button[aria-label="${i18n.t("remoteMcpFormUi.removeHeader", { index: 1 })}"]`)).not.toBeNull();
    expect(host.textContent).toContain(i18n.t("remoteMcpFormUi.saveExit"));
    host.innerHTML = renderToStaticMarkup(<TooltipProvider><RemoteMcpConnectionSetup provider={provider} state={{ ...initial, setupComplete: true }} actions={a} agents={[]} companyId="" connectionId="saved-id" /></TooltipProvider>);
    expect(host.querySelector('h1')?.textContent).toBe(i18n.t("remoteMcpFormUi.reconnect", { provider: provider.name }));
    expect(host.textContent).toContain(i18n.t("remoteMcpFormUi.manageConnection", { provider: provider.name }));
    for (const callback of Object.values(a)) expect(callback).not.toHaveBeenCalled();
  }
  expect(JSON.stringify(remoteMcpProviders)).toBe(original);
});
it("keeps custom presentation text without explicit metadata raw", () => {
  const provider = { ...remoteMcpProviders.arcade, messageKeys: undefined, instructions: ["Custom instruction"], urlHelp: "Customer help", authHelp: "Raw auth guide", placeholder: "Customer endpoint" };
  expect(remoteMcpProviderDisplay(provider, i18n.t)).toEqual({ instructions: provider.instructions, urlHelp: provider.urlHelp, authHelp: provider.authHelp, placeholder: provider.placeholder });
});
it("changes mounted form language without editing secrets, auth, headers or callbacks", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const a = actions();
  let current = initial;
  function Harness() { const [state, setState] = useState(initial); current = state; return <TooltipProvider><RemoteMcpConnectionSetup provider={remoteMcpProviders.executor} state={state} actions={{ ...a, edit: patch => { a.edit(patch); setState(s => ({ ...s, ...patch })); } }} agents={[]} companyId="" connectionId="draft-id" /></TooltipProvider>; }
  try {
    await act(async () => root.render(<Harness />)); const saved = JSON.stringify(current);
    for (const locale of ["ja", "zh-CN", "es", "en"]) {
      await act(async () => { await i18n.changeLanguage(locale); });
      expect(host.textContent).toContain(i18n.t("remoteMcpFormUi.authentication"));
      expect(host.querySelector<HTMLInputElement>('input[id$="-token"]')?.value).toBe(initial.token);
      expect(host.querySelector<HTMLInputElement>('input[id$="-value"]')?.value).toBe(initial.headers[0]!.value);
      expect(host.querySelector('button[aria-expanded="true"]')).not.toBeNull();
      expect(JSON.stringify(current)).toBe(saved); for (const callback of Object.values(a)) expect(callback).not.toHaveBeenCalled();
    }
    await act(async () => { const select = host.querySelector<HTMLSelectElement>('select[id$="-auth"]')!; select.value = "headers"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(a.edit).toHaveBeenCalledExactlyOnceWith({ auth: "headers" });
    await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("remoteMcpFormUi.removeHeader", { index: 1 })}"]`)!.click());
    expect(a.edit).toHaveBeenLastCalledWith({ headers: [] });
    expect(current.token).toBe(initial.token); expect(current.url).toBe(initial.url);
    await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === i18n.t("remoteMcpFormUi.saveExit"))!.click());
    expect(a.saveExit).toHaveBeenCalledOnce(); expect(a.connect).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
