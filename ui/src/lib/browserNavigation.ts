// A top-level handoff is not an idle background tab. A service-worker takeover
// must not reload the old document while login/logout is leaving it.
let pendingWindow: Window | null = null;
const observedWindows = new WeakSet<Window>();

export function isTopLevelNavigationPending(): boolean {
  return typeof window !== "undefined" && pendingWindow === window;
}

function navigate(target: string, method: "assign" | "replace") {
  const currentWindow = window;
  if (!observedWindows.has(currentWindow)) {
    observedWindows.add(currentWindow);
    currentWindow.addEventListener?.("pageshow", (event) => {
      // Back/forward-cache restores keep module state. Initial pageshow can
      // occur after an early Cloud handoff started, so only a restore clears it.
      if (event.persisted && pendingWindow === currentWindow) pendingWindow = null;
    });
  }
  const previous = pendingWindow;
  pendingWindow = currentWindow;
  try { currentWindow.location[method](target); }
  catch (error) { pendingWindow = previous; throw error; }
}

/** Caller still owns URL validation and authorization. No URL is retained. */
export function navigateTopLevel(target: string) { navigate(target, "assign"); }
export function replaceTopLevel(target: string) { navigate(target, "replace"); }
