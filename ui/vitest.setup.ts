const storageEntries = new Map<string, string>();

// React's concurrent act() API needs this explicit test-environment contract.
// Individual tests still have to wrap renders and interactions in act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Node also exposes navigator.languages, populated from the host OS. Keep the
// baseline UI assertions independent of the developer's locale; locale suites
// explicitly select/override the language they exercise.
if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "language", { configurable: true, value: "en-US" });
  Object.defineProperty(navigator, "languages", { configurable: true, value: ["en-US", "en"] });
}

function installStorageMock(target: Record<string, unknown>) {
  Object.defineProperty(target, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storageEntries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storageEntries.set(key, String(value));
      },
      removeItem: (key: string) => {
        storageEntries.delete(key);
      },
      clear: () => {
        storageEntries.clear();
      },
    },
  });
}

if (
  typeof globalThis.localStorage?.getItem !== "function"
  || typeof globalThis.localStorage?.setItem !== "function"
  || typeof globalThis.localStorage?.removeItem !== "function"
  || typeof globalThis.localStorage?.clear !== "function"
) {
  installStorageMock(globalThis);
}

if (typeof window !== "undefined" && window.localStorage !== globalThis.localStorage) {
  installStorageMock(window as unknown as Record<string, unknown>);
}

// jsdom does not implement Element.prototype.scrollIntoView. Several surfaces
// (e.g. IssueChatThread's auto-scroll-to-latest) call it during normal render,
// so provide a no-op default. Tests that assert on scroll behaviour override
// this on the prototype themselves and restore it afterwards.
if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// jsdom exposes scrollTo but its implementation only emits a not-implemented
// error (it has no layout engine). Scrolling behavior is covered by browser
// tests; unit tests can replace this default with their own observable spy.
if (typeof window !== "undefined" && /jsdom/i.test(window.navigator.userAgent)) {
  window.scrollTo = function scrollTo() {};
  // jsdom cannot create a secondary browsing context. Use the browser's
  // blocked-popup result by default; popup-flow tests supply their own window.
  window.open = function open() { return null; };
  // Model the browser's supported "no rendering context" fallback. jsdom has
  // no canvas backend; calling its stub returns null but also emits an error.
  // Tests of actual pixels run in Playwright, while unit tests can supply a
  // context explicitly when exercising canvas logic.
  if (!("CanvasRenderingContext2D" in window)) {
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
  }
}
