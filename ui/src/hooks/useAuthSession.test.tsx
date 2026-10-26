// @vitest-environment jsdom
import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { clearLocalSignOutNotice, hasLocalSignOutNotice, rememberLocalSignOut } from "@/lib/local-sign-out-notice";
import { useAuthSession } from "./useAuthSession";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("@/api/auth", () => ({ authApi: { getSession } }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const session = (id: string) => ({ session: { id, userId: id }, user: { id, name: id, email: `${id}@example.test`, image: null }, sentryDsn: null });
const pending = () => {
  let finish!: (value: unknown) => void;
  const promise = new Promise(resolve => { finish = resolve; });
  return { promise, finish };
};
let observed: Array<ReturnType<typeof useAuthSession>> = [];
function Observer({ index, cloud }: { index: number; cloud?: boolean }) {
  observed[index] = useAuthSession({ cloud });
  return null;
}

describe("post-sign-out fresh session fence", () => {
  let root: Root;
  let client: QueryClient;
  let container: HTMLDivElement;
  beforeEach(() => {
    clearLocalSignOutNotice();
    getSession.mockReset();
    observed = [];
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    flushSync(() => root.unmount());
    client.clear();
    clearLocalSignOutNotice();
    container.remove();
  });
  async function mount(count = 1, cloud = false) {
    await act(async () => root.render(<QueryClientProvider client={client}>
      {Array.from({ length: count }, (_, index) => <Observer key={index} index={index} cloud={cloud} />)}
    </QueryClientProvider>));
  }

  it("recognizes a fresh login after resetQueries rewinds the mounted observer", async () => {
    getSession.mockResolvedValueOnce(null);
    rememberLocalSignOut();
    await mount();
    await vi.waitFor(() => expect(observed[0].data).toBeNull());
    expect(hasLocalSignOutNotice()).toBe(true);
    getSession.mockResolvedValue(session("new"));
    await act(async () => { await client.resetQueries({ queryKey: queryKeys.auth.session }); });
    expect(hasLocalSignOutNotice()).toBe(false);
    expect(client.getQueryData(queryKeys.auth.session)).toEqual(session("new"));
  });

  it("ignores an old response after another local logout starts a new epoch", async () => {
    const first = pending(); const second = pending();
    getSession.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    rememberLocalSignOut(); await mount();
    await vi.waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
    await act(async () => rememberLocalSignOut());
    await vi.waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
    await act(async () => first.finish(session("old")));
    expect(hasLocalSignOutNotice()).toBe(true);
    expect(client.getQueryData(queryKeys.auth.session)).toBeNull();
    await act(async () => second.finish(session("new")));
    expect(hasLocalSignOutNotice()).toBe(false);
    expect(client.getQueryData(queryKeys.auth.session)).toEqual(session("new"));
  });

  it("does a new check on BFCache restoration instead of accepting its old result", async () => {
    const restored = pending();
    getSession.mockResolvedValueOnce(null).mockReturnValueOnce(restored.promise);
    rememberLocalSignOut(); await mount();
    await vi.waitFor(() => expect(observed[0].data).toBeNull());
    const previousKey = client.getQueryCache().getAll().find(query => query.queryKey.includes("after-sign-out"))!.queryKey;
    // A restored QueryClient may contain a result from an earlier document era.
    client.setQueryData(previousKey, session("stale-restored"));
    await act(async () => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await vi.waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
    expect(observed[0].data).toBeUndefined();
    expect(hasLocalSignOutNotice()).toBe(true);
    await act(async () => restored.finish(null));
    expect(hasLocalSignOutNotice()).toBe(true);
    expect(client.getQueryData(queryKeys.auth.session)).toBeNull();
  });

  it("does not let a parallel observer's late response replace a newer confirmed login", async () => {
    const first = pending(); const second = pending();
    getSession.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    rememberLocalSignOut(); await mount(2);
    await vi.waitFor(() => expect(getSession).toHaveBeenCalledTimes(2));
    await act(async () => second.finish(session("new")));
    expect(hasLocalSignOutNotice()).toBe(false);
    await act(async () => first.finish(session("old")));
    expect(client.getQueryData(queryKeys.auth.session)).toEqual(session("new"));
  });

  it("does not overwrite a newer standard session after the notice is dismissed", async () => {
    const old = pending(); getSession.mockReturnValueOnce(old.promise);
    rememberLocalSignOut(); await mount();
    await vi.waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
    await act(async () => {
      client.setQueryData(queryKeys.auth.session, session("new"));
      clearLocalSignOutNotice();
    });
    await act(async () => old.finish(session("old")));
    expect(client.getQueryData(queryKeys.auth.session)).toEqual(session("new"));
    expect(hasLocalSignOutNotice()).toBe(false);
  });

  it("does not publish an older response over intervening standard-cache updates", async () => {
    const old = pending(); getSession.mockReturnValueOnce(old.promise);
    rememberLocalSignOut(); await mount();
    await vi.waitFor(() => expect(getSession).toHaveBeenCalledTimes(1));
    client.setQueryData(queryKeys.auth.session, session("new"));
    await act(async () => old.finish(null));
    expect(client.getQueryData(queryKeys.auth.session)).toEqual(session("new"));
    expect(hasLocalSignOutNotice()).toBe(true);
  });

  it("leaves the Cloud session cache and request policy unchanged", async () => {
    client.setQueryData(queryKeys.auth.session, session("cloud"));
    rememberLocalSignOut(); await mount(1, true);
    expect(observed[0].data).toEqual(session("cloud"));
    expect(getSession).not.toHaveBeenCalled();
    expect(hasLocalSignOutNotice()).toBe(true);
  });
});
