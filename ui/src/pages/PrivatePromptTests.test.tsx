// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { i18n } from "@/i18n";
import en from "@/i18n/contributions/privatePromptTestsUi/en.json";
import zh from "@/i18n/contributions/privatePromptTestsUi/zh-CN.json";
import es from "@/i18n/contributions/privatePromptTestsUi/es.json";
import ja from "@/i18n/contributions/privatePromptTestsUi/ja.json";
import { ids, marker, record, capabilities } from "@/test/private-prompt-fixtures";
import { readPrivatePromptJournal, replacePrivatePromptJournal, privatePromptJournalKey } from "@/lib/private-prompt-journal";
import { PrivatePromptTests } from "./PrivatePromptTests";
import { MimousePromptRegistry } from "./MimousePromptRegistry";
import registryEn from "@/i18n/contributions/promptRegistryUi/en.json";
const calls = vi.hoisted(() => ({ capabilities: vi.fn(), list: vi.fn(), detail: vi.fn(), prepare: vi.fn(), execute: vi.fn(), cancel: vi.fn() }));
vi.mock("@/api/private-prompt-tests", async importOriginal => ({ ...await importOriginal<typeof import("@/api/private-prompt-tests")>(), privatePromptTestsApi: () => calls }));
const registry = vi.hoisted(() => ({ list: vi.fn(), revisions: vi.fn(), receipts: vi.fn(), content: vi.fn(), create: vi.fn(), select: vi.fn() }));
vi.mock("@/api/prompt-registry", () => ({ promptRegistryApi: () => registry }));
let host: HTMLDivElement, root: Root, current = record();
const pending = vi.fn(), denied = vi.fn();
const text = (key: string) => i18n.t(`privatePromptTestsUi.${key}`);
const button = (key: string) => [...host.querySelectorAll("button")].find(element => element.textContent === text(key))!;
const stored = () => readPrivatePromptJournal(ids.company, "user");
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount(patch: Record<string, unknown> = {}) { await act(async () => root.render(<PrivatePromptTests companyId={ids.company} userId="user" sessionId="session" promptId={ids.prompt} revisionId={ids.revision} headReceiptId={null} onPendingChange={pending} onAccessLost={denied} {...patch} />)); await flush(); }
async function click(element: HTMLElement) { expect(element).toBeDefined(); await act(async () => element.click()); await flush(); }
async function fill(field: string, value = ids.ref) { const input = host.querySelector<HTMLInputElement>(`[aria-label="${text(field)}"]`)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function prepare() { for (const field of ["agentId", "datasetId", "caseId", "skillVersionId"]) await fill(field); await click(button("prepare")); }
async function confirm() { for (const input of host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) await click(input); }
async function reload(patch: Record<string, unknown> = {}) { await act(async () => root.unmount()); root = createRoot(host); await mount(patch); }
beforeEach(async () => {
  sessionStorage.clear(); for (const [locale, data] of Object.entries({ en, "zh-CN": zh, es, ja })) i18n.addResourceBundle(locale, "translation", { privatePromptTestsUi: data }, true, true);
  i18n.addResourceBundle("en", "translation", { promptRegistryUi: registryEn }, true, true);
  await i18n.changeLanguage("en"); Object.values(calls).forEach(call => call.mockReset()); pending.mockClear(); denied.mockClear(); current = record();
  calls.capabilities.mockResolvedValue(capabilities); calls.list.mockImplementation(async () => ({ items: [current], nextBeforeId: null }));
  calls.detail.mockImplementation(async () => ({ item: current, privateResult: current.status === "completed" ? { summary: "<script>not executed</script>", resultJson: { result: "exact" } } : null, contentDisposition: "untrusted_inert_text" }));
  calls.prepare.mockImplementation(async (_promptId, body) => { current = record({ ...body, headReceiptId: body.expectedHeadReceiptId }); return { item: current, duplicate: false }; });
  calls.execute.mockImplementation(async () => { current = record({ ...current, status: "queued" }); return { item: current, duplicate: false }; });
  calls.cancel.mockImplementation(async () => { current = record({ ...current, status: "cancelled" }); return { item: current, duplicate: false }; });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); sessionStorage.clear(); vi.restoreAllMocks(); });
