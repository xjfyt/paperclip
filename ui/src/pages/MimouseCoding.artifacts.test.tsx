// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { MimouseCoding } from "./MimouseCoding";
const calls = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), session: vi.fn(), breadcrumb: vi.fn(), company: "company" }));
vi.mock("@/api/client", () => ({ api: { get: calls.get, post: calls.post } }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: calls.session } }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: calls.company }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: calls.breadcrumb }) }));
vi.mock("@/lib/router", () => ({ useSearchParams: () => [new URLSearchParams()] }));
vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
vi.mock("./MimouseCodingRepair", () => ({ MimouseCodingRepair: () => null }));
vi.mock("@/components/MimouseCodingDiffReview", () => ({ MimouseCodingDiffReview: () => null }));
vi.mock("@/components/MimouseBuildMatrix", () => ({ MimouseBuildMatrix: () => <p>existing matrix</p> }));
vi.mock("@/components/MimouseCodingArtifacts", () => ({ MimouseCodingArtifacts: (props: { sessionId: string; projectId: number; headSha: string; onRefresh: () => Promise<unknown> }) => <div data-artifact-session={props.sessionId} data-artifact-project={props.projectId} data-artifact-sha={props.headSha}><button onClick={() => { void props.onRefresh(); }}>read manifest</button></div> }));
let root: Root, host: HTMLDivElement, client: QueryClient;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount() { await act(async () => root.render(<QueryClientProvider client={client}><MimouseCoding /></QueryClientProvider>)); await flush(); await flush(); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); calls.company = "company";
  calls.session.mockResolvedValue({ session: { id: "session-one", userId: "owner" }, user: { id: "owner" } });
  calls.get.mockResolvedValue({ publishEnabled: false, deliveries: [{ id: "delivery", projectId: 7, issueId: "issue", headSha: "a".repeat(40), operationState: "local", gate: { readyForReleaseCandidate: false, blockers: [] } }] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
it("routes each delivery's actual project/SHA/session to the artifact entry and reuses the matrix", async () => {
  await mount(); const panel = host.querySelector<HTMLElement>("[data-artifact-session]")!;
  expect(panel.dataset).toMatchObject({ artifactSession: "session-one", artifactProject: "7", artifactSha: "a".repeat(40) });
  expect(host.textContent).toContain("existing matrix"); expect(calls.post).not.toHaveBeenCalled();
  await act(async () => panel.querySelector("button")!.click()); await flush();
  expect(calls.get).toHaveBeenLastCalledWith("/companies/company/coding", { cache: "no-store" }); expect(calls.post).not.toHaveBeenCalled();
});
it("same-user replacement sessions get an isolated delivery query and artifact identity", async () => {
  await mount();
  await act(async () => client.setQueryData(queryKeys.auth.session, { session: { id: "session-two", userId: "owner" }, user: { id: "owner" } }));
  await flush(); await flush();
  expect(host.querySelector<HTMLElement>("[data-artifact-session]")!.dataset.artifactSession).toBe("session-two");
  expect(client.getQueryData(["mimouse-coding", "company", "owner", "session-two"])).toBeTruthy();
  expect(calls.post).not.toHaveBeenCalled();
});
