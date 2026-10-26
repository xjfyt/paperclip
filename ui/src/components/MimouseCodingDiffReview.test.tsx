// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MimouseCodingDiffReview } from "./MimouseCodingDiffReview";
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/api/client", async original => ({ ...await original<typeof import("@/api/client")>(), api }));
vi.mock("@/api/coding-read", () => ({ readCodingEvidence: (path: string) => api.get(path) }));
vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let root: Root, host: HTMLDivElement, client: QueryClient;
const props = { companyId: "company", userId: "owner", sessionId: "session", authEpoch: 1, deliveryId: "delivery", headSha: "a".repeat(40), onReviewed: vi.fn(async () => {}) };
const diff = { baseSha: "b".repeat(40), headSha: props.headSha, digest: "d".repeat(64), projectId: 3, repository: "https://git.example/group/repo.git", complete: true, blockers: [], fileCount: 1, patch: "-old\n+new", evidence: [], artifactManifest: null };
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };
const click = async (item: Element) => { await act(async () => { item.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const button = (label: string) => [...host.querySelectorAll("button")].find(item => item.textContent === label)!;
async function mount(extra = {}) { await act(async () => root.render(<QueryClientProvider client={client}><MimouseCodingDiffReview {...props} {...extra} /></QueryClientProvider>)); await flush(); }
async function open() { await click(button("codingDiff.title")); }
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); api.get.mockResolvedValue(diff); api.post.mockResolvedValue({});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
it("shows real patch and confirms exactly the displayed base/head/digest", async () => {
  await mount(); await open(); expect(host.textContent).toContain(diff.patch); expect(button("codingDiff.save").disabled).toBe(true);
  await click(host.querySelector('input[type="checkbox"]')!); await click(button("codingDiff.save"));
  expect(api.post).toHaveBeenCalledWith("/companies/company/coding/delivery/review", { headSha: diff.headSha, baseSha: diff.baseSha, digest: diff.digest, confirm: true }); expect(props.onReviewed).toHaveBeenCalledOnce();
});
it("new digest invalidates checked consent", async () => {
  await mount(); await open(); await click(host.querySelector("input")!);
  await act(async () => client.setQueryData(["coding-diff", "company", "owner", "session", 1, "delivery", props.headSha], { ...diff, digest: "e".repeat(64) })); await flush();
  expect(button("codingDiff.save").disabled).toBe(true); expect((host.querySelector("input") as HTMLInputElement).checked).toBe(false);
});
it.each([{ ...diff, complete: false, blockers: ["diff_byte_limit"] }, { ...diff, headSha: "c".repeat(40) }])("blocks incomplete or stale snapshots", async value => {
  api.get.mockResolvedValue(value); await mount(); await open(); expect(button("codingDiff.save").disabled).toBe(true); expect((host.querySelector("input") as HTMLInputElement).disabled).toBe(true); expect(api.post).not.toHaveBeenCalled();
});
it("cancel and reopen discard consent", async () => {
  await mount(); await open(); await click(host.querySelector("input")!); await click(button("common.cancel")); await open(); expect(button("codingDiff.save").disabled).toBe(true);
});
it("company/user navigation discards the previous consent", async () => {
  await mount(); await open(); await click(host.querySelector("input")!); await mount({ companyId: "other", userId: "new-owner" });
  expect(button("codingDiff.save").disabled).toBe(true); expect(api.get).toHaveBeenLastCalledWith("/companies/other/coding/delivery/diff");
});
it("failed submission clears consent and reports failure", async () => {
  api.post.mockRejectedValue(new Error("stale")); await mount(); await open(); await click(host.querySelector("input")!); await click(button("codingDiff.save"));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("codingDiff.error"); expect(button("codingDiff.save").disabled).toBe(true);
});

it("local implicit identity cannot approve", async () => {
  await mount({ userId: "local-board" }); await open(); expect(button("codingDiff.save").disabled).toBe(true);
  expect(host.textContent).toContain("codingDiff.loginRequired"); expect(api.post).not.toHaveBeenCalled();
});