it("prepares only metadata; separately confirms all three execution terms against the fixed digest", async () => {
  await mount(); await prepare(); expect(calls.execute).not.toHaveBeenCalled();
  expect(calls.prepare.mock.calls[0]![1]).not.toHaveProperty("confirmExecution"); expect(stored()?.phase).toBe("awaiting_confirmation");
  expect(host.textContent).toContain(current.approvalDigest); expect(button("execute").disabled).toBe(true);
  await confirm(); await click(button("execute")); expect(calls.execute).toHaveBeenCalledExactlyOnceWith(ids.prompt, ids.test, { approvalDigest: current.approvalDigest, executionProfile: current.executionProfile, confirmRestrictedProfile: true, confirmExecution: true, confirmPossibleCharges: true });
  expect(stored()?.phase).toBe("accepted"); expect(button("execute")).toBeUndefined(); expect(pending).toHaveBeenLastCalledWith(true);
});
it("renders four languages including text-only and two-stage billing boundaries", async () => {
  for (const data of [zh, es, ja]) expect(Object.keys(data).sort()).toEqual(Object.keys(en).sort());
  await mount(); for (const locale of ["en", "zh-CN", "es", "ja"]) { await act(async () => { await i18n.changeLanguage(locale); }); for (const key of ["boundary", "profile", "textOnlyBoundary", "twoPhase"]) expect(host.textContent).toContain(text(key)); }
});
it("retains metadata-only preparation after an unknown response and recovers the exact request", async () => {
  calls.prepare.mockRejectedValueOnce(Error("lost")); await mount(); await prepare(); const original = calls.prepare.mock.calls[0]![1];
  expect(stored()?.phase).toBe("prepare_pending"); await reload({ sessionId: "new-session", revisionId: ids.ref });
  expect(calls.execute).not.toHaveBeenCalled(); await click(button("recoverPrepare")); expect(calls.prepare.mock.calls[1]![1]).toEqual(original);
});
it.each([400, 401, 403, 404, 409, 422, 500])("never clears an unresolved execution because of HTTP %s", async code => {
  calls.execute.mockRejectedValueOnce(new ApiError("failed", code, null)); await mount(); await prepare(); await confirm(); await click(button("execute"));
  expect(stored()?.phase).toBe("execute_pending"); expect(pending).toHaveBeenLastCalledWith(true);
  if ([401, 403].includes(code)) { expect(denied).toHaveBeenCalled(); expect(host.querySelector("pre")).toBeNull(); }
});
it.each([{}, { item: {} }, { item: record({ requestId: ids.ref }), duplicate: false }])("never acknowledges malformed or mismatched 200", async response => {
  calls.execute.mockResolvedValueOnce(response); await mount(); await prepare(); await confirm(); await click(button("execute"));
  expect(stored()?.phase).toBe("execute_pending"); expect(pending).toHaveBeenLastCalledWith(true);
});
it("survives session/head/revision remount and awaiting GET cannot erase a delayed execution", async () => {
  calls.execute.mockRejectedValueOnce(Error("lost")); await mount(); await prepare(); await confirm(); await click(button("execute")); const original = stored()!;
  await reload({ sessionId: "renewed", revisionId: ids.ref, headReceiptId: ids.ref });
  expect(stored()).toEqual(original); expect(calls.execute).toHaveBeenCalledTimes(1); expect(button("retryExecute").disabled).toBe(true);
  await confirm(); await click(button("retryExecute")); expect(calls.execute.mock.calls[1]).toEqual(calls.execute.mock.calls[0]); expect(stored()?.phase).toBe("accepted");
});
it("background auth verification cannot acknowledge a delayed POST or erase its marker", async () => {
  let finish!: (value: unknown) => void; calls.execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await prepare(); await confirm(); await click(button("execute")); const original = stored()!;
  await mount({ authPending: true }); await act(async () => finish({ item: record({ ...current, status: "queued" }), duplicate: false })); await flush();
  expect(stored()).toEqual(original); await mount({ authPending: false }); expect(stored()?.phase).toBe("execute_pending"); expect(calls.execute).toHaveBeenCalledTimes(1);
});
it("storage failure sends zero execution requests and never silently forgets the ticket", async () => {
  await mount(); await prepare(); await confirm(); const before = stored(); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("quota"); });
  await click(button("execute")); expect(calls.execute).not.toHaveBeenCalled(); expect(stored()).toEqual(before); expect(host.textContent).toContain(text("storageFailed"));
});
it("old POST cannot clear a newer marker for the same scope", async () => {
  let finish!: (value: unknown) => void; calls.execute.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await prepare(); await confirm(); await click(button("execute")); const first = stored()!, newer = { ...first, operationId: ids.ref };
  replacePrivatePromptJournal(newer, first.operationId); await act(async () => finish({ item: record({ requestId: current.requestId, status: "completed" }), duplicate: false })); await flush(); expect(stored()).toEqual(newer);
});
it("UI cancellation clears only its matching receipt without invoking Execute", async () => {
  replacePrivatePromptJournal(marker(), null); await mount(); await click(button("cancelTicket")); expect(stored()).toBeNull(); expect(calls.cancel).toHaveBeenCalledExactlyOnceWith(ids.prompt, ids.test, { approvalDigest: "a".repeat(64) });
  expect(calls.execute).not.toHaveBeenCalled(); expect(host.textContent).toContain(text("status_cancelled"));
});
it("unknown is retained, while a verified terminal GET clears the marker and renders inert private results", async () => {
  replacePrivatePromptJournal(marker({ phase: "accepted" }), null); current = record({ status: "unknown" }); await mount(); expect(stored()).not.toBeNull(); expect(button("execute")).toBeUndefined();
  current = record({ status: "completed" }); await click(button("refresh")); expect(stored()).toBeNull(); expect(host.querySelector("script")).toBeNull(); expect(host.querySelector("pre")?.textContent).toContain("<script>not executed</script>");
});
it("different user/company cannot read or replay another scope marker; returning revalidates without POST", async () => {
  replacePrivatePromptJournal(marker(), null); await mount(); await mount({ userId: "other", promptId: null, revisionId: null });
  expect(stored()).not.toBeNull(); expect(button("retryExecute")).toBeUndefined(); expect(host.textContent).not.toContain(ids.test);
  await mount(); expect(calls.execute).not.toHaveBeenCalled(); expect(stored()).not.toBeNull();
});
it("does not put prompt content, result or credentials in persisted metadata", async () => {
  await mount(); await prepare(); const raw = sessionStorage.getItem(privatePromptJournalKey(ids.company, "user"))!;
  expect(raw).not.toMatch(/content|summary|resultJson|ANTHROPIC_API_KEY/); expect(JSON.parse(raw).approvalDigest).toBe(current.approvalDigest);
});

