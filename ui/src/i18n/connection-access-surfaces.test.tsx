// @vitest-environment jsdom
import { act, useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { i18n, useTranslation } from "./index";
import { connectionAccessMessages } from "./connection-access-test-resources";
import { validateLocaleMessages } from "./locale-validation";
import { AccessStepContent, ConnectionAccessDefaults, connectionDefaultSummarySentence } from "../features/connections/ConnectionSetupFlow";
import type { ConnectionGrantKind } from "@paperclipai/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => { await i18n.changeLanguage("en"); });
const locales = ["en", "zh-CN", "es", "ja"] as const;
const name = 'Customer <strong>Write</strong> & 私の Agent';
function props(overrides: Partial<ComponentProps<typeof AccessStepContent>> = {}): ComponentProps<typeof AccessStepContent> {
  return { agents: [{ id: "agent-id", name }], authKind: "oauth", grantKind: "user", setGrantKind: vi.fn(), installChoice: "specific", setInstallChoice: vi.fn(), installAgentIds: new Set(["agent-id"]), setInstallAgentIds: vi.fn(), submitLabel: "Continue unchanged", onBack: vi.fn(), onContinue: vi.fn(), ...overrides };
}
function render(props: ComponentProps<typeof AccessStepContent>) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<AccessStepContent {...props} />);
  return host;
}
it.each(Object.entries(connectionAccessMessages))("validates permission-display resources in %s", (_locale, messages) => {
  expect(validateLocaleMessages(messages, connectionAccessMessages.en)).toEqual([]);
  expect(messages.lockedAccess.match(/<0\/>/g)).toHaveLength(1);
  // Match the stricter contribution composer gate, not only the runtime validator.
  for (const value of Object.values(messages)) expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
});
it.each(locales)("states every identity and configured reach accurately in %s", async locale => {
  await i18n.changeLanguage(locale);
  const t = i18n.t;
  for (const [authKind, grantKind, identity] of [
    ["none", "user", "summaryNoSignIn"], ["oauth", "user", "summaryPersonal"],
    ["api_key", "organization", "summaryOrganization"], ["oauth", "agent", "summaryDedicated"],
  ] as const) {
    for (const [extra, reach] of [
      [{ installChoice: "all" as const }, t("connectionAccessUi.summaryAll")],
      [{ installCount: 0 }, t("connectionAccessUi.summaryNoneSelected")],
      [{ installCount: 1 }, t("connectionAccessUi.summarySelected", { count: 1 })],
      [{ installCount: 2 }, t("connectionAccessUi.summarySelected", { count: 2 })],
      [{ lockedAgentId: "requesting-id" }, t("connectionAccessUi.summaryLocked")],
      [{ preserveAgentAccess: true, installChoice: "all" as const }, t("connectionAccessUi.summaryPreserve")],
    ] as const) {
      expect(connectionDefaultSummarySentence({ authKind, grantKind, installChoice: "specific", installCount: 2, ...extra }, t))
        .toBe(t("connectionAccessUi.summarySentence", { identity: t(`connectionAccessUi.${identity}`), reach }));
    }
    const host = render(props({ authKind, grantKind, grantKinds: [grantKind], githubIdentity: true }));
    expect(host.textContent).toContain(t(`connectionAccessUi.${authKind === "none" ? "noIdentity" : grantKind === "user" ? "myGithub" : grantKind === "agent" ? "dedicatedAccount" : "sharedGithub"}`));
    expect(host.innerHTML).not.toContain("connectionAccessUi.");
  }
  if (locale === "en") expect(connectionDefaultSummarySentence({ authKind: "oauth", grantKind: "user", installChoice: "specific", installCount: 1 })).toBe("Connects as you, available to 1 selected agent.");
});
it.each(locales)("does not label unknown identity or reach as granted or read-only in %s", async locale => {
  await i18n.changeLanguage(locale);
  const unknown = { authKind: "other", grantKind: "other", installChoice: "other", installCount: -1 } as unknown as Parameters<typeof connectionDefaultSummarySentence>[0];
  expect(connectionDefaultSummarySentence(unknown)).toBe(i18n.t("connectionAccessUi.summarySentence", { identity: i18n.t("connectionAccessUi.summaryIdentityUnknown"), reach: i18n.t("connectionAccessUi.summaryReachUnknown") }));
  const host = render(props({ githubIdentity: true, grantKind: "other" as ConnectionGrantKind, grantKinds: ["other" as ConnectionGrantKind] }));
  expect(host.textContent).toContain(i18n.t("connectionAccessUi.summaryIdentityUnknown"));
  expect(host.textContent).not.toContain(i18n.t("connectionAccessUi.sharedGithubHelp"));
  expect(host.textContent).not.toContain(i18n.t("connectionAccessUi.selectedSharedHelp"));
  expect(host.textContent).not.toContain(i18n.t("connectionAccessUi.allSharedHelp"));
  for (const count of [-1, Number.NaN, 1.5]) expect(connectionDefaultSummarySentence({ authKind: "oauth", grantKind: "user", installChoice: "specific", installCount: count })).toContain(i18n.t("connectionAccessUi.summaryReachUnknown"));
});
it.each(locales)("preserves disabled permissions, reasons and credential-free empty reach in %s", async locale => {
  await i18n.changeLanguage(locale);
  const host = render(props({ grantKind: "organization", installChoice: "all", capabilities: { canCreateOrganizationGrant: false, canSetCompanyInstall: false } }));
  const organization = host.querySelector<HTMLButtonElement>(`[aria-label="${i18n.t("connectionAccessUi.unavailableLabel", { label: i18n.t("connectionAccessUi.anyHuman"), reason: i18n.t("connectionAccessUi.organizationManagerOnly") })}"]`)!;
  expect(organization.disabled).toBe(true);
  expect(organization.title).toBe(i18n.t("connectionAccessUi.organizationManagerOnly"));
  const allAgents = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(button => button.textContent === i18n.t("connectionAccessUi.anyAgent"))!;
  expect(allAgents.disabled).toBe(true);
  expect(allAgents.title).toBe(i18n.t("connectionAccessUi.configureOnly"));
  expect(Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === "Continue unchanged")?.disabled).toBe(true);
  const external = render(props({ capabilities: { canCreateOrganizationGrant: false, canSetCompanyInstall: false, organizationGrantReason: "External organization policy", companyInstallReason: "External install policy" } }));
  expect(external.innerHTML).toContain("External organization policy");
  expect(external.innerHTML).toContain("External install policy");
  const noIdentity = render(props({ authKind: "none", installAgentIds: new Set() }));
  expect(noIdentity.textContent).toContain(i18n.t("connectionAccessUi.noIdentity"));
  expect(Array.from(noIdentity.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === "Continue unchanged")?.disabled).toBe(true);
});
it.each(locales)("keeps locked names literal and distinguishes reconnect from newly granted reach in %s", async locale => {
  await i18n.changeLanguage(locale);
  const host = render(props({ lockedAgentId: "agent-id" }));
  expect(host.textContent).toContain(name);
  expect(host.querySelector('strong')).toBeNull();
  expect(host.querySelector('p > span.font-medium')?.textContent).toBe(name);
  expect(host.textContent).toContain(i18n.t("connectionAccessUi.lockedAccess").replace("<0/>", name));
  const missing = render(props({ lockedAgentId: "missing", installAgentIds: new Set(["missing"]) }));
  expect(missing.textContent).toContain(i18n.t("connectionAccessUi.requestingAgent"));
  const preserve = render(props({ preserveAgentAccess: true, installAgentIds: new Set() }));
  expect(preserve.textContent).toContain(i18n.t("connectionAccessUi.preserveHelp"));
  expect(preserve.textContent).toContain(i18n.t("connectionAccessUi.preserveHeading"));
  expect(preserve.querySelectorAll('[role="radiogroup"]')).toHaveLength(1);
});
it.each(locales)("switches display language without changing permission state or firing actions from %s", async locale => {
  await i18n.changeLanguage(locale);
  const changeGrant = vi.fn(), changeInstall = vi.fn(), changeIds = vi.fn(), onContinue = vi.fn();
  function Harness() {
    const { t } = useTranslation();
    const [grantKind, setGrantKind] = useState<ConnectionGrantKind>("user");
    const [installChoice, setInstallChoice] = useState<"all" | "specific">("specific");
    const [ids, setIds] = useState(new Set(["agent-id"]));
    return <><output>{JSON.stringify({ grantKind, installChoice, ids: [...ids] })}</output><ConnectionAccessDefaults
      {...props({ grantKind, installChoice, installAgentIds: ids, setGrantKind: next => { changeGrant(next); setGrantKind(next); }, setInstallChoice: next => { changeInstall(next); setInstallChoice(next); }, setInstallAgentIds: next => { changeIds(next); setIds(next); }, onContinue })}
      companyId="company" agents={[{ id: "agent-id", name }]} extra={<p>Unchanged read + write permission</p>}
      sentence={connectionDefaultSummarySentence({ authKind: "oauth", grantKind, installChoice, installCount: ids.size }, t)} />
    </>;
  }
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness />));
    const change = Array.from(container.querySelectorAll('button')).find(button => button.textContent === i18n.t("connectionAccessUi.change"))!;
    await act(async () => change.click());
    expect(change.getAttribute("aria-expanded")).toBe("true");
    const value = container.querySelector('output')!.textContent;
    await act(async () => { await i18n.changeLanguage(locale === "ja" ? "zh-CN" : "ja"); });
    expect(change.textContent).toBe(i18n.t("connectionAccessUi.change"));
    expect(change.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain(i18n.t("connectionAccessUi.summaryPersonal"));
    expect(container.textContent).toContain(i18n.t("connectionAccessUi.summarySelected", { count: 1 }));
    expect(container.textContent).toContain("Unchanged read + write permission");
    expect(container.querySelector('output')!.textContent).toBe(value);
    expect(changeGrant).not.toHaveBeenCalled(); expect(changeInstall).not.toHaveBeenCalled(); expect(changeIds).not.toHaveBeenCalled(); expect(onContinue).not.toHaveBeenCalled();
    const organization = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(button => button.textContent === i18n.t("connectionAccessUi.anyHuman"))!;
    await act(async () => organization.click());
    const all = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(button => button.textContent === i18n.t("connectionAccessUi.anyAgent"))!;
    await act(async () => all.click());
    expect(changeGrant).toHaveBeenCalledExactlyOnceWith("organization"); expect(changeInstall).toHaveBeenCalledExactlyOnceWith("all");
    expect(JSON.parse(container.querySelector('output')!.textContent!)).toEqual({ grantKind: "organization", installChoice: "all", ids: ["agent-id"] });
  } finally { await act(async () => root.unmount()); container.remove(); }
});
