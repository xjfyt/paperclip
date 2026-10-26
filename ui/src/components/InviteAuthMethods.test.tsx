// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CloudInstanceHealthStatus } from "@/api/health";
import { i18n } from "@/i18n";
import { InviteAuthMethods } from "./InviteAuthMethods";
const mocks = vi.hoisted(() => ({ capabilities: vi.fn(), signIn: vi.fn(), navigate: vi.fn() }));
vi.mock("@/api/auth", () => ({ authApi: { capabilities: () => mocks.capabilities(), signInCasdoor: (path: string) => mocks.signIn(path) } }));
vi.mock("@/lib/browserNavigation", () => ({ navigateTopLevel: (path: string) => mocks.navigate(path) }));
vi.mock("./CloudSignIn", () => ({ CloudSignIn: ({ returnTo }: { returnTo: string }) => <div data-testid="cloud-auth">{returnTo}</div> }));
let host: HTMLDivElement, root: Root, client: QueryClient;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); }
async function render(token = "pcp_invite_test", cloud?: CloudInstanceHealthStatus) {
  await act(async () => root.render(<QueryClientProvider client={client}><InviteAuthMethods token={token} cloud={cloud}><input aria-label="Password" /></InviteAuthMethods></QueryClientProvider>));
  await flush();
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.capabilities.mockReset().mockResolvedValue({ password: false, providers: [{ id: "casdoor" }] });
  mocks.signIn.mockReset().mockResolvedValue("http://localhost:3102/authorize"); mocks.navigate.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });
it.each(["en", "zh-CN", "es", "ja"])("offers localized SSO without a password bypass in %s", async locale => {
  await i18n.changeLanguage(locale); await render();
  expect(host.textContent).toContain(i18n.t("inviteAuth.ssoOnly")); expect(host.querySelector("input")).toBeNull();
  const button = [...host.querySelectorAll("button")].find(node => node.textContent === i18n.t("auth.casdoor"))!;
  await act(async () => { button.click(); button.click(); }); await flush();
  expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith("/invite/pcp_invite_test"); expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("http://localhost:3102/authorize");
});
it("keeps password hidden during capability loading and error, with explicit retry", async () => {
  let reject!: (error: Error) => void;
  mocks.capabilities.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; })); await render();
  expect(host.querySelector('[role="status"]')).not.toBeNull(); expect(host.querySelector("input")).toBeNull();
  await act(async () => reject(new Error("offline"))); await flush();
  expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.querySelector("input")).toBeNull();
  mocks.capabilities.mockResolvedValue({ password: true, providers: [] });
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click()); await flush();
  expect(host.querySelector("input")).not.toBeNull(); expect(mocks.signIn).not.toHaveBeenCalled();
});
it("shows failure without navigating or exposing password fallback in SSO-only mode", async () => {
  mocks.signIn.mockRejectedValue(new Error("provider unavailable")); await render();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click()); await flush();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("auth.failed")); expect(host.querySelector("input")).toBeNull(); expect(mocks.navigate).not.toHaveBeenCalled();
});
it("routes hosted invites to hosted authentication without querying self-hosted capabilities", async () => {
  await render("pcp_invite_cloud", { managed: true, managedBy: "paperclip-cloud", cloudBaseUrl: "https://cloud.example.invalid", stackSlug: "fixture" });
  expect(host.querySelector('[data-testid="cloud-auth"]')?.textContent).toBe("/invite/pcp_invite_cloud"); expect(mocks.capabilities).not.toHaveBeenCalled(); expect(host.querySelector("input")).toBeNull();
});
it("does not redirect an older invitation after navigation to a new invitation", async () => {
  let resolve!: (url: string) => void; mocks.signIn.mockReturnValue(new Promise(done => { resolve = done; }));
  await render(); await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  await render("pcp_invite_new"); await act(async () => resolve("http://localhost:3102/authorize")); await flush(); expect(mocks.navigate).not.toHaveBeenCalled();
});
it("shows an administrator recovery message if no method is enabled", async () => {
  mocks.capabilities.mockResolvedValue({ password: false, providers: [] }); await render(); expect(host.textContent).toContain(i18n.t("inviteAuth.noMethod")); expect(host.querySelector("input")).toBeNull();
});