it("StrictMode rehearsal preserves recovery identity and still permits private reads", async () => {
  replacePrivatePromptJournal(marker(), null);
  await act(async () => root.render(<StrictMode><PrivatePromptTests companyId={ids.company} userId="user" sessionId="session" promptId={ids.prompt} revisionId={ids.revision} headReceiptId={null} onPendingChange={pending} onAccessLost={denied} /></StrictMode>)); await flush();
  expect(stored()?.testId).toBe(ids.test); expect(button("retryExecute")).toBeDefined(); expect(calls.execute).not.toHaveBeenCalled();
});
it("cancel losing to execution keeps the same accepted marker instead of authorizing another charge", async () => {
  replacePrivatePromptJournal(marker(), null); calls.cancel.mockResolvedValueOnce({ item: record({ status: "queued" }), duplicate: true });
  await mount(); await click(button("cancelTicket")); expect(stored()?.phase).toBe("accepted"); expect(button("retryExecute")).toBeUndefined(); expect(calls.execute).not.toHaveBeenCalled();
});
it("storage readback mismatch blocks Execute even when setItem appears to succeed", async () => {
  await mount(); await prepare(); await confirm(); const before = stored(); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
  await click(button("execute")); expect(calls.execute).not.toHaveBeenCalled(); expect(stored()).toEqual(before); expect(host.textContent).toContain(text("storageFailed"));
});

