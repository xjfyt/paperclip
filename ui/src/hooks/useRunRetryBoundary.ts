import { useCallback, useLayoutEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthSession } from "@paperclipai/shared";
import { useLocation } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";

type RetryTarget = { runId: string; companyId: string };
type RetryScope = { key: string; auth: string; active: boolean; attempts: Map<string, object> };
export type RunRetryAttempt<T extends RetryTarget> = { readonly target: Readonly<T>; readonly scope: RetryScope };

// Public identity only: a known null session is local_trusted, not an unknown cache.
function sessionIdentity(session: AuthSession | null | undefined): string {
  return session === undefined ? "unknown" : JSON.stringify([
    session?.user?.id ?? session?.session?.userId ?? null,
    session?.session?.id ?? null,
  ]);
}

/** A receipt controls UI feedback only; leaving the page never cancels a server retry. */
export function useRunRetryBoundary(companyId: string | null | undefined, targetKey = "", selectedCompanyId = companyId) {
  const client = useQueryClient();
  const location = useLocation();
  const authRevision = useRef(0);
  const scopeRef = useRef<RetryScope | null>(null);
  const [, render] = useReducer((n: number) => n + 1, 0);
  const readIdentity = useCallback(() => sessionIdentity(client.getQueryData<AuthSession | null>(queryKeys.auth.session)), [client]);
  const subscribe = useCallback((notify: () => void) => {
    let previous = readIdentity();
    return client.getQueryCache().subscribe(() => {
      // Query-cache changes may precede React's commit. Retire the receipt now,
      // including clear/remove followed by restoration of the same public identity.
      const identity = readIdentity();
      if (identity !== previous) {
        previous = identity;
        authRevision.current++;
        if (scopeRef.current) scopeRef.current.active = false;
      }
      notify();
    });
  }, [client, readIdentity]);
  const snapshot = useCallback(() => JSON.stringify([authRevision.current, readIdentity()]), [readIdentity]);
  const authSnapshot = useSyncExternalStore(subscribe, snapshot, snapshot);
  const auth = readIdentity();
  const key = JSON.stringify([companyId, selectedCompanyId, targetKey, location.key, location.pathname, location.search, location.hash, authSnapshot]);
  useLayoutEffect(() => {
    const scope: RetryScope = { key, auth, active: true, attempts: new Map() };
    scopeRef.current = scope;
    render();
    return () => { scope.active = false; scope.attempts.clear(); };
  }, [key, auth, client]);

  function begin<T extends RetryTarget>(target: T): RunRetryAttempt<T> | null {
    const scope = scopeRef.current;
    if (!scope?.active || scope.key !== key || auth === "unknown" || readIdentity() !== auth
      || target.companyId !== companyId || (selectedCompanyId != null && target.companyId !== selectedCompanyId)
      || scope.attempts.has(target.runId)) return null;
    const attempt = { target: Object.freeze({ ...target }), scope };
    // Synchronous event-time reservation: onMutate and isPending are too late.
    scope.attempts.set(target.runId, attempt);
    render();
    return attempt;
  }
  function isCurrent<T extends RetryTarget>(attempt: RunRetryAttempt<T> | undefined) {
    return Boolean(attempt && attempt.scope.active && scopeRef.current === attempt.scope
      && attempt.scope.auth !== "unknown" && readIdentity() === attempt.scope.auth);
  }
  function finish<T extends RetryTarget>(attempt: RunRetryAttempt<T>) {
    if (attempt.scope.attempts.get(attempt.target.runId) !== attempt) return;
    attempt.scope.attempts.delete(attempt.target.runId);
    if (isCurrent(attempt)) render();
  }
  const scope = scopeRef.current;
  const pendingRunIds = new Set(scope?.active && scope.key === key ? scope.attempts.keys() : []);
  return { begin, isCurrent, finish, pendingRunIds };
}
