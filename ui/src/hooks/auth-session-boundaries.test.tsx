// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { useRunRetryBoundary } from "./useRunRetryBoundary";
import { useDecisionActionBoundary } from "./useDecisionActionBoundary";
vi.mock("@/lib/router", () => ({ useLocation: () => ({ key: "route", pathname: "/same", search: "", hash: "" }) }));
const session = (marker?: string) => ({ user: { id: "owner" }, session: { id: "paperclip:session:owner", userId: "owner", ...(marker ? { scopeKey: marker.repeat(64) } : {}) } });
const target = { companyId: "company", runId: "run" };
function useRetry() { const boundary = useRunRetryBoundary("company"); return { begin: () => boundary.begin(target), isCurrent: boundary.isCurrent }; }
function useDecision() { const boundary = useDecisionActionBoundary("company", "target"); return { begin: () => boundary.begin(target), isCurrent: boundary.isCurrent }; }
describe.each([["retry", useRetry], ["decision", useDecision]] as const)("%s auth cache fence", (_name, useBoundary) => {
  it.each(["marker", "clear", "remove"])("retires old callbacks synchronously for %s even before commit", async change => {
    const client = new QueryClient(), root = createRoot(document.createElement("div"));
    let current!: ReturnType<typeof useBoundary>;
    function Host() { current = useBoundary(); return null; }
    client.setQueryData(queryKeys.auth.session, session("a"));
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><Host /></QueryClientProvider>));
      const old = current;
      let receipt: ReturnType<typeof old.begin>;
      await act(async () => { receipt = old.begin(); });
      expect(receipt!).not.toBeNull();
      await act(async () => {
        if (change === "clear") client.clear();
        if (change === "remove") client.removeQueries({ queryKey: queryKeys.auth.session });
        client.setQueryData(queryKeys.auth.session, session(change === "marker" ? "b" : "a"));
        expect(old.isCurrent(receipt! as never)).toBe(false);
        expect(old.begin()).toBeNull();
      });
      await act(async () => { expect(current.begin()).not.toBeNull(); });
    } finally { await act(async () => root.unmount()); client.clear(); }
  });
  it.each([undefined, "a"])("keeps receipts on same-marker normal refetch, including old-server fallback (%s)", async marker => {
    const client = new QueryClient(), root = createRoot(document.createElement("div"));
    let current!: ReturnType<typeof useBoundary>;
    function Host() { current = useBoundary(); return null; }
    client.setQueryData(queryKeys.auth.session, session(marker));
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><Host /></QueryClientProvider>));
      let receipt: ReturnType<typeof current.begin>;
      await act(async () => { receipt = current.begin(); });
      await act(async () => { await client.fetchQuery({ queryKey: queryKeys.auth.session, queryFn: async () => session(marker) }); });
      expect(current.isCurrent(receipt! as never)).toBe(true);
    } finally { await act(async () => root.unmount()); client.clear(); }
  });
  it("does not upgrade an unknown cache into the known-null local fallback", async () => {
    const client = new QueryClient(), root = createRoot(document.createElement("div"));
    let current!: ReturnType<typeof useBoundary>;
    function Host() { current = useBoundary(); return null; }
    try {
      await act(async () => root.render(<QueryClientProvider client={client}><Host /></QueryClientProvider>));
      expect(current.begin()).toBeNull();
      await act(async () => { client.setQueryData(queryKeys.auth.session, null); });
      await act(async () => { expect(current.begin()).not.toBeNull(); });
    } finally { await act(async () => root.unmount()); client.clear(); }
  });
});
