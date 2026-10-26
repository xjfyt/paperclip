// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { MimouseResearch } from "./MimouseResearch";
const calls = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), session: vi.fn(), breadcrumbs: vi.fn(), companyId: "company-a", search: new URLSearchParams(), setSearch: vi.fn() }));
vi.mock("@/components/mimouse-research/ResearchRoutinePanel", () => ({ ResearchRoutinePanel: () => null }));
vi.mock("@/api/client", () => ({ api: { get: calls.get, post: calls.post } }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: calls.session } }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: calls.companyId }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: calls.breadcrumbs }) }));
vi.mock("@/lib/router", () => ({ useSearchParams: () => [calls.search, calls.setSearch], Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a> }));
const id = "11111111-1111-4111-8111-111111111111", hash = "a".repeat(64), task = "22222222-2222-4222-8222-222222222222";
const item = { id, companyId: "company-a", requestId: "33333333-3333-4333-8333-333333333333", actorId: "owner-a", createdAt: "2026-10-26T00:00:00Z", evidenceHash: hash, status: "candidate",
  evidence: { title: "Candidate evidence", product: "Example product", currentState: "Manual checks", proposedState: "Reviewed workflow", recommendation: "Review first",
    sources: [{ url: "https://docs.example.invalid/guide", retrievedAt: "2026-10-25T04:00:00.000Z", evidence: "<script>untrusted()</script>" }], evidenceMode: "manual_import", redacted: false, redactionVersion: 1 } };
const receipt = { requestId: "44444444-4444-4444-8444-444444444444", candidateId: id, issueId: task, actorUserId: "owner-a", evidenceHash: hash, createdAt: "2026-10-26T00:00:00Z", initialStatus: "backlog", initialVisibility: "private", agentDispatched: false };
let host: HTMLDivElement, root: Root, client: QueryClient, recorded: boolean;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function mount() { await act(async () => root.render(<QueryClientProvider client={client}><MimouseResearch /></QueryClientProvider>)); await flush(); await flush(); }
function button(text: string) { const found = [...host.querySelectorAll("button")].find(node => node.textContent?.trim() === text); expect(found).toBeTruthy(); return found!; }
async function click(element: Element) { await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); await flush(); }
async function field(key: string, value: string, form = 0) {
  const label = [...host.querySelectorAll("form")[form].querySelectorAll("label")].find(node => node.querySelector("span")?.textContent === i18n.t(`researchUi.${key}`));
  const input = label?.querySelector("input,textarea") as HTMLInputElement | HTMLTextAreaElement; expect(input).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function submit(form = 0) { await act(async () => host.querySelectorAll("form")[form].dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await flush(); }
beforeEach(async () => {
  vi.clearAllMocks(); await i18n.changeLanguage("en"); calls.companyId = "company-a"; calls.search = new URLSearchParams(); recorded = false;
  calls.session.mockResolvedValue({ user: { id: "owner-a" }, session: { userId: "owner-a" } });
  calls.get.mockImplementation(async (url: string) => {
    if (url.includes("company-b")) return { items: [], nextBeforeId: null };
    if (url.endsWith("/promotion")) return { recorded, receipt: recorded ? receipt : null };
    if (url.endsWith("/" + id)) return item;
    return { items: [{ id, companyId: "company-a", title: item.evidence.title, product: item.evidence.product }], nextBeforeId: null };
  });
  calls.post.mockImplementation(async (url: string) => { if (url.endsWith("/promote")) { recorded = true; return receipt; } return { item, duplicate: false }; });
  calls.setSearch.mockImplementation(next => { calls.search = typeof next === "function" ? next(calls.search) : new URLSearchParams(next); });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });
it("imports validated source declarations without auto-fetching or dispatching", async () => {
  await mount(); await click(button(i18n.t("operationsUi.example"))); await submit();
  expect(calls.post).toHaveBeenCalledTimes(1); const [url, payload] = calls.post.mock.calls[0];
  expect(url).toBe("/companies/company-a/research-candidates"); expect(payload.sources[0].url).toBe("https://docs.example.invalid/guide");
  expect(payload).not.toHaveProperty("companyId"); expect(payload).not.toHaveProperty("execute"); expect(calls.search.get("candidate")).toBe(id);
  expect(host.textContent).toContain(i18n.t("researchUi.created"));
});
it("rejects malformed source JSON and preserves the request identity across failed retries", async () => {
  await mount(); await click(button(i18n.t("operationsUi.example"))); await field("sources", "not json"); await submit(); expect(calls.post).not.toHaveBeenCalled();
  await field("sources", JSON.stringify(item.evidence.sources)); calls.post.mockRejectedValue(Error("Unknown outcome")); await submit(); await submit();
  expect(calls.post.mock.calls[0][1]).toEqual(calls.post.mock.calls[1][1]); expect(host.textContent).toContain(i18n.t("researchUi.saveError"));
});
it.each(["en", "zh-CN", "es", "ja"])("renders source evidence as inert text and preserves hash/time in %s", async locale => {
  await i18n.changeLanguage(locale); calls.search = new URLSearchParams({ candidate: id }); await mount();
  expect(i18n.exists("researchUi.unverified")).toBe(true); expect(host.textContent).toContain(i18n.t("researchUi.unverified"));
  expect(host.textContent).toContain(hash); expect(host.textContent).toContain("2026-10-25T04:00:00.000Z"); expect(host.querySelector("script")).toBeNull();
  expect(host.textContent).toContain("<script>untrusted()</script>"); expect(calls.post).not.toHaveBeenCalled();
});
it("requires explicit scope, benefit and confirmation and binds the evidence hash", async () => {
  calls.search = new URLSearchParams({ candidate: id }); await mount();
  await field("scope", "Only reviewed change", 1); await field("expectedBenefit", "Testable benefit", 1); await field("acceptanceCriteria", "Pass regression", 1);
  await field("dependencyIssueIds", task, 1); await submit(1); expect(calls.post).not.toHaveBeenCalled();
  await click(host.querySelector('input[type="checkbox"]')!); await submit(1);
  const [url, payload] = calls.post.mock.calls[0]; expect(url).toBe(`/companies/company-a/research-candidates/${id}/promote`);
  expect(payload).toMatchObject({ confirm: true, expectedEvidenceHash: hash, scope: "Only reviewed change", dependencyIssueIds: [task], acceptanceCriteria: ["Pass regression"] });
  expect(payload).not.toHaveProperty("assigneeAgentId"); expect(host.querySelector(`a[href="/issues/${task}"]`)).not.toBeNull();
});
it("recovers an existing confirmation by GET without creating a second task", async () => {
  recorded = true; calls.search = new URLSearchParams({ candidate: id }); await mount();
  expect(host.querySelector(`a[href="/issues/${task}"]`)).not.toBeNull(); expect(host.querySelectorAll("form")).toHaveLength(1); expect(calls.post).not.toHaveBeenCalled();
});
it("hides import and evidence when administrator access is denied", async () => {
  calls.get.mockRejectedValue(Error("403")); calls.search = new URLSearchParams({ candidate: id }); await mount();
  expect(host.querySelector("form")).toBeNull(); expect(host.textContent).not.toContain(hash); expect(host.textContent).toContain(i18n.t("researchUi.readError"));
});
it("drops in-memory research drafts when switching companies", async () => {
  await mount(); await field("title", "Private company A draft"); calls.companyId = "company-b"; calls.search = new URLSearchParams(); await mount();
  expect([...host.querySelectorAll("input")].some(input => input.value === "Private company A draft")).toBe(false); expect(calls.post).not.toHaveBeenCalled();
});