it.each(["pending_harness", "pending_wake"] as const)("explicitly resumes %s only through the original ticket and digest", async status => {
  replacePrivatePromptJournal(marker({ phase: "accepted" }), null); current = record({ status }); await mount();
  expect(calls.execute).not.toHaveBeenCalled(); expect(button("continueExecution").disabled).toBe(true);
  await confirm(); await click(button("continueExecution")); expect(calls.prepare).not.toHaveBeenCalled(); expect(calls.execute).toHaveBeenCalledExactlyOnceWith(ids.prompt, ids.test, expect.objectContaining({ approvalDigest: "a".repeat(64) }));
});
it("shows only the saved approval snapshot and forbids execution of null historical snapshots", async () => {
  replacePrivatePromptJournal(marker({ phase: "awaiting_confirmation" }), null); await mount();
  expect(host.textContent).toContain("claude-sonnet-4-6"); expect(host.textContent).toContain("/fixture/work"); expect(host.textContent).toContain(`${ids.ref} / v2`); expect(host.textContent).toContain(text("snapshotTitle"));
  current = record({ approvalSnapshot: null }); await click(button("refresh")); expect(host.textContent).toContain(text("snapshotUnavailable")); expect(button("execute")).toBeUndefined(); expect(calls.execute).not.toHaveBeenCalled();
});
it("a closed execution gate remains read-only without auto preparation or execution", async () => {
  calls.capabilities.mockResolvedValue({ ...capabilities, enabled: false }); await mount(); expect(host.querySelector("fieldset")!.disabled).toBe(true); expect(calls.prepare).not.toHaveBeenCalled(); expect(calls.execute).not.toHaveBeenCalled();
});
it("real Registry host keeps pending recovery and parent locks across auth verification/epoch remount without a selected revision", async () => {
  replacePrivatePromptJournal(marker(), null); registry.list.mockResolvedValue({ items: [], nextBeforeId: null });
  const render = async (authPending: boolean, authEpoch: number) => { await act(async () => root.render(<MimousePromptRegistry companyId={ids.company} userId="user" sessionId="session" {...{ authPending, authEpoch }} />)); await flush(); };
  await render(false, 1); expect(host.textContent).toContain(ids.test); expect(host.querySelector("fieldset")!.disabled).toBe(true);
  await render(true, 1); expect(stored()?.testId).toBe(ids.test);
  await render(false, 2); expect(host.textContent).toContain(ids.test); expect(host.querySelector("fieldset")!.disabled).toBe(true);
  const refreshRegistry = [...host.querySelectorAll("button")].find(element => element.textContent === i18n.t("promptRegistryUi.refresh"))!;
  expect(refreshRegistry.disabled).toBe(true); expect(calls.prepare).not.toHaveBeenCalled(); expect(calls.execute).not.toHaveBeenCalled();
});
it("late prior-epoch POST finally cannot release the new epoch's active write lock", async () => {
  const finishes: Array<(value: unknown) => void> = []; calls.execute.mockImplementation(() => new Promise(resolve => finishes.push(resolve)));
  await mount(); await prepare(); await confirm(); await click(button("execute")); await mount({ authPending: true }); await mount({ authPending: false });
  await confirm(); await click(button("retryExecute")); expect(calls.execute).toHaveBeenCalledTimes(2);
  await act(async () => finishes[0]!({ item: record({ requestId: current.requestId, status: "completed" }), duplicate: false })); await flush();
  expect(stored()?.phase).toBe("execute_pending"); expect(button("refresh").disabled).toBe(true);
  await act(async () => finishes[1]!({ item: record({ ...current, status: "queued" }), duplicate: false })); await flush(); expect(stored()?.phase).toBe("accepted");
});

