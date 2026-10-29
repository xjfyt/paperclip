import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthSession } from "@paperclipai/shared";
import { authSessionIdentity } from "@/lib/auth-session-scope";
import { queryKeys } from "@/lib/queryKeys";

/** Fence private UI callbacks at cache-event time, not at a later React commit.
 * Removing/restoring the same session still retires the old epoch. Ordinary
 * profile/refetch updates with the same marker do not. This grants no access.
 */
export function useAuthSessionFence() {
  const client = useQueryClient(), revision = useRef(0), committed = useRef<string | null>(null);
  const identity = useCallback(() => authSessionIdentity(client.getQueryData<AuthSession | null>(queryKeys.auth.session)), [client]);
  const subscribe = useCallback((notify: () => void) => {
    let previous = identity();
    return client.getQueryCache().subscribe(() => {
      const next = identity();
      if (next !== previous) { previous = next; revision.current++; committed.current = null; }
      notify();
    });
  }, [client, identity]);
  const snapshot = useCallback(() => JSON.stringify([revision.current, identity()]), [identity]);
  const key = useSyncExternalStore(subscribe, snapshot, snapshot);
  useLayoutEffect(() => { committed.current = key; return () => { if (committed.current === key) committed.current = null; }; }, [key]);
  const isCurrent = useCallback(() => identity() !== "unknown" && committed.current === key && snapshot() === key, [identity, key, snapshot]);
  return { key, isCurrent };
}
