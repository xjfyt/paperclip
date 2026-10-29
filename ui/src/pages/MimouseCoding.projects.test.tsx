// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MimouseCoding } from "./MimouseCoding";
const calls = vi.hoisted(() => ({ fetch: vi.fn(), search: new URLSearchParams(), navigate: vi.fn(), breadcrumb: vi.fn() }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: async () => ({ session: { id: "session", userId: "owner" }, user: { id: "owner" } }) } }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company" }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: calls.breadcrumb }) }));
vi.mock("@/lib/router", () => ({ useSearchParams: () => [calls.search, calls.navigate] }));
vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }) }));
vi.mock("./MimouseCodingRepair", () => ({ MimouseCodingRepair: () => null }));
vi.mock("@/components/MimouseCodingGoal", () => ({ MimouseCodingGoal: () => null }));
vi.mock("@/components/MimouseCodingDiffReview", () => ({ MimouseCodingDiffReview: () => null }));
vi.mock("@/components/MimouseCodingArtifacts", () => ({ MimouseCodingArtifacts: () => null }));
vi.mock("@/components/MimouseBuildMatrix", () => ({ MimouseBuildMatrix: () => null }));
vi.mock("@/components/MimouseBuildObservations", () => ({ MimouseBuildObservations: () => null }));
const firstId = "10000000-0000-4000-8000-000000000001", taskId = "20000000-0000-4000-8000-000000000001";
const page = (label = "first-visible-sha", hasMore = true) => ({ publishEnabled: false,
  deliveries: [{ id: firstId, issueId: taskId, projectId: 42, headSha: label, operationState: "local", gate: { readyForReleaseCandidate: false, blockers: ["remote_evidence_stale_or_unknown"] } }],
  pagination: { limit: 1, hasMore, nextCursor: hasMore ? firstId : null },
  projectSummary: { scope: "authorized_delivery_page", deliveryCount: 1, projects: [
    { gitlabOrigin: "https://git.example", projectId: 42, deliveryCount: 1, candidateCount: 0, blockedCount: 1, localArtifactCount: 0, trustedBuildTargetCount: 0, uploadStatus: "blocked", readyForRelease: false },
    { gitlabOrigin: "https://other.example", projectId: 42, deliveryCount: 1, candidateCount: 0, blockedCount: 1, localArtifactCount: 0, trustedBuildTargetCount: 0, uploadStatus: "blocked", readyForRelease: false },
  ] },
});
let root: Root, host: HTMLDivElement, client: QueryClient;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><MimouseCoding /></QueryClientProvider>)); await flush(); await flush(); }
function button(text: string) { const found = [...host.querySelectorAll("button")].find(item => item.textContent === text); expect(found).toBeDefined(); return found!; }
async function click(text: string) { await act(async () => button(text).click()); await render(); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks();
  calls.search = new URLSearchParams(); calls.navigate.mockImplementation((next: URLSearchParams) => { calls.search = next; });
  calls.fetch.mockResolvedValue(Response.json(page())); vi.stubGlobal("fetch", calls.fetch);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });
it("shows page-scoped boundaries and filters by origin plus project, never ID alone", async () => {
  await render(); expect(host.textContent).toContain("codingProjects.scope"); expect(host.textContent).toContain("codingProjects.boundary");
  expect(host.textContent).toContain("https://git.example"); expect(host.textContent).toContain("https://other.example"); expect(host.textContent).toContain("codingProjects.staleEvidence");
  calls.fetch.mockResolvedValue(Response.json(page("filtered")));
  await click("codingProjects.filterProject");
  expect(calls.search.get("gitlabOrigin")).toBe("https://git.example"); expect(calls.search.get("projectId")).toBe("42"); expect(calls.search.has("after")).toBe(false);
  expect(calls.fetch).toHaveBeenLastCalledWith("/api/companies/company/coding?gitlabOrigin=https%3A%2F%2Fgit.example&projectId=42", expect.objectContaining({ method: "GET", cache: "no-store", signal: expect.any(AbortSignal) }));
  calls.fetch.mockResolvedValue(Response.json(page("reset"))); await click("codingProjects.reset"); expect(calls.search.toString()).toBe("");
});
it("replaces the visible page, closes pending confirmations and returns to the first page read-only", async () => {
  await render(); await act(async () => button("coding.evidence").click()); expect(host.textContent).toContain("coding.confirmScope");
  calls.fetch.mockResolvedValue(Response.json(page("second-visible-sha", false))); await click("codingProjects.next");
  expect(calls.search.get("after")).toBe(firstId); expect(host.textContent).not.toContain("first-visible-sha"); expect(host.textContent).toContain("second-visible-sha"); expect(host.textContent).not.toContain("coding.confirmScope");
  calls.fetch.mockResolvedValue(Response.json(page())); await click("codingProjects.first"); expect(calls.search.has("after")).toBe(false);
  expect(calls.fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
});
it("does not render a late page from a newer navigation's abandoned observer", async () => {
  await render(); let resolve!: (response: Response) => void; let signal!: AbortSignal;
  calls.fetch.mockImplementationOnce((_url, init) => new Promise<Response>(done => { resolve = done; signal = init.signal; }));
  await click("codingProjects.next"); expect(host.textContent).not.toContain("first-visible-sha");
  calls.search = new URLSearchParams({ issueId: taskId }); calls.fetch.mockResolvedValue(Response.json(page("task-visible-sha", false))); await render();
  expect(signal.aborted).toBe(true); await act(async () => resolve(Response.json(page("late-private-sha")))); await flush();
  expect(host.textContent).not.toContain("late-private-sha"); expect(host.textContent).toContain("task-visible-sha");
});
it("surfaces a revoked cursor error without cached evidence and can clear the filter", async () => {
  await render(); calls.fetch.mockResolvedValue(new Response(JSON.stringify({ error: "Coding cursor not found" }), { status: 404 }));
  await click("codingProjects.next"); expect(host.querySelector('[role="alert"]')?.textContent).toBe("coding.error"); expect(host.textContent).not.toContain("first-visible-sha");
  calls.fetch.mockResolvedValue(Response.json(page("recovered"))); await click("codingProjects.reset"); expect(host.textContent).toContain("recovered");
});
