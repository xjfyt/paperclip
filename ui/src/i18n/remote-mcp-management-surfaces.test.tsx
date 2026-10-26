// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { i18n } from "./index";
import { remoteMcpManagementMessages } from "./remote-mcp-management-test-resources";
import { validateLocaleMessages } from "./locale-validation";
import { RemoteMcpManagement } from "../features/connections/remote-mcp/RemoteMcpManagement";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => { await i18n.changeLanguage("en"); });
it.each(Object.entries(remoteMcpManagementMessages))("validates management resources in %s", (locale, messages) => {
  expect(validateLocaleMessages(messages, remoteMcpManagementMessages.en)).toEqual([]);
  for (const [key, value] of Object.entries(messages)) { expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i); if (locale !== "en") expect(value).not.toBe(remoteMcpManagementMessages.en[key as keyof typeof messages]); }
});
it.each(["en", "zh-CN", "es", "ja"])("retranslates an open confirmation from %s without disconnecting or closing it", async locale => {
  await i18n.changeLanguage(locale);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const providerName = "Customer <strong>Account</strong> 私の接続";
  const onReconnect = vi.fn(), onManage = vi.fn(), onDisconnect = vi.fn().mockRejectedValue(new Error("Provider raw failure"));
  const props = { providerName, onReconnect, onManage, onDisconnect };
  const button = (label: string) => Array.from(document.body.querySelectorAll('button')).find(b => b.textContent === label)!;
  try {
    await act(async () => root.render(<RemoteMcpManagement {...props} />));
    await act(async () => button(i18n.t("remoteMcpManagementUi.disconnect")).click());
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(i18n.t("remoteMcpManagementUi.confirmHelp"));
    await act(async () => { await i18n.changeLanguage(locale === "ja" ? "zh-CN" : "ja"); });
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(i18n.t("remoteMcpManagementUi.confirmTitle", { provider: providerName }));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(i18n.t("remoteMcpManagementUi.confirmHelp"));
    expect(document.querySelector('strong')).toBeNull();
    expect(onDisconnect).not.toHaveBeenCalled(); expect(onReconnect).not.toHaveBeenCalled(); expect(onManage).not.toHaveBeenCalled();
    await act(async () => button(i18n.t("remoteMcpManagementUi.confirmDisconnect")).click());
    expect(onDisconnect).toHaveBeenCalledOnce(); expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    await act(async () => root.render(<RemoteMcpManagement {...props} busy />));
    expect(button(i18n.t("remoteMcpManagementUi.disconnecting")).disabled).toBe(true);
    expect(button(i18n.t("common.cancel")).disabled).toBe(true);
    await act(async () => { await i18n.changeLanguage("es"); });
    expect(onDisconnect).toHaveBeenCalledOnce(); expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    onDisconnect.mockResolvedValue(undefined);
    await act(async () => root.render(<RemoteMcpManagement {...props} />));
    await act(async () => button(i18n.t("remoteMcpManagementUi.confirmDisconnect")).click());
    expect(onDisconnect).toHaveBeenCalledTimes(2); expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
it.each(["en", "zh-CN", "es", "ja"])("preserves disabled and hidden permission controls in %s", async locale => {
  await i18n.changeLanguage(locale);
  for (const connected of [true, false]) {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<RemoteMcpManagement providerName="Arcade" connected={connected} canReconnect={false} canDisconnect={false} onReconnect={() => {}} onManage={() => {}} onDisconnect={() => {}} />);
    expect(Array.from(host.querySelectorAll('button')).find(b => b.textContent === i18n.t("remoteMcpManagementUi.reconnect"))?.disabled).toBe(true);
    expect(Array.from(host.querySelectorAll('button')).some(b => b.textContent === i18n.t("remoteMcpManagementUi.disconnect"))).toBe(false);
  }
});
