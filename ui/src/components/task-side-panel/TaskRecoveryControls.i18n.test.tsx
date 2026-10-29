// @vitest-environment jsdom
import { type ComponentProps, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { CompanySkillDetail, TaskBrowser } from "@paperclipai/shared";
import { queryKeys } from "@/lib/queryKeys";
import { ApiError } from "@/api/client";
import { companySkillsApi } from "@/api/companySkills";
import { i18n, taskRecoveryControlsMessages } from "@/i18n/task-recovery-controls-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TaskSkillPanel } from "./TaskSkillPanel";
import { TaskBrowserFooter } from "./TaskBrowserFooter";

const navigate = vi.hoisted(() => vi.fn());
const location = vi.hoisted(() => ({ pathname: "/raw/task", search: "?view=raw" }));
const capture = vi.hoisted(() => vi.fn());
vi.mock("@/lib/router", () => ({ useNavigate: () => navigate, useLocation: () => location }));
vi.mock("@/lib/sentry", () => ({ captureBrowserException: capture }));
vi.mock("@/api/companySkills", () => ({ companySkillsApi: { detail: vi.fn() } }));
vi.mock("@/components/MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: ReactNode }) => <div data-markdown>{children}</div> }));

const languages = ["en", "zh-CN", "es", "ja"] as const;
const tr = (key: string, options: Record<string, unknown> = {}) => i18n.t(`taskRecoveryControlsUi.${key}`, options);
const rawError = "RAW_ERROR {{value}}: stopped_by_user <raw>";
const skill = {
  id: "skill/raw#1", slug: "RAW_skill-slug", name: "Customer 原始 skill {{name}}",
  description: "Raw description — 停止浏览", markdown: "---\nname: raw-frontmatter\n---\n# RAW Instructions\n{{do_not_translate}}",
  currentVersion: { revisionNumber: 42 },
} as CompanySkillDetail;
const now = Date.parse("2026-10-29T00:00:00Z");
const browser: TaskBrowser = {
  id: "RAW-browser", sessionId: "RAW-session", issueId: "RAW-task", status: "idle", runStatus: "completed",
  progress: null, error: rawError, costCents: 0, idleDeadline: new Date(now + 299_000).toISOString(),
  expiresAt: new Date(now + 600_000).toISOString(), createdAt: new Date(now).toISOString(),
};
let root: Root, container: HTMLDivElement, client: QueryClient;
function render(node: ReactNode) { flushSync(() => root.render(node)); }
async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0));
  flushSync(() => {});
}
async function locale(language: string) { await i18n.changeLanguage(language); await settle(); }
function button(label: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find(el => el.textContent?.trim() === label || el.getAttribute("aria-label") === label);
  expect(result, label).toBeDefined(); return result!;
}
function menuItem(label: string) {
  const result = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')]
    .find(el => el.textContent?.startsWith(label));
  expect(result, label).toBeDefined(); return result!;
}
async function openOptions() {
  button(tr("browser.options")).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  await settle();
}
async function openSizes() {
  await openOptions(); menuItem(tr("browser.size")).click(); await settle();
}
async function escapeMenu() {
  document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await settle();
}
function panel() {
  render(<QueryClientProvider client={client}><TaskSkillPanel companyId="RAW-company" skillId={skill.id} /></QueryClientProvider>);
}
type FooterProps = ComponentProps<typeof TaskBrowserFooter>;
type FooterOverrides = Omit<Partial<FooterProps>, "onControl" | "onReconnect" | "onResize"> & {
  onControl?: Mock<FooterProps["onControl"]>; onReconnect?: Mock<FooterProps["onReconnect"]>; onResize?: Mock<FooterProps["onResize"]>;
};
function footer(overrides: FooterOverrides = {}) {
  const props = { browser, now, onControl: vi.fn<FooterProps["onControl"]>(), onReconnect: vi.fn<FooterProps["onReconnect"]>(), onResize: vi.fn<FooterProps["onResize"]>(), ...overrides };
  render(<TooltipProvider delayDuration={0}><TaskBrowserFooter {...props} /></TooltipProvider>);
  return props;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function Boom(): never { throw new Error(rawError); }

beforeEach(() => {
  vi.clearAllMocks();
  location.pathname = "/raw/task"; location.search = "?view=raw";
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("PointerEvent", globalThis.PointerEvent ?? MouseEvent);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(async () => {
  flushSync(() => root.unmount()); client.clear(); container.remove(); await settle();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.style.pointerEvents = ""; await locale("en");
});

it.each(Object.entries(taskRecoveryControlsMessages))("validates complete translated recovery controls in %s", (language, messages) => {
  expect(validateLocaleMessages(messages, taskRecoveryControlsMessages.en)).toEqual([]);
  const leaves = (value: object): string[] => Object.values(value).flatMap(item => typeof item === "string" ? [item] : leaves(item));
  if (language !== "en") {
    const english = leaves(taskRecoveryControlsMessages.en);
    leaves(messages).forEach((message, index) => expect(message).not.toBe(english[index]));
  }
});

describe.each(languages)("mounted recovery controls in %s", language => {
  it("localizes loading and skill content chrome without translating user content or refetching on language changes", async () => {
    await locale(language);
    const request = deferred<CompanySkillDetail>();
    vi.mocked(companySkillsApi.detail).mockReturnValue(request.promise); panel();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(tr("skill.loading"));
    request.resolve(skill);
    await vi.waitFor(() => expect(container.textContent).toContain(skill.name));
    const studio = button(tr("skill.openStudio"));
    for (const next of languages) {
      await locale(next);
      expect(container.textContent).toContain(skill.name); expect(container.textContent).toContain(skill.description);
      expect(container.textContent).toContain(skill.slug); expect(container.textContent).toContain(tr("skill.revision", { revision: 42 }));
      expect(container.textContent).toContain(tr("skill.instructions"));
      expect(container.querySelector('[data-markdown]')?.textContent).toBe("# RAW Instructions\n{{do_not_translate}}");
      expect(container.textContent).not.toContain("raw-frontmatter");
      expect(button(tr("skill.openStudio"))).toBe(studio);
    }
    expect(companySkillsApi.detail).toHaveBeenCalledTimes(1);
    expect(companySkillsApi.detail).toHaveBeenCalledWith("RAW-company", skill.id);
    studio.click(); studio.click(); expect(navigate.mock.calls).toEqual([["/skills/studio/skill%2Fraw%231"], ["/skills/studio/skill%2Fraw%231"]]);
  });

  it.each([403, 404])("keeps the %s access/missing state terminal without adding a retry", async status => {
    await locale(language); vi.mocked(companySkillsApi.detail).mockRejectedValue(new ApiError(rawError, status, null)); panel();
    await vi.waitFor(() => expect(container.textContent).toContain(tr(status === 403 ? "skill.forbidden" : "skill.unavailable")));
    expect(container.querySelector(status === 403 ? '[role="alert"]' : '[role="status"]')).not.toBeNull();
    expect(container.querySelector("button")).toBeNull(); expect(companySkillsApi.detail).toHaveBeenCalledTimes(1);
  });

  it("keeps retry single-flight and renders current-version and empty-instructions fallbacks", async () => {
    await locale(language); const request = deferred<CompanySkillDetail>();
    vi.mocked(companySkillsApi.detail).mockRejectedValueOnce(new Error(rawError)).mockReturnValueOnce(request.promise);
    client.setQueryData(queryKeys.companySkills.detail("RAW-company", skill.id), skill);
    panel(); await vi.waitFor(() => expect(container.textContent).toContain(tr("skill.loadFailed")));
    button(tr("skill.retry")).click(); await settle();
    const retry = button(tr("skill.retrying")); expect(retry.disabled).toBe(true); retry.click(); retry.click();
    expect(companySkillsApi.detail).toHaveBeenCalledTimes(2);
    request.resolve({ ...skill, currentVersion: null, markdown: "", description: null });
    await vi.waitFor(() => expect(container.textContent).toContain(tr("skill.emptyInstructions")));
    expect(container.textContent).toContain(tr("skill.currentVersion"));
  });

  it("localizes live session controls, preserves cancel/end/keep_open, and dismisses options without actions", async () => {
    await locale(language); const props = footer();
    expect(container.querySelector("footer")?.getAttribute("aria-label")).toBe(tr("browser.session"));
    expect(container.querySelector('[role="timer"]')?.textContent).toBe(tr("browser.closesIn", { countdown: "4:59" }).replace(/<\/?0>/g, ""));
    expect(container.querySelector('[role="timer"] .font-mono')?.textContent).toBe("4:59");
    button(tr("browser.keepBrowsing")).focus(); await settle();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(tr("browser.keepBrowsingDescription", { minutes: 10 }));
    button(tr("browser.keepBrowsing")).click(); expect(props.onControl).toHaveBeenLastCalledWith("keep_open");
    await openOptions(); expect(document.body.textContent).toContain(tr("browser.keepOpenDescription", { minutes: 10 }));
    await escapeMenu(); expect(document.querySelector('[role="menu"]')).toBeNull(); expect(props.onControl).toHaveBeenCalledTimes(1);
    await openOptions(); menuItem(tr("browser.reconnect")).click(); await settle(); expect(props.onReconnect).toHaveBeenCalledTimes(1);
    await openOptions(); menuItem(tr("browser.keepOpen")).click(); await settle(); expect(props.onControl).toHaveBeenCalledTimes(2);
    await openOptions(); menuItem(tr("browser.close")).click(); await settle(); expect(props.onControl).toHaveBeenLastCalledWith("end");
    render(null); // Start the running tooltip independently of the prior clicked tooltip's dismissal state.
    footer({ ...props, browser: { ...browser, status: "running" } });
    expect(container.textContent).toContain(tr("browser.browsing")); expect(container.querySelector('[role="timer"]')).toBeNull();
    button(tr("browser.stopBrowsing")).focus(); await settle();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(tr("browser.stopDescription"));
    button(tr("browser.stopBrowsing")).click(); button(tr("browser.stopBrowsing")).click();
    expect(props.onControl.mock.calls.slice(-2)).toEqual([["cancel"], ["cancel"]]);
    footer({ ...props, browser: { ...browser, status: "running" }, disabled: true });
    button(tr("browser.stopBrowsing")).click(); expect(props.onControl).toHaveBeenCalledTimes(5);
    expect(button(tr("browser.options")).disabled).toBe(true);
  });

  it("localizes resize options but keeps preset identifiers, dimensions and same-preset reapply stable", async () => {
    await locale(language); const props = footer({ controlledElsewhere: true });
    expect(container.textContent).toContain(tr("browser.controlledElsewhere"));
    await openSizes();
    for (const next of languages) {
      await locale(next);
      expect(document.body.textContent).toContain(tr("browser.fitHere"));
      for (const preset of ["phone", "tablet", "laptop", "desktop"]) expect(document.body.textContent).toContain(tr(`browser.presets.${preset}`));
      for (const size of ["390 × 844", "768 × 1024", "1280 × 800", "1440 × 900"]) expect(document.body.textContent).toContain(size);
      expect(props.onResize).not.toHaveBeenCalled();
    }
    menuItem(tr("browser.fitHere")).click(); await settle(); expect(props.onResize.mock.calls).toEqual([["fit"]]);
    for (const preset of ["fit", "default", "phone", "tablet", "laptop", "desktop"] as const) {
      footer({ ...props, viewport: preset });
      const label = preset === "fit" ? tr("browser.fit") : preset === "default" ? tr("browser.browserDefault") : tr(`browser.presets.${preset}`);
      for (let repeat = 0; repeat < 2; repeat += 1) {
        await openSizes(); const count = props.onResize.mock.calls.length;
        menuItem(label).click(); await settle();
        expect(props.onResize.mock.calls.slice(count)).toEqual([[preset]]);
      }
    }
    footer({ ...props, resizing: true }); expect(container.textContent).toContain(tr("browser.resizing"));
    await openOptions(); expect(menuItem(tr("browser.size")).getAttribute("data-disabled")).not.toBeNull();
    await escapeMenu(); footer({ ...props, resizeAvailable: false });
    await openOptions(); expect(menuItem(tr("browser.size")).getAttribute("data-disabled")).not.toBeNull();
  });

  it("preserves countdown rounding, five-minute visibility, expiry precedence and terminal hiding", async () => {
    await locale(language);
    const idle = { ...browser, idleDeadline: new Date(now + 300_001).toISOString() };
    const props = footer({ browser: idle }); expect(container.querySelector('[role="timer"]')).toBeNull();
    footer({ ...props, now: now + 1 }); expect(container.querySelector('[role="timer"]')?.textContent).toContain("5:00");
    footer({ ...props, now: now + 300_000 }); expect(container.querySelector('[role="timer"]')?.textContent).toContain("0:01");
    footer({ ...props, now: now + 300_001 }); expect(container.querySelector('[role="timer"]')?.textContent).toBe(tr("browser.closing"));
    expect(container.textContent).not.toContain(tr("browser.keepBrowsing"));
    footer({ ...props, browser: { ...idle, expiresAt: new Date(now + 2000).toISOString() } });
    expect(container.querySelector('[role="timer"]')?.textContent).toContain("0:02");
    expect(container.textContent).not.toContain(tr("browser.keepBrowsing"));
    await openOptions(); expect(document.body.textContent).not.toContain(tr("browser.keepOpen")); await escapeMenu();
    for (const status of ["starting", "stopping", "closed", "failed"] as const) {
      footer({ ...props, browser: { ...browser, status } }); expect(container.innerHTML).toBe("");
    }
    expect(props.onControl).not.toHaveBeenCalled(); expect(browser.status).toBe("idle"); expect(browser.runStatus).toBe("completed");
  });

  it("updates a caught error in place, preserves raw diagnostics, and retains back/reload and route-reset lifecycle", async () => {
    await locale(language); vi.spyOn(console, "error").mockImplementation(() => {});
    render(<RouteErrorBoundary><Boom /></RouteErrorBoundary>);
    const diagnostic = container.querySelector("pre"); expect(diagnostic?.textContent?.trim()).toBe(rawError);
    for (const next of languages) {
      await locale(next); expect(container.textContent).toContain(tr("route.title")); expect(container.textContent).toContain(tr("route.description"));
      expect(container.querySelector("pre")).toBe(diagnostic); expect(diagnostic?.textContent?.trim()).toBe(rawError);
    }
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ message: rawError }), { boundary: "route", componentStack: expect.stringContaining("Boom") });
    button(tr("route.goBack")).click(); button(tr("route.goBack")).click(); expect(navigate.mock.calls).toEqual([[-1], [-1]]);
    const reload = vi.fn(); const originalWindow = window;
    vi.stubGlobal("window", new Proxy(originalWindow, { get(target, key) { return key === "location" ? { reload } : Reflect.get(target, key); } }));
    button(tr("route.reload")).click(); expect(reload).toHaveBeenCalledTimes(1); vi.stubGlobal("window", originalWindow);
    render(<RouteErrorBoundary><div>RAW healthy page</div></RouteErrorBoundary>);
    expect(container.querySelector("pre")).toBe(diagnostic); // Same route must not silently clear errors.
    location.search = "?view=changed"; render(<RouteErrorBoundary><div>RAW healthy page</div></RouteErrorBoundary>);
    expect(container.textContent).toBe("RAW healthy page"); expect(capture).toHaveBeenCalledTimes(1);
    render(<RouteErrorBoundary><Boom /></RouteErrorBoundary>); expect(capture).toHaveBeenCalledTimes(2);
    location.pathname = "/raw/back"; render(<RouteErrorBoundary><div>RAW back page</div></RouteErrorBoundary>);
    expect(container.textContent).toBe("RAW back page");
  });
});
