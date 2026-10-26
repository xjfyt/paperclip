// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { MimouseFeedback } from "./MimouseFeedback";
const calls = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), session: vi.fn(), breadcrumbs: vi.fn(), companyId: "company-a" as string | null }));
vi.mock("@/components/MimouseFeedbackVerification", () => ({ MimouseFeedbackVerification: () => <section data-testid="verification-panel" /> }));
vi.mock("@/components/MimouseWecomPanel", () => ({ MimouseWecomPanel: ({ companyId, userId, sessionId }: { companyId: string; userId: string; sessionId: string }) => <section data-testid="wecom-panel" data-company={companyId} data-user={userId} data-session={sessionId} /> }));
vi.mock("@/components/MimouseLangfusePanel", () => ({ MimouseLangfusePanel: ({ companyId }: { companyId: string }) => <section data-testid="langfuse-panel">{companyId}</section> }));
vi.mock("@/api/client", () => ({ api: { get: calls.get, post: calls.post } }));
vi.mock("@/api/private-feedback", () => ({ privateFeedbackGet: (...args: unknown[]) => calls.get(...args) }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: calls.session } }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: calls.companyId }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: calls.breadcrumbs }) }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => <a href={to} {...props}>{children}</a> }));
const source = { id: "source-a", companyId: "company-a", sourceKind: "manual", sourceInstance: "test-source", externalId: "event-1", title: "Customer crash", text: "Untrusted customer observation", product: "Customer App", softwareVersion: "1.0", commitSha: null, traceId: null, occurredAt: "2026-10-26T00:00:00Z", createdAt: "2026-10-26T00:00:01Z", actorId: "owner-a", redacted: true, redactionVersion: 1, ingestionMode: "manual_import", status: "candidate" };
const evidenceRecord = { feedbackId: source.id, sourceKind: source.sourceKind, sourceInstance: source.sourceInstance, externalId: source.externalId, product: source.product, softwareVersion: source.softwareVersion, commitSha: null, traceId: null, occurredAt: source.occurredAt, fingerprint: null, excerpts: [{ line: 1, text: "Error: <img src=x onerror=alert(1)>" }], checklist: { versionReference: true, commitReference: false, traceReference: false, errorStackExcerpt: false, reproduction: "not_performed", expectedBehavior: "requires_review", regressionTest: "requires_review" } };
const evidencePage = { algorithmVersion: "redacted-error-stack-v1", autoMerged: false, source: evidenceRecord, items: [], scanned: 0, scanLimit: 50, nextBeforeId: null };
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
    : url.endsWith("/evidence") || url.includes("/evidence?") ? evidencePage
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
  calls.get.mockImplementation(async (url: string) => url.endsWith("/promotion") ? { recorded: true, receipt: null } : url.endsWith("/evidence") || url.includes("/evidence?") ? evidencePage
    : url.endsWith("/candidates") ? { items: [], autoMerged: false } : url.endsWith("/source-a") ? source : { items: [source], nextBeforeId: null });
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
it.each(["en", "zh-CN", "es", "ja"])("distinguishes fetched quarantined evidence from manual labels in %s", async locale => {
  await i18n.changeLanguage(locale);
  const fetched = { ...source, sourceKind: "langfuse", ingestionMode: "provider_fetch", sourceUrl: "https://langfuse.example.invalid/project/p/traces/t" };
  calls.get.mockImplementation(async (url: string) => url.endsWith("/promotion") ? { recorded: false, receipt: null }
    : url.endsWith("/evidence") || url.includes("/evidence?") ? evidencePage
    : url.endsWith("/candidates") ? { items: [], autoMerged: false } : url.endsWith("/source-a") ? fetched : { items: [fetched], nextBeforeId: null });
  await mount(); await openReview();
  expect(i18n.exists("feedbackUi.providerFetched")).toBe(true);
  expect(host.textContent).toContain(i18n.t("feedbackUi.providerFetched"));
  expect(host.textContent).not.toContain(i18n.t("feedbackUi.manualOnly"));
  expect(host.textContent).toContain(fetched.sourceUrl);
  expect(host.querySelector('[data-testid="langfuse-panel"]')?.textContent).toBe("company-a");
  expect(calls.post).not.toHaveBeenCalled();
});

it("shows local evidence as inert text and never claims reproduction or creates a task", async () => {
  await mount(); await openReview();
  expect(host.textContent).toContain("redacted-error-stack-v1");
  expect(host.textContent).toContain(evidenceRecord.excerpts[0].text);
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toContain(i18n.t("feedbackEvidence.notReproduced"));
  expect(calls.post).not.toHaveBeenCalled();
});

