// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskBrowser } from "@paperclipai/shared";
import { browserUseApi } from "@/api/browser-use";
import { TooltipProvider } from "@/components/ui/tooltip";
import { i18n, taskBrowserPanelMessages } from "@/i18n/task-browser-panel-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import { TaskBrowserPanel } from "./TaskBrowserPanel";

vi.mock("@/api/browser-use", () => ({ browserUseApi: {
  viewer: vi.fn(), presence: vi.fn(), control: vi.fn(), resize: vi.fn(), releaseViewport: vi.fn(),
} }));
const languages = ["en", "zh-CN", "es", "ja"] as const;
const tr = (key: string) => i18n.t(`taskBrowserPanelUi.${key}`);
const footerText = (key: string) => i18n.t(`taskRecoveryControlsUi.browser.${key}`);
const rawError = "RAW browser {{diagnostic}} <unsafe> stopped_by_user";
const url = "https://live.browser-use.com/RAW-view?token=raw-preserved";
const now = Date.parse("2026-10-29T00:00:00Z");
const browser: TaskBrowser = {
  id: "RAW-browser", sessionId: "RAW-session", issueId: "RAW-task", status: "idle", runStatus: "completed",
  progress: "RAW webpage 原文", error: null, costCents: 0, idleDeadline: new Date(now + 299_000).toISOString(),
  expiresAt: new Date(now + 600_000).toISOString(), createdAt: new Date(now).toISOString(),
};
let root: Root, host: HTMLDivElement, cache: QueryClient;
let hidden = false;
async function render(overrides: Partial<ComponentProps<typeof TaskBrowserPanel>> = {}) {
  await act(async () => root.render(<QueryClientProvider client={cache}><TooltipProvider delayDuration={0}>
    <TaskBrowserPanel issueId="RAW-task" browser={browser} {...overrides} />
  </TooltipProvider></QueryClientProvider>));
}
async function locale(language: string) { await act(async () => { await i18n.changeLanguage(language); }); }
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function loaded() { await act(async () => host.querySelector("iframe")!.dispatchEvent(new Event("load"))); }
function button(label: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find(el => el.textContent?.trim() === label || el.getAttribute("aria-label") === label);
  expect(result, label).toBeDefined(); return result!;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function openSizes() {
  await act(async () => button(footerText("options")).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })));
  const size = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el => el.textContent?.startsWith(footerText("size")))!;
  await act(async () => size.click());
}
async function selectSize(key: string) {
  await openSizes(); const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(el => el.textContent?.startsWith(footerText(key)))!;
  await act(async () => item.click());
}
function deferred<T>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.resetAllMocks(); hidden = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("PointerEvent", globalThis.PointerEvent ?? MouseEvent);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => hidden ? "hidden" : "visible" });
  vi.spyOn(HTMLIFrameElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  vi.spyOn(HTMLIFrameElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 600, height: 800 } as DOMRect);
  vi.mocked(browserUseApi.viewer).mockResolvedValue({ url, viewport: "default" });
  vi.mocked(browserUseApi.presence).mockResolvedValue({ accepted: true });
  vi.mocked(browserUseApi.releaseViewport).mockResolvedValue({ released: true });
  vi.mocked(browserUseApi.resize).mockImplementation(async (_issue, _browser, request) => ({ preset: request.preset }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount()); cache.clear(); host.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.style.pointerEvents = ""; await locale("en");
});

it.each(Object.entries(taskBrowserPanelMessages))("validates browser-panel messages in %s", (language, messages) => {
  expect(validateLocaleMessages(messages, taskBrowserPanelMessages.en)).toEqual([]);
  if (language !== "en") for (const key of Object.keys(messages) as Array<keyof typeof messages>) expect(messages[key]).not.toBe(taskBrowserPanelMessages.en[key]);
});

