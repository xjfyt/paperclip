// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY, MCP_CONFIG_HELP_PROMPT, mcpInvitation, type IssueDocument } from "@paperclipai/shared";
import { i18n } from "@/i18n";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import en from "@/i18n/contributions/agentSetupHandoffUi/en.json";
import zh from "@/i18n/contributions/agentSetupHandoffUi/zh-CN.json";
import es from "@/i18n/contributions/agentSetupHandoffUi/es.json";
import ja from "@/i18n/contributions/agentSetupHandoffUi/ja.json";
import { AssistantConnection } from "@/pages/apps/AssistantConnection";
import { DotRunnerConnection } from "./DotRunnerConnection";
import { IssueContinuationHandoff } from "./IssueContinuationHandoff";
import { ExternalAgentInviteContent } from "./new-agent/ExternalAgentInviteContent";
import { PasteConfigTab } from "@/pages/tools/PasteConfigTab";
import { Dialog, DialogContent } from "./ui/dialog";
import { buildDotSetupPrompt } from "@/lib/dot-setup-prompt";

const mocks = vi.hoisted(() => ({
  copy: vi.fn(), setup: vi.fn(), connections: vi.fn(), revoke: vi.fn(), breadcrumbs: vi.fn(), navigate: vi.fn(), onCopied: vi.fn(), onBinding: vi.fn(),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  tools: { importMcpJson: vi.fn(), connectApp: vi.fn(), finishApp: vi.fn() },
}));
vi.mock("@/lib/clipboard", () => ({ copyTextToClipboard: mocks.copy }));
vi.mock("@/hooks/usePrefersReducedMotion", () => ({ usePrefersReducedMotion: () => true }));
vi.mock("@/components/CompanyPatternIcon", () => ({ CompanyPatternIcon: () => <span aria-hidden="true" /> }));
vi.mock("@/api/publicMcp", () => ({ publicMcpApi: mocks }));
vi.mock("@/api/client", async (importOriginal) => ({ ...await importOriginal<typeof import("@/api/client")>(), api: mocks.api }));
vi.mock("@/api/tools", () => ({ toolsApi: mocks.tools }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company", selectedCompany: { id: "company", name: "R&D 原文", logoUrl: null } }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: mocks.breadcrumbs }) }));
vi.mock("@/lib/router", () => ({ useNavigate: () => mocks.navigate, Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => <a href={to} {...props}>{children}</a> }));
vi.mock("./MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <div>{children}</div> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Test-only registration: the integration owner composes runtime locales.
const messages = { en, "zh-CN": zh, es, ja };
for (const [locale, agentSetupHandoffUi] of Object.entries(messages)) {
  i18n.addResourceBundle(locale, "translation", { agentSetupHandoffUi }, true, true);
}
const noop = () => {};
const invitationBody = "# Agent-owned instructions\n\nKeep 原文, /goal set, https://example.test/setup?token=sample and JSON {\"id\":\"wire-key\"}.";
const handoff: IssueDocument = {
  id: "document", companyId: "company", issueId: "issue", key: ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY,
  title: "User handoff 原文", format: "markdown", body: invitationBody, latestRevisionId: "revision", latestRevisionNumber: 1,
  createdByAgentId: "agent", createdByUserId: null, updatedByAgentId: "agent", updatedByUserId: null,
  lockedAt: null, lockedByAgentId: null, lockedByUserId: null,
  createdAt: new Date("2026-04-19T12:00:00Z"), updatedAt: new Date("2026-04-19T12:05:00Z"),
};
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let expiresAt: string;
const resourceUrl = "https://paperclip.example/mcp/runner";
const serverUrl = "https://paperclip.example/mcp/paperclip";
const draftConfig = '{"mcpServers":{"原文":{"url":"https://example.test/mcp"}}}';
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function click(button: HTMLButtonElement | null | undefined) {
  expect(button).toBeTruthy();
  await act(async () => button!.click());
  await flush();
}
function buttonByText(text: string) { return Array.from(document.querySelectorAll("button")).find(button => button.textContent === text); }
async function render(element: ReactNode) {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter>{element}</MemoryRouter></QueryClientProvider>));
  await flush();
}
function external(preset: "dot" | "hermes" | "other") {
  return <Dialog open><DialogContent><ExternalAgentInviteContent preset={preset} prompt={invitationBody} companyName="R&D 原文"
    connection={{ phase: "waiting" }} onSelect={noop} onBack={noop} onClose={noop} onCopied={mocks.onCopied} onRetry={noop} onNewPrompt={noop} />
  </DialogContent></Dialog>;
}
type CopyKeys = [keyof typeof en, keyof typeof en, keyof typeof en];
const hosts: Array<{ name: string; keys: CopyKeys; mount: () => Promise<void>; prompt: () => string }> = [
  { name: "AssistantConnection", keys: ["assistantLabel", "assistantTitle", "assistantDescription"],
    mount: () => render(<AssistantConnection />), prompt: () => mcpInvitation(serverUrl, { id: "company", name: "R&D 原文" }) },
  { name: "DotRunnerConnection pairing", keys: ["dotLabel", "dotTitle", "dotDescription"],
    mount: async () => { await render(<DotRunnerConnection companyId="company" agentId="agent" onBinding={mocks.onBinding} />); await click(buttonByText("Pair Dot")); },
    prompt: () => buildDotSetupPrompt({ companyId: "company", agentId: "agent", resourceUrl, pairingCode: "one-use-code", expiresAt }) },
  { name: "IssueContinuationHandoff", keys: ["continuationLabel", "continuationTitle", "continuationDescription"],
    mount: () => render(<IssueContinuationHandoff document={handoff} />), prompt: () => handoff.body },
  ...(["dot", "hermes", "other"] as const).map(preset => ({
    name: `ExternalAgentInviteContent ${preset}`,
    keys: (preset === "dot" ? ["externalDotLabel", "dotTitle", "externalDotDescription"] : ["externalAgentLabel", "externalAgentTitle", "externalAgentDescription"]) as CopyKeys,
    mount: () => render(external(preset)), prompt: () => invitationBody,
  })),
  { name: "PasteConfigTab → McpConfigHelpDialog", keys: ["mcpLabel", "mcpTitle", "mcpDescription"],
    mount: async () => {
      await render(<PasteConfigTab companyId="company" />);
      const textarea = container.querySelector("textarea")!;
      await act(async () => {
        textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "原" }));
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, draftConfig);
        textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: "原文", isComposing: true }));
      });
      await click(document.querySelector<HTMLButtonElement>('[aria-label="Get help creating an MCP config"]'));
    }, prompt: () => MCP_CONFIG_HELP_PROMPT },
];
beforeEach(async () => {
  await i18n.changeLanguage("en");
  mocks.copy.mockResolvedValue(undefined);
  mocks.setup.mockResolvedValue({ enabled: true, serverUrl });
  mocks.connections.mockResolvedValue([]);
  mocks.api.get.mockResolvedValue({ enabled: true, resourceUrl, binding: null });
  expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  mocks.api.post.mockImplementation(async () => {
    mocks.api.get.mockResolvedValue({ enabled: true, resourceUrl, binding: { id: "binding", status: "pairing", connected: false, subscriptionVerified: false, hasPendingChallenge: false } });
    return { bindingId: "binding", pairingCode: "one-use-code", expiresAt };
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear(); container.remove();
  await i18n.changeLanguage("en");
  vi.resetAllMocks();
});

it.each(Object.entries(messages))("validates handoff chrome keys and safe text in %s", (locale, translated) => {
  expect(validateLocaleMessages(translated, en)).toEqual([]);
  if (locale !== "en") for (const key of Object.keys(en) as Array<keyof typeof en>) expect(translated[key]).not.toBe(en[key]);
});

describe.each(hosts)("$name real prompt handoff", (host) => {
  it.each([false, true])("updates four-language chrome in place; clipboard failure=%s preserves the whole prompt", async (failed) => {
    if (failed) mocks.copy.mockRejectedValueOnce(new Error("test-only clipboard failure"));
    await host.mount();
    const trigger = document.querySelector<HTMLButtonElement>(".agent-setup-trigger")!;
    expect(trigger.getAttribute("aria-label")).toBe(en[host.keys[0]]);
    await click(trigger);
    const expectedPrompt = host.prompt();
    expect(mocks.copy).toHaveBeenCalledExactlyOnceWith(expectedPrompt);
    const preview = document.querySelector<HTMLElement>(".agent-setup-preview")!;
    for (const locale of ["en", "zh-CN", "es", "ja", "en"] as const) {
      await act(async () => { await i18n.changeLanguage(locale); });
      expect(document.querySelector(".agent-setup-trigger")).toBe(trigger);
      expect(trigger.getAttribute("aria-label")).toBe(messages[locale][host.keys[0]]);
      const popover = document.querySelector(".agent-setup-popover")!;
      expect(popover.querySelector("h2")?.textContent).toBe(messages[locale][host.keys[1]]);
      expect(popover.querySelector("h2 + p")?.textContent).toBe(messages[locale][host.keys[2]]);
      expect(document.querySelector(".agent-setup-preview")).toBe(preview);
      expect(preview instanceof HTMLTextAreaElement ? preview.value : preview.textContent).toBe(expectedPrompt);
      if (failed) {
        expect(popover.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("agentSetupPromptUi.failed"));
        expect(popover.querySelector(".agent-setup-copy")?.textContent).toBe(i18n.t("agentSetupPromptUi.retry"));
      }
      expect(mocks.copy).toHaveBeenCalledTimes(1);
    }
    if (failed) {
      await click(document.querySelector<HTMLButtonElement>(".agent-setup-copy"));
      expect(mocks.copy).toHaveBeenNthCalledWith(2, expectedPrompt);
      expect(document.querySelector(".agent-setup-popover [role=alert]")).toBeNull();
      expect(document.querySelector("pre.agent-setup-preview")?.textContent).toBe(expectedPrompt);
    }
    if (host.name.startsWith("External")) expect(mocks.onCopied).toHaveBeenCalledTimes(1);
    if (host.name.startsWith("DotRunner")) {
      expect(mocks.api.post).toHaveBeenCalledTimes(1);
      expect(mocks.api.post).toHaveBeenCalledWith("/companies/company/agents/agent/dot-binding", {});
    } else expect(mocks.api.post).not.toHaveBeenCalled();
    expect(mocks.api.delete).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.tools.importMcpJson).not.toHaveBeenCalled();
    expect(mocks.tools.connectApp).not.toHaveBeenCalled();
    expect(mocks.tools.finishApp).not.toHaveBeenCalled();
    if (host.name.startsWith("PasteConfig")) {
      const draft = container.querySelector("textarea")!;
      expect(draft.value).toBe(draftConfig);
      await act(async () => { draft.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "原文" })); });
      expect(draft.value).toBe(draftConfig);
      expect(mocks.tools.importMcpJson).not.toHaveBeenCalled();
    }
  });
});
