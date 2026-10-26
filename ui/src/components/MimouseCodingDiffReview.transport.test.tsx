// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { MimouseCodingDiffReview } from "./MimouseCodingDiffReview";
vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const props = { companyId: "company", userId: "owner", sessionId: "session-one", authEpoch: 1, deliveryId: "delivery", headSha: "a".repeat(40), onReviewed: vi.fn(async () => {}) };
const diff = (patch: string) => ({ baseSha: "b".repeat(40), headSha: props.headSha, digest: "d".repeat(64), projectId: 3, repository: "https://git.example/group/repo.git", complete: true, blockers: [], fileCount: 1, patch, evidence: [], artifactManifest: null });
let root: Root, host: HTMLDivElement, client: QueryClient;
const fetchMock = vi.fn();
const button = (text: string) => [...host.querySelectorAll("button")].find(item => item.textContent === text)!;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function click(item: HTMLElement) { await act(async () => item.click()); await flush(); }
async function mount(extra: Partial<typeof props> = {}) { await act(async () => root.render(<QueryClientProvider client={client}><MimouseCodingDiffReview {...props} {...extra} /></QueryClientProvider>)); await flush(); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockResolvedValue(Response.json(diff("current patch")));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });
it("a new session owns a separate abortable transport despite an old URL-only diff observer", async () => {
  const pending: Array<{ resolve: (value: Response) => void; signal?: AbortSignal }> = [];
  fetchMock.mockImplementation((_url, init) => new Promise<Response>(resolve => pending.push({ resolve, signal: init?.signal })));
  const observer = api.get("/companies/company/coding/delivery/diff");
  await mount(); await click(button("codingDiff.title")); expect(pending).toHaveLength(2);
  await mount({ sessionId: "session-two" }); expect(pending).toHaveLength(3);
  expect(pending[1].signal?.aborted).toBe(true); expect(pending[2].signal?.aborted).toBe(false);
  await act(async () => { pending[0].resolve(Response.json(diff("old-observer-private"))); pending[1].resolve(Response.json(diff("old-session-private"))); });
  await observer; await flush(); expect(host.textContent).not.toContain("old-"); expect(button("codingDiff.save").disabled).toBe(true);
  await act(async () => pending[2].resolve(Response.json(diff("new private patch")))); await flush();
  expect(host.textContent).toContain("new private patch"); expect(button("codingDiff.save").disabled).toBe(true);
  expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "GET", cache: "no-store", credentials: "include" });
});
it("same-session auth epoch change discards both cached patch and checked consent", async () => {
  await mount(); await click(button("codingDiff.title")); await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  let resolve!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  await mount({ authEpoch: 2 }); expect(host.textContent).not.toContain("current patch"); expect(button("codingDiff.save").disabled).toBe(true);
  await act(async () => resolve(Response.json(diff("refreshed patch")))); await flush();
  expect(host.textContent).toContain("refreshed patch"); expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
});
it("a late review write cannot close or refresh the replacement session", async () => {
  let resolve!: (value: Response) => void;
  fetchMock.mockImplementation((_url, init) => init.method === "POST" ? new Promise<Response>(done => { resolve = done; }) : Promise.resolve(Response.json(diff("current patch"))));
  await mount(); await click(button("codingDiff.title")); await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!); await click(button("codingDiff.save"));
  await mount({ sessionId: "session-two" }); await act(async () => resolve(Response.json({ reviewed: true }))); await flush();
  expect(props.onReviewed).not.toHaveBeenCalled(); expect(host.textContent).toContain("current patch"); expect(button("codingDiff.save").disabled).toBe(true);
});
it("a denied diff refresh hides previously cached private evidence and confirmation", async () => {
  await mount(); await click(button("codingDiff.title")); expect(host.textContent).toContain("current patch");
  fetchMock.mockResolvedValueOnce(Response.json({ error: "forbidden" }, { status: 403 }));
  await act(async () => { await client.invalidateQueries({ queryKey: ["coding-diff"] }); }); await flush();
  expect(host.textContent).not.toContain("current patch"); expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  expect(button("codingDiff.save").disabled).toBe(true); expect(host.textContent).toContain("codingDiff.error");
});
