// @vitest-environment jsdom
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserUseViewportPreset, TaskBrowser } from "@paperclipai/shared";
import { i18n } from "@/i18n/task-recovery-controls-test-resources";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TaskBrowserFooter } from "./TaskBrowserFooter";

let root: Root, host: HTMLDivElement;
const onResize = vi.fn(); const onControl = vi.fn(); const onReconnect = vi.fn();
const browser = { status: "idle", idleDeadline: null, expiresAt: null } as TaskBrowser;
const tr = (key: string) => i18n.t(`taskRecoveryControlsUi.browser.${key}`);
function render(viewport: BrowserUseViewportPreset, controlledElsewhere = false) {
  flushSync(() => root.render(<TooltipProvider><TaskBrowserFooter browser={browser} now={0}
    viewport={viewport} controlledElsewhere={controlledElsewhere} onResize={onResize} onControl={onControl} onReconnect={onReconnect} /></TooltipProvider>));
}
async function settle() { await new Promise(resolve => setTimeout(resolve, 0)); flushSync(() => {}); }
async function key(element: Element, value: string) {
  element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })); await settle();
}
async function openSizes(mode: "mouse" | "keyboard") {
  const options = host.querySelector("button")!;
  if (mode === "keyboard") await key(options, "ArrowDown");
  else { options.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })); await settle(); }
  const sizes = document.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]')!;
  if (mode === "keyboard") { sizes.focus(); await key(sizes, "ArrowRight"); }
  else { sizes.click(); await settle(); }
}
async function select(preset: BrowserUseViewportPreset, mode: "mouse" | "keyboard") {
  const label = tr(preset === "fit" ? "fit" : preset === "default" ? "browserDefault" : `presets.${preset}`);
  const option = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(el => el.textContent?.startsWith(label))!;
  expect(option).toBeDefined();
  if (mode === "keyboard") { option.focus(); await key(option, "Enter"); }
  else { option.click(); await settle(); }
}
beforeEach(async () => {
  vi.clearAllMocks(); await i18n.changeLanguage("en");
  vi.stubGlobal("PointerEvent", globalThis.PointerEvent ?? MouseEvent);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  flushSync(() => root.unmount()); host.remove(); await settle(); vi.unstubAllGlobals(); document.body.style.pointerEvents = "";
});

describe.each(["mouse", "keyboard"] as const)("browser viewport selection by %s", mode => {
  it.each(["fit", "default", "phone", "tablet", "laptop", "desktop"] as const)("reapplies the current %s preset exactly once per selection and closes the menu", async preset => {
    render(preset);
    for (let repeat = 0; repeat < 2; repeat += 1) {
      await openSizes(mode); await select(preset, mode);
      expect(onResize.mock.calls).toEqual(Array.from({ length: repeat + 1 }, () => [preset]));
      expect(document.querySelector('[role="menu"]')).toBeNull();
    }
    expect(onControl).not.toHaveBeenCalled(); expect(onReconnect).not.toHaveBeenCalled();
  });

  it("selects a different preset once and dismisses without selecting anything", async () => {
    render("fit"); await openSizes(mode); await select("phone", mode);
    expect(onResize.mock.calls).toEqual([["phone"]]);
    render("phone"); await openSizes(mode);
    await key(document.activeElement!, "Escape"); await key(document.activeElement!, "Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull(); expect(onResize.mock.calls).toEqual([["phone"]]);
  });

  it("requests explicit fit takeover exactly once while another viewer owns the viewport", async () => {
    render("fit", true); await openSizes(mode);
    const takeover = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el => el.textContent === tr("fitHere"))!;
    expect(takeover).toBeDefined();
    if (mode === "keyboard") { takeover.focus(); await key(takeover, "Enter"); }
    else { takeover.click(); await settle(); }
    expect(onResize.mock.calls).toEqual([["fit"]]); expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
