// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { i18n } from "./index";
import { connectionHandoffMessages } from "./connection-handoff-test-resources";
import { validateLocaleMessages } from "./locale-validation";
import { resolveAuthorizationTarget } from "../lib/authorizationUrl";
import { OAuthHandoffError, oauthHandoffUiMessage, prepareOAuthNavigation, savePendingCloudHandoff } from "../lib/oauthHandoff";
import { ManagedOAuthHandoffState, PaperclipCloudOAuthHandoffPage } from "../pages/apps/PaperclipCloudOAuthHandoff";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const navigate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/browserNavigation", () => ({ navigateTopLevel: (url: string) => navigate(url) }));
const session = "cloud_session_abcdefghijklmnop";
const handoff = { kind: "paperclip_cloud", session } as const;
afterEach(async () => { vi.restoreAllMocks(); navigate.mockReset(); window.sessionStorage.clear(); await i18n.changeLanguage("en"); });
it.each(Object.entries(connectionHandoffMessages))("validates handoff resources in %s", (locale, messages) => {
  expect(validateLocaleMessages(messages, connectionHandoffMessages.en)).toEqual([]);
  for (const [key, value] of Object.entries(messages)) {
    expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    if (locale !== "en") expect(value).not.toBe(connectionHandoffMessages.en[key as keyof typeof messages]);
  }
});
it.each(["en", "zh-CN", "es", "ja"])("renders handoff loading/reauthentication/error in %s", async locale => {
  await i18n.changeLanguage(locale);
  for (const [phase, body] of [["loading", "opening"], ["reauthenticating", "refreshing"], ["error", "prepareFailed"]] as const) {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<ManagedOAuthHandoffState phase={phase} onRetry={() => {}} onCancel={() => {}} />);
    expect(host.textContent).toContain(i18n.t(`connectionHandoffUi.${body}`));
    if (phase === "error") expect(host.textContent).toContain(i18n.t("connectionHandoffUi.returnToPaperclip"));
    else expect(host.querySelector('button')).toBeNull();
  }
});
it.each([
  ["", "urlMissing"], ["not-a-url", "urlMalformed"], ["javascript:alert(1)", "urlScheme"],
  ["http://evil.test/authorize", "urlInsecure"], ["https://user:secret@evil.test/authorize", "urlCredentials"], ["https://auth.test/authorize#secret", "urlFragment"],
])("retains URL refusal and explicit local descriptor for %s", async (url, key) => {
  const target = resolveAuthorizationTarget(url);
  expect(target.ok).toBe(false); if (target.ok) return;
  expect(target.translationKey).toBe(`connectionHandoffUi.${key}`);
  expect(target.message).toBe(i18n.t(target.translationKey, { lng: "en" }));
  const error = await prepareOAuthNavigation({ authorizationUrl: url }).catch(error => error);
  expect(error).toBeInstanceOf(OAuthHandoffError);
  expect(error).toMatchObject({ message: target.message, name: "OAuthHandoffError", code: "invalid_handoff" });
  expect(oauthHandoffUiMessage(error, "unused")).toEqual({ key: target.translationKey });
  for (const locale of ["en", "zh-CN", "es", "ja"]) {
    const message = i18n.t(target.translationKey, { lng: locale });
    if (url) expect(message).not.toContain(url);
    expect(message).not.toContain("secret");
  }
});
it.each([[404, "expired", "expired"], [401, "forbidden", "forbidden"], [403, "forbidden", "forbidden"], [500, "unavailable", "unavailable"]])("retains handoff code and retry behavior for HTTP %s", async (status, code, key) => {
  const request = vi.fn().mockResolvedValue(Response.json({ error: "REMOTE_CODE" }, { status: Number(status) }));
  const error = await prepareOAuthNavigation({ authorizationUrl: "", handoff }, { request }).catch(error => error);
  expect(error).toMatchObject({ name: "OAuthHandoffError", code, message: i18n.t(`connectionHandoffUi.${key}`, { lng: "en" }) });
  expect(oauthHandoffUiMessage(error, "unused")).toEqual({ key: `connectionHandoffUi.${key}` });
  expect(request).toHaveBeenCalledTimes(Number(status) >= 500 ? 2 : 1);
  for (const [url, options] of request.mock.calls) { expect(url).toBe("/cloud/connections/handoff"); expect(options.body).toBe(JSON.stringify({ session })); }
});
it("does not classify raw network text by unavailable code and preserves AbortError", async () => {
  const raw = "Network diagnostic <raw> url=provider-private";
  const request = vi.fn().mockRejectedValue(new Error(raw));
  const error = await prepareOAuthNavigation({ authorizationUrl: "", handoff }, { request }).catch(error => error);
  expect(error).toMatchObject({ code: "unavailable", message: raw });
  expect(oauthHandoffUiMessage(error, "unused")).toBe(raw);
  expect(request).toHaveBeenCalledTimes(2);
  const aborted = new DOMException("Abort raw", "AbortError"); request.mockReset().mockRejectedValue(aborted);
  await expect(prepareOAuthNavigation({ authorizationUrl: "", handoff }, { request })).rejects.toBe(aborted);
  expect(request).toHaveBeenCalledOnce();
});
it.each(["expired", "forbidden", "unavailable", "invalidProviderAddress", "refreshFailed", "returnExpired", "raw"])("retranslates cached %s without exchanging again, clearing session or navigating", async kind => {
  if (kind !== "returnExpired") savePendingCloudHandoff(session);
  const request = vi.spyOn(globalThis, "fetch");
  if (kind === "raw") request.mockRejectedValue(new Error("Original network diagnostic <raw>"));
  else request.mockResolvedValue(kind === "invalidProviderAddress" ? Response.json({ authorizationUrl: "javascript:secret" })
    : kind === "refreshFailed" ? Response.json({ error: "RECENT_LOGIN_REQUIRED", reauthenticationUrl: `${window.location.origin}/cloud/connections/reauth?session=${session}` }, { status: 401 })
    : Response.json({ error: "REMOTE_CODE" }, { status: kind === "expired" ? 404 : kind === "forbidden" ? 403 : 500 }));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<PaperclipCloudOAuthHandoffPage />));
    const saved = JSON.stringify({ ...window.sessionStorage });
    const calls = JSON.stringify(request.mock.calls);
    expect(request.mock.calls.length).toBe(kind === "returnExpired" ? 0 : ["raw", "unavailable"].includes(kind) ? 2 : 1);
    for (const locale of ["ja", "zh-CN", "es", "en"]) {
      await act(async () => { await i18n.changeLanguage(locale); });
      expect(host.textContent).toContain(kind === "raw" ? "Original network diagnostic <raw>" : i18n.t(`connectionHandoffUi.${kind}`));
      expect(host.textContent).toContain(i18n.t("connectionHandoffUi.cannotContinue"));
      expect(JSON.stringify(request.mock.calls)).toBe(calls);
      expect(JSON.stringify({ ...window.sessionStorage })).toBe(saved);
      expect(navigate).not.toHaveBeenCalled();
    }
  } finally { await act(async () => root.unmount()); host.remove(); }
});
