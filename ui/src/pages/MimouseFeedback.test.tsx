// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { MimouseFeedback } from "./MimouseFeedback";
const calls = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), session: vi.fn(), breadcrumbs: vi.fn(), companyId: "company-a" as string | null }));
vi.mock("@/api/client", () => ({ api: { get: calls.get, post: calls.post } }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: calls.session } }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: calls.companyId }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: calls.breadcrumbs }) }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a> }));
const source = { id: "source-a", companyId: "company-a", sourceKind: "manual", sourceInstance: "test-source", externalId: "event-1", title: "Customer crash", text: "Untrusted customer observation", product: "Customer App", softwareVersion: "1.0", commitSha: null, traceId: null, occurredAt: "2026-10-26T00:00:00Z", createdAt: "2026-10-26T00:00:01Z", actorId: "owner-a", redacted: true, redactionVersion: 1, ingestionMode: "manual_import", status: "candidate" };
const receipt = { requestId: "request-original", feedbackId: "source-a", issueId: "created-task", actorUserId: "owner-a", createdAt: "2026-10-26T00:00:02Z", initialStatus: "backlog", initialVisibility: "private", agentDispatched: false };
let host: HTMLDivElement, root: Root, client: QueryClient, recorded: boolean;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function mount() { await act(async () => root.render(<QueryClientProvider client={client}><MimouseFeedback /></QueryClientProvider>)); await flush(); }
function button(text: string) { const found = [...host.querySelectorAll("button")].find(item => item.textContent?.trim() === text); expect(found).toBeTruthy(); return found!; }
async function click(element: Element) { await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true }))); await flush(); }
async function setField(form: HTMLFormElement, key: string, value: string) {
  const label = [...form.querySelectorAll("label")].find(item => item.querySelector("span")?.textContent === i18n.t(`feedbackUi.${key}`));
  const input = label?.querySelector("input,textarea") as HTMLInputElement | HTMLTextAreaElement; expect(input).toBeTruthy();
  await act(async () => { const prototype = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function openReview() { await click(button("Customer crash · Customer App · 1.0")); await flush(); return host.querySelectorAll("form")[1]; }
async function completeReview(form: HTMLFormElement) { await setField(form, "reproduction", "Click Save."); await setField(form, "expectedBehavior", "No crash."); await setField(form, "acceptanceCriteria", "Regression passes\nNo secret leak"); await click(form.querySelector('input[type="checkbox"]')!); }
async function submit(form: HTMLFormElement) { await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await flush(); }
beforeEach(async () => {
  await i18n.changeLanguage("en"); calls.companyId = "company-a"; recorded = false; vi.clearAllMocks();
  calls.session.mockResolvedValue({ user: { id: "owner-a" }, session: { userId: "owner-a" } });
  calls.get.mockImplementation(async (url: string) => url.endsWith("/promotion") ? { recorded, receipt: recorded ? receipt : null }
    : url.endsWith("/candidates") ? { items: [], hasMore: false, autoMerged: false }
    : url.endsWith("/source-a") ? source
    : { items: calls.companyId === "company-b" ? [] : [source], nextBeforeId: null });
  calls.post.mockImplementation(async (url: string) => { if (url.endsWith("/promote")) { recorded = true; return receipt; } return { item: source, duplicate: false }; });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });
it("requires explicit review confirmation and sends only the bounded backlog contract", async () => {
  await mount(); const form = await openReview(); expect(form).toBeTruthy();
  expect(button(i18n.t("feedbackUi.createTask")).disabled).toBe(true);
  await completeReview(form); await submit(form);
  expect(calls.post).toHaveBeenCalledTimes(1);
  const [url, payload] = calls.post.mock.calls[0]; expect(url).toBe("/companies/company-a/feedback-inbox/source-a/promote");
  expect(payload).toMatchObject({ confirm: true, title: "Customer crash", reproduction: "Click Save.", acceptanceCriteria: ["Regression passes", "No secret leak"] });
  expect(payload).not.toHaveProperty("assigneeAgentId"); expect(payload.requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(host.querySelector('a[href="/issues/created-task"]')).not.toBeNull(); expect(host.textContent).toContain(i18n.t("feedbackUi.confirmed"));
});
it("changing review contents clears confirmation", async () => { await mount(); const form = await openReview(); await completeReview(form); await setField(form, "expectedBehavior", "Updated expected behavior"); expect(button(i18n.t("feedbackUi.createTask")).disabled).toBe(true); expect(calls.post).not.toHaveBeenCalled(); });
it("retries an unknown result with the exact frozen payload and request ID", async () => {
  calls.post.mockRejectedValue(new Error("transport unknown")); await mount(); const form = await openReview(); await completeReview(form); await submit(form);
  expect((form.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  const first = calls.post.mock.calls[0][1]; await submit(form); expect(calls.post.mock.calls[1][1]).toEqual(first); expect(calls.post).toHaveBeenCalledTimes(2);
});
it("reads a persisted confirmation after reload without submitting again", async () => { recorded = true; await mount(); await openReview(); expect(host.querySelector('a[href="/issues/created-task"]')).not.toBeNull(); expect(calls.post).not.toHaveBeenCalled(); expect(host.querySelectorAll("form")).toHaveLength(1); });
it("does not disclose another reviewer's private receipt or offer a second creation", async () => {
  calls.get.mockImplementation(async (url: string) => url.endsWith("/promotion") ? { recorded: true, receipt: null } : url.endsWith("/candidates") ? { items: [], autoMerged: false } : url.endsWith("/source-a") ? source : { items: [source], nextBeforeId: null });
  await mount(); await openReview(); expect(host.textContent).toContain(i18n.t("feedbackUi.alreadyConfirmed")); expect(host.querySelectorAll("form")).toHaveLength(1); expect(host.querySelector('a[href="/issues/created-task"]')).toBeNull();
});
it("keeps late import replies scoped to the previous company", async () => {
  let resolve!: (value: unknown) => void; calls.post.mockReturnValue(new Promise(done => { resolve = done; }));
  await mount(); const form = host.querySelector("form")!; await setField(form, "title", "Private old-company note"); await setField(form, "product", "Old App"); await setField(form, "text", "Old private text"); await submit(form);
  calls.companyId = "company-b"; await mount(); await act(async () => { resolve({ item: source, duplicate: false }); }); await flush();
  expect(host.textContent).not.toContain("Customer crash"); expect(host.textContent).not.toContain(i18n.t("feedbackUi.imported"));
  expect([...host.querySelectorAll("input,textarea")].some(item => (item as HTMLInputElement).value.includes("Private old-company"))).toBe(false);
});
it("does not expose import forms on denied reads", async () => { calls.get.mockRejectedValue(new Error("403")); await mount(); await flush(); expect(host.querySelector("form")).toBeNull(); expect(host.textContent).toContain(i18n.t("feedbackUi.readError")); });
it("does not offer task confirmation to implicit local access", async () => { calls.session.mockResolvedValue({ user: null, session: null }); await mount(); await openReview(); expect(host.textContent).toContain(i18n.t("feedbackUi.sessionRequired")); expect(host.querySelectorAll("form")).toHaveLength(1); expect(calls.get.mock.calls.some(([url]) => url.endsWith("/promotion"))).toBe(false); });
it("switches all four languages without translating customer content or resetting the review draft", async () => {
  await mount(); const form = await openReview(); await completeReview(form);
  for (const locale of ["zh-CN", "es", "ja", "en"]) { await act(async () => { await i18n.changeLanguage(locale); });
    expect(host.textContent).toContain(i18n.t("feedbackUi.boundary")); expect(host.textContent).toContain(i18n.t("feedbackUi.reviewBoundary"));
    expect(host.textContent).toContain("Customer crash"); expect([...form.querySelectorAll("textarea")].some(item => item.value === "Click Save.")).toBe(true);
    expect((form.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  }
  expect(calls.post).not.toHaveBeenCalled();
});

it("ignores a late private task receipt after switching organizations", async () => {
  let resolve!: (value: unknown) => void; calls.post.mockReturnValue(new Promise(done => { resolve = done; }));
  await mount(); const form = await openReview(); await completeReview(form); await submit(form);
  calls.companyId = "company-b"; await mount(); await act(async () => { resolve(receipt); }); await flush();
  expect(host.querySelector('a[href="/issues/created-task"]')).toBeNull();
  expect(host.textContent).not.toContain(i18n.t("feedbackUi.confirmed"));
  expect(host.textContent).not.toContain("Customer crash");
});
