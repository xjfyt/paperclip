// @vitest-environment jsdom
import { act, Suspense, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useCommittedResourceScope } from "./useCommittedResourceScope";
it("invalidates old callbacks at layout commit, ignores abandoned renders, and does not revive A after A → B → A", async () => {
  const host = document.createElement("div"); const root = createRoot(host);
  let current!: () => boolean; let onCommit = () => {}; const never = new Promise(() => {});
  function Consumer({ scope, suspend = false }: { scope: string; suspend?: boolean }) {
    const isCurrent = useCommittedResourceScope(scope);
    useLayoutEffect(() => { current = isCurrent; onCommit(); });
    if (suspend) throw never;
    return <span>{scope}</span>;
  }
  try {
    await act(async () => root.render(<Suspense fallback={null}><Consumer scope="A" /></Suspense>));
    const first = current; expect(first()).toBe(true);
    await act(async () => root.render(<Suspense fallback={null}><Consumer scope="B" suspend /></Suspense>));
    // Suspense hides the committed tree (layout cleanup), never authorizes B.
    expect(current).toBe(first);
    onCommit = () => expect(first()).toBe(false);
    await act(async () => root.render(<Suspense fallback={null}><Consumer scope="B" /></Suspense>));
    expect(current()).toBe(true);
    await act(async () => root.render(<Suspense fallback={null}><Consumer scope="A" /></Suspense>));
    expect(first()).toBe(false); expect(current()).toBe(true);
  } finally { await act(async () => root.unmount()); }
  expect(current()).toBe(false);
});
