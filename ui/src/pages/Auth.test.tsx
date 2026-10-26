// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../lib/queryKeys";
import { AuthPage } from "./Auth";
import "@/i18n/auth-test-resources";
import { i18n } from "@/i18n";
import { clearLocalSignOutNotice, hasLocalSignOutNotice, rememberLocalSignOut } from "@/lib/local-sign-out-notice";

const capabilitiesMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const signInEmailMock = vi.hoisted(() => vi.fn());
const signUpEmailMock = vi.hoisted(() => vi.fn());
const healthMock = vi.hoisted(() => vi.fn());
const beginCloudSignInMock = vi.hoisted(() => vi.fn());

vi.mock("../api/health", () => ({ healthApi: { get: () => healthMock() } }));
vi.mock("@/lib/cloud-sign-in", () => ({
  beginCloudSignIn: (url: string) => beginCloudSignInMock(url),
  clearCloudSignInAttempt: vi.fn(),
}));

vi.mock("../api/auth", () => ({
  authApi: {
    capabilities: () => capabilitiesMock(),
    signInCasdoor: async () => "https://id.example/authorize",
    getSession: () => getSessionMock(),
    signInEmail: (input: unknown) => signInEmailMock(input),
    signUpEmail: (input: unknown) => signUpEmailMock(input),
  },
}));

// The ASCII art animation drives a canvas/requestAnimationFrame loop that adds
// nothing to these assertions, so stub it out.
vi.mock("@/components/AsciiArtAnimation", () => ({
  AsciiArtAnimation: () => null,
}));

// The auth page renders a ThemeToggle, which reads ThemeContext. The provider
// lives in main.tsx (above the router), so mock the hook here the same way
// SidebarAccountMenu.test.tsx does.
vi.mock("../context/ThemeContext", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

// The router's navigate wrapper reads the active company prefix from context.
vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompany: null,
    selectedCompanyId: null,
    companies: [],
    selectionSource: "manual",
    loading: false,
    error: null,
    setSelectedCompanyId: vi.fn(),
    reloadCompanies: vi.fn(),
    createCompany: vi.fn(),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
  flushSync(() => {});
}

function renderAuthPage(container: HTMLElement) {
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return { root, queryClient };
}

