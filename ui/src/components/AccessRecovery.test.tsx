// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { NoBoardAccessPage } from "./CloudAccessGate";
import { BootstrapPendingPage } from "./BootstrapPendingPage";
import { agentCreationIsReady } from "@/hooks/useCompanyAgentCreationAccess";
afterEach(async () => { await i18n.changeLanguage("en"); });
it.each([["en", "No organization access"], ["zh-CN", "没有组织访问权限"], ["es", "Sin acceso a la organización"], ["ja", "組織へのアクセス権がありません"]])("shows an explicit account exit and localized no-access state in %s", async (locale, title) => {
  await i18n.changeLanguage(locale);
  const html = renderToStaticMarkup(<NoBoardAccessPage onSignOut={() => {}} />); expect(html).toContain(title); expect(html).toContain(i18n.t("authGate.switchAccount"));
});
it("uses an actual sign-out action instead of an auth link that redirects the signed-in user back", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host), signOut = vi.fn();
  try {
    await act(async () => root.render(<NoBoardAccessPage onSignOut={signOut} />));
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click()); expect(signOut).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<NoBoardAccessPage onSignOut={signOut} signingOut />)); expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
    await act(async () => root.render(<MemoryRouter><BootstrapPendingPage claimAvailable session={{ session: { id: "session", userId: "user" }, user: { id: "user", name: "Fixture", email: "fixture@example.invalid", image: null }, sentryDsn: null }} claimState="idle" onClaim={() => {}} onSwitchAccount={signOut} /></MemoryRouter>));
    const switcher = [...host.querySelectorAll("button")].find(button => button.textContent === "Sign out and switch account")!;
    await act(async () => switcher.click()); expect(signOut).toHaveBeenCalledTimes(2); expect(host.querySelector('a[href="/auth?next=/"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it("never offers agent setup on denied, missing, stale or failed capability snapshots", () => {
  expect(agentCreationIsReady(undefined, false, false)).toBe(false);
  expect(agentCreationIsReady({ canCreateAgents: false }, false, false)).toBe(false);
  expect(agentCreationIsReady({ canCreateAgents: true }, true, false)).toBe(false);
  expect(agentCreationIsReady({ canCreateAgents: true }, false, true)).toBe(false);
  expect(agentCreationIsReady({ canCreateAgents: true }, false, false)).toBe(true);
});
