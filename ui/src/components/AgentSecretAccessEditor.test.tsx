// @vitest-environment jsdom

import { act, useState } from "react";
import { i18n } from "@/i18n";
import { agentConfigurationMessages } from "@/i18n/agent-configuration-test-resources";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanySecret, EnvSecretRefBinding } from "@paperclipai/shared";

const mockSecretPickerRender = vi.hoisted(() => vi.fn());

// Keep this component test focused on access-row behavior while asserting that
// the editor routes selection through the shared, folder-aware env picker.
vi.mock("./environment-variables-editor/SecretPicker", () => ({
  SecretPicker: (props: {
    secretId: string;
    secrets: readonly CompanySecret[];
    onSelect: (secretId: string) => void;
    onCreateNew?: (query: string) => void;
  }) => {
    mockSecretPickerRender(props);
    return <>
      <button type="button" data-testid="pick-secret" onClick={() => props.onSelect("s1")}>
        pick
      </button>
      {props.onCreateNew ? (
        <button type="button" data-testid="create-secret" onClick={() => props.onCreateNew?.("new_secret")}>
          create
        </button>
      ) : null}
    </>;
  },
}));

import {
  AgentSecretAccessEditor,
  parseAccessGrants,
  parseEnvSecretRefs,
  rowsToAccessMap,
  summarizeAgentBindings,
} from "./AgentSecretAccessEditor";