it("labels a null configured directory as unresolved rather than claiming a pinned execution directory", async () => {
  replacePrivatePromptJournal(marker({ phase: "awaiting_confirmation" }), null); current = record({ approvalSnapshot: { ...record().approvalSnapshot!, configuredCwd: null } });
  await mount(); expect(host.textContent).toContain(text("snapshotTarget")); expect(host.textContent).toContain(text("snapshotCwdUnresolved"));
});

it.each([undefined, "not-a-hash"])("retains execution journal when a terminal witness runtime config hash is invalid: %s", async runtimeConfigHash => {
    await mount(); await prepare(); await confirm();
    const completed = record({ ...current, status: "completed" });
    calls.execute.mockResolvedValueOnce({ item: { ...completed, prepared: { ...completed.prepared, runtimeConfigHash } }, duplicate: false });
    await click(button("execute"));
    expect(stored()?.phase).toBe("execute_pending"); expect(pending).toHaveBeenLastCalledWith(true);
});

const letterUuid = "abcdefab-cdef-4abc-abcd-abcdefabcdef";
it("normalizes all four new draft UUIDs before journaling and posting", async () => {
  calls.prepare.mockImplementation(async (_promptId, body) => {
    for (const field of ["agentId", "datasetId", "caseId", "skillVersionId"] as const) {
      expect(body[field]).toBe(letterUuid); expect(stored()?.[field]).toBe(letterUuid);
    }
    current = record({ ...body, headReceiptId: body.expectedHeadReceiptId });
    return { item: current, duplicate: false };
  });
  await mount();
  for (const field of ["agentId", "datasetId", "caseId", "skillVersionId"]) await fill(field, letterUuid.toUpperCase());
  await click(button("prepare"));
  expect(calls.prepare).toHaveBeenCalledTimes(1); expect(stored()?.phase).toBe("awaiting_confirmation");
  expect(calls.execute).not.toHaveBeenCalled();
});
it("recovers old uppercase metadata with a lowercase receipt while retrying the exact original body", async () => {
  const upper = letterUuid.toUpperCase();
  const old = marker({ phase: "prepare_pending", testId: null, approvalDigest: null,
    requestId: upper, revisionId: upper, headReceiptId: upper, agentId: upper, datasetId: upper, caseId: upper, skillVersionId: upper,
    originSessionId: "Session-ABC" });
  replacePrivatePromptJournal(old, null);
  calls.prepare.mockRejectedValueOnce(Error("lost"));
  calls.prepare.mockImplementationOnce(async (_promptId, body) => {
    current = record({ ...body, requestId: letterUuid, revisionId: letterUuid, headReceiptId: letterUuid,
      agentId: letterUuid, datasetId: letterUuid, caseId: letterUuid, skillVersionId: letterUuid });
    return { item: current, duplicate: true };
  });
  await mount(); expect(stored()).toEqual(old);
  await click(button("recoverPrepare")); const firstBody = calls.prepare.mock.calls[0]![1];
  expect(firstBody).toEqual({ requestId: upper, revisionId: upper, expectedHeadReceiptId: upper,
    agentId: upper, datasetId: upper, caseId: upper, skillVersionId: upper, executionProfile: old.executionProfile });
  expect(stored()?.phase).toBe("prepare_pending");
  await reload({ sessionId: "Different-Session" }); await click(button("recoverPrepare"));
  expect(calls.prepare.mock.calls[1]![1]).toEqual(firstBody);
  expect(stored()).toEqual(expect.objectContaining({ ...old, operationId: expect.any(String), phase: "awaiting_confirmation", testId: ids.test, approvalDigest: "a".repeat(64) }));
  expect(button("execute").disabled).toBe(true); expect(calls.execute).not.toHaveBeenCalled();
});

