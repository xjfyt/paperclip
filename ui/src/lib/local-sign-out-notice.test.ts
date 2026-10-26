// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLocalSignOutNotice, hasLocalSignOutNotice, rememberLocalSignOut, subscribeLocalSignOutNotice } from "./local-sign-out-notice";

afterEach(() => {
  vi.restoreAllMocks();
  clearLocalSignOutNotice();
  window.sessionStorage.clear();
});

describe("local sign-out presentation hint", () => {
  it("stores only a fixed status and survives a fresh module/return to the app", async () => {
    rememberLocalSignOut();
    expect(window.sessionStorage.length).toBe(1);
    expect(window.sessionStorage.getItem("paperclip.local-sign-out")).toBe("local-complete-global-unconfirmed");
    vi.resetModules();
    const returned = await import("./local-sign-out-notice");
    expect(returned.hasLocalSignOutNotice()).toBe(true);
    returned.clearLocalSignOutNotice();
    expect(returned.hasLocalSignOutNotice()).toBe(false);
  });

  it("does not treat an arbitrary stored value as local or global confirmation", () => {
    window.sessionStorage.setItem("paperclip.local-sign-out", "global-success");
    expect(hasLocalSignOutNotice()).toBe(false);
  });

  it("falls back to memory if writes fail even while reads remain available", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => rememberLocalSignOut()).not.toThrow();
    expect(hasLocalSignOutNotice()).toBe(true);
    clearLocalSignOutNotice();
    expect(hasLocalSignOutNotice()).toBe(false);
  });

  it("notifies mounted UI on local updates and back/forward restoration", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLocalSignOutNotice(listener);
    rememberLocalSignOut();
    clearLocalSignOutNotice();
    window.dispatchEvent(new Event("pageshow"));
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    window.dispatchEvent(new Event("pageshow"));
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