function makeSecret(id: string, name: string): CompanySecret {
  return {
    id,
    companyId: "co",
    scope: "company",
    ownerUserId: null,
    userSecretDefinitionId: null,
    key: id,
    name,
    provider: "local_encrypted",
    status: "active",
    managedMode: "paperclip_managed",
    externalRef: null,
    providerConfigId: null,
    providerMetadata: null,
    latestVersion: 1,
    description: null,
    lastResolvedAt: null,
    lastRotatedAt: null,
    deletedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("AgentSecretAccessEditor model", () => {
  const config = {
    env: {
      GH_TOKEN: { type: "secret_ref", secretId: "s1", version: 2 },
      PLAIN: { type: "plain", value: "hi" },
    },
    "access.STRIPE": { type: "secret_ref", secretId: "s1" },
    "access.BROKEN": { type: "plain", value: "nope" },
    model: "claude",
  };

  it("parses env secret refs, ignoring plain values", () => {
    expect(parseEnvSecretRefs(config)).toEqual([{ name: "GH_TOKEN", secretId: "s1", version: 2 }]);
  });

  it("parses only well-formed top-level access.* secret refs", () => {
    expect(parseAccessGrants(config)).toEqual([{ name: "STRIPE", secretId: "s1", version: "latest" }]);
  });

  it("summarizes bindings per secret with both delivery modes", () => {
    const summary = summarizeAgentBindings(parseEnvSecretRefs(config), parseAccessGrants(config));
    expect(summary).toEqual([{ secretId: "s1", envKeys: ["GH_TOKEN"], apiAliases: ["STRIPE"] }]);
  });

  it("drops incomplete, invalid-alias, and unselected rows from the emitted access map", () => {
    expect(
      rowsToAccessMap([
        { id: "1", alias: "OK", secretId: "s1", version: "latest" },
        { id: "2", alias: "", secretId: "s1", version: "latest" }, // no alias
        { id: "3", alias: "1BAD", secretId: "s1", version: "latest" }, // invalid alias
        { id: "4", alias: "NOSECRET", secretId: "", version: "latest" }, // no secret
      ]),
    ).toEqual({ OK: { type: "secret_ref", secretId: "s1", version: "latest" } });
  });
});

describe("AgentSecretAccessEditor component", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    flushSync(() => root?.unmount());
    root = null;
    container.remove();
    vi.clearAllMocks();
    await i18n.changeLanguage("en");
  });

  function render(node: React.ReactNode) {
    root ??= createRoot(container);
    flushSync(() => root!.render(node));
  }

  const secrets = [makeSecret("s1", "STRIPE_KEY")];

  it("shows the delivery-mode overview for existing bindings", () => {
    render(
      <AgentSecretAccessEditor
        config={{
          env: { GH_TOKEN: { type: "secret_ref", secretId: "s1" } },
          "access.STRIPE": { type: "secret_ref", secretId: "s1" },
        }}
        secrets={secrets}
        onChange={() => {}}
      />,
    );
    expect(container.textContent).toContain("STRIPE_KEY");
    expect(container.textContent).toContain("Env var");
    expect(container.textContent).toContain("API access");
    expect(container.textContent).toContain("env.GH_TOKEN");
    expect(container.textContent).toContain("access.STRIPE");
  });

  it("adds an API-access grant, emitting an access.<ALIAS> secret_ref", () => {
    const emitted: Array<Record<string, EnvSecretRefBinding>> = [];
    render(
      <AgentSecretAccessEditor
        config={{}}
        secrets={secrets}
        onChange={(next) => emitted.push(next)}
      />,
    );

    // "Add API access" appends an editable row.
    const addButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Add API access"),
    )!;
    flushSync(() => addButton.click());

    // Type an alias.
    const aliasInput = container.querySelector<HTMLInputElement>('input[aria-label="Access alias"]')!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(aliasInput, "STRIPE");
    flushSync(() => aliasInput.dispatchEvent(new Event("input", { bubbles: true })));

    // Bind a secret via the stubbed picker.
    const pick = container.querySelector<HTMLButtonElement>('[data-testid="pick-secret"]')!;
    expect(mockSecretPickerRender).toHaveBeenLastCalledWith(
      expect.objectContaining({ secretId: "", secrets }),
    );
    flushSync(() => pick.click());

    const last = emitted.at(-1)!;
    expect(last).toEqual({ STRIPE: { type: "secret_ref", secretId: "s1", version: "latest" } });
  });

  it("keeps the create form open when focus returns to the shared picker anchor", async () => {
    vi.useFakeTimers();
    try {
      render(
        <AgentSecretAccessEditor
          config={{ "access.STRIPE": { type: "secret_ref", secretId: "s1" } }}
          secrets={secrets}
          onChange={() => {}}
          onCreateSecret={async () => secrets[0]!}
        />,
      );

      const createButton = container.querySelector<HTMLButtonElement>('[data-testid="create-secret"]')!;
      flushSync(() => createButton.click());
      flushSync(() => vi.runAllTimers());
      expect(document.body.textContent).toContain("Create secret");

      const pickerButton = container.querySelector<HTMLButtonElement>('[data-testid="pick-secret"]')!;
      pickerButton.focus();
      flushSync(() => {});

      expect(document.body.textContent).toContain("Create secret");
      expect(document.querySelector('input[aria-label="Secret name"]')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(Object.entries(agentConfigurationMessages))("renders binding proposals with original data and actions (%s)", async (locale, messages) => {
    await i18n.changeLanguage(locale);
    const approved: string[] = [];
    const rejected: string[] = [];
    const proposal = {
      id: "prop-1",
      companyId: "co",
      kind: "binding" as const,
      status: "pending" as const,
      justification: "Bind Stripe for the billing agent.",
      proposedName: null,
      proposedKey: null,
      proposedDescription: null,
      valueFingerprintSha256: null,
      valueLength: null,
      secretId: "s1",
      secretName: "STRIPE_KEY",
      secretProposalId: null,
      secretProposalName: null,
      targetType: "agent" as const,
      target: { id: "agent-1", name: "BillingBot", icon: null },
      configPath: "access.STRIPE",
      proposedBy: { id: "agent-2", name: "ClaudeCoder", icon: null },
      originIssue: null,
      originRunId: "run-1",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      createdAt: new Date(0).toISOString(),
      resolvedByUserId: null,
      resolvedAt: null,
      resolutionReason: null,
      createdSecretId: null,
      appliedBindingConfigPath: null,
      viewerCanApprove: true,
      approveBlockReason: null,
    };
    render(
      <AgentSecretAccessEditor
        config={{}}
        secrets={secrets}
        onChange={() => {}}
        proposals={[proposal]}
        onApproveProposal={(p) => approved.push(p.id)}
        onRejectProposal={(p) => rejected.push(p.id)}
      />,
    );

    expect(container.textContent).toContain(messages.secretAccessProposed);
    expect(container.textContent).toContain(messages.secretAccessProposedBy.replace("{{name}}", "ClaudeCoder"));
    expect(container.textContent).toContain(proposal.justification);
    expect(container.textContent).toContain("STRIPE"); // alias + bound secret name
    expect(container.textContent).toContain("ClaudeCoder"); // proposer

    const approveButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Approve",
    )!;
    flushSync(() => approveButton.click());
    expect(approved).toEqual(["prop-1"]);

    const rejectButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Reject",
    )!;
    flushSync(() => rejectButton.click());
    expect(rejected).toEqual(["prop-1"]);
  });

  describe.each(Object.entries(agentConfigurationMessages))("localized secret access (%s)", (locale, messages) => {
    function button(label: string) {
      return [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === label)!;
    }
    function setValue(input: HTMLInputElement, value: string) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      flushSync(() => input.dispatchEvent(new Event("input", { bubbles: true })));
    }

    it("localizes the empty state, add/remove controls and API help without changing paths", async () => {
      const onChange = vi.fn();
      render(<AgentSecretAccessEditor config={{}} secrets={secrets} onChange={onChange} />);
      await act(async () => { await i18n.changeLanguage(locale); });
      expect(container.textContent).toContain(messages.secretAccessEmpty);
      expect(container.textContent).toContain(messages.secretAccessApiOnly);
      expect(container.querySelector("code")?.textContent).toBe("GET /agents/me/secrets");
      expect(container.textContent).toContain(messages.secretAccessDescription.replace(/<\/?0>/g, "").replace("{{path}}", "GET /agents/me/secrets"));
      flushSync(() => { button(messages.secretAccessAdd).click(); button(messages.secretAccessAdd).click(); });
      const aliases = container.querySelectorAll<HTMLInputElement>(`input[aria-label="${messages.secretAccessAlias}"]`);
      expect(aliases).toHaveLength(2);
      expect(onChange).not.toHaveBeenCalled();
      setValue(aliases[0]!, "API_Original");
      flushSync(() => container.querySelector<HTMLButtonElement>('[data-testid="pick-secret"]')!.click());
      expect(onChange).toHaveBeenLastCalledWith({ API_Original: { type: "secret_ref", secretId: "s1", version: "latest" } });
      const select = container.querySelector("select")!;
      expect(select.getAttribute("aria-label")).toBe(i18n.t("environmentEditorUi.version"));
      expect(select.value).toBe("latest");
      expect(select.options[0]!.text).toBe(i18n.t("environmentEditorUi.latest"));
      flushSync(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${messages.secretAccessRemove}"]`)!.click());
      expect(onChange).toHaveBeenLastCalledWith({});
      expect(container.querySelectorAll('input[placeholder="ALIAS"]')).toHaveLength(1);
    });

    it("keeps incomplete drafts, localized validation and raw names through language changes and controlled cancel", async () => {
      const onChange = vi.fn();
      const original = { "access.Original_ALIAS": { type: "secret_ref", secretId: "s1", version: 1 } };
      function ControlledEditor() {
        const [config, setConfig] = useState<Record<string, unknown>>(original);
        return <>
          <AgentSecretAccessEditor config={config} secrets={[makeSecret("s1", "Secret 原文 <API_KEY>")]} onChange={next => {
            onChange(next);
            setConfig(Object.fromEntries(Object.entries(next).map(([alias, binding]) => [`access.${alias}`, binding])));
          }} />
          <button onClick={() => setConfig(original)}>cancel-draft</button>
        </>;
      }
      render(<ControlledEditor />);
      const input = container.querySelector<HTMLInputElement>('input[placeholder="ALIAS"]')!;
      input.focus();
      setValue(input, "1 invalid");
      await act(async () => { await i18n.changeLanguage(locale); });
      expect(container.querySelector('input[placeholder="ALIAS"]')).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe("1 invalid");
      expect(container.textContent).toContain(messages.secretAccessInvalidAlias);
      expect(onChange).toHaveBeenLastCalledWith({});
      setValue(input, "DUPLICATE");
      flushSync(() => button(messages.secretAccessAdd).click());
      const second = container.querySelectorAll<HTMLInputElement>('input[placeholder="ALIAS"]')[1]!;
      setValue(second, "DUPLICATE");
      expect(container.textContent).toContain(messages.secretAccessDuplicateAlias);
      flushSync(() => button("cancel-draft").click());
      await act(async () => {});
      expect(container.querySelectorAll('input[placeholder="ALIAS"]')).toHaveLength(1);
      expect(container.querySelector<HTMLInputElement>('input[placeholder="ALIAS"]')!.value).toBe("Original_ALIAS");
      expect(container.textContent).toContain("Secret 原文 <API_KEY>");
      expect(container.textContent).toContain("access.Original_ALIAS");
      expect(container.textContent).toContain(messages.secretAccessApi);
      expect(container.querySelector("API_KEY")).toBeNull();
    });

    it("preserves existing binding values and keeps disabled controls inert", async () => {
      const onChange = vi.fn();
      render(<AgentSecretAccessEditor config={{
        env: { ENV_Original: { type: "secret_ref", secretId: "s1" } },
        "access.Alias_Original": { type: "secret_ref", secretId: "s1", version: 1 },
      }} secrets={secrets} onChange={onChange} disabled />);
      await act(async () => { await i18n.changeLanguage(locale); });
      expect(container.textContent).toContain(messages.secretAccessEnv);
      expect(container.textContent).toContain(messages.secretAccessApi);
      expect(container.textContent).toContain("STRIPE_KEY");
      expect(container.textContent).toContain("env.ENV_Original");
      expect(container.textContent).toContain("access.Alias_Original");
      const input = container.querySelector("input")!;
      expect(input.value).toBe("Alias_Original");
      expect(input.disabled).toBe(true);
      expect(container.querySelector("select")!.value).toBe("1");
      const add = button(messages.secretAccessAdd);
      const remove = container.querySelector<HTMLButtonElement>(`button[aria-label="${messages.secretAccessRemove}"]`)!;
      expect(add.disabled).toBe(true); expect(remove.disabled).toBe(true);
      flushSync(() => { add.click(); remove.click(); });
      expect(container.querySelectorAll("input")).toHaveLength(1);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

});
