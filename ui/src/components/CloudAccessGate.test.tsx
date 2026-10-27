// @vitest-environment jsdom

import { i18n, shellNavigationMessages } from "@/i18n/shell-navigation-test-resources";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { focusManager, QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudAccessGate } from "./CloudAccessGate";
import { queryKeys } from "@/lib/queryKeys";
import { ApiUnavailableError } from "@/api/response";
import "@/i18n/auth-test-resources";
import { clearLocalSignOutNotice, hasLocalSignOutNotice, rememberLocalSignOut } from "@/lib/local-sign-out-notice";

vi.mock("@/lib/router", () => ({
  useLocation: () => ({ pathname: "/CON/agents/conan/instructions", search: "?tab=edit", hash: "#draft" }),
  Navigate: ({ to }: { to: string }) => <div data-redirect={to} />,
  Outlet: () => <textarea aria-label="Instructions" defaultValue="Unsaved instructions" />,
}));
vi.mock("@/components/AnimatedPaperclipIcon", () => ({ PaperclipLoading: () => <div>Loading…</div> }));
vi.mock("@/components/CloudSignIn", () => ({ CloudSignIn: () => <div>Sign in to Cloud</div> }));
vi.mock("@/components/BootstrapPendingPage", () => ({ BootstrapPendingPage: () => <div>Set up instance</div> }));

const responses: Record<string, unknown> = {
  "/api/health": { status: "ok", deploymentMode: "authenticated", bootstrapStatus: "ready" },
  "/api/auth/get-session": {
    session: { id: "session", userId: "user" },
    user: { id: "user", name: "Operator", email: "operator@example.com", image: null },
    sentryDsn: null,
  },
  "/api/cli-auth/me": { isInstanceAdmin: false, companyIds: ["company"] },
};
const checks = [
  ["/api/health", queryKeys.health],
  ["/api/auth/get-session", queryKeys.auth.session],
  ["/api/cli-auth/me", queryKeys.access.currentBoardAccess],
] as const;

