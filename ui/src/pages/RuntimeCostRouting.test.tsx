// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RuntimeCostRouting } from "./RuntimeCostRouting";
import { i18n } from "@/i18n";
import { readRoutingJournal, routingJournalKey } from "@/lib/runtime-cost-routing-journal";
import { routingId as id, routingPolicy as policy, routingRecord as record, routingHead as head, routingBinding as binding } from "@/test/runtime-cost-routing-fixtures";
import en from "@/i18n/contributions/runtimeCostRoutingUi/en.json";
import zh from "@/i18n/contributions/runtimeCostRoutingUi/zh-CN.json";
import es from "@/i18n/contributions/runtimeCostRoutingUi/es.json";
import ja from "@/i18n/contributions/runtimeCostRoutingUi/ja.json";
const calls = { current: vi.fn(), closeExpired: vi.fn(), prepare: vi.fn(), approve: vi.fn(), disable: vi.fn(), createTask: vi.fn(), run: vi.fn(), request: vi.fn(), policy: vi.fn(), binding: vi.fn() };
const props = { companyId: id(1), userId: "owner", sessionId: "session-1", authEpoch: 1, companyPrefix: "rc" };
let host: HTMLDivElement, root: Root;
const label = (key: string) => i18n.t(`runtimeCostRoutingUi.${key}`);
const button = (key: string) => [...host.querySelectorAll("button")].find(value => value.textContent === label(key))!;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); }
async function mount(patch = {}) { await act(async () => root.render(<RuntimeCostRouting {...props} {...patch} />)); await flush(); }
async function click(key: string) { await act(async () => button(key).click()); await flush(); }
async function fill(key: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label(key)}"]`)!;
  const prototype = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function check(key: string) { await act(async () => host.querySelector<HTMLInputElement>(`input[aria-label="${label(key)}"]`)!.click()); }
