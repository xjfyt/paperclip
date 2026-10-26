// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { AuthRevocationPanel } from "./AuthRevocationPanel";
const mocks = vi.hoisted(() => ({ list: vi.fn(), revoke: vi.fn() }));
vi.mock("@/api/access", () => ({ accessApi: { listAuthRevocations: (id: string) => mocks.list(id), revokeLocalAuth: (id: string, input: unknown) => mocks.revoke(id, input) } }));
let host: HTMLDivElement, root: Root, client: QueryClient;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); }
async function render(target = "target") { await act(async () => root.render(<QueryClientProvider client={client}><AuthRevocationPanel key={`admin:${target}`} actorUserId="admin" targetUserId={target} /></QueryClientProvider>)); await flush(); }
async function confirm(value = "target") {
  await act(async () => { const input = host.querySelector("input")!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
const receipt = { requestId: "11111111-1111-4111-8111-111111111111", actorUserId: "admin", targetUserId: "target", reason: "offboarding", cutoffAt: "2026-10-26T01:00:00.000Z", createdAt: "2026-10-26T01:00:00.000Z", sessionsRevoked: 2, boardKeysRevoked: 3 };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear(); mocks.list.mockReset().mockResolvedValue([]); mocks.revoke.mockReset().mockImplementation(async (_id, input) => ({ ...receipt, requestId: input.requestId }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });
it.each(["en", "zh-CN", "es", "ja"])("requires exact confirmation and renders bounded scope in %s", async locale => {
  await i18n.changeLanguage(locale); await render();
  expect(host.textContent).toContain(i18n.t("authRevocation.warning")); expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  await confirm("wrong"); expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  await confirm(); await act(async () => { host.querySelector<HTMLButtonElement>("button")!.click(); host.querySelector<HTMLButtonElement>("button")!.click(); }); await flush();
  expect(mocks.revoke).toHaveBeenCalledTimes(1); expect(mocks.revoke.mock.calls[0][1].confirmUserId).toBe("target");
  expect(host.textContent).toContain(i18n.t("authRevocation.success", { sessions: "2", keys: "3" }));
});
it("retries the persisted request after an uncertain result and remount, never automatically", async () => {
  mocks.revoke.mockRejectedValueOnce(new Error("response lost")); await render(); await confirm();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click()); await flush();
  const input = mocks.revoke.mock.calls[0][1]; expect(host.querySelector('[role="alert"]')?.textContent).toContain(i18n.t("authRevocation.uncertain"));
  await render("other"); expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("");
  await render(); expect(mocks.revoke).toHaveBeenCalledTimes(1); expect(host.textContent).toContain(input.requestId);
  await confirm(); await act(async () => host.querySelector<HTMLButtonElement>("button")!.click()); await flush();
  expect(mocks.revoke.mock.calls[1]).toEqual(["target", input]);
});
it("uses history to recover the receipt for a prior request without resubmission", async () => {
  sessionStorage.setItem("mimouse:auth-revocation:admin:target", JSON.stringify({ requestId: receipt.requestId, confirmUserId: "target", reason: "offboarding" }));
  mocks.list.mockResolvedValue([receipt]); await render(); expect(host.querySelector("input")).toBeNull(); expect(mocks.revoke).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click()); expect(host.querySelector("input")).not.toBeNull(); expect(sessionStorage.getItem("mimouse:auth-revocation:admin:target")).toBeNull();
});
it("does not carry an earlier target confirmation or receipt to another target", async () => {
  await render(); await confirm(); await render("other"); expect(host.querySelector<HTMLInputElement>("input")!.value).toBe(""); expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true); expect(mocks.revoke).not.toHaveBeenCalled();
});
