// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MimouseFeedbackVerification } from "./MimouseFeedbackVerification";
import en from "../i18n/contributions/feedbackVerification/en.json";
const calls = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/api/client", () => ({ api: { post: calls.post } }));
vi.mock("@/api/private-feedback", () => ({ privateFeedbackGet: (...args: unknown[]) => calls.get(...args) }));
vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => (en as Record<string, string>)[key.replace("feedbackVerification.", "")] ?? key }) }));
const uid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const failed = { deliveryId: uid(5), checkIndex: 0, commitSha: "a".repeat(40), status: "failed", exitCode: 1, startedAt: "2026-01-01T01:00:00Z", finishedAt: "2026-01-01T01:01:00Z", commandDigest: "c".repeat(64), logRefDigest: "d".repeat(64), checkDigest: "e".repeat(64), provenance: "operator_supplied" };
const passed = { ...failed, deliveryId: uid(6), commitSha: "b".repeat(40), status: "passed", exitCode: 0 };
const preview = { previewDigest: "f".repeat(64), assessment: "awaiting_human_attestation", snapshot: { feedbackId: uid(2), source: { sourceKind: "manual", sourceInstance: "fixture", externalId: "event-1", product: "Editor", softwareVersion: "1", traceId: null }, reproduction: failed, regression: passed } };
const receipt = { ...preview, id: uid(9), requestId: uid(8), actorUserId: "owner", createdAt: "2026-01-01T03:00:00Z", historical: true, assessment: "human_attested" };
let host: HTMLDivElement, root: Root, client: QueryClient, history: unknown[];
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function mount(sessionId = "session-a", companyId = "company-a") { await act(async () => root.render(<QueryClientProvider client={client}><MimouseFeedbackVerification companyId={companyId} userId="owner" sessionId={sessionId} id={uid(2)} /></QueryClientProvider>)); await flush(); }
function button(text: string) { const found = [...host.querySelectorAll("button")].find(node => node.textContent === text); expect(found).toBeTruthy(); return found!; }
async function click(node: Element) { await act(async () => node.dispatchEvent(new MouseEvent("click", { bubbles: true }))); await flush(); }
async function choose(index: number, value: string) { await act(async () => { const select = host.querySelectorAll("select")[index]; select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); }); await flush(); }
async function selectAndPreview() { await choose(0, `${failed.deliveryId}:0`); await choose(1, `${passed.deliveryId}:0`); await click(button(en.preview)); }
async function confirmAll() { for (const checkbox of host.querySelectorAll('input[type="checkbox"]')) await click(checkbox); }
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  history = []; vi.clearAllMocks(); calls.get.mockImplementation(async (url: string) => url.endsWith("/verification-options") ? { checks: [failed, passed], scanLimit: 50, hasMore: false } : { items: history, hasMore: false });
  calls.post.mockImplementation(async (url: string) => { if (url.endsWith("/verification-preview")) return preview; history = [receipt]; return receipt; });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
it("does not execute on read and requires all three human attestations before a single guarded save", async () => {
  await mount(); expect(calls.post).not.toHaveBeenCalled(); expect(host.textContent).toContain(en.boundary);
  await selectAndPreview(); expect(button(en.record).disabled).toBe(true);
  await confirmAll(); expect(button(en.record).disabled).toBe(false);
  const save = button(en.record);
  await act(async () => { save.dispatchEvent(new MouseEvent("click", { bubbles: true })); save.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); await flush();
  const writes = calls.post.mock.calls.filter(([url]) => url.endsWith("/verifications")); expect(writes).toHaveLength(1);
  expect(writes[0][1]).toMatchObject({ reproduction: { deliveryId: failed.deliveryId, checkIndex: 0 }, regression: { deliveryId: passed.deliveryId, checkIndex: 0 }, previewDigest: preview.previewDigest, confirmReproduction: true, confirmFix: true, confirmComparableEnvironment: true });
  expect(writes[0][1]).not.toHaveProperty("status"); expect(writes[0][1]).not.toHaveProperty("command");
  expect(host.textContent).toContain(en.attested); expect(host.textContent).toContain(en.historical);
});
it("editing either selection clears preview and confirmations, while cancel performs no write", async () => {
  await mount(); await selectAndPreview(); await confirmAll();
  await choose(1, ""); expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(0); expect(host.textContent).not.toContain(en.record);
  await choose(1, `${passed.deliveryId}:0`); await click(button(en.preview)); expect(button(en.record).disabled).toBe(true);
  await click(button(en.cancel)); expect(host.textContent).not.toContain(en.awaiting);
  expect(calls.post.mock.calls.every(([url]) => url.endsWith("/verification-preview"))).toBe(true);
});
it("same-user session rotation drops a pending old-session preview and private history", async () => {
  let finish!: (value: unknown) => void; calls.post.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await selectAndPreview(); await mount("session-b");
  await act(async () => finish(preview)); await flush();
  expect(host.textContent).not.toContain(en.awaiting); expect(host.textContent).not.toContain(en.record);
  expect(calls.get.mock.calls.some(([, signal]) => signal instanceof AbortSignal)).toBe(true);
});
it("retains the same request id on uncertain retry and does not silently create a new attestation", async () => {
  let failedOnce = false;
  calls.post.mockImplementation(async (url: string) => {
    if (url.endsWith("/verification-preview")) return preview;
    if (!failedOnce) { failedOnce = true; throw Error("unknown response"); } history = [receipt]; return receipt;
  });
  await mount(); await selectAndPreview(); await confirmAll(); await click(button(en.record)); await flush();
  expect(host.textContent).toContain(en.saveError); await click(button(en.retry)); await flush();
  const writes = calls.post.mock.calls.filter(([url]) => url.endsWith("/verifications")); expect(writes).toHaveLength(2); expect(writes[1][1]).toEqual(writes[0][1]);
});
it("hides cached private records and the confirmation action when authority revalidation fails", async () => {
  history = [receipt]; await mount(); await selectAndPreview(); await confirmAll();
  calls.get.mockRejectedValue(Error("access revoked"));
  await act(async () => { await client.invalidateQueries({ queryKey: ["feedback-verification"] }); }); await flush();
  expect(host.textContent).toContain(en.readError); expect(host.textContent).not.toContain(en.record); expect(host.textContent).not.toContain(receipt.id);
});
