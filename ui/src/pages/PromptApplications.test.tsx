// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { i18n } from "@/i18n";
import { readApplicationJournal, applicationJournalKey } from "@/lib/prompt-application-journal";
import { applicationId as id, applicationRecord as record, applicationReceipt as receipt, applicationDispatch as dispatch, applicationEvidence as evidence } from "@/test/prompt-application-fixtures";
import en from "@/i18n/contributions/promptApplicationsUi/en.json";
import zh from "@/i18n/contributions/promptApplicationsUi/zh-CN.json";
import es from "@/i18n/contributions/promptApplicationsUi/es.json";
import ja from "@/i18n/contributions/promptApplicationsUi/ja.json";
import { PromptApplications } from "./PromptApplications";
const calls = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), head: vi.fn(), prepare: vi.fn(), approve: vi.fn(), rollback: vi.fn(), request: vi.fn(), dispatches: vi.fn() }));
vi.mock("@/api/prompt-applications", async original => ({ ...await original<typeof import("@/api/prompt-applications")>(), promptApplicationsApi: () => calls }));
const lost = vi.fn(), pending = vi.fn();
const props = { companyId: id(1), userId: "user", sessionId: "session", promptId: id(7), evidence, onAccessLost: lost, onPendingChange: pending };
let host: HTMLDivElement, root: Root;
const label = (key: string) => i18n.t(`promptApplicationsUi.${key}`);
const button = (key: string) => [...host.querySelectorAll("button")].find(value => value.textContent === label(key))!;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount(patch = {}) { await act(async () => root.render(<PromptApplications {...props} {...patch} />)); await flush(); }
async function click(key: string) { await act(async () => button(key).click()); await flush(); }
async function fill(value: string) {
  const input = host.querySelector<HTMLInputElement>(`[aria-label="${label("agentId")}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function ready() { await fill(id(9)); await click("inspectTarget"); }
async function prepared() { await mount(); await ready(); await click("prepare"); await click("inspectTarget"); }
async function checkAll() { for (const input of host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) await act(async () => input.click()); }
async function selectHistory() { await act(async () => [...host.querySelectorAll("button")].find(value => value.textContent === id(20))!.click()); await flush(); }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); lost.mockClear(); pending.mockClear(); for (const call of Object.values(calls)) call.mockReset();
  calls.detail.mockResolvedValue({ enabled: true, item: record() }); calls.list.mockResolvedValue({ enabled: true, items: [], nextBeforeId: null }); calls.head.mockResolvedValue({ enabled: true, generation: 0, applicationId: null, configuredAt: null });
  calls.prepare.mockImplementation(async (_prompt, body) => ({ item: record({ requestId: body.requestId }), duplicate: false }));
  calls.approve.mockImplementation(async (_prompt, _id, body) => ({ receipt: receipt({ requestId: body.requestId }), duplicate: false }));
  calls.rollback.mockImplementation(async (_prompt, _id, body) => ({ receipt: receipt({ requestId: body.requestId, action: "rollback", generation: body.expectedGeneration + 1 }), duplicate: false }));
  calls.request.mockResolvedValue({ enabled: true, application: null, receipt: null }); calls.dispatches.mockResolvedValue({ items: [dispatch()], nextBeforeId: null });
  for (const [locale, data] of Object.entries({ en, "zh-CN": zh, es, ja })) i18n.addResourceBundle(locale, "translation", { promptApplicationsUi: data }, true, true);
  await i18n.changeLanguage("en"); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it("does not prepare, approve, rollback or dispatch on mount or locale changes", async () => {
  await mount(); for (const locale of ["en", "zh-CN", "es", "ja"]) { await act(async () => { await i18n.changeLanguage(locale); }); for (const key of ["boundary", "scope", "profile", "visibility", "dispatchBoundary"]) expect(host.textContent).toContain(label(key)); }
  for (const key of ["prepare", "approve", "rollback", "dispatches"] as const) expect(calls[key]).not.toHaveBeenCalled();
  for (const data of [zh, es, ja]) expect(Object.keys(data).sort()).toEqual(Object.keys(en).sort());
});
it("disabled-by-default and absent evidence cannot prepare a proposal", async () => {
  calls.list.mockResolvedValueOnce({ enabled: false, items: [], nextBeforeId: null }); await mount(); expect(button("prepare").matches(":disabled")).toBe(true); expect(host.textContent).toContain(label("disabled"));
  await click("refresh"); await mount({ evidence: null }); await ready(); expect(button("prepare").matches(":disabled")).toBe(true); expect(calls.prepare).not.toHaveBeenCalled();
});
it("prepares one explicitly selected agent and gates approval on four fresh checks", async () => {
  await prepared(); expect(calls.prepare).toHaveBeenCalledTimes(1); expect(calls.prepare.mock.calls[0][1]).toMatchObject({ agentId: id(9), expectedGeneration: 0, comparison: evidence.comparison, approvalValidForMinutes: 60 });
  for (const key of ["revisionHash", "reportHash", "targetDigest", "implementationDigest", "expiryBoundary", "contextBoundary", "credentialVersions", "baselineRevisionId", "testCount"]) expect(host.textContent).toContain(label(key));
  expect(button("approve").matches(":disabled")).toBe(true); expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(4);
  await checkAll(); await click("approve"); expect(calls.approve).toHaveBeenCalledExactlyOnceWith(id(7), id(20), expect.objectContaining({ expectedGeneration: 0, approvalDigest: "f".repeat(64), confirmOrdinaryVisibility: true, confirmBareComparisonNotToolQuality: true, confirmNewTasksOnly: true, confirmNoAutomaticRun: true }));
  expect(host.textContent).toContain(label("configuredReceipt")); expect(calls.dispatches).not.toHaveBeenCalled(); expect(readApplicationJournal(id(1), "user")).toBeNull();
});
it("deduplicates repeated mutation clicks synchronously before React rerenders", async () => {
  let finish!: (value: unknown) => void; calls.prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await mount(); await ready();
  await act(async () => { button("prepare").click(); button("prepare").click(); }); expect(calls.prepare).toHaveBeenCalledTimes(1);
  await act(async () => finish({ item: record({ requestId: calls.prepare.mock.calls[0][1].requestId }), duplicate: false })); await flush();
});
it("unknown writes persist only metadata and recover by same-ID GET without replay or replacement", async () => {
  calls.prepare.mockRejectedValueOnce(Error("PRIVATE_NETWORK_ERROR")); await mount(); await ready(); await click("prepare");
  const requestId = calls.prepare.mock.calls[0][1].requestId, saved = readApplicationJournal(id(1), "user")!;
  expect(saved.requestId).toBe(requestId); expect(JSON.stringify(saved)).not.toMatch(/reportHash|promptText|output|confirmOrdinaryVisibility/);
  expect(button("prepare").matches(":disabled")).toBe(true); expect(host.textContent).not.toContain("PRIVATE_NETWORK_ERROR");
  await click("recover"); expect(calls.request).toHaveBeenCalledExactlyOnceWith(id(7), requestId); expect(host.textContent).toContain(label("unresolved")); expect(readApplicationJournal(id(1), "user")).not.toBeNull();
  calls.request.mockResolvedValueOnce({ enabled: true, application: record({ requestId }), receipt: null }); await click("recover");
  expect(readApplicationJournal(id(1), "user")).toBeNull(); expect(calls.prepare).toHaveBeenCalledTimes(1); expect(calls.approve).not.toHaveBeenCalled(); expect(host.textContent).toContain(label("prepared"));
});
it("after remount, an uncertain approval can only be queried and never inherits checked confirmation", async () => {
  calls.approve.mockRejectedValueOnce(Error("lost")); await prepared(); await checkAll(); await click("approve"); const saved = readApplicationJournal(id(1), "user")!;
  await mount({ sessionId: "next-session" }); expect(host.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(0);
  calls.request.mockResolvedValueOnce({ enabled: true, application: null, receipt: receipt({ requestId: saved.requestId }) }); await click("recover"); expect(calls.request).toHaveBeenCalledWith(id(7), saved.requestId, { action: "approve", applicationId: id(20), agentId: id(9), expectedGeneration: 0 });
  expect(calls.approve).toHaveBeenCalledTimes(1); expect(host.textContent).toContain(label("configuredReceipt")); expect(readApplicationJournal(id(1), "user")).toBeNull();
});
it.each(["companyId", "userId", "sessionId", "promptId"])("%s transition clears private state and discards a late write response", async key => {
  let finish!: (value: unknown) => void; calls.prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await mount(); await ready(); await click("prepare");
  const requestId = calls.prepare.mock.calls[0][1].requestId; await mount({ [key]: id(99) }); await act(async () => finish({ item: record({ requestId }), duplicate: false })); await flush();
  expect(host.textContent).not.toContain(label("prepared")); expect(host.querySelector<HTMLInputElement>('input:not([type="checkbox"])')?.value).toBe(""); expect(calls.prepare).toHaveBeenCalledTimes(1);
});
it("auth pending hides all details and destroys checked approval before returning", async () => {
  await prepared(); await checkAll(); await mount({ authPending: true }); expect(host.textContent).toBe(""); await mount({ authPending: false }); expect(host.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(0); expect(calls.approve).not.toHaveBeenCalled();
});
it.each([401, 403])("HTTP %s revokes the view, draft and controls without revealing server detail", async status => {
  await prepared(); calls.head.mockRejectedValueOnce(new ApiError("PRIVATE_DENIAL", status, null)); await click("refresh"); await ready();
  expect(lost).toHaveBeenCalledTimes(1); expect(host.querySelector("fieldset")).toBeNull(); expect(host.textContent).not.toContain("PRIVATE_DENIAL"); expect(host.textContent).not.toContain("f".repeat(64));
});
it("stale CAS clears selection and checks without automatic overwrite or a new write", async () => {
  await prepared(); await checkAll(); calls.approve.mockRejectedValueOnce(new ApiError("changed", 409, null)); await click("approve");
  expect(host.textContent).toContain(label("conflict")); expect(host.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(0); expect(calls.approve).toHaveBeenCalledTimes(1); expect(readApplicationJournal(id(1), "user")).toBeNull();
});
it("expired approval cannot be accepted, but a configured expired binding can roll back with the gate off", async () => {
  const row = record({ approvalExpiresAt: "2020-01-01T00:00:00.000Z" }); calls.list.mockResolvedValue({ enabled: true, items: [row], nextBeforeId: null }); await mount(); await selectHistory(); expect(button("approve").matches(":disabled")).toBe(true);
  const configured = { ...row, configured: true, currentGeneration: 1, configuredAt: "2026-10-26T12:01:00.000Z" }; calls.list.mockResolvedValue({ enabled: false, items: [configured], nextBeforeId: null }); calls.head.mockResolvedValue({ enabled: false, generation: 1, applicationId: id(20), configuredAt: configured.configuredAt });
  await click("refresh"); await selectHistory(); await act(async () => host.querySelector<HTMLInputElement>(`[aria-label="${label("confirmRollback")}"]`)!.click()); await click("rollback"); expect(calls.rollback).toHaveBeenCalledWith(id(7), id(20), expect.objectContaining({ expectedGeneration: 1 })); expect(host.textContent).toContain(label("rollbackReceipt"));
});
it("stale rollback never targets a newer application or restores other agent configuration", async () => {
  calls.list.mockResolvedValue({ enabled: true, items: [record({ configured: true, currentGeneration: 1, configuredAt: "2026-10-26T12:01:00.000Z" })], nextBeforeId: null }); calls.head.mockResolvedValue({ enabled: true, generation: 2, applicationId: id(99), configuredAt: "2026-10-26T12:02:00.000Z" }); await mount(); await selectHistory(); expect(button("rollback")).toBeUndefined(); expect(calls.rollback).not.toHaveBeenCalled();
});
it("reads actual dispatch receipts only on demand and paginates without model execution", async () => {
  calls.list.mockResolvedValue({ enabled: true, items: [record()], nextBeforeId: null }); calls.dispatches.mockResolvedValueOnce({ items: [dispatch()], nextBeforeId: id(26) }).mockResolvedValueOnce({ items: [dispatch({ id: id(29), runId: id(30) })], nextBeforeId: null });
  await mount(); await selectHistory(); expect(calls.dispatches).not.toHaveBeenCalled(); await click("dispatches"); expect(host.textContent).toContain(label("dispatched")); expect(host.textContent).toContain("d".repeat(64)); await click("moreDispatches"); expect(calls.dispatches).toHaveBeenLastCalledWith(id(7), id(20), id(26)); expect(host.textContent).toContain(id(30)); expect(calls.approve).not.toHaveBeenCalled();
});
it("blocked browser storage prevents every mutation", async () => {
  await mount(); await ready(); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("blocked"); }); await click("prepare"); expect(host.textContent).toContain(label("storageFailed")); expect(calls.prepare).not.toHaveBeenCalled(); expect(button("prepare").matches(":disabled")).toBe(true);
});
it("StrictMode never mutates on mount and explicit preparation remains usable", async () => {
  await act(async () => root.render(<StrictMode><PromptApplications {...props} /></StrictMode>)); await flush(); expect(calls.prepare).not.toHaveBeenCalled(); await ready(); await click("prepare"); expect(calls.prepare).toHaveBeenCalledTimes(1);
});
it("malformed stored metadata is never discarded to permit another request", async () => {
  sessionStorage.setItem(applicationJournalKey(id(1), "user"), JSON.stringify({ prompt: "PRIVATE" })); await mount(); expect(host.textContent).toContain(label("storageFailed")); expect(calls.prepare).not.toHaveBeenCalled(); expect(sessionStorage.getItem(applicationJournalKey(id(1), "user"))).toContain("PRIVATE"); expect(host.textContent).not.toContain("PRIVATE");
});

it("explicit preparation retry preserves the entire original ID-only payload across reload", async () => {
  calls.prepare.mockRejectedValueOnce(Error("lost")); await mount(); await ready(); await click("prepare"); const original = calls.prepare.mock.calls[0][1];
  await mount({ sessionId: "reloaded" }); expect(calls.prepare).toHaveBeenCalledTimes(1);
  await act(async () => host.querySelector<HTMLInputElement>(`[aria-label="${label("confirmRetry")}"]`)!.click()); await click("retrySameRequest");
  expect(calls.prepare).toHaveBeenCalledTimes(2); expect(calls.prepare.mock.calls[1][1]).toEqual(original); expect(readApplicationJournal(id(1), "user")).toBeNull();
});
it("explicit approval retry re-reads the fixed original proposal and requires four fresh checks plus retry consent", async () => {
  calls.approve.mockRejectedValueOnce(Error("lost")); await prepared(); await checkAll(); await click("approve"); const original = calls.approve.mock.calls[0][2];
  await mount({ sessionId: "reloaded" }); expect(button("retrySameRequest")).toBeUndefined(); await click("reviewRetry");
  expect(calls.detail).toHaveBeenCalledWith(id(7), id(20)); expect(host.textContent).toContain("f".repeat(64)); expect(button("retrySameRequest").matches(":disabled")).toBe(true);
  await checkAll(); await click("retrySameRequest"); expect(calls.approve).toHaveBeenCalledTimes(2); expect(calls.approve.mock.calls[1][2]).toEqual(original); expect(readApplicationJournal(id(1), "user")).toBeNull();
});
it("another administrator's configured binding can roll back but cannot be approved by this user", async () => {
  const row = record({ actorUserId: "revoked-admin", configured: true, currentGeneration: 1, configuredAt: "2026-10-26T12:01:00.000Z" });
  calls.list.mockResolvedValue({ enabled: true, items: [row], nextBeforeId: null }); calls.head.mockResolvedValue({ enabled: true, generation: 1, applicationId: row.id, configuredAt: row.configuredAt });
  await mount(); await selectHistory(); expect(button("approve").matches(":disabled")).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>(`[aria-label="${label("confirmRollback")}"]`)!.click()); await click("rollback"); expect(calls.rollback).toHaveBeenCalledTimes(1); expect(calls.approve).not.toHaveBeenCalled();
});

it("only metadata-only preparation can be abandoned locally, without cancelling or approving a server proposal", async () => {
  calls.prepare.mockRejectedValueOnce(Error("lost")); await mount(); await ready(); await click("prepare");
  expect(host.textContent).toContain(label("abandonPrepareBoundary")); await click("abandonPrepare"); expect(readApplicationJournal(id(1), "user")).toBeNull();
  expect(host.textContent).toContain(label("abandonedPrepare")); expect(calls.approve).not.toHaveBeenCalled(); expect(calls.rollback).not.toHaveBeenCalled(); expect(calls.prepare).toHaveBeenCalledTimes(1);
});
it("only a matching server closure releases an uncertain approval; an ordinary retry conflict never does", async () => {
  calls.approve.mockRejectedValueOnce(Error("lost")).mockRejectedValueOnce(new ApiError("expired", 409, null)); await prepared(); await checkAll(); await click("approve");
  const saved = readApplicationJournal(id(1), "user")!; await click("reviewRetry"); await checkAll(); await click("retrySameRequest"); expect(readApplicationJournal(id(1), "user")).not.toBeNull();
  const closure = { outcome: "not_applied_closed", requestId: saved.requestId, action: "approve", applicationId: id(20), agentId: id(9), expectedGeneration: 0, currentGeneration: 0, reason: "approval_expired" };
  calls.request.mockResolvedValueOnce({ enabled: true, application: null, receipt: null, closure: { ...closure, agentId: id(99) } }); await click("recover"); expect(readApplicationJournal(id(1), "user")).not.toBeNull();
  calls.request.mockResolvedValueOnce({ enabled: true, application: null, receipt: null, closure }); await click("recover"); expect(readApplicationJournal(id(1), "user")).toBeNull(); expect(host.textContent).toContain(label("notAppliedClosed")); expect(calls.approve).toHaveBeenCalledTimes(2);
});