describe.each(languages)("mounted browser panel in %s", language => {
  it("localizes every lifecycle/access state, retains provider diagnostics and repeats active-browser navigation only on clicks", async () => {
    await locale(language); await render({ browser: undefined });
    expect(host.textContent).toContain(tr("noneOpen")); expect(host.textContent).toContain(tr("askBrowse"));
    for (const [status, heading, description] of [
      ["starting", "starting", "waitingReady"], ["stopping", "closing", "waitingShutdown"], ["closed", "closed", "askAnother"],
    ] as const) {
      await render({ browser: { ...browser, status } }); expect(host.textContent).toContain(tr(heading)); expect(host.textContent).toContain(tr(description));
      expect(host.querySelector("footer")).toBeNull();
    }
    const openActive = vi.fn(); await render({ browser: { ...browser, status: "closed" }, onOpenActiveBrowser: openActive });
    expect(host.textContent).toContain(tr("anotherOpen")); await click(tr("openActive")); await click(tr("openActive")); expect(openActive).toHaveBeenCalledTimes(2);
    await render({ browser: { ...browser, status: "failed", error: rawError } });
    expect(host.textContent).toContain(tr("startFailed")); expect(host.textContent).toContain(rawError); expect(host.querySelector("unsafe")).toBeNull();
    await render({ accessError: true, onOpenActiveBrowser: openActive });
    expect(host.textContent).toContain(tr("accessUnavailable")); expect(host.textContent).toContain(tr("accessDenied"));
    expect(host.querySelector("iframe")).toBeNull(); expect(host.querySelector("button")).toBeNull(); expect(browserUseApi.viewer).not.toHaveBeenCalled();
  });

  it("switches language without replacing the webpage, URL, viewer request, lease, or polling clock", async () => {
    await locale(language); await render({ browser: { ...browser, error: rawError } });
    const frame = host.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(url); expect(frame.title).toBe(tr("frameTitle")); expect(host.textContent).toContain(tr("connecting"));
    await loaded(); const initialViewer = vi.mocked(browserUseApi.viewer).mock.calls[0];
    for (const next of languages) {
      await locale(next); expect(host.querySelector("iframe")).toBe(frame); expect(frame.src).toBe(url); expect(frame.title).toBe(tr("frameTitle"));
      expect(host.textContent).toContain(rawError); expect(browserUseApi.viewer).toHaveBeenCalledTimes(1); expect(browserUseApi.presence).toHaveBeenCalledTimes(1);
      expect(browserUseApi.releaseViewport).not.toHaveBeenCalled();
    }
    expect(initialViewer.slice(0, 2)).toEqual(["RAW-task", "RAW-browser"]);
    await tick(14_999); expect(browserUseApi.viewer).toHaveBeenCalledTimes(1); await tick(1); expect(browserUseApi.viewer).toHaveBeenCalledTimes(2);
    await tick(15_000); expect(browserUseApi.presence).toHaveBeenCalledTimes(2); expect(host.querySelector("iframe")).toBe(frame);
    expect(browser.progress).toBe("RAW webpage 原文"); expect(browser.runStatus).toBe("completed");
  });

  it("localizes load timeout and keeps one automatic reconnect, explicit retries, hidden cancellation and recovery", async () => {
    await locale(language); await render(); const initial = host.querySelector("iframe");
    await tick(15_000); const retried = host.querySelector("iframe"); expect(retried).not.toBe(initial);
    await tick(15_000); expect(host.textContent).toContain(tr("loadTimeout")); expect(host.textContent).toContain(tr("loadTimeoutDescription"));
    await tick(30_000); expect(host.querySelector("iframe")).toBe(retried);
    await click(tr("reconnect")); expect(host.querySelector("iframe")).not.toBe(retried); expect(host.textContent).toContain(tr("connecting"));
    const manual = host.querySelector("iframe"); await render({ active: false }); await tick(60_000); expect(host.querySelector("iframe")).toBe(manual);
    await render(); await loaded(); await tick(15_000); expect(host.querySelector("iframe")).toBe(manual); expect(host.textContent).not.toContain(tr("loadTimeout"));
  });

  it("translates local disconnect/action errors at render time, keeps mutations pending-disabled, and preserves raw server errors", async () => {
    await locale(language); vi.mocked(browserUseApi.viewer).mockRejectedValueOnce(new Error("RAW network")); await render();
    expect(host.textContent).toContain(tr("disconnectedTitle")); expect(host.textContent).toContain(tr("disconnected"));
    await locale(language === "en" ? "ja" : "en"); expect(host.textContent).toContain(tr("disconnected")); expect(browserUseApi.viewer).toHaveBeenCalledTimes(1);
    await tick(15_000); await loaded();
    const pending = deferred<Awaited<ReturnType<typeof browserUseApi.control>>>(); vi.mocked(browserUseApi.control).mockReturnValueOnce(pending.promise);
    await render({ browser: { ...browser, status: "running" } });
    await click(footerText("stopBrowsing")); await tick(0); expect(button(footerText("stopBrowsing")).disabled).toBe(true); await click(footerText("stopBrowsing"));
    expect(browserUseApi.control).toHaveBeenCalledTimes(1); expect(browserUseApi.control).toHaveBeenLastCalledWith("RAW-task", "RAW-browser", "cancel");
    pending.resolve({ ...browser, status: "idle" }); await tick(0);
    vi.mocked(browserUseApi.control).mockRejectedValueOnce(new Error(rawError)); await click(footerText("stopBrowsing")); await tick(0);
    expect(host.textContent).toContain(tr("actionFailed"));
    await locale(language); expect(host.textContent).toContain(tr("actionFailed")); expect(browserUseApi.control).toHaveBeenCalledTimes(2);
    await render({ browser: { ...browser, status: "running", error: rawError } }); expect(host.textContent).toContain(rawError); expect(host.textContent).not.toContain(tr("actionFailed"));
  });

  it("keeps presence warnings and resize failure recovery translated without restarting effects", async () => {
    await locale(language); vi.mocked(browserUseApi.presence).mockRejectedValueOnce(new Error(rawError)); await render(); await loaded();
    expect(host.textContent).toContain(tr("presenceFailed"));
    vi.mocked(browserUseApi.resize).mockRejectedValueOnce(new Error(rawError)); await selectSize("presets.phone");
    expect(host.textContent).toContain(tr("resizeFailed")); const resizeCalls = vi.mocked(browserUseApi.resize).mock.calls.length;
    for (const next of languages) {
      await locale(next); expect(host.textContent).toContain(tr("presenceFailed")); expect(host.textContent).toContain(tr("resizeFailed"));
      expect(browserUseApi.resize).toHaveBeenCalledTimes(resizeCalls);
    }
    await selectSize("presets.phone"); expect(host.textContent).not.toContain(tr("resizeFailed"));
    expect(browserUseApi.resize).toHaveBeenLastCalledWith("RAW-task", "RAW-browser", expect.objectContaining({ preset: "phone" }));
    await tick(30_000); expect(host.textContent).not.toContain(tr("presenceFailed"));
  });

  it("does not revive a revoked viewer when its pending request resolves after access removal", async () => {
    await locale(language); const request = deferred<Awaited<ReturnType<typeof browserUseApi.viewer>>>(); vi.mocked(browserUseApi.viewer).mockReturnValueOnce(request.promise);
    await render(); const signal = vi.mocked(browserUseApi.viewer).mock.calls[0][2];
    await render({ accessError: true }); expect(signal?.aborted).toBe(true);
    request.resolve({ url, viewport: "default" }); await tick(0);
    expect(host.querySelector("iframe")).toBeNull(); expect(host.textContent).toContain(tr("accessDenied"));
    expect(browserUseApi.presence).not.toHaveBeenCalled(); await render(); expect(host.querySelector("iframe")?.src).toBe(url);
  });
});
