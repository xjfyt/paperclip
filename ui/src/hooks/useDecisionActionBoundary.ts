import { useCallback, useLayoutEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthSession } from "@paperclipai/shared";
import { authSessionIdentity } from "@/lib/auth-session-scope";
import { useLocation } from "@/lib/router";
import { queryKeys } from "../lib/queryKeys";

type Scope = { key: string; identity: string; active: boolean; pending: Map<string, object> };
export type DecisionActionReceipt<T> = { readonly scope: Scope; readonly input: Readonly<T>; readonly slot: string };

/** UI receipts supplement (never replace) server permissions, CAS and idempotency. */
export function useDecisionActionBoundary(companyId: string | null | undefined, targetKey: string, selectedCompanyId = companyId) {
  const client = useQueryClient();
  const location = useLocation();
  const scopeRef = useRef<Scope | null>(null);
  const revision = useRef(0);
  const [, render] = useReducer((value: number) => value + 1, 0);
  const readIdentity = useCallback(() => authSessionIdentity(client.getQueryData<AuthSession | null>(queryKeys.auth.session)), [client]);
  const subscribe = useCallback((notify: () => void) => {
    let previous = readIdentity();
    return client.getQueryCache().subscribe(() => {
      const next = readIdentity();
      if (next !== previous) {
        previous = next;
        revision.current++;
        if (scopeRef.current) scopeRef.current.active = false;
      }
      notify();
    });
  }, [client, readIdentity]);
  const snapshot = useCallback(() => JSON.stringify([revision.current, readIdentity()]), [readIdentity]);
  const authSnapshot = useSyncExternalStore(subscribe, snapshot, snapshot);
  const key = JSON.stringify([companyId, selectedCompanyId, targetKey, location.key, location.pathname, location.search, location.hash, authSnapshot]);
  useLayoutEffect(() => {
    const scope: Scope = { key, identity: readIdentity(), active: true, pending: new Map() };
    scopeRef.current = scope;
    render();
    return () => { scope.active = false; scope.pending.clear(); };
  }, [key, readIdentity]);
  function begin<T>(input: T, slot = "action"): DecisionActionReceipt<T> | null {
    const scope = scopeRef.current;
    if (!companyId || companyId !== selectedCompanyId || !scope?.active || scope.key !== key
      || scope.identity === "unknown" || scope.identity !== readIdentity() || scope.pending.has(slot)) return null;
    const receipt = { scope, input: Object.freeze({ ...input }), slot };
    scope.pending.set(slot, receipt);
    render();
    return receipt;
  }
  function isCurrent<T>(receipt: DecisionActionReceipt<T> | undefined) {
    return Boolean(receipt && receipt.scope.active && receipt.scope === scopeRef.current
      && receipt.scope.identity === readIdentity());
  }
  function finish<T>(receipt: DecisionActionReceipt<T>) {
    if (receipt.scope.pending.get(receipt.slot) === receipt) receipt.scope.pending.delete(receipt.slot);
    if (isCurrent(receipt)) render();
  }
  const scope = scopeRef.current;
  return { begin, isCurrent, finish, pending: Boolean(scope?.active && scope.key === key && scope.pending.size) };
}