const preparationMarker = () => marker({ phase: "prepare_pending", testId: null, approvalDigest: null });
it("explicit local abandonment sends no requests and only a later Prepare creates a new identity", async () => {
  const old = preparationMarker(); replacePrivatePromptJournal(old, null); await mount();
  const random = vi.spyOn(crypto, "randomUUID"); await click(button("abandonPrepare"));
  expect(stored()).toBeNull(); expect(pending).toHaveBeenLastCalledWith(false); expect(random).not.toHaveBeenCalled();
  for (const call of [calls.prepare, calls.execute, calls.cancel]) expect(call).not.toHaveBeenCalled();
  expect(host.textContent).toContain(text("prepareAbandoned"));
  await prepare(); expect(calls.prepare).toHaveBeenCalledTimes(1); expect(stored()?.requestId).not.toBe(old.requestId);
});
it.each(["awaiting_confirmation", "execute_pending", "cancel_pending", "accepted"] as const)("does not offer abandonment for %s", async phase => {
  replacePrivatePromptJournal(marker({ phase }), null); await mount(); expect(button("abandonPrepare")).toBeUndefined();
});
it("cannot abandon while access is pending or a read failed", async () => {
  replacePrivatePromptJournal(preparationMarker(), null); await mount(); await mount({ authPending: true });
  expect(button("abandonPrepare").disabled).toBe(true); await click(button("abandonPrepare")); expect(stored()).not.toBeNull();
  calls.capabilities.mockRejectedValue(new ApiError("forbidden", 403, {})); await mount({ authPending: false });
  expect(button("abandonPrepare").disabled).toBe(true); expect(stored()).not.toBeNull();
});
it.each(["phase", "operation", "corrupt", "owner", "delete"])("retains local lock on abandonment race/failure: %s", async change => {
  const old = preparationMarker(); replacePrivatePromptJournal(old, null); await mount();
  const key = privatePromptJournalKey(ids.company, "user");
  if (change === "phase") replacePrivatePromptJournal(marker({ phase: "awaiting_confirmation" }), old.operationId);
  if (change === "operation") replacePrivatePromptJournal({ ...old, operationId: ids.ref }, old.operationId);
  if (change === "corrupt") sessionStorage.setItem(key, "corrupt");
  if (change === "owner") sessionStorage.setItem(key, JSON.stringify({ ...old, userId: "other" }));
  if (change === "delete") vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {});
  const before = sessionStorage.getItem(key); await click(button("abandonPrepare"));
  expect(sessionStorage.getItem(key)).toBe(before); expect(pending).toHaveBeenLastCalledWith(true);
  expect(host.textContent).toContain(text("storageFailed"));
  for (const call of [calls.prepare, calls.execute, calls.cancel]) expect(call).not.toHaveBeenCalled();
});
it("disables abandonment during Prepare and ignores its late prior-epoch response after abandonment and a new marker", async () => {
  let finish!: (value: unknown) => void;
  calls.prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await prepare(); const old = stored()!;
  expect(button("abandonPrepare").disabled).toBe(true); await click(button("abandonPrepare")); expect(stored()).toEqual(old);
  await mount({ authPending: true }); await mount({ authPending: false });
  await click(button("abandonPrepare")); expect(stored()).toBeNull();
  await prepare(); const next = stored(); expect(next?.requestId).not.toBe(old.requestId);
  await act(async () => finish({ item: record({ requestId: old.requestId, id: letterUuid }), duplicate: false })); await flush();
  expect(stored()).toEqual(next); expect(host.textContent).not.toContain(letterUuid);
  expect(calls.execute).not.toHaveBeenCalled(); expect(calls.cancel).not.toHaveBeenCalled();
});
it.each([404, 422])("allows explicit metadata-only abandonment after %s without claiming server cancellation", async status => {
  calls.prepare.mockRejectedValueOnce(new ApiError("rejected", status, {})); await mount(); await prepare();
  expect(stored()?.phase).toBe("prepare_pending"); expect(host.textContent).toContain(text("abandonPrepareBoundary"));
  await click(button("abandonPrepare")); expect(stored()).toBeNull(); expect(calls.prepare).toHaveBeenCalledTimes(1);
  expect(calls.execute).not.toHaveBeenCalled(); expect(calls.cancel).not.toHaveBeenCalled();
});