describe("CloudAccessGate restart recovery", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  let failingPath: string | null;
  let failure: () => Response;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    clearLocalSignOutNotice();
    vi.useFakeTimers();
    failingPath = null;
    failure = () => new Response("<!doctype html><h1>Restarting</h1>", { status: 200 });
    fetchMock.mockImplementation(async (path: string) => {
      if (path === failingPath) return failure();
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return Response.json(responses[path]);
    });
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  });

  afterEach(async () => {
    flushSync(() => root.unmount());
    client.clear();
    focusManager.setFocused(undefined);
    container.remove();
    vi.useRealTimers();
    await i18n.changeLanguage("en");
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    clearLocalSignOutNotice();
  });

  async function flushReact() {
    await vi.advanceTimersByTimeAsync(20);
    flushSync(() => {});
  }

  async function render() {
    flushSync(() => root.render(<QueryClientProvider client={client}><CloudAccessGate /></QueryClientProvider>));
    await flushReact();
  }

  it("keeps completed logout visible when health fails before the auth redirect", async () => {
    rememberLocalSignOut();
    failingPath = "/api/health";
    await render();
    expect(container.textContent).toContain("Signed out of this app");
    expect(container.textContent).toContain("global sign-out is unconfirmed");
    expect(container.textContent).toContain("Reconnecting");
  });

  it("clears a previous logout notice after confirmed login returning directly to the board", async () => {
    rememberLocalSignOut();
    await render();
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(hasLocalSignOutNotice()).toBe(false);
  });

  it.each(["pending", "error", "null"])("ignores warm cached login while fresh session verification is %s", async outcome => {
    client.setQueryData(queryKeys.health, responses["/api/health"]);
    client.setQueryData(queryKeys.auth.session, responses["/api/auth/get-session"]);
    fetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/auth/get-session") {
        if (outcome === "pending") return new Promise(() => {});
        if (outcome === "error") throw new Error("offline");
        return Response.json(null);
      }
      return Response.json(responses[path]);
    });
    rememberLocalSignOut();
    await render();
    expect(hasLocalSignOutNotice()).toBe(true);
    expect(client.getQueryData(queryKeys.auth.session)).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
    if (outcome === "null") expect(container.querySelector("[data-redirect]")).not.toBeNull();
    else expect(container.textContent).toContain("global sign-out is unconfirmed");
  });

  it("only clears a warm-session notice after a fresh nonempty session response", async () => {
    client.setQueryData(queryKeys.health, responses["/api/health"]);
    client.setQueryData(queryKeys.auth.session, responses["/api/auth/get-session"]);
    let finish!: (value: Response) => void;
    fetchMock.mockImplementation(async (path: string) => path === "/api/auth/get-session"
      ? new Promise<Response>(resolve => { finish = resolve; }) : Response.json(responses[path]));
    rememberLocalSignOut();
    await render();
    expect(hasLocalSignOutNotice()).toBe(true);
    expect(container.querySelector("textarea")).toBeNull();
    finish(Response.json(responses["/api/auth/get-session"]));
    await flushReact();
    expect(hasLocalSignOutNotice()).toBe(false);
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it.each(checks)("recovers from an HTML response on %s without navigating", async (path) => {
    failingPath = path;
    await render();
    expect(container.textContent).toContain("Reconnecting to Paperclip");
    expect(container.textContent).not.toContain("Unexpected token");
    expect(container.querySelector("[data-redirect]")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
    const callsBeforeRetry = fetchMock.mock.calls.filter(([url]) => url === path).length;
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchMock.mock.calls.filter(([url]) => url === path)).toHaveLength(callsBeforeRetry);

    failingPath = null;
    await vi.advanceTimersByTimeAsync(1_100);
    await flushReact();
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.textContent).not.toContain("Reconnecting");
    const callsAfterRecovery = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterRecovery);
    expect(fetchMock.mock.calls.every(([, init]) => !init.method || init.method === "GET")).toBe(true);
  });

  it.each(checks)("preserves a mounted editor through an outage on %s", async (path, queryKey) => {
    await render();
    const editor = container.querySelector("textarea")!;
    editor.value = "Keep my unsaved changes";
    failingPath = path;
    failure = () => new Response("Bad gateway", { status: 502 });
    await client.refetchQueries({ queryKey });
    await flushReact();
    expect(container.querySelector("textarea")).toBe(editor);
    expect(editor.value).toBe("Keep my unsaved changes");
    expect(container.textContent).toContain("Reconnecting automatically");

    failingPath = null;
    await vi.advanceTimersByTimeAsync(5_100);
    await flushReact();
    expect(container.querySelector("textarea")).toBe(editor);
    expect(editor.value).toBe("Keep my unsaved changes");
    expect(container.textContent).not.toContain("Reconnecting");
  });

  it.each(checks)("keeps retrying %s while the tab is hidden", async (path) => {
    focusManager.setFocused(false);
    failingPath = path;
    await render();
    expect(container.textContent).toContain("Reconnecting to Paperclip");
    failingPath = null;
    await vi.advanceTimersByTimeAsync(5_100);
    await flushReact();
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("waits for ready health before opening the board even when access checks succeed", async () => {
    failingPath = "/api/health";
    failure = () => Response.json({ status: "starting", deploymentMode: "authenticated", bootstrapStatus: "ready" });
    await render();
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain("Reconnecting");
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(checks.map(([path]) => path));
    await vi.advanceTimersByTimeAsync(5_100);
    expect(container.querySelector("textarea")).toBeNull();
    failingPath = null;
    await vi.advanceTimersByTimeAsync(5_100);
    await flushReact();
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.textContent).not.toContain("Reconnecting");
  });

  it("supports manual retry while startup health is pending", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ status: "starting", deploymentMode: "local_trusted" }));
    await render();
    expect(container.querySelector("textarea")).toBeNull();
    container.querySelector("button")!.click();
    await flushReact();
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("preserves an open editor while health reports startup recovery", async () => {
    await render();
    const editor = container.querySelector("textarea")!;
    editor.value = "Keep my unsaved changes";
    fetchMock.mockResolvedValueOnce(Response.json({
      status: "starting", deploymentMode: "authenticated", bootstrapStatus: "ready",
    }));
    await client.refetchQueries({ queryKey: queryKeys.health });
    await flushReact();
    expect(container.querySelector("textarea")).toBe(editor);
    expect(container.textContent).toContain("Reconnecting automatically");
    await vi.advanceTimersByTimeAsync(5_100);
    await flushReact();
    expect(container.querySelector("textarea")).toBe(editor);
    expect(editor.value).toBe("Keep my unsaved changes");
    expect(container.textContent).not.toContain("Reconnecting");
  });

  it("offers immediate retry while waiting for the next automatic check", async () => {
    failingPath = "/api/health";
    await render();
    failingPath = null;
    container.querySelector("button")!.click();
    await flushReact();
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("retries a dropped connection and opens the requested page when it returns", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await render();
    expect(container.textContent).toContain("Reconnecting to Paperclip");
    await vi.advanceTimersByTimeAsync(5_100);
    await flushReact();
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.querySelector("[data-redirect]")).toBeNull();
  });

  it("refreshes other failed reads after access checks recover", async () => {
    const read = vi.fn().mockRejectedValueOnce(new ApiUnavailableError(503)).mockResolvedValue([]);
    const observer = new QueryObserver(client, { queryKey: ["companies", "test"], queryFn: read, retry: false });
    const unsubscribe = observer.subscribe(() => {});
    failingPath = "/api/health";
    await render();
    expect(read).toHaveBeenCalledTimes(1);
    failingPath = null;
    await vi.advanceTimersByTimeAsync(5_100);
    await flushReact();
    expect(read).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data).toEqual([]);
    unsubscribe();
  });

  it("fails closed for access denials even with cached access, and does not poll", async () => {
    await render();
    failingPath = "/api/cli-auth/me";
    failure = () => Response.json({ error: "Forbidden" }, { status: 403 });
    await client.refetchQueries({ queryKey: queryKeys.access.currentBoardAccess });
    await flushReact();
    expect(container.textContent).toContain("Unable to load Paperclip");
    expect(container.textContent).not.toContain("reconnect automatically");
    expect(container.querySelector("textarea")).toBeNull();
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    failingPath = null;
    container.querySelector("button")!.click();
    await flushReact();
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("still redirects to sign-in when the session expires", async () => {
    await render();
    failingPath = "/api/auth/get-session";
    failure = () => Response.json({ error: "unauthorized" }, { status: 401 });
    await client.refetchQueries({ queryKey: queryKeys.auth.session });
    await flushReact();
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector("[data-redirect]")?.getAttribute("data-redirect"))
      .toBe("/auth?next=%2FCON%2Fagents%2Fconan%2Finstructions%3Ftab%3Dedit");
  });
  describe.each(Object.entries(shellNavigationMessages))("reconnect banner localization (%s)", (locale, messages) => {
    it.each(checks)("keeps the outlet draft and retry schedule during a language switch after %s fails", async (path, queryKey) => {
      await render();
      const editor = container.querySelector("textarea")!;
      editor.value = "未保存の草稿 / 项目 <raw>";
      editor.focus();
      editor.setSelectionRange(2, 5);
      failingPath = path;
      failure = () => new Response("Bad gateway", { status: 502 });
      await client.refetchQueries({ queryKey });
      await flushReact();
      const callsBeforeSwitch = fetchMock.mock.calls.length;
      await i18n.changeLanguage(locale);
      await flushReact();
      expect(container.querySelector('[role="status"]')?.textContent).toBe(messages.reconnectingBanner);
      expect(container.querySelector("textarea")).toBe(editor);
      expect(editor.value).toBe("未保存の草稿 / 项目 <raw>");
      expect(document.activeElement).toBe(editor);
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 5]);
      expect(fetchMock).toHaveBeenCalledTimes(callsBeforeSwitch);
      expect(container.querySelector("[data-redirect]")).toBeNull();
      expect(fetchMock.mock.calls.every(([, init]) => !init.method || init.method === "GET")).toBe(true);
      failingPath = null;
      await vi.advanceTimersByTimeAsync(5_100);
      await flushReact();
      expect(container.querySelector('[role="status"]')).toBeNull();
      expect(container.querySelector("textarea")).toBe(editor);
      expect(editor.value).toBe("未保存の草稿 / 项目 <raw>");
    });
  });

});
