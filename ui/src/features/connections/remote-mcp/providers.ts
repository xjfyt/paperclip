import type { TFunction } from "i18next";

/** Presentation metadata only. Each provider will have its own catalog entry and connection. */
export type RemoteMcpProviderId = "zapier" | "arcade" | "composio" | "executor";

export interface RemoteMcpProvider {
  id: RemoteMcpProviderId;
  name: string;
  description: string;
  instructions: string[];
  setupUrl: string;
  dashboardUrl: string;
  defaultUrl: string;
  placeholder: string;
  urlHelp: string;
  authHelp: string;
  supportsBrowserAuth: boolean;
  /** UI copy only; identity, URLs and payload defaults stay in their original fields. */
  messageKeys?: { instructions: string[]; urlHelp: string; authHelp: string; placeholder?: string };
}

export const remoteMcpProviders: Record<RemoteMcpProviderId, RemoteMcpProvider> = {
  zapier: {
    messageKeys: { instructions: ["remoteMcpFormUi.zapierInstruction1", "remoteMcpFormUi.zapierInstruction2", "remoteMcpFormUi.zapierInstruction3"], urlHelp: "remoteMcpFormUi.zapierUrlHelp", authHelp: "remoteMcpFormUi.zapierAuthHelp", placeholder: "remoteMcpFormUi.zapierPlaceholder" },
    id: "zapier", name: "Zapier", supportsBrowserAuth: false,
    description: "Use the apps and actions on your Zapier MCP server.",
    instructions: ["Create an MCP server in Zapier and choose Other as the client.", "Connect your apps and select the actions to expose.", "Open Connect, generate a token, and copy the full server URL."],
    setupUrl: "https://docs.zapier.com/mcp/get-started/connect/other",
    dashboardUrl: "https://mcp.zapier.com",
    defaultUrl: "", placeholder: "Paste the full URL from Zapier",
    urlHelp: "The full server URL can contain a secret token. Paste it exactly as Zapier provides it.",
    authHelp: "For a separate token, use https://mcp.zapier.com/api/v1/connect and choose Bearer token.",
  },
  arcade: {
    messageKeys: { instructions: ["remoteMcpFormUi.arcadeInstruction1", "remoteMcpFormUi.arcadeInstruction2", "remoteMcpFormUi.arcadeInstruction3"], urlHelp: "remoteMcpFormUi.arcadeUrlHelp", authHelp: "remoteMcpFormUi.arcadeAuthHelp" },
    id: "arcade", name: "Arcade", supportsBrowserAuth: true,
    description: "Use the tools exposed by your Arcade gateway.",
    instructions: ["Create a gateway in Arcade and select its tools.", "Choose its User Source and copy the gateway URL.", "Paste the URL here, then sign in when prompted."],
    setupUrl: "https://docs.arcade.dev/en/operate/governance/mcp-gateways",
    dashboardUrl: "https://app.arcade.dev",
    defaultUrl: "", placeholder: "https://api.arcade.dev/mcp/your-gateway",
    urlHelp: "Copy the MCP gateway URL from Arcade. App authorization may be required the first time you use a tool.",
    authHelp: "For Arcade Headers, use an API key as the bearer token and add the Arcade-User-ID header for the acting user.",
  },
  composio: {
    messageKeys: { instructions: ["remoteMcpFormUi.composioInstruction1", "remoteMcpFormUi.composioInstruction2"], urlHelp: "remoteMcpFormUi.composioUrlHelp", authHelp: "remoteMcpFormUi.composioAuthHelp" },
    id: "composio", name: "Composio", supportsBrowserAuth: true,
    description: "Discover and use your apps through Composio Connect.",
    instructions: ["Connect to Composio and sign in with your account.", "Connect underlying apps in Composio when prompted."],
    setupUrl: "https://docs.composio.dev/docs/composio-connect",
    dashboardUrl: "https://dashboard.composio.dev",
    defaultUrl: "https://connect.composio.dev/mcp", placeholder: "https://connect.composio.dev/mcp",
    urlHelp: "Paste the MCP URL from your existing Composio session. If it requires headers, add them under Change.",
    authHelp: "Session URLs and headers come from your external Composio setup. Direct-tools sessions expose individual actions.",
  },
  executor: {
    messageKeys: { instructions: ["remoteMcpFormUi.executorInstruction1", "remoteMcpFormUi.executorInstruction2", "remoteMcpFormUi.executorInstruction3"], urlHelp: "remoteMcpFormUi.executorUrlHelp", authHelp: "remoteMcpFormUi.executorAuthHelp", placeholder: "remoteMcpFormUi.executorPlaceholder" },
    id: "executor", name: "Executor", supportsBrowserAuth: true,
    description: "Run tools through your Executor workspace.",
    instructions: ["Connect your apps and configure action policies in Executor.", "Open Integrations and copy the URL under “Connect an agent”.", "Paste it here and sign in when prompted."],
    setupUrl: "https://executor.sh/docs/mcp-proxy",
    dashboardUrl: "https://executor.sh",
    defaultUrl: "", placeholder: "Paste your Executor workspace MCP URL",
    urlHelp: "Use the hosted workspace URL or a self-hosted HTTP endpoint reachable from Paperclip. The server’s endpoint policy also applies.",
    authHelp: "Keep any options in the copied URL. If using an API key, use a user key; workspace and organization keys cannot open an MCP session.",
  },
};

/** Translate explicit presentation metadata, never provider names/IDs or endpoint values. */
export function remoteMcpProviderDisplay(provider: RemoteMcpProvider, t: TFunction) {
  const keys = provider.messageKeys;
  return {
    instructions: provider.instructions.map((text, index) => {
      const key = keys?.instructions[index];
      return key ? t(key) : text;
    }),
    urlHelp: keys ? t(keys.urlHelp) : provider.urlHelp,
    authHelp: keys ? t(keys.authHelp) : provider.authHelp,
    placeholder: keys?.placeholder ? t(keys.placeholder) : provider.placeholder,
  };
}
