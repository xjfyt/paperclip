import { afterEach, expect, it, vi } from "vitest";
import { isTopLevelNavigationPending, navigateTopLevel, replaceTopLevel } from "./browserNavigation";
function fakeWindow() {
  const lifecycle = new EventTarget(), assign = vi.fn(), replace = vi.fn();
  vi.stubGlobal("window", { location: { assign, replace }, addEventListener: lifecycle.addEventListener.bind(lifecycle) });
  return { lifecycle, assign, replace };
}
afterEach(() => vi.unstubAllGlobals());
it.each(["assign", "replace"] as const)("marks %s handoffs before navigation without retaining the URL", method => {
  const target = fakeWindow(); expect(isTopLevelNavigationPending()).toBe(false);
  target[method].mockImplementation(() => expect(isTopLevelNavigationPending()).toBe(true));
  (method === "assign" ? navigateTopLevel : replaceTopLevel)("https://id.example/authorize");
  expect(target[method]).toHaveBeenCalledExactlyOnceWith("https://id.example/authorize"); expect(isTopLevelNavigationPending()).toBe(true);
});
it("keeps an early handoff pending on initial pageshow and clears it on a BFCache restore", () => {
  const { lifecycle } = fakeWindow(); navigateTopLevel("https://id.example/logout");
  lifecycle.dispatchEvent(new Event("pageshow")); expect(isTopLevelNavigationPending()).toBe(true);
  const restored = new Event("pageshow"); Object.defineProperty(restored, "persisted", { value: true });
  lifecycle.dispatchEvent(restored); expect(isTopLevelNavigationPending()).toBe(false);
});
it("does not leave an update guard behind when navigation throws", () => {
  const { assign } = fakeWindow(); assign.mockImplementation(() => { throw Error("navigation failed"); });
  expect(() => navigateTopLevel("https://id.example/authorize")).toThrow("navigation failed"); expect(isTopLevelNavigationPending()).toBe(false);
});
it("does not cancel a prior handoff when a second navigation fails", () => {
  const { assign } = fakeWindow(); navigateTopLevel("https://id.example/first");
  assign.mockImplementation(() => { throw Error("second failed"); });
  expect(() => navigateTopLevel("https://id.example/second")).toThrow(); expect(isTopLevelNavigationPending()).toBe(true);
});
it("is safe outside a browser", () => { vi.stubGlobal("window", undefined); expect(isTopLevelNavigationPending()).toBe(false); });
