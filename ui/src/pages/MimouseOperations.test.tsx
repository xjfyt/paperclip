// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { MimouseOperations } from "./MimouseOperations";
const calls = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), session: vi.fn(), breadcrumbs: vi.fn(), companyId: "company-a", search: new URLSearchParams(), setSearch: vi.fn() }));
vi.mock("@/api/client", () => ({ api: { get: calls.get, post: calls.post } }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: calls.session } }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: calls.companyId }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: calls.breadcrumbs }) }));
vi.mock("@/lib/router", () => ({ useSearchParams: () => [calls.search, calls.setSearch], Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a> }));
const id = "11111111-1111-4111-8111-111111111111", hash = "a".repeat(64);
const operation = { key: "b".repeat(64), sourceId: "source-a", targetId: "target-a", action: "update", before: { amount: "100.00" }, after: { amount: "123.40" }, expectedTargetHash: "c".repeat(64), expectedTargetVersion: "declared-only", sourceHash: "d".repeat(64), afterHash: "e".repeat(64) };
const base = { id, companyId: "company-a", requestId: "22222222-2222-4222-8222-222222222222", actorId: "owner-a", approvalId: null, createdAt: "2026-10-26T00:00:00Z", preview: { schemaVersion: 1, companyId: "company-a", period: "2026-10", timeZone: "Asia/Shanghai", sourceInstance: "import", targetInstance: "target", mapping: [{ sourceField: "amount", targetField: "amount" }], operations: [operation], excluded: [], counts: { insert: 0, update: 1, noop: 0, excluded: 0 }, evidenceMode: "imported_snapshot", mode: "dry_run", externalWrites: 0, previewHash: hash } };
let host: HTMLDivElement, root: Root, client: QueryClient, approved: boolean, requested: boolean, current: typeof base;
async function flush() {
  // Auth, list and detail queries form a render-dependent chain. A fixed 10ms
  // sleep races their notifications on Windows and under a loaded test shard.
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(client.isFetching()).toBe(0);
    expect(host.textContent).not.toContain(i18n.t("common.loading"));
  });
}
async function mount() { await act(async () => root.render(<QueryClientProvider client={client}><MimouseOperations /></QueryClientProvider>)); await flush(); }
function button(text: string) { const found = [...host.querySelectorAll("button")].find(item => item.textContent?.trim() === text); expect(found).toBeTruthy(); return found!; }
async function click(element: Element) { await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true }))); await flush(); }
async function setField(key: string, value: string) {
  const label = [...host.querySelectorAll("form label")].find(item => item.querySelector("span")?.textContent === i18n.t(`operationsUi.${key}`));
  const input = label?.querySelector("input,textarea") as HTMLInputElement | HTMLTextAreaElement; expect(input).toBeTruthy();
  await act(async () => { const prototype = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function submit() { await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await flush(); }
async function selectPreview() { await click(button(`2026-10 · Asia/Shanghai · ${i18n.t("operationsUi.changeCount", { amount: "1" })}`)); await flush(); }
beforeEach(async () => {
  await i18n.changeLanguage("en"); vi.clearAllMocks(); approved = false; requested = false; current = structuredClone(base); calls.companyId = "company-a"; calls.search = new URLSearchParams();
  calls.setSearch.mockImplementation(next => { calls.search = typeof next === "function" ? next(calls.search) : new URLSearchParams(next); });
  calls.session.mockResolvedValue({ user: { id: "owner-a" }, session: { userId: "owner-a" } });
  calls.get.mockImplementation(async (url: string) => {
    if (url.includes("company-b")) { if (url.endsWith("/data-operations")) return { items: [], nextBeforeId: null }; throw Error("404"); }
    if (url.endsWith("/readiness")) return { mode: "dry_run_only", writesSupported: false, externalWrites: 0, approval: requested ? { id: "approval-a", status: approved ? "approved" : "pending" } : null, blockers: ["write_adapter_not_implemented"] };
    if (url.endsWith(`/${id}`)) return { ...current, approvalId: requested ? "approval-a" : null };
    return { items: [{ id, companyId: "company-a", period: "2026-10", timeZone: "Asia/Shanghai", counts: base.preview.counts }], nextBeforeId: null };
  });
  calls.post.mockImplementation(async (url: string) => { if (url.endsWith("/request-approval")) { requested = true; return { approvalId: "approval-a", previewHash: hash }; } return { item: current, duplicate: false }; });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });
it("submits validated declarations with decimal strings and no client company or execute flag", async () => {
  await mount(); await click(button(i18n.t("operationsUi.example"))); await submit();
  expect(calls.post).toHaveBeenCalledTimes(1); const [url, payload] = calls.post.mock.calls[0];
  expect(url).toBe("/companies/company-a/data-operations"); expect(payload.sourceRecords[0].values.amount).toBe("123.40"); expect(payload.targetRecords[0].values.amount).toBe("100.00");
  expect(payload).not.toHaveProperty("companyId"); expect(payload).not.toHaveProperty("execute"); expect(payload.requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(host.textContent).toContain(i18n.t("operationsUi.noWrites"));
});
it("rejects malformed JSON or timezone without sending a request", async () => {
  await mount(); await setField("sourceRecords", "not json"); await submit(); expect(calls.post).not.toHaveBeenCalled(); expect(host.textContent).toContain(i18n.t("operationsUi.invalidInput"));
  await click(button(i18n.t("operationsUi.example"))); await setField("timeZone", "Not/AZone"); await submit(); expect(calls.post).not.toHaveBeenCalled();
});
it("requires explicit review of the immutable hash and never offers an apply action", async () => {
  await mount(); await selectPreview(); expect(button(i18n.t("operationsUi.requestReview")).disabled).toBe(true);
  await click(host.querySelector('input[type="checkbox"]')!); await click(button(i18n.t("operationsUi.requestReview")));
  expect(calls.post).toHaveBeenCalledExactlyOnceWith(`/companies/company-a/data-operations/${id}/request-approval`, { confirm: true, expectedPreviewHash: hash, locale: "en" });
  expect(host.querySelector('a[href="/approvals/approval-a"]')).not.toBeNull(); expect(host.textContent).toContain(i18n.t("operationsUi.noWrites"));
  expect(calls.post.mock.calls.some(([url]) => /apply|execute/.test(url))).toBe(false);
});
it("keeps approved review visibly separate from write availability", async () => {
  requested = true; approved = true; await mount(); await selectPreview(); expect(host.textContent).toContain(i18n.t("statuses.approved"));
  expect(host.textContent).toContain(i18n.t("operationsUi.write_adapter_not_implemented")); expect(host.querySelector('input[type="checkbox"]')).toBeNull(); expect(calls.post).not.toHaveBeenCalled();
});
it("requires revealing all rows before requesting review", async () => {
  current.preview.operations = Array.from({ length: 21 }, (_, i) => ({ ...operation, key: `key-${i}`, sourceId: `source-${i}` }));
  await mount(); await selectPreview(); expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(true);
  await click(button(i18n.t("operationsUi.showMore", { shown: "20", total: "21" }))); expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(false);
});
it("does not transfer a late approval link across companies", async () => {
  let resolve!: (value: unknown) => void; calls.post.mockReturnValue(new Promise(done => { resolve = done; }));
  await mount(); await selectPreview(); await click(host.querySelector('input[type="checkbox"]')!); await click(button(i18n.t("operationsUi.requestReview")));
  calls.companyId = "company-b"; await mount(); await act(async () => resolve({ approvalId: "approval-a", previewHash: hash })); await flush();
  expect(host.querySelector('a[href="/approvals/approval-a"]')).toBeNull(); expect(host.textContent).not.toContain('"123.40"');
});
it("edits hide the previously selected preview instead of approving stale draft contents", async () => {
  await mount(); await selectPreview(); await click(host.querySelector('input[type="checkbox"]')!); await setField("targetInstance", "different-target");
  expect(host.querySelector('input[type="checkbox"]')).toBeNull(); expect(calls.search.has("preview")).toBe(false); expect(calls.post).not.toHaveBeenCalled();
});
it("preserves data and business timezone through all four display languages", async () => {
  await mount(); await selectPreview(); for (const locale of ["zh-CN", "es", "ja", "en"]) {
    await act(async () => { await i18n.changeLanguage(locale); }); expect(host.textContent).toContain(i18n.t("operationsUi.noWrites")); expect(host.textContent).toContain('"123.40"'); expect(host.textContent).toContain("Asia/Shanghai");
    expect(host.textContent).toContain(i18n.t("operationsUi.importedSnapshot"));
  } expect(calls.post).not.toHaveBeenCalled();
});
it("does not show review controls or row values when the administrator read is denied", async () => {
  calls.get.mockRejectedValue(new Error("403")); await mount(); await flush(); expect(host.querySelector("form")).toBeNull(); expect(host.textContent).toContain(i18n.t("operationsUi.readError"));
});
