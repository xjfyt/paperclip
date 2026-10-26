// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { MimouseCoding } from "./MimouseCoding";
const calls = vi.hoisted(() => ({ fetch: vi.fn(), session: vi.fn(), breadcrumb: vi.fn(), company: "company" }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: calls.session } }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: calls.company }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: calls.breadcrumb }) }));
vi.mock("@/lib/router", () => ({ useSearchParams: () => [new URLSearchParams()] }));
vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
vi.mock("./MimouseCodingRepair", () => ({ MimouseCodingRepair: () => null }));
vi.mock("@/components/MimouseCodingDiffReview", () => ({ MimouseCodingDiffReview: () => null }));
vi.mock("@/components/MimouseBuildMatrix", () => ({ MimouseBuildMatrix: () => <p>existing matrix</p> }));
vi.mock("@/components/MimouseCodingArtifacts", () => ({ MimouseCodingArtifacts: (props: { sessionId: string; projectId: number; headSha: string; onRefresh: () => Promise<unknown> }) => <div data-artifact-session={props.sessionId} data-artifact-project={props.projectId} data-artifact-sha={props.headSha}><button onClick={() => { void props.onRefresh(); }}>read manifest</button></div> }));
const list = (sha = "a".repeat(40)) => ({ publishEnabled: false, deliveries: [{ id: "delivery", projectId: 7, issueId: "issue", headSha: sha, operationState: "local", gate: { readyForReleaseCandidate: false, blockers: [] } }] });
let root: Root, host: HTMLDivElement, client: QueryClient;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount() { await act(async () => root.render(<QueryClientProvider client={client}><MimouseCoding /></QueryClientProvider>)); await flush(); await flush(); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); calls.company = "company";
  calls.session.mockResolvedValue({ session: { id: "session-one", userId: "owner" }, user: { id: "owner" } });
  calls.fetch.mockImplementation(async () => Response.json(list())); vi.stubGlobal("fetch", calls.fetch);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });
it("routes each delivery's actual project/SHA/session to the artifact entry and reuses the matrix", async () => {
  await mount(); const panel = host.querySelector<HTMLElement>("[data-artifact-session]")!;
  expect(panel.dataset).toMatchObject({ artifactSession: "session-one", artifactProject: "7", artifactSha: "a".repeat(40) });
  expect(host.textContent).toContain("existing matrix"); expect(calls.fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  await act(async () => panel.querySelector("button")!.click()); await flush();
  expect(calls.fetch).toHaveBeenLastCalledWith("/api/companies/company/coding", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) })); expect(calls.fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});
it("same-user replacement sessions get an isolated delivery query and artifact identity", async () => {
  await mount();
  await act(async () => client.setQueryData(queryKeys.auth.session, { session: { id: "session-two", userId: "owner" }, user: { id: "owner" } }));
  await flush(); await flush();
  expect(host.querySelector<HTMLElement>("[data-artifact-session]")!.dataset.artifactSession).toBe("session-two");
  expect(client.getQueriesData({ queryKey: ["mimouse-coding", "company", "owner", "session-two"] })[0]?.[1]).toBeTruthy();
  expect(calls.fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});

it("new session reads never join an old URL-only observer or receive its late data", async () => {
  const pending: Array<{ resolve: (value: Response) => void; signal?: AbortSignal }> = [];
  calls.fetch.mockImplementation((_url, init) => new Promise<Response>(resolve => pending.push({ resolve, signal: init?.signal })));
  const oldObserver = api.get("/companies/company/coding");
  await mount(); expect(pending).toHaveLength(2);
  await act(async () => client.setQueryData(queryKeys.auth.session, { session: { id: "session-two", userId: "owner" }, user: { id: "owner" } }));
  await flush(); await flush(); expect(pending).toHaveLength(3);
  expect(pending[1].signal?.aborted).toBe(true); expect(pending[2].signal?.aborted).toBe(false);
  await act(async () => { pending[0].resolve(Response.json(list("old-observer-private"))); pending[1].resolve(Response.json(list("old-session-private"))); });
  await oldObserver; await flush(); expect(host.textContent).not.toContain("old-"); expect(host.querySelector("[data-artifact-session]")).toBeNull();
  await act(async () => pending[2].resolve(Response.json(list("new-session-sha")))); await flush();
  expect(host.querySelector<HTMLElement>("[data-artifact-session]")!.dataset).toMatchObject({ artifactSession: "session-two", artifactSha: "new-session-sha" });
});
it("session revalidation hides private operations and requires a new delivery read even for the same session", async () => {
  await mount(); expect(host.querySelector("[data-artifact-session]")).not.toBeNull();
  let sessionResult!: (value: unknown) => void, deliveryResult!: (value: Response) => void;
  calls.session.mockImplementationOnce(() => new Promise(resolve => { sessionResult = resolve; }));
  calls.fetch.mockImplementationOnce(() => new Promise(resolve => { deliveryResult = resolve; }));
  let refreshing!: Promise<void>;
  await act(async () => { refreshing = client.refetchQueries({ queryKey: queryKeys.auth.session }); }); await flush();
  expect(host.querySelector("[data-artifact-session]")).toBeNull(); expect(host.querySelector("form")).toBeNull();
  await act(async () => sessionResult({ session: { id: "session-one", userId: "owner" }, user: { id: "owner" } })); await refreshing; await flush();
  expect(host.querySelector("[data-artifact-session]")).toBeNull();
  await act(async () => deliveryResult(Response.json(list()))); await flush(); expect(host.querySelector("[data-artifact-session]")).not.toBeNull();
});
it("a confirmed local-trusted null session keeps the existing Board-authorized read path", async () => {
  calls.session.mockResolvedValue(null); await mount();
  expect(host.querySelector<HTMLElement>("[data-artifact-session]")!.dataset.artifactSession).toBe("local-board");
});
