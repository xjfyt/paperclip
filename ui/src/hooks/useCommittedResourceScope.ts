import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

/** Gate late asynchronous UI feedback by the resource that actually committed.
 * A render-time ref assignment leaks abandoned concurrent renders; an effect is
 * too late for callbacks delivered after layout commit. Returning to the same
 * resource also starts a new generation, so an old A → B → A reply stays stale.
 * An optional source version invalidates feedback when bytes change at the same path.
 */
export function useCommittedResourceScope(scope: string, source?: unknown) {
  const generation = useMemo(() => ({}), [scope, source]);
  const committed = useRef<object | null>(null);
  useLayoutEffect(() => {
    committed.current = generation;
    return () => { if (committed.current === generation) committed.current = null; };
  }, [generation]);
  return useCallback(() => committed.current === generation, [generation]);
}
