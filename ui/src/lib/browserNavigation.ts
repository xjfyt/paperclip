// A top-level handoff is not an idle background tab. A service-worker takeover
// must not reload the old document while login/logout is leaving it.
let pendingWindow: Window | null = null;
const observedWindows = new WeakSet<Window>();

export function isTopLevelNavigationPending(): boolean {
  return typeof window !== "undefined" && pendingWindow === window;
}

function markPending(currentWindow: Window) {
  if (!observedWindows.has(currentWindow)) {
    observedWindows.add(currentWindow);
    currentWindow.addEventListener?.("pageshow", (event) => {
      // Back/forward-cache restores keep module state. Initial pageshow can
      // occur after an early Cloud handoff started, so only a restore clears it.
      if (event.persisted && pendingWindow === currentWindow) pendingWindow = null;
    });
  }
  pendingWindow = currentWindow;
}

function navigate(target: string, method: "assign" | "replace") {
  const currentWindow = window;
  const previous = pendingWindow;
  markPending(currentWindow);
  try { currentWindow.location[method](target); }
  catch (error) { pendingWindow = previous; throw error; }
}

/** Caller still owns URL validation and authorization. No URL is retained. */
export function navigateTopLevel(target: string) { navigate(target, "assign"); }
export function replaceTopLevel(target: string) { navigate(target, "replace"); }

/**
 * Observe native intents after SPA handlers have had a chance to prevent them.
 * No URLs are retained and no navigation is initiated here. Late cancellation
 * conservatively defers worker refresh until restoration or manual reload.
 */
export function watchNativeTopLevelNavigations(documentRef: Document): () => void {
  if (typeof window === "undefined") return () => {};
  const currentWindow = window;
  const selfTarget = (target: string | null) => !target || target.toLowerCase() === "_self"
    || ((target.toLowerCase() === "_top" || target.toLowerCase() === "_parent")
      && currentWindow.top === currentWindow);
  const baseTarget = () => documentRef.querySelector("base[target]")?.getAttribute("target") ?? null;
  const leavesDocument = (href: string, form = false) => {
    try {
      const next = new URL(href, documentRef.baseURI);
      if (next.protocol !== "http:" && next.protocol !== "https:") return false;
      const here = new URL(currentWindow.location.href);
      // An empty fragment also stays in this document. Same-URL links without
      // a fragment, and forms even with a fragment, perform document requests.
      return form || !next.href.includes("#")
        || next.origin !== here.origin || next.pathname !== here.pathname || next.search !== here.search;
    } catch { return false; }
  };
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const node = event.target as Element | null;
    const anchor = node?.closest?.("a[href]");
    if (!anchor || anchor.hasAttribute("download") || !selfTarget(anchor.getAttribute("target") ?? baseTarget())) return;
    if (leavesDocument(anchor.getAttribute("href")!)) markPending(currentWindow);
  };
  const onSubmit = (event: SubmitEvent) => {
    if (event.defaultPrevented) return;
    const form = event.target as HTMLFormElement | null;
    if (form?.tagName !== "FORM") return;
    const submitter = event.submitter;
    const method = submitter?.getAttribute("formmethod") ?? form.getAttribute("method");
    if (method?.toLowerCase() === "dialog") return;
    if (!selfTarget(submitter?.getAttribute("formtarget") ?? form.getAttribute("target") ?? baseTarget())) return;
    const action = submitter?.getAttribute("formaction") ?? form.getAttribute("action") ?? currentWindow.location.href;
    if (leavesDocument(action || currentWindow.location.href, true)) markPending(currentWindow);
  };
  documentRef.addEventListener("click", onClick);
  documentRef.addEventListener("submit", onSubmit);
  return () => {
    documentRef.removeEventListener("click", onClick);
    documentRef.removeEventListener("submit", onSubmit);
  };
}
