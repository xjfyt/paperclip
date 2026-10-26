// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { i18n } from "@/i18n";
import en from "@/i18n/contributions/wecomUi/en.json";
import zh from "@/i18n/contributions/wecomUi/zh-CN.json";
import es from "@/i18n/contributions/wecomUi/es.json";
import ja from "@/i18n/contributions/wecomUi/ja.json";
import { MimouseWecomPanel } from "./MimouseWecomPanel";
const calls = vi.hoisted(() => ({ list: vi.fn(), secrets: vi.fn(), register: vi.fn(), enabled: vi.fn() }));
vi.mock("@/api/wecom", () => ({ wecomApi: () => calls }));
const row = { id: "connection", companyId: "company", product: "<script>inert</script>", enabled: false, state: "disabled", imported: 3, allowedGroupCount: 2, allowedDirectSenderCount: 1, gapDetected: true, replaySupported: false };
let host: HTMLDivElement, root: Root;
const label = (key: string) => i18n.t(`wecomUi.${key}`);
const button = (key: string) => [...host.querySelectorAll("button")].find(item => item.textContent === label(key))!;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount(companyId = "company", userId = "user", sessionId = "session") { await act(async () => root.render(<MimouseWecomPanel {...{ companyId, userId, sessionId }} />)); await flush(); }
async function click(key: string) { await act(async () => button(key).click()); await flush(); }
async function check() { await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); }
async function fill(key: string, value: string) { const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[aria-label="${label(key)}"]`)!;
  await act(async () => { const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value); input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
}
async function registration() { await click("prepare"); await fill("botId", "bot-owned"); await fill("product", "Product"); await fill("groups", "group-a\ngroup-b"); await fill("secret", "secret"); }
beforeEach(async () => {
  for (const [locale, value] of Object.entries({ en, "zh-CN": zh, es, ja })) i18n.addResourceBundle(locale, "translation", { wecomUi: value }, true, true);
  await i18n.changeLanguage("en"); for (const call of Object.values(calls)) call.mockReset();
  calls.list.mockResolvedValue([row]); calls.secrets.mockResolvedValue([{ id: "secret", name: "Credential metadata", version: 4 }]);
  calls.register.mockResolvedValue({ ...row, id: "new", product: "Product" }); calls.enabled.mockResolvedValue({ ...row, enabled: true, state: "pending" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("shows redacted state/count/gap and four-language no-replay boundary as inert text", async () => {
  await mount(); expect(host.querySelector("script")).toBeNull(); expect(host.textContent).toContain(row.product); expect(calls.secrets).not.toHaveBeenCalled(); expect(calls.register).not.toHaveBeenCalled();
  for (const locale of ["en", "zh-CN", "es", "ja"]) { await act(async () => { await i18n.changeLanguage(locale); }); expect(host.textContent).toContain(label("noReplay")); expect(host.textContent).toContain(label("gap")); }
});
it("registration is disabled-only, pins a numeric credential version and requires confirmation", async () => {
  await mount(); await registration(); expect(button("register").disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>(`[aria-label="${label("version")}"]`)!.value).toBe("4"); await check(); await click("register");
  expect(calls.register).toHaveBeenCalledWith({ transport: "long_connection", botId: "bot-owned", product: "Product", allowedGroupIds: ["group-a", "group-b"], allowedDirectSenderIds: [], secret: { secretId: "secret", version: 4 } });
  expect(calls.enabled).not.toHaveBeenCalled(); expect(host.textContent).toContain(label("registered"));
});
it("requires explicit enable confirmation with actual-connection warning, and supports disable", async () => {
  await mount(); await click("enable"); expect(host.textContent).toContain(label("enableWarning")); expect(button("apply").disabled).toBe(true); expect(calls.enabled).not.toHaveBeenCalled();
  await check(); await click("apply"); expect(calls.enabled).toHaveBeenCalledWith("connection", true);
  await click("disable"); expect(host.textContent).toContain(label("disableWarning")); await check(); await click("apply"); expect(calls.enabled).toHaveBeenLastCalledWith("connection", false);
});
it("unknown creation is never replayed by refresh; requires independent reconciliation then clears draft", async () => {
  calls.register.mockRejectedValue(Error("response lost")); await mount(); await registration(); await check(); await click("register");
  expect(button("reconciled").disabled).toBe(true); expect(host.querySelector("fieldset")!.disabled).toBe(true);
  await click("refresh"); expect(calls.register).toHaveBeenCalledTimes(1); expect(host.querySelector("fieldset")!.disabled).toBe(true);
  await click("reconciled"); expect(host.querySelector('input[aria-label="Bot ID"]')).toBeNull(); expect(calls.register).toHaveBeenCalledTimes(1);
});
it("uncertain enable never retries automatically and manual refresh only reads", async () => {
  calls.enabled.mockRejectedValue(Error("lost")); await mount(); await click("enable"); await check(); await click("apply"); await click("refresh"); expect(calls.enabled).toHaveBeenCalledTimes(1); expect(calls.list).toHaveBeenCalledTimes(2);
});
it.each(["company", "user", "session"])("clears drafts/results and discards late write after %s change", async dimension => {
  let complete!: (value: unknown) => void; calls.register.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await mount(); await registration(); await check(); await click("register");
  await mount(dimension === "company" ? "other" : "company", dimension === "user" ? "other" : "user", dimension === "session" ? "other" : "session");
  await act(async () => complete({ ...row, product: "late-private-result" })); await flush(); expect(host.textContent).not.toContain("late-private-result"); expect(host.querySelector('input')).toBeNull();
});
it("403 server registration authority denial clears draft/secret metadata and hides controls", async () => {
  calls.register.mockRejectedValue(new ApiError("Instance administrator required", 403, null)); await mount(); await registration(); await check(); await click("register");
  expect(host.querySelector("fieldset")).toBeNull(); expect(host.textContent).not.toContain("Credential metadata"); await click("refresh"); await click("prepare"); expect(host.querySelector<HTMLInputElement>(`[aria-label="${label("botId")}"]`)!.value).toBe("");
});
it("rejects missing scope and clears confirmation after a pin change", async () => {
  await mount(); await registration(); await check(); await fill("version", "2"); expect(button("register").disabled).toBe(true); await check(); await fill("groups", ""); expect(button("register").disabled).toBe(true); expect(calls.register).not.toHaveBeenCalled();
});
it("late metadata after session change never populates new session", async () => {
  let complete!: (value: unknown) => void; calls.secrets.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  await mount(); await click("prepare"); await mount("company", "user", "new-session"); await act(async () => complete([{ id: "old", name: "old-private-secret-name", version: 1 }])); await flush(); expect(host.textContent).not.toContain("old-private-secret-name");
});
it("read error fails closed and missing session performs no reads", async () => {
  calls.list.mockRejectedValueOnce(Error("offline")); await mount(); expect(host.querySelector("fieldset")).toBeNull(); calls.list.mockClear(); await mount("company", "user", ""); expect(calls.list).not.toHaveBeenCalled();
});
it("422 revoked credential pin is a known rejection, editable only after renewed confirmation", async () => {
  calls.register.mockRejectedValueOnce(new ApiError("Active pinned company credential required", 422, null));
  await mount(); await registration(); await check(); await click("register");
  expect(calls.register).toHaveBeenCalledTimes(1); expect(host.textContent).toContain(label("rejected"));
  expect(host.textContent).not.toContain(label("unknown")); expect(button("reconciled")).toBeUndefined(); expect(host.querySelector("fieldset")!.disabled).toBe(false);
  expect(button("register").disabled).toBe(true); await fill("version", "2"); expect(button("register").disabled).toBe(true);
  await check(); await click("register"); expect(calls.register).toHaveBeenCalledTimes(2);
  expect(calls.register.mock.calls[0]![0].secret.version).toBe(4); expect(calls.register.mock.calls[1]![0].secret.version).toBe(2);
});
it.each(["en", "zh-CN", "es", "ja"])("localizes every backend state and safely replaces unknown state in %s", async locale => {
  await i18n.changeLanguage(locale);
  const states = ["disabled", "pending", "company_inactive", "interrupted", "revoked", "connecting", "authenticated", "reconnecting", "receiving", "cancelled", "displaced", "authentication", "budget_exhausted", "protocol", "overflow", "transport"];
  calls.list.mockResolvedValue([...states.map(state => ({ ...row, id: state, state })), { ...row, id: "unknown-row", state: '<script>private-server-state</script>' }]);
  await mount(); for (const state of states) { expect(label(`state_${state}`)).not.toBe(`wecomUi.state_${state}`); expect(host.textContent).toContain(`${label("state")}: ${label(`state_${state}`)}`); }
  expect(host.textContent).toContain(`${label("state")}: ${label("state_unknown")}`); expect(host.textContent).not.toContain("private-server-state"); expect(host.querySelector("script")).toBeNull();
});
