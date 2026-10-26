// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startServiceWorkerUpdates } from "./service-worker-updates";
import { isTopLevelNavigationPending } from "./browserNavigation";
let stop: () => void, block: (event: Event) => void;
function fixture() {
  const listeners = new Map<string, EventListener>();
  const container = { controller: {}, register: vi.fn(async () => ({ update: vi.fn(async () => {}) })),
    addEventListener: (name: string, listener: EventListener) => listeners.set(name, listener), removeEventListener: (name: string) => listeners.delete(name) } as unknown as ServiceWorkerContainer;
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible"), reload = vi.fn();
  stop = startServiceWorkerUpdates({ container, documentRef: document, reload });
  listeners.get("controllerchange")!(new Event("controllerchange"));
  // Cancel only after the app's handlers have observed the native intent so
  // jsdom does not try to leave the test document. A late cancellation keeps
  // the conservative guard until restoration/manual reload.
  block = event => event.preventDefault(); document.addEventListener("click", block); document.addEventListener("submit", block);
  return { reload, hide() { visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange")); } };
}
function link(href: string, attrs: Record<string, string | undefined> = {}) {
  const anchor = document.createElement("a"); anchor.href = href; for (const [name, value] of Object.entries(attrs)) if (value !== undefined) anchor.setAttribute(name, value);
  const child = document.createElement("span"); child.textContent = "Navigate"; anchor.append(child); document.body.append(anchor); return { anchor, child };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  stop?.(); document.removeEventListener("click", block); document.removeEventListener("submit", block); document.body.innerHTML = "";
  const restored = new Event("pageshow"); Object.defineProperty(restored, "persisted", { value: true }); window.dispatchEvent(restored);
  vi.restoreAllMocks(); vi.useRealTimers();
});
it("protects native same-tab links from a pending worker refresh", () => {
  const f = fixture(), { child } = link("/data-operations?preview=fixture");
  child.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); f.hide();
  expect(f.reload).not.toHaveBeenCalled(); expect(isTopLevelNavigationPending()).toBe(true);
});
it.each(["https://id.example/authorize", "/auth", window.location.href])("protects a native document navigation to %s", href => {
  const f = fixture(), { anchor } = link(href); anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); f.hide(); expect(f.reload).not.toHaveBeenCalled();
});
it.each([{ target: "_blank" }, { download: "file.txt" }])("does not defer refresh for non-self link %j", attrs => {
  const f = fixture(), { anchor } = link("/elsewhere", attrs); anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); f.hide(); expect(f.reload).toHaveBeenCalledTimes(1);
});
it.each(["ctrlKey", "metaKey", "shiftKey", "altKey"])("keeps modified %s link behavior native", key => {
  const f = fixture(), { anchor } = link("/elsewhere"); anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, [key]: true })); f.hide(); expect(f.reload).toHaveBeenCalledTimes(1);
});
it.each(["#section", "mailto:fixture@example.invalid", "tel:123456"])("does not confuse %s with leaving the document", href => {
  const f = fixture(), { anchor } = link(href); anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); f.hide(); expect(f.reload).toHaveBeenCalledTimes(1);
});
it("does not mark router-handled clicks as native navigation", () => {
  const f = fixture(), { anchor } = link("/elsewhere"); anchor.addEventListener("click", event => event.preventDefault());
  anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); f.hide(); expect(f.reload).toHaveBeenCalledTimes(1);
});
it("protects native form navigation but not SPA submission", () => {
  const f = fixture(), form = document.createElement("form"); form.action = "/auth"; document.body.append(form);
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); f.hide(); expect(f.reload).not.toHaveBeenCalled();
});
it("does not guard prevented or new-tab form submissions", () => {
  const f = fixture(), form = document.createElement("form"); form.action = "/auth"; form.target = "_blank"; document.body.append(form);
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); f.hide(); expect(f.reload).toHaveBeenCalledTimes(1);
});
it("resumes deferred updates after BFCache restoration and removes native handlers on cleanup", () => {
  const f = fixture(), { anchor } = link("/elsewhere"); anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); f.hide(); expect(f.reload).not.toHaveBeenCalled();
  const restored = new Event("pageshow"); Object.defineProperty(restored, "persisted", { value: true }); window.dispatchEvent(restored); f.hide(); expect(f.reload).toHaveBeenCalledTimes(1);
  stop(); anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); expect(isTopLevelNavigationPending()).toBe(false);
});
it("does not guard a form handled by React before bubbling to document", () => {
  const f = fixture(), form = document.createElement("form"); form.action = "/auth"; document.body.append(form);
  form.addEventListener("submit", event => event.preventDefault());
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); f.hide(); expect(f.reload).toHaveBeenCalledTimes(1);
});
it("respects submitter target overrides", () => {
  const f = fixture(), form = document.createElement("form"), button = document.createElement("button");
  form.action = "/auth"; button.setAttribute("formtarget", "_blank"); form.append(button); document.body.append(form);
  form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button })); f.hide(); expect(f.reload).toHaveBeenCalledTimes(1);
});
it("ignores middle clicks and empty-fragment links", () => {
  const f = fixture(), { anchor } = link("/elsewhere"); anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 1 }));
  const fragment = link("#").anchor; fragment.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  f.hide(); expect(f.reload).toHaveBeenCalledTimes(1);
});
