// @vitest-environment jsdom
import "@/i18n/agent-setup-test-resources";
import "@/i18n/agent-setup-login-test-resources";
import { i18n } from "@/i18n";
import { act, StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLocalAiLogin } from "./useLocalAiLogin";
import { LocalProviderLoginInstructions } from "../AdapterLoginChrome";

const api = vi.hoisted(() => ({ startLocalLogin: vi.fn(), checkLocalLogin: vi.fn(), submitLocalLoginCode: vi.fn(), cancelLocalLogin: vi.fn(), connectLocal: vi.fn() }));
vi.mock("@/api/ai-connections", () => ({ aiConnectionsApi: api }));
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks();
  api.startLocalLogin.mockImplementation(async () => ({ sessionId: "attempt-1", expiresAt: "2099-01-01T00:00:00Z" }));
  api.checkLocalLogin.mockResolvedValue({ status: "sign_in_required", authorizationUrl: "https://auth.openai.com/codex/device", code: "ABCD-12345" });
  api.submitLocalLoginCode.mockResolvedValue({ ok: true });
  api.cancelLocalLogin.mockResolvedValue({});
  api.connectLocal.mockResolvedValue({ connectionId: "connection", grantId: "grant" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { flushSync(() => root.unmount()); host.remove(); vi.useRealTimers(); await i18n.changeLanguage("en"); });
function Harness({ name = "Account", provider = "openai", enabled = true }: { name?: string; provider?: "anthropic" | "openai"; enabled?: boolean }) {
  const login = useLocalAiLogin("company", { provider, method: "subscription", name, ownership: "personal", agentIds: [], allAgents: true }, enabled);
  return <><LocalProviderLoginInstructions adapterType={provider === "anthropic" ? "claude_local" : "codex_local"} login={login} /><button onClick={() => void login.connect()}>Connect</button></>;
}
it("checks once under StrictMode, preserves renaming and navigation, and cancels only on explicit retry", async () => {
  flushSync(() => root.render(<StrictMode><Harness name="First name" /></StrictMode>));
  await vi.waitFor(() => expect(host.textContent).toContain("ABCD-12345"));
  expect(api.startLocalLogin).toHaveBeenCalledTimes(1);
  expect(api.checkLocalLogin).toHaveBeenCalledTimes(1);
  expect(api.cancelLocalLogin).not.toHaveBeenCalled();
  flushSync(() => root.render(<StrictMode><Harness name="Renamed" /></StrictMode>));
  expect(api.startLocalLogin).toHaveBeenCalledTimes(1);
  flushSync(() => root.render(<StrictMode><Harness name="Renamed" enabled={false} /></StrictMode>));
  flushSync(() => root.render(<StrictMode><Harness name="Renamed" /></StrictMode>));
  await vi.waitFor(() => expect(host.textContent).toContain("ABCD-12345"));
  expect(api.cancelLocalLogin).not.toHaveBeenCalled();
  flushSync(() => Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Connect')!.click());
  await vi.waitFor(() => expect(api.connectLocal).toHaveBeenCalledWith("company", expect.objectContaining({ name: "Renamed", localSessionId: "attempt-1" })));
  flushSync(() => Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Start sign-in again')!.click());
  await vi.waitFor(() => expect(api.startLocalLogin).toHaveBeenCalledTimes(2));
  expect(api.cancelLocalLogin).toHaveBeenCalledTimes(1);
  expect(api.cancelLocalLogin.mock.invocationCallOrder[0]).toBeLessThan(api.startLocalLogin.mock.invocationCallOrder[1]);
});
it.each(["anthropic", "openai"] as const)("detects an already-signed-in %s account before showing instructions, and does not save it until Connect", async provider => {
  api.checkLocalLogin.mockResolvedValue({ status: "ready" });
  flushSync(() => root.render(<Harness provider={provider} />));
  expect(host.textContent).toContain("Preparing sign-in");
  await vi.waitFor(() => expect(host.textContent).toContain("is signed in"));
  expect(host.textContent).not.toContain("Run this in a terminal");
  expect(api.connectLocal).not.toHaveBeenCalled();
  expect(api.startLocalLogin).toHaveBeenCalledTimes(1);
});
it("detects browser completion on focus without needing a Connect attempt", async () => {
  flushSync(() => root.render(<Harness />));
  await vi.waitFor(() => expect(host.textContent).toContain("ABCD-12345"));
  api.checkLocalLogin.mockResolvedValue({ status: "ready" });
  window.dispatchEvent(new Event('focus'));
  await vi.waitFor(() => expect(host.textContent).toContain("is signed in"));
  expect(host.textContent).not.toContain("ABCD-12345");
  expect(api.connectLocal).not.toHaveBeenCalled();
});
it("keeps a browser sign-in attempt alive after leaving the page", async () => {
  flushSync(() => root.render(<Harness />));
  await vi.waitFor(() => expect(host.textContent).toContain("ABCD-12345"));
  flushSync(() => root.render(<div>Another page</div>));
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(api.cancelLocalLogin).not.toHaveBeenCalled();
  const checks = api.checkLocalLogin.mock.calls.length;
  window.dispatchEvent(new Event('focus'));
  expect(api.checkLocalLogin).toHaveBeenCalledTimes(checks);
});

it("explicit retry can replace an attempt opened in another authentication host", async () => {
  api.startLocalLogin.mockRejectedValueOnce(new Error("Another sign-in is still open."));
  flushSync(() => root.render(<Harness />));
  await vi.waitFor(() => expect(host.textContent).toContain("Another sign-in"));
  flushSync(() => Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Start sign-in again')!.click());
  await vi.waitFor(() => expect(host.textContent).toContain("ABCD-12345"));
  expect(api.startLocalLogin).toHaveBeenLastCalledWith("company", expect.objectContaining({ restart: true }));
});

it("submits a Claude browser code through the owned local attempt", async () => {
  api.checkLocalLogin.mockResolvedValue({ status: "sign_in_required", authorizationUrl: "https://claude.ai/oauth/authorize?client_id=test" });
  flushSync(() => root.render(<Harness provider="anthropic" />));
  await vi.waitFor(() => expect(host.querySelector('input[aria-label="Authorization code"]')).not.toBeNull());
  const input = host.querySelector('input[aria-label="Authorization code"]') as HTMLInputElement;
  flushSync(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "fixture-code");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  flushSync(() => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Submit code")?.click());
  await vi.waitFor(() => expect(api.submitLocalLoginCode).toHaveBeenCalledWith("company", "attempt-1", "fixture-code"));
  expect(host.textContent).not.toContain("claude auth login");
});

it("hides a failed device prompt and lets the user restart sign-in", async () => {
  api.checkLocalLogin.mockResolvedValue({ status: "sign_in_required", authorizationUrl: "https://auth.openai.com/codex/device", code: "OLD-CODE", error: "Sign-in ended. Start sign-in again." });
  flushSync(() => root.render(<Harness />));
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain("Sign-in ended"));
  expect(host.textContent).not.toContain("OLD-CODE");
  expect(host.querySelector('a[href="https://auth.openai.com/codex/device"]')).toBeNull();
  api.checkLocalLogin.mockResolvedValue({ status: "sign_in_required", authorizationUrl: "https://auth.openai.com/codex/device", code: "NEW-CODE" });
  flushSync(() => Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Start sign-in again")!.click());
  await vi.waitFor(() => expect(host.textContent).toContain("NEW-CODE"));
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it.each(["expired", "fallback", "external"])("retranslates local %s errors without restarting sign-in or checks", async kind => {
  await i18n.changeLanguage("ja");
  if (kind === "expired") api.checkLocalLogin.mockResolvedValue({ status: "expired" });
  else api.checkLocalLogin.mockRejectedValue(kind === "external" ? new Error("Provider raw diagnostic") : null);
  flushSync(() => root.render(<Harness />));
  const message = () => kind === "external" ? "Provider raw diagnostic" : i18n.t(`agentSetupLoginUi.${kind === "expired" ? "localExpired" : "localCheckFailed"}`);
  await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain(message()));
  await act(async () => { await i18n.changeLanguage("zh-CN"); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(message());
  expect(api.startLocalLogin).toHaveBeenCalledTimes(1);
  expect(api.checkLocalLogin).toHaveBeenCalledTimes(1);
  expect(api.cancelLocalLogin).not.toHaveBeenCalled();
  expect(api.connectLocal).not.toHaveBeenCalled();
});

it("keeps the existing local polling deadline and prompt across a language switch", async () => {
  vi.useFakeTimers();
  await i18n.changeLanguage("ja");
  await act(async () => root.render(<Harness />));
  expect(host.textContent).toContain("ABCD-12345");
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  await act(async () => { await i18n.changeLanguage("zh-CN"); });
  expect(api.startLocalLogin).toHaveBeenCalledTimes(1);
  expect(api.checkLocalLogin).toHaveBeenCalledTimes(1);
  expect(api.cancelLocalLogin).not.toHaveBeenCalled();
  expect(host.textContent).toContain("ABCD-12345");
  expect(host.querySelector('a[href="https://auth.openai.com/codex/device"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(api.checkLocalLogin).toHaveBeenCalledTimes(2);
  expect(api.startLocalLogin).toHaveBeenCalledTimes(1);
  expect(api.connectLocal).not.toHaveBeenCalled();
});

it("retranslates sanitized submit errors without repeating the authorization request", async () => {
  await i18n.changeLanguage("ja");
  api.checkLocalLogin.mockResolvedValue({ status: "sign_in_required", authorizationUrl: "https://claude.ai/oauth/authorize?client_id=test" });
  api.submitLocalLoginCode.mockRejectedValue(new Error("private-provider-diagnostic"));
  flushSync(() => root.render(<Harness provider="anthropic" />));
  await vi.waitFor(() => expect(host.querySelector('input')).not.toBeNull());
  const input = host.querySelector('input')!;
  flushSync(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "fixture-code");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  flushSync(() => Array.from(host.querySelectorAll('button')).find(button => button.textContent === i18n.t("agentSetupSharedUi.submitCode"))!.click());
  await vi.waitFor(() => expect(host.textContent).toContain(i18n.t("agentSetupLoginUi.localSubmitFailed")));
  await act(async () => { await i18n.changeLanguage("zh-CN"); });
  expect(host.textContent).toContain(i18n.t("agentSetupLoginUi.localSubmitFailed"));
  expect(host.textContent).not.toContain("private-provider-diagnostic");
  expect(api.submitLocalLoginCode).toHaveBeenCalledExactlyOnceWith("company", "attempt-1", "fixture-code");
  expect(api.checkLocalLogin).toHaveBeenCalledTimes(1);
  expect(api.startLocalLogin).toHaveBeenCalledTimes(1);
  expect(api.cancelLocalLogin).not.toHaveBeenCalled();
  expect(api.connectLocal).not.toHaveBeenCalled();
});