async function prepare() { await mount(); await fill("policyInput", JSON.stringify(policy())); await click("prepare"); }
async function approvalChecks() { for (const key of ["confirmBare", "confirmHistorical", "confirmNew", "confirmNoRun", "confirmAudience"]) await check(key); }
function response(value: unknown, status = 200) { return { ok: status < 400, status, json: async () => value } as Response; }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.stubGlobal("crypto", webcrypto); sessionStorage.clear();
  for (const fn of Object.values(calls)) fn.mockReset();
  calls.closeExpired.mockResolvedValue({ item: record({ approvalClosedAt: new Date().toISOString() }), duplicate: false });
  calls.current.mockResolvedValue(head()); calls.prepare.mockImplementation(async body => ({ item: record({ requestId: body.requestId }), duplicate: false }));
  calls.approve.mockImplementation(async body => ({ receipt: { id: id(300), requestId: body.requestId, policyId: id(3), action: "approve", generation: body.expectedGeneration + 1, createdAt: new Date().toISOString(), executionStarted: false }, duplicate: false }));
  calls.disable.mockImplementation(async body => ({ receipt: { id: id(301), requestId: body.requestId, policyId: id(3), action: "disable", generation: body.expectedGeneration + 1, createdAt: new Date().toISOString(), executionStarted: false }, duplicate: false }));
  calls.createTask.mockImplementation(async body => ({ binding: binding({ requestId: body.requestId }), duplicate: false }));
  calls.run.mockImplementation(async body => ({ binding: binding({ dispatchRequestId: body.requestId, state: "wake_pending", wakeRequestedAt: new Date().toISOString() }), duplicate: false }));
  calls.request.mockResolvedValue({ enabled: true, companyPaused: false, policy: null, receipt: null, binding: null, closure: null });
  calls.policy.mockResolvedValue({ item: record(), enabled: true, companyPaused: false }); calls.binding.mockResolvedValue({ binding: binding() });
  vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit) => {
    const route = path.replace(/^.*\/runtime-cost-routing/, ""), body = init.body ? JSON.parse(String(init.body)) : undefined;
    const fn = route === "" ? calls.current : route === "/prepare" ? calls.prepare : route.endsWith("/close-expired") ? calls.closeExpired : route.endsWith("/approve") ? calls.approve : route === "/disable" ? calls.disable : route === "/tasks" ? calls.createTask : route.endsWith("/run") ? calls.run : route.startsWith("/requests/") ? calls.request : route.startsWith("/policies/") ? calls.policy : calls.binding;
    const value = await fn(body, path, init); return value && "ok" in value ? value : response(value);
  }));
  for (const [locale, data] of Object.entries({ en, "zh-CN": zh, es, ja })) i18n.addResourceBundle(locale, "translation", { runtimeCostRoutingUi: data }, true, true);
  await i18n.changeLanguage("en"); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("renders real components in four languages without writes on mount or locale change", async () => {
  await mount(); for (const locale of ["en", "zh-CN", "es", "ja"]) { await act(async () => { await i18n.changeLanguage(locale); });
    for (const key of ["boundary", "profile", "historyCost", "privacy", "unsupported", "disableBoundary", "taskVisibility", "runBoundary"]) expect(host.textContent).toContain(label(key)); }
  for (const key of ["prepare", "approve", "disable", "createTask", "run", "closeExpired"] as const) expect(calls[key]).not.toHaveBeenCalled();
  for (const messages of [zh, es, ja]) expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
});
it("default off blocks preparation and task creation", async () => {
  calls.current.mockResolvedValue(head(false, { enabled: false })); await mount(); await fill("policyInput", JSON.stringify(policy()));
  expect(button("prepare").matches(":disabled")).toBe(true); expect(button("createTask").matches(":disabled")).toBe(true); expect(host.textContent).toContain(label("defaultOff"));
});
it.each(["unknown_cost", "wrong_agent", "unsupported_provider", "raw_cases"])("rejects %s evidence before any approval controls", async kind => {
  const row = record() as any;
  if (kind === "unknown_cost") row.candidates[0].evidence.observedCostCents = null;
  if (kind === "wrong_agent") row.candidates[0].evidence.agentId = id(999);
  if (kind === "unsupported_provider") row.candidates[0].evidence.provider = "unsupported";
  if (kind === "raw_cases") row.candidates[0].evidence.cases[0].input = "DO_NOT_DISPLAY_PRIVATE_CASE";
  calls.prepare.mockImplementation(async body => ({ item: { ...row, requestId: body.requestId }, duplicate: false })); await prepare();
  expect(host.querySelector('[aria-label="' + label("confirmBare") + '"]')).toBeNull(); expect(calls.approve).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("DO_NOT_DISPLAY_PRIVATE_CASE"); expect(readRoutingJournal(props)).not.toBeNull();
});
it("approval requires fresh acknowledgments and never creates or runs a task", async () => {
  await prepare(); expect(button("approve").matches(":disabled")).toBe(true); await approvalChecks(); calls.current.mockResolvedValue(head(true)); await click("approve");
  expect(calls.approve).toHaveBeenCalledTimes(1); expect(calls.approve.mock.calls[0][0]).toMatchObject({ expectedGeneration: 0, approvalDigest: "f".repeat(64), confirmBareTextProxy: true, confirmHistoricalCostNotQuote: true });
  expect(calls.createTask).not.toHaveBeenCalled(); expect(calls.run).not.toHaveBeenCalled(); expect(host.textContent).toContain(label("approved"));
  expect(readRoutingJournal(props)).toBeNull();
});
it("synchronous repeated prepare clicks produce one exact request", async () => {
  let finish!: (value: unknown) => void; calls.prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await fill("policyInput", JSON.stringify(policy())); await act(async () => { button("prepare").click(); button("prepare").click(); });
  expect(calls.prepare).toHaveBeenCalledTimes(1); await act(async () => finish({ item: record({ requestId: calls.prepare.mock.calls[0][0].requestId }), duplicate: false })); await flush();
});
it.each(["companyId", "userId", "sessionId", "authEpoch"])("%s transition discards late metadata and write results", async key => {
  let finish!: (value: unknown) => void; calls.prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await fill("policyInput", JSON.stringify(policy())); await click("prepare"); const requestId = calls.prepare.mock.calls[0][0].requestId;
  await mount({ [key]: key === "authEpoch" ? 2 : key === "companyId" ? id(999) : "new-identity" });
  await act(async () => finish({ item: record({ requestId }), duplicate: false })); await flush(); expect(host.textContent).not.toContain(label("prepared"));
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value ?? "").toBe(""); expect(calls.approve).not.toHaveBeenCalled();
});
it("auth pending hides metadata and destroys approval checks", async () => {
  await prepare(); await approvalChecks(); await mount({ authPending: true }); expect(host.textContent).toBe(""); await mount();
  expect(host.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(0); expect(calls.approve).not.toHaveBeenCalled();
});
it("404 is never proof of not applied; readback precedes exact explicit retry", async () => {
  calls.prepare.mockRejectedValueOnce(Error("lost response")); await prepare(); const original = calls.prepare.mock.calls[0][0];
  calls.request.mockResolvedValueOnce(response({ error: "not found" }, 404)); await click("recover"); expect(readRoutingJournal(props)?.requestId).toBe(original.requestId); expect(button("retry")).toBeUndefined();
  await click("recover"); expect(button("retry").matches(":disabled")).toBe(true); await check("confirmRetry"); await click("retry");
  expect(calls.prepare).toHaveBeenCalledTimes(2); expect(calls.prepare.mock.calls[1][0]).toEqual(original); expect(readRoutingJournal(props)).toBeNull();
});
it("paused and flag-disabled companies can disable an active policy without a wake", async () => {
  calls.current.mockResolvedValue(head(true, { enabled: false, companyPaused: true })); await mount(); expect(host.textContent).toContain(label("paused"));
  expect(button("prepare").matches(":disabled")).toBe(true); expect(button("createTask").matches(":disabled")).toBe(true);
  await check("confirmDisable"); await click("disable"); expect(calls.disable).toHaveBeenCalledTimes(1); expect(calls.run).not.toHaveBeenCalled(); expect(calls.createTask).not.toHaveBeenCalled();
});
it("new ordinary task visibility and potentially billable run require separate explicit intent", async () => {
  calls.current.mockResolvedValue(head(true)); await mount(); await fill("taskTitle", "User work / モデル"); await fill("taskDescription", "Ordinary task instructions");
  expect(button("createTask").matches(":disabled")).toBe(true); await check("confirmTask"); await click("createTask");
  expect(calls.createTask).toHaveBeenCalledTimes(1); expect(calls.run).not.toHaveBeenCalled(); expect(button("run").matches(":disabled")).toBe(true);
  expect(calls.createTask.mock.calls[0][0]).toMatchObject({ title: "User work / モデル", description: "Ordinary task instructions", confirmOrdinaryTaskVisibility: true });
  await check("confirmRun"); await click("run"); expect(calls.run).toHaveBeenCalledTimes(1); expect(host.textContent).toContain(label("runRequested"));
});
it("unknown task creation stores only a digest and cannot replay plaintext after remount", async () => {
  calls.current.mockResolvedValue(head(true)); calls.createTask.mockRejectedValueOnce(Error("lost")); await mount(); await fill("taskTitle", "PRIVATE_ORDINARY_TITLE"); await fill("taskDescription", "PRIVATE_ORDINARY_BODY"); await check("confirmTask"); await click("createTask");
  const saved = sessionStorage.getItem(routingJournalKey(props))!; expect(saved).not.toMatch(/PRIVATE_ORDINARY|confirmOrdinary|description|title/); expect(JSON.parse(saved).inputDigest).toMatch(/^[a-f0-9]{64}$/);
  await mount({ authPending: true }); await mount(); await click("recover"); expect(host.textContent).toContain(label("retryUnavailable")); expect(button("retry").matches(":disabled")).toBe(true);
  expect(calls.createTask).toHaveBeenCalledTimes(1); expect(calls.run).not.toHaveBeenCalled();
});
it("denied readback immediately hides private policy data without clearing an uncertain write", async () => {
  calls.prepare.mockRejectedValueOnce(Error("lost")); await prepare(); calls.current.mockResolvedValueOnce(response({ error: "PRIVATE_DENIAL" }, 403)); await click("recover");
  expect(host.querySelector("textarea")).toBeNull(); expect(host.textContent).not.toContain("PRIVATE_DENIAL"); expect(host.textContent).toContain(label("notAuthorized")); expect(readRoutingJournal(props)).not.toBeNull();
});
it("server-sorted candidate snapshots and mixed proxy quality remain inspectable", async () => {
  const row = record(); row.candidates.reverse(); row.candidates[0]!.evidence.passedCases = 0;
  calls.prepare.mockImplementation(async body => ({ item: { ...row, requestId: body.requestId }, duplicate: false })); await prepare();
  expect(host.textContent).toContain(label("proxyThresholdMet")); expect(host.textContent).toContain(label("proxyThresholdNotMet"));
  for (const key of ["datasetId", "datasetHash", "minimumPassRate", "maxEvidenceAgeHours", "approvalExpiresAt", "promptId", "revisionId", "applicationId", "targetDigest", "environmentId", "profileHash"]) expect(host.textContent).toContain(label(key));
  expect(button("approve").matches(":disabled")).toBe(true); expect(readRoutingJournal(props)).toBeNull();
});
it("successful task binding survives refresh and remount only through fresh authorized readback", async () => {
  calls.current.mockResolvedValue(head(true)); await mount(); await fill("taskTitle", "EPHEMERAL_TASK_TITLE"); await check("confirmTask"); await click("createTask");
  expect(sessionStorage.getItem(`${routingJournalKey(props)}:binding`)).toContain(id(200)); expect(JSON.stringify(sessionStorage)).not.toContain("EPHEMERAL_TASK_TITLE");
  await click("refresh"); expect(host.textContent).toContain(id(200)); expect(calls.binding).toHaveBeenCalledTimes(1); expect(calls.run).not.toHaveBeenCalled();
  await mount({ authPending: true }); await mount(); expect(host.textContent).toContain(id(200)); expect(calls.binding).toHaveBeenCalledTimes(2); expect(calls.run).not.toHaveBeenCalled();
  expect(button("run").matches(":disabled")).toBe(true);
});
it("a stale binding remains inspectable but cannot run after its policy is disabled", async () => {
  calls.current.mockResolvedValue(head(true)); await mount(); await fill("taskTitle", "Work"); await check("confirmTask"); await click("createTask");
  calls.current.mockResolvedValue(head(false, { generation: 2 })); await click("refresh"); expect(host.textContent).toContain(label("boundPolicyInactive"));
  expect(host.querySelector<HTMLInputElement>(`[aria-label="${label("confirmRun")}"]`)!.matches(":disabled")).toBe(true); expect(calls.run).not.toHaveBeenCalled();
});
it("another authorized administrator can inspect and disable a metadata-only paused policy head", async () => {
  calls.current.mockResolvedValue(head(true, { policy: null, companyPaused: true })); await mount({ userId: "second-admin" });
  expect(host.textContent).toContain(id(3)); expect(host.textContent).not.toContain("claude-model-0");
  expect(button("createTask").matches(":disabled")).toBe(true); await check("confirmDisable"); await click("disable");
  expect(calls.disable).toHaveBeenCalledTimes(1); expect(calls.prepare).not.toHaveBeenCalled(); expect(calls.createTask).not.toHaveBeenCalled(); expect(calls.run).not.toHaveBeenCalled();
});
it("locale changes preserve user task text and model IDs without creating execution intent", async () => {
  calls.current.mockResolvedValue(head(true)); await mount(); await fill("taskTitle", "用户标题 / User label / 日本語");
  for (const locale of ["zh-CN", "es", "ja", "en"]) { await act(async () => { await i18n.changeLanguage(locale); });
    expect(host.querySelector<HTMLInputElement>(`[aria-label="${label("taskTitle")}"]`)!.value).toBe("用户标题 / User label / 日本語"); expect(host.textContent).toContain("claude-model-0"); }
  expect(calls.createTask).not.toHaveBeenCalled(); expect(calls.run).not.toHaveBeenCalled();
});
it("new-task hashing and pending state synchronously reject repeated clicks", async () => {
  calls.current.mockResolvedValue(head(true)); let finish!: (value: unknown) => void; calls.createTask.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await fill("taskTitle", "One task"); await check("confirmTask"); await act(async () => { button("createTask").click(); button("createTask").click(); }); await flush();
  expect(calls.createTask).toHaveBeenCalledTimes(1); await act(async () => finish({ binding: binding({ requestId: calls.createTask.mock.calls[0][0].requestId }), duplicate: false })); await flush(); expect(calls.run).not.toHaveBeenCalled();
});
it("a new login discovers only its own actor's unresolved metadata after live auth and cannot replay it", async () => {
  calls.prepare.mockRejectedValueOnce(Error("lost")); await prepare(); const original = calls.prepare.mock.calls[0][0];
  await mount({ sessionId: "new-session" }); expect(host.textContent).toContain(label("previousSessionPending")); expect(button("prepare").matches(":disabled")).toBe(true);
  await click("recover"); expect(button("retry")).toBeUndefined(); expect(calls.prepare).toHaveBeenCalledTimes(1);
  calls.request.mockResolvedValueOnce({ enabled: true, companyPaused: false, policy: record({ requestId: original.requestId }), receipt: null, binding: null, closure: null }); await click("recover"); expect(readRoutingJournal(props)).toBeNull(); expect(calls.prepare).toHaveBeenCalledTimes(1);
});
it("a forbidden saved binding does not suppress disable after policy authorization is rechecked", async () => {
  calls.current.mockResolvedValue(head(true)); await mount(); await fill("taskTitle", "Work"); await check("confirmTask"); await click("createTask");
  calls.binding.mockResolvedValueOnce(response({ error: "private task no longer visible" }, 403)); const count = calls.current.mock.calls.length; await click("refresh");
  expect(calls.current).toHaveBeenCalledTimes(count + 2); expect(host.textContent).toContain(label("bindingUnavailable")); expect(host.textContent).not.toContain(id(202));
  await check("confirmDisable"); await click("disable"); expect(calls.disable).toHaveBeenCalledTimes(1); expect(calls.run).not.toHaveBeenCalled();
});
it("a confirmed old-session task can receive a new explicit run without replaying its creation", async () => {
  calls.current.mockResolvedValue(head(true)); calls.createTask.mockRejectedValueOnce(Error("unknown create")); await mount();
  await fill("taskTitle", "Actual intended work"); await fill("taskDescription", "Actual instructions"); await check("confirmTask"); await click("createTask");
  const creationId = calls.createTask.mock.calls[0][0].requestId; await mount({ authPending: true }); await mount({ sessionId: "relogin" });
  expect(calls.run).not.toHaveBeenCalled(); calls.request.mockResolvedValueOnce({ enabled: true, companyPaused: false, policy: null, receipt: null, binding: binding({ requestId: creationId }), closure: null });
  await click("recover"); expect(readRoutingJournal(props)).toBeNull(); expect(button("run").matches(":disabled")).toBe(true);
  await check("confirmRun"); await click("run"); expect(calls.run).toHaveBeenCalledTimes(1); expect(calls.run.mock.calls[0][0].requestId).not.toBe(creationId); expect(calls.createTask).toHaveBeenCalledTimes(1);
});
async function unknownApproval() {
  calls.approve.mockRejectedValueOnce(Error("approval response lost")); await prepare(); await approvalChecks(); await click("approve");
  calls.policy.mockResolvedValue({ item: record({ approvalExpiresAt: new Date(Date.now() - 60_000).toISOString() }), enabled: true, companyPaused: false });
}
function expiredReadback(requestId: string) {
  return { enabled: true, companyPaused: false, policy: null, receipt: null, binding: null,
    closure: { outcome: "not_applied_closed", requestId, action: "approve", reason: "approval_expired", currentGeneration: 0 } };
}
function closeDurably(lostResponse = false) {
  calls.closeExpired.mockImplementationOnce(async () => {
    const pending = readRoutingJournal(props)!;
    calls.policy.mockResolvedValue({ item: record({ approvalClosedAt: new Date().toISOString() }), enabled: false, companyPaused: true });
    calls.request.mockResolvedValue(expiredReadback(pending.requestId));
    if (lostResponse) throw Error("close response lost");
    return { item: record({ approvalClosedAt: new Date().toISOString() }), duplicate: false };
  });
}
it.each([false, true])("gen0 approval recovery requires explicit durable closure; lost close response=%s", async lost => {
  await unknownApproval(); const original = readRoutingJournal(props)!;
  expect(button("closeExpired").matches(":disabled")).toBe(true); await click("recover");
  expect(readRoutingJournal(props)).toEqual(original); expect(calls.closeExpired).not.toHaveBeenCalled(); expect(button("prepare").matches(":disabled")).toBe(true);
  for (const locale of ["zh-CN", "es", "ja", "en"]) { await act(async () => { await i18n.changeLanguage(locale); }); expect(host.textContent).toContain(label("closeExpiredBoundary")); expect(calls.closeExpired).not.toHaveBeenCalled(); }
  closeDurably(lost); await check("confirmCloseExpired"); await click("closeExpired");
  expect(calls.closeExpired).toHaveBeenCalledTimes(1); expect(calls.closeExpired.mock.calls[0][0]).toEqual({ expectedGeneration: 0 });
  expect(readRoutingJournal(props)).toBeNull(); expect(host.textContent).toContain(label("closed")); expect(calls.approve).toHaveBeenCalledTimes(1); expect(calls.run).not.toHaveBeenCalled();
});
it("successful close POST alone does not release the original approval journal", async () => {
  await unknownApproval(); await click("recover"); const original = readRoutingJournal(props)!; await check("confirmCloseExpired"); await click("closeExpired");
  expect(readRoutingJournal(props)).toEqual(original); expect(host.textContent).toContain(label("unknown")); expect(button("prepare").matches(":disabled")).toBe(true);
});
it("a nonexpired server rejection preserves unknown approval without a replacement", async () => {
  await unknownApproval(); await click("recover"); const original = readRoutingJournal(props)!;
  calls.closeExpired.mockResolvedValueOnce(response({ error: "not expired" }, 409)); await check("confirmCloseExpired"); await click("closeExpired");
  expect(readRoutingJournal(props)).toEqual(original); expect(calls.approve).toHaveBeenCalledTimes(1); expect(host.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(0);
});
it("a new session can explicitly close an old pending proposal while paused and flag-off, without replaying approval", async () => {
  await unknownApproval(); const original = readRoutingJournal(props)!; await mount({ authPending: true });
  calls.current.mockResolvedValue(head(false, { enabled: false, companyPaused: true }));
  calls.policy.mockResolvedValue({ item: record({ approvalExpiresAt: new Date(Date.now() - 60_000).toISOString() }), enabled: false, companyPaused: true });
  await mount({ sessionId: "new-login", authEpoch: 2 }); await click("recover");
  expect(button("retry")).toBeUndefined(); expect(calls.closeExpired).not.toHaveBeenCalled(); expect(readRoutingJournal(props)).toEqual(original);
  closeDurably(); await check("confirmCloseExpired"); await click("closeExpired"); expect(readRoutingJournal(props)).toBeNull();
  expect(calls.approve).toHaveBeenCalledTimes(1); expect(calls.closeExpired).toHaveBeenCalledTimes(1); expect(calls.run).not.toHaveBeenCalled();
});
it.each(["companyId", "userId", "sessionId", "authEpoch"])("pending close guards double clicks and ignores late %s results", async key => {
  await unknownApproval(); await click("recover"); let finish!: (value: unknown) => void;
  calls.closeExpired.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await check("confirmCloseExpired");
  await act(async () => { button("closeExpired").click(); button("closeExpired").click(); }); await flush(); expect(calls.closeExpired).toHaveBeenCalledTimes(1);
  const reads = calls.request.mock.calls.length; await mount({ [key]: key === "authEpoch" ? 2 : key === "companyId" ? id(999) : "new-identity" });
  await act(async () => finish({ item: record({ approvalClosedAt: new Date().toISOString() }), duplicate: false })); await flush();
  expect(calls.request).toHaveBeenCalledTimes(reads); expect(host.textContent).not.toContain(label("closed")); expect(readRoutingJournal(props)).not.toBeNull();
});
it("an approval that became active before close is read back instead of being closed", async () => {
  await unknownApproval(); await click("recover"); const original = readRoutingJournal(props)!;
  calls.current.mockResolvedValue(head(true)); calls.request.mockResolvedValue({ enabled: true, companyPaused: false, policy: null, binding: null, closure: null,
    receipt: { id: id(300), requestId: original.requestId, policyId: id(3), action: "approve", generation: 1, createdAt: new Date().toISOString(), executionStarted: false } });
  await check("confirmCloseExpired"); await click("closeExpired"); expect(calls.closeExpired).not.toHaveBeenCalled(); expect(readRoutingJournal(props)).toBeNull(); expect(host.textContent).toContain(label("approved"));
});
it.each([
  ["bound", "bindingBound"], ["wake_pending", "bindingWakePending"], ["run_claimed", "bindingRunClaimed"], ["start_requested", "bindingStartRequested"],
] as const)("localizes %s as a routing witness in four languages and links the exact company task", async (state, stateKey) => {
  calls.current.mockResolvedValue(head(true));
  calls.createTask.mockImplementation(async body => ({ binding: binding({ requestId: body.requestId, state,
    dispatchRequestId: state === "bound" ? null : id(210), runId: ["run_claimed", "start_requested"].includes(state) ? id(211) : null,
    wakeRequestedAt: state === "bound" ? null : new Date().toISOString(), startRequestedAt: state === "start_requested" ? new Date().toISOString() : null }), duplicate: false }));
  await mount(); await fill("taskTitle", "Actual work"); await check("confirmTask"); await click("createTask");
  const reads = calls.current.mock.calls.length;
  for (const locale of ["en", "zh-CN", "es", "ja"]) {
    await act(async () => { await i18n.changeLanguage(locale); });
    const stateRow = [...host.querySelectorAll("p")].find(value => value.textContent?.startsWith(`${label("bindingState")}:`));
    expect(stateRow?.querySelector("span")?.textContent).toBe(label(stateKey)); expect(host.textContent).toContain(label("bindingWitnessBoundary"));
    const link = [...host.querySelectorAll("a")].find(value => value.textContent === label("openTask"));
    expect(link?.getAttribute("href")).toBe(`/RC/issues/${id(202)}`); expect(host.textContent).toContain(id(202));
  }
  expect(calls.current).toHaveBeenCalledTimes(reads); expect(calls.createTask).toHaveBeenCalledTimes(1); expect(calls.run).not.toHaveBeenCalled();
});
it("does not produce an unscoped task link when the matching company prefix is unavailable", async () => {
  calls.current.mockResolvedValue(head(true)); await mount({ companyPrefix: null }); await fill("taskTitle", "Work"); await check("confirmTask"); await click("createTask");
  expect(host.querySelector("a")).toBeNull(); expect(host.textContent).toContain(id(202));
  calls.current.mockResolvedValue(head(false)); await mount({ companyId: id(999), companyPrefix: "other" });
  expect(host.querySelector("a")).toBeNull(); expect(host.textContent).not.toContain(id(202)); expect(calls.run).not.toHaveBeenCalled();
});