it("mounts WeCom alongside Langfuse with company, user and actual session identity", async () => {
  calls.session.mockResolvedValue({ user: { id: "owner-a" }, session: { id: "session-a", userId: "owner-a" } }); await mount();
  const panel = host.querySelector('[data-testid="wecom-panel"]')!;
  expect(panel.getAttribute("data-company")).toBe("company-a"); expect(panel.getAttribute("data-user")).toBe("owner-a"); expect(panel.getAttribute("data-session")).toBe("session-a");
  expect(host.querySelector('[data-testid="langfuse-panel"]')).not.toBeNull();
});

it("removes private WeCom session identity during authentication refetch without replaying writes", async () => {
  calls.session.mockResolvedValue({ user: { id: "owner-a" }, session: { id: "session-a", userId: "owner-a" } }); await mount();
  let finish!: (value: unknown) => void; calls.session.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let refreshing!: Promise<void>; await act(async () => { refreshing = client.refetchQueries({ queryKey: queryKeys.auth.session }); }); await flush();
  expect(host.querySelector('[data-testid="wecom-panel"]')).toBeNull();
  await act(async () => { finish({ user: { id: "owner-a" }, session: { id: "session-new", userId: "owner-a" } }); await refreshing; }); await flush();
  expect(host.querySelector('[data-testid="wecom-panel"]')!.getAttribute("data-session")).toBe("session-new"); expect(calls.post).not.toHaveBeenCalled();
});

it("does not reuse warm feedback after same-user session rotation", async () => {
  client.setDefaultOptions({ queries: { retry: false, staleTime: 30_000, gcTime: 300_000 } });
  calls.session.mockResolvedValue({ user: { id: "owner-a" }, session: { id: "old", userId: "owner-a" } });
  await mount(); expect(host.textContent).toContain(source.title);
  let finish!: (value: unknown) => void;
  calls.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { client.setQueryData(queryKeys.auth.session, { user: { id: "owner-a" }, session: { id: "new", userId: "owner-a" } }); }); await flush();
  expect(host.textContent).not.toContain(source.title);
  await act(async () => finish({ items: [], nextBeforeId: null })); await flush();
  expect(host.textContent).not.toContain(source.title);
  expect(client.getQueryData(["mimouse-feedback", "company-a", "owner-a", "new", "list", undefined])).toEqual({ items: [], nextBeforeId: null });
});
it("discards pending old-session list after same-user rotation", async () => {
  let finish!: (value: unknown) => void;
  calls.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  calls.session.mockResolvedValue({ user: { id: "owner-a" }, session: { id: "old", userId: "owner-a" } });
  await mount(); calls.get.mockResolvedValue({ items: [], nextBeforeId: null });
  await act(async () => { client.setQueryData(queryKeys.auth.session, { user: { id: "owner-a" }, session: { id: "new", userId: "owner-a" } }); }); await flush();
  expect(calls.get).toHaveBeenCalledTimes(2);
  await act(async () => finish({ items: [source], nextBeforeId: null })); await flush();
  expect(host.textContent).not.toContain(source.title);
});
it.each([401, 403])("hides cached promotion receipt after %s", async status => {
  recorded = true; await mount(); await openReview();
  expect(host.querySelector('a[href="/issues/created-task"]')).not.toBeNull();
  const previous = calls.get.getMockImplementation()!;
  calls.get.mockImplementation((url: string) => url.endsWith("/promotion") ? Promise.reject(Object.assign(new Error("denied"), { status })) : previous(url));
  await act(async () => { await client.refetchQueries({ predicate: query => query.queryKey.at(-1) === "promotion" }); }); await flush();
  expect(host.querySelector('a[href="/issues/created-task"]')).toBeNull(); expect(host.textContent).not.toContain(receipt.requestId);
  expect(host.querySelectorAll("form")).toHaveLength(1);
});
it("clears a locally returned promotion receipt when authorization is subsequently denied", async () => {
  await mount(); const form = await openReview(); await completeReview(form); await submit(form);
  expect(host.querySelector('a[href="/issues/created-task"]')).not.toBeNull();
  const previous = calls.get.getMockImplementation()!;
  calls.get.mockImplementation((url: string) => url.endsWith("/promotion") ? Promise.reject(Object.assign(new Error("denied"), { status: 403 })) : previous(url));
  await act(async () => { await client.refetchQueries({ predicate: query => query.queryKey.at(-1) === "promotion" }); }); await flush();
  expect(host.querySelector('a[href="/issues/created-task"]')).toBeNull();
  calls.get.mockImplementation((url: string) => url.endsWith("/promotion") ? Promise.resolve({ recorded: false, receipt: null }) : previous(url));
  await act(async () => { await client.refetchQueries({ predicate: query => query.queryKey.at(-1) === "promotion" }); }); await flush();
  expect(host.querySelector('a[href="/issues/created-task"]')).toBeNull();
  expect(host.textContent).not.toContain(receipt.requestId);
});