describe("AuthPage", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    clearLocalSignOutNotice();
    void i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.appendChild(container);
    capabilitiesMock.mockResolvedValue({ password: true, providers: [] });
    getSessionMock.mockResolvedValue(null);
    healthMock.mockResolvedValue({ status: "ok", deploymentMode: "authenticated" });
    beginCloudSignInMock.mockReturnValue(true);
    signInEmailMock.mockResolvedValue(undefined);
    signUpEmailMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearLocalSignOutNotice();
    void i18n.changeLanguage("en");
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function mount(path = "/auth", warmSession?: unknown) {
    const { root, queryClient } = renderAuthPage(container);
    if (warmSession) queryClient.setQueryData(queryKeys.auth.session, warmSession);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <QueryClientProvider client={queryClient}>
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    await flushReact();
    await flushReact();
    return { root, queryClient };
  }

  it.each(["https://my.paperclip.app", "https://my-staging.paperclip.app"])("recovers Cloud auth through %s without rendering an instance form", async (origin) => {
    rememberLocalSignOut();
    healthMock.mockResolvedValue({ cloud: { managed: true, managedBy: "paperclip-cloud", cloudBaseUrl: origin, stackSlug: "team" } });
    const { root } = await mount("/auth?next=%2FTEST%2Fissues%2FTEST-1%3Ftab%3Dactivity%23comment");
    await vi.waitFor(() => expect(beginCloudSignInMock).toHaveBeenCalledTimes(1));
    const target = new URL(beginCloudSignInMock.mock.calls[0][0]);
    expect(target.origin).toBe(origin);
    expect(target.pathname).toBe("/v1/stacks/team/entry-redirect");
    expect(target.searchParams.get("returnTo")).toBe("/TEST/issues/TEST-1?tab=activity#comment");
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("Signed out of this app");
    await act(() => root.unmount());
  });

  it.each([
    ["en", "Signed out of this app.", "global sign-out is unconfirmed"],
    ["zh-CN", "已退出此应用。", "全局退出尚未确认"],
    ["es", "Se ha cerrado la sesión de esta aplicación.", "no se ha confirmado el cierre de sesión global"],
    ["ja", "このアプリからログアウトしました。", "全体のログアウトは未確認"],
  ])("shows separate local/unknown-global results in %s", async (locale, local, global) => {
    await i18n.changeLanguage(locale);
    rememberLocalSignOut();
    const { root } = await mount("/auth?global_logout=success&returnURL=https%3A%2F%2Fid.example");
    expect(container.querySelector('[role="status"]')?.textContent).toContain(local);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(global);
    expect(container.textContent).not.toContain("auth.globalSignOutUnconfirmed");
    await act(() => root.unmount());
  });

  it("does not invent a sign-out result from query parameters", async () => {
    const { root } = await mount("/auth?logout=success&global_logout=success&localSignOut=complete");
    expect(container.textContent).not.toContain("Signed out of this app");
    expect(hasLocalSignOutNotice()).toBe(false);
    await act(() => root.unmount());
  });

  it("keeps the notice across a return/revisit and clears it only when dismissed", async () => {
    rememberLocalSignOut();
    const first = await mount();
    expect(container.textContent).toContain("global sign-out is unconfirmed");
    await act(() => first.root.unmount());
    const returned = await mount();
    expect(container.textContent).toContain("global sign-out is unconfirmed");
    const dismiss = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Dismiss sign-out notice");
    await act(() => dismiss?.click());
    expect(hasLocalSignOutNotice()).toBe(false);
    expect(container.textContent).not.toContain("Signed out of this app");
    await act(() => returned.root.unmount());
    const revisited = await mount();
    expect(container.textContent).not.toContain("Signed out of this app");
    await act(() => revisited.root.unmount());
  });

  it.each(["health", "session", "capabilities"])("keeps local completion visible if %s is unavailable after returning", async service => {
    rememberLocalSignOut();
    const mock = service === "health" ? healthMock : service === "session" ? getSessionMock : capabilitiesMock;
    mock.mockRejectedValue(new Error("offline"));
    const { root } = await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("Unable to check sign-in"));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Signed out of this app");
    expect(container.textContent).toContain("global sign-out is unconfirmed");
    expect(container.querySelector("form")).toBeNull();
    await act(() => root.unmount());
  });

  it("clears the old notice after a confirmed authenticated session", async () => {
    rememberLocalSignOut();
    getSessionMock.mockResolvedValue({ session: { id: "new-session" }, user: { id: "new-user" } });
    const { root } = await mount();
    await vi.waitFor(() => expect(hasLocalSignOutNotice()).toBe(false));
    expect(container.textContent).not.toContain("Signed out of this app");
    await act(() => root.unmount());
  });

  it.each(["pending", "error", "null"])("does not let a warm old session clear/hide the notice when fresh auth is %s", async outcome => {
    const oldSession = { session: { id: "old-session" }, user: { id: "old-user" } };
    rememberLocalSignOut();
    if (outcome === "pending") getSessionMock.mockReturnValue(new Promise(() => {}));
    if (outcome === "error") getSessionMock.mockRejectedValue(new Error("offline"));
    if (outcome === "null") getSessionMock.mockResolvedValue(null);
    const { root, queryClient } = await mount("/auth", oldSession);
    expect(hasLocalSignOutNotice()).toBe(true);
    expect(container.textContent).toContain("global sign-out is unconfirmed");
    expect(queryClient.getQueryData(queryKeys.auth.session)).toBeNull();
    if (outcome === "error") expect(container.textContent).toContain("Unable to check sign-in");
    if (outcome === "null") expect(container.querySelector("form")).not.toBeNull();
    await act(() => root.unmount());
  });

  it("replaces a warm old session and clears the notice only after the fresh login response", async () => {
    const oldSession = { session: { id: "old-session" }, user: { id: "old-user" } };
    const newSession = { session: { id: "new-session" }, user: { id: "new-user" } };
    let finish!: (value: unknown) => void;
    getSessionMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    rememberLocalSignOut();
    const { root, queryClient } = await mount("/auth", oldSession);
    expect(hasLocalSignOutNotice()).toBe(true);
    finish(newSession);
    await vi.waitFor(() => expect(hasLocalSignOutNotice()).toBe(false));
    expect(queryClient.getQueryData(queryKeys.auth.session)).toEqual(newSession);
    await act(() => root.unmount());
  });

  it("does not clear a warm Cloud session while deployment metadata is still unknown", async () => {
    const oldSession = { session: { id: "cloud-session" }, user: { id: "cloud-user" } };
    let finishHealth!: (value: unknown) => void;
    healthMock.mockReturnValue(new Promise(resolve => { finishHealth = resolve; }));
    getSessionMock.mockReturnValue(new Promise(() => {}));
    rememberLocalSignOut();
    const { root, queryClient } = await mount("/auth", oldSession);
    expect(queryClient.getQueryData(queryKeys.auth.session)).toEqual(oldSession);
    expect(getSessionMock).not.toHaveBeenCalled();
    finishHealth({ cloud: { managed: true, managedBy: "paperclip-cloud", cloudBaseUrl: "https://my.paperclip.app", stackSlug: "team" } });
    await flushReact(); await flushReact();
    expect(queryClient.getQueryData(queryKeys.auth.session)).toEqual(oldSession);
    expect(hasLocalSignOutNotice()).toBe(true);
    expect(queryClient.getQueryCache().getAll().some(query => query.queryKey.includes("after-sign-out"))).toBe(false);
    await act(() => root.unmount());
  });

  it("never flashes a form while deployment metadata is loading", async () => {
    healthMock.mockReturnValue(new Promise(() => {}));
    const { root } = await mount();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Loading");
    await act(() => root.unmount());
  });

  it("fails closed when deployment metadata cannot be loaded", async () => {
    healthMock.mockRejectedValue(new Error("offline"));
    const { root } = await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("Unable to check sign-in"));
    expect(container.querySelector("form")).toBeNull();
    await act(() => root.unmount());
  });

  it("offers a manual Cloud retry after the automatic recovery limit", async () => {
    healthMock.mockResolvedValue({ cloud: { managed: true, managedBy: "paperclip-cloud", cloudBaseUrl: "https://my.paperclip.app", stackSlug: "team" } });
    beginCloudSignInMock.mockReturnValue(false);
    const { root } = await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("Continue to Paperclip Cloud"));
    expect(container.querySelector("form")).toBeNull();
    await act(() => root.unmount());
  });

  it("keeps incomplete Cloud configuration out of the instance form", async () => {
    healthMock.mockResolvedValue({ cloud: { managed: true, managedBy: "paperclip-cloud", cloudBaseUrl: null, stackSlug: null } });
    const { root } = await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("Cloud sign-in is unavailable"));
    expect(container.querySelector("form")).toBeNull();
    expect(beginCloudSignInMock).not.toHaveBeenCalled();
    await act(() => root.unmount());
  });

  it("exposes password-manager metadata and a11y attributes on the sign-in form", async () => {
    const { root } = await mount();

    const emailInput = container.querySelector('input[name="email"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;

    expect(emailInput).not.toBeNull();
    expect(passwordInput).not.toBeNull();

    // 1Password / password-manager recognition: identifier field is "username".
    expect(emailInput.getAttribute("autocomplete")).toBe("username");
    expect(emailInput.getAttribute("type")).toBe("email");
    expect(passwordInput.getAttribute("autocomplete")).toBe("current-password");

    // Stable ids/names for both inputs.
    expect(emailInput.id).toBe("email");
    expect(passwordInput.id).toBe("password");

    // Required + programmatic required state.
    expect(emailInput.required).toBe(true);
    expect(emailInput.getAttribute("aria-required")).toBe("true");
    expect(passwordInput.required).toBe(true);
    expect(passwordInput.getAttribute("aria-required")).toBe("true");

    // Programmatic labels.
    expect(container.querySelector('label[for="email"]')).not.toBeNull();
    expect(container.querySelector('label[for="password"]')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("uses new-password autocomplete in sign-up mode", async () => {
    const { root } = await mount();

    const createOne = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Create one",
    );
    expect(createOne).not.toBeNull();

    await act(async () => {
      createOne?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReact();

    const nameInput = container.querySelector('input[name="name"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.getAttribute("autocomplete")).toBe("name");
    expect(nameInput.required).toBe(true);
    expect(passwordInput.getAttribute("autocomplete")).toBe("new-password");

    await act(async () => {
      root.unmount();
    });
  });

  it("renders auth errors in an assertive alert region referenced by the inputs", async () => {
    const { root } = await mount();

    const inputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    const emailInput = container.querySelector('input[name="email"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;

    await act(async () => {
      inputValueSetter!.call(emailInput, "jane@example.com");
      emailInput.dispatchEvent(new Event("input", { bubbles: true }));
      inputValueSetter!.call(passwordInput, "wrongpass");
      passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    signInEmailMock.mockRejectedValueOnce(new Error("Invalid email or password"));

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushReact();
    await flushReact();

    const alert = container.querySelector('[role="alert"]') as HTMLElement;
    expect(alert).not.toBeNull();
    expect(alert.hasAttribute("aria-live")).toBe(false);
    expect(alert.textContent).toContain("Invalid email or password");

    const errorId = alert.id;
    expect(errorId.length).toBeGreaterThan(0);
    expect(emailInput.getAttribute("aria-describedby")).toBe(errorId);
    expect(emailInput.getAttribute("aria-invalid")).toBe("true");
    expect(passwordInput.getAttribute("aria-describedby")).toBe(errorId);
    expect(passwordInput.getAttribute("aria-invalid")).toBe("true");

    await act(async () => {
      root.unmount();
    });
  });

  it("invalidates anonymous health metadata after sign-in", async () => {
    const { root, queryClient } = await mount();
    queryClient.setQueryData(queryKeys.health, {
      status: "ok",
      deploymentMode: "authenticated",
    });

    const inputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    const emailInput = container.querySelector('input[name="email"]') as HTMLInputElement;
    const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement;

    await act(async () => {
      inputValueSetter!.call(emailInput, "jane@example.com");
      emailInput.dispatchEvent(new Event("input", { bubbles: true }));
      inputValueSetter!.call(passwordInput, "supersecret");
      passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushReact();
    await flushReact();

    expect(signInEmailMock).toHaveBeenCalledWith({
      email: "jane@example.com",
      password: "supersecret",
    });
    expect(healthMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
    });
  });
  it("does not advertise email/password in SSO-only mode", async () => {
    capabilitiesMock.mockResolvedValue({ password: false, providers: [{ id: "casdoor" }] });
    const { root } = await mount();
    expect(container.textContent).toContain("Use your organization’s single sign-on");
    expect(container.textContent).not.toContain("Use your email and password");
    expect(container.querySelector('input[name="password"]')).toBeNull();
    await act(async () => root.unmount());
  });

});
