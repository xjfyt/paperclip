// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthSessionFence } from "@/hooks/useAuthSessionFence";
import { queryKeys } from "@/lib/queryKeys";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n, runLogMessages } from "@/i18n/feedback-run-log-test-resources";
import { MimouseFeedbackRunLog, MimouseFeedbackRunLogSource } from "./MimouseFeedbackRunLog";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const calls = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), imported: vi.fn() }));
vi.mock("@/api/client", () => ({ api: { post: calls.post } }));
vi.mock("@/api/private-feedback", () => ({ privateFeedbackGet: calls.get }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>, DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>, DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>, DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p> }));
const runId = "11111111-1111-4111-8111-111111111111";
const reference = { contractVersion: "feedback-run-log-reference-v1", companyId: "company-a", runId, eventId: "17", eventSeq: 1,
  runCreatedAt: "2026-10-29T00:00:00Z", eventCreatedAt: "2026-10-29T00:00:01Z", referenceDigest: "a".repeat(64), softwareVersion: "unknown", commitSha: null, reproduction: "not_performed", contentIncluded: false };
const preview = { reference, previewDigest: "b".repeat(64) }, receipt = { item: { id: "feedback-a" }, duplicate: false };
let root: Root, host: HTMLDivElement;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function render(overrides = {}) { await act(async () => root.render(<MimouseFeedbackRunLog companyId="company-a" userId="user-a" sessionId="session-a" onImported={calls.imported} {...overrides} />)); }
function button(key: string) { const node = [...host.querySelectorAll("button")].find(item => item.textContent === i18n.t(`feedbackRunLogUi.${key}`)); expect(node).toBeTruthy(); return node!; }
async function click(node: Element) { await act(async () => node.dispatchEvent(new MouseEvent("click", { bubbles: true }))); await flush(); }
async function input(index: number, value: string) { const node = host.querySelectorAll("input")[index]; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function select() { await click(button("open")); await input(0, runId); await input(1, "1"); }
async function confirm() { await click(button("preview")); await click(host.querySelector('input[type="checkbox"]')!); }
beforeEach(async () => { vi.clearAllMocks(); await i18n.changeLanguage("en"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); calls.post.mockImplementation(async (url: string) => url.endsWith("preview") ? preview : receipt); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); await i18n.changeLanguage("en"); });
it("requires an explicit preview and confirmation and sends no source text", async () => {
  await render(); expect(calls.post).not.toHaveBeenCalled(); await select(); expect(button("import").disabled).toBe(true); await confirm(); await click(button("import"));
  expect(calls.post.mock.calls).toEqual([["/companies/company-a/feedback-inbox/run-log-preview", { runId, eventSeq: 1 }], ["/companies/company-a/feedback-inbox/run-log-import", { runId, eventSeq: 1, previewDigest: preview.previewDigest, confirm: true }]]);
  expect(calls.imported).toHaveBeenCalledTimes(1); expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it.each(["company", "user", "session", "close"])("discards old preview on %s lifecycle change", async kind => {
  let resolve!: (value: unknown) => void; calls.post.mockReturnValue(new Promise(done => { resolve = done; })); await render(); await select(); await click(button("preview"));
  if (kind === "close") { await click(button("cancel")); await click(button("open")); } else await render(kind === "company" ? { companyId: "company-b" } : kind === "user" ? { userId: "user-b" } : { sessionId: "session-b" });
  await act(async () => resolve(preview)); await flush(); expect(host.textContent).not.toContain(reference.referenceDigest); expect(calls.imported).not.toHaveBeenCalled();
});
it("new selection clears confirmation and stale in-flight previews cannot overwrite it", async () => {
  await render(); await select(); await confirm(); await input(1, "2"); expect(button("import").disabled).toBe(true); expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  let resolve!: (value: unknown) => void; calls.post.mockReturnValue(new Promise(done => { resolve = done; })); await click(button("preview")); await input(1, "3");
  await act(async () => resolve({ ...preview, reference: { ...reference, eventSeq: 2 } })); await flush(); expect(host.textContent).not.toContain(reference.referenceDigest);
});
it("freezes same-attempt retries, prevents same-tick duplicates and ignores late import after reopen", async () => {
  await render(); await select(); await confirm(); let reject!: (error: Error) => void; calls.post.mockReturnValue(new Promise((_done, fail) => { reject = fail; }));
  const save = button("import"); await act(async () => { save.click(); save.click(); }); expect(calls.post).toHaveBeenCalledTimes(2);
  await act(async () => reject(new Error("PRIVATE_PROVIDER_ERROR"))); await flush(); expect(host.textContent).not.toContain("PRIVATE_PROVIDER_ERROR");
  const sent = calls.post.mock.calls[1][1]; let resolve!: (value: unknown) => void; calls.post.mockReturnValue(new Promise(done => { resolve = done; })); await click(button("retry")); expect(calls.post.mock.calls[2][1]).toEqual(sent);
  await click(button("cancel")); await click(button("open")); await act(async () => resolve(receipt)); await flush(); expect(calls.imported).not.toHaveBeenCalled(); expect(host.querySelector('[role="dialog"]')).not.toBeNull();
});
it("keeps raw identifiers while changing only local copy in all four languages", async () => {
  await render(); await select(); await confirm();
  for (const [locale, messages] of Object.entries(runLogMessages)) { await act(async () => { await i18n.changeLanguage(locale); }); expect(host.textContent).toContain(messages.boundary); expect(host.textContent).toContain(runId); expect(host.textContent).toContain(messages.notReproduced); expect((host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true); }
});

it("checks source access explicitly and fences old identity receipts", async () => {
  const item = { id: "source-a", sourceKind: "application_log", sourceInstance: "internal.run-log.v1", text: JSON.stringify({ ...reference, companyId: runId }) } as import("@paperclipai/shared").FeedbackInboxItem;
  let resolve!: (value: unknown) => void; calls.get.mockReturnValue(new Promise(done => { resolve = done; }));
  await act(async () => root.render(<MimouseFeedbackRunLogSource companyId="company-a" userId="one" sessionId="one" item={item} />));
  expect(calls.get).not.toHaveBeenCalled(); await click(button("verifySource")); expect(calls.get).toHaveBeenCalledWith("/companies/company-a/feedback-inbox/source-a/run-log-source", expect.any(AbortSignal));
  const signal = calls.get.mock.calls[0][1] as AbortSignal;
  await act(async () => root.render(<MimouseFeedbackRunLogSource companyId="company-a" userId="two" sessionId="two" item={item} />)); expect(signal.aborted).toBe(true);
  await act(async () => resolve({ reference })); await flush(); expect(host.textContent).not.toContain(i18n.t("feedbackRunLogUi.sourceVerified"));
  calls.get.mockRejectedValue(new Error("PRIVATE_ORIGINAL_ERROR")); await click(button("verifySource")); expect(host.textContent).toContain(i18n.t("feedbackRunLogUi.sourceUnavailable")); expect(host.textContent).not.toContain("PRIVATE_ORIGINAL_ERROR");
});

it.each(["click", "late receipt"])("uses the real auth-cache fence before React commits a marker change (%s)", async mode => {
  const client = new QueryClient();
  const session = (scopeKey: string) => ({ user: { id: "user-a" }, session: { id: "paperclip:session:user-a", userId: "user-a", scopeKey } });
  client.setQueryData(queryKeys.auth.session, session("a".repeat(64)));
  function Host() { const fence = useAuthSessionFence(); return <MimouseFeedbackRunLog companyId="company-a" userId="user-a" sessionId="paperclip:session:user-a" isSessionCurrent={fence.isCurrent} onImported={calls.imported} />; }
  await act(async () => root.render(<QueryClientProvider client={client}><Host /></QueryClientProvider>)); await select(); await confirm();
  const submit = button("import");
  let resolve!: (value: unknown) => void;
  if (mode === "late receipt") { calls.post.mockReturnValue(new Promise(done => { resolve = done; })); await click(button("import")); }
  const before = calls.post.mock.calls.length;
  await act(async () => {
    client.setQueryData(queryKeys.auth.session, session("b".repeat(64)));
    if (mode === "click") submit.click(); else { resolve(receipt); await Promise.resolve(); }
  }); await flush();
  expect(calls.post).toHaveBeenCalledTimes(before); expect(calls.imported).not.toHaveBeenCalled();
  await act(async () => root.render(null)); client.clear();
});
