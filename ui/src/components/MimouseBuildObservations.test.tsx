// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MimouseBuildObservationContext, MimouseBuildObservationPage, MimouseBuildObservationReceipt,
  MimouseBuildObservationRequestOutcome } from "@paperclipai/shared";
import { MimouseBuildObservations } from "./MimouseBuildObservations";
import { ensureBuildObservationJournal, readBuildObservationJournal } from "@/lib/build-observation-journal";

type ReadResult = MimouseBuildObservationContext | MimouseBuildObservationPage | MimouseBuildObservationRequestOutcome
  | { request: MimouseBuildObservationRequestOutcome | null } | null;
const calls = vi.hoisted(() => ({ read: vi.fn<(path: string, signal: AbortSignal) => Promise<ReadResult>>(),
  post: vi.fn<(path: string, init?: RequestInit) => Promise<Response>>() }));
vi.mock("@/api/coding-read", () => ({ readCodingEvidence: calls.read }));
vi.mock("@/api/client", () => ({ requestResponse: calls.post }));
vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const requestId = "7537f5ba-ae42-4a48-89a1-79949638fd83";
const props = { companyId: "company", userId: "owner", sessionId: "session-one", authEpoch: 1, deliveryId: "delivery", headSha: "a".repeat(40) };
const path = "/companies/company/coding/delivery/build-observations";
const context: MimouseBuildObservationContext = { enabled: true, diagnostic: "observation_available",
  profiles: [{ id: "linux-x64", expectedBinding: "b".repeat(64), artifactName: "app.bin", pipelineId: 7, headSha: props.headSha }] };
const receipt: MimouseBuildObservationReceipt = { id: "receipt", requestId, deliveryId: props.deliveryId, profileId: "linux-x64", status: "observed",
  diagnostic: "observation_complete", admission: "blocked", observedAt: "2026-10-27T10:00:00.000Z", createdAt: "2026-10-27T10:00:01.000Z",
  currentness: { status: "local_current", reasons: ["historical_observation"] },
  result: { status: "observed", diagnostic: "observation_complete", admission: "blocked", jobRechecked: true, pipelineRechecked: true,
    artifact: { sha256: "d".repeat(64), sizeBytes: 123, pathSha256: "e".repeat(64), basis: "exact_job_bytes" },
    provenance: { status: "verified_claim", cryptographicSignature: "verified", payloadSha256: "f".repeat(64), policySha256: "1".repeat(64),
      verifiedAt: "2026-10-27T10:00:00.000Z", startedOn: "2026-10-26T08:00:00Z", finishedOn: "2026-10-26T08:02:00Z" },
    blockers: ["controller_provenance_unavailable"], otherFacts: { workflowClosure: "unassessed", platform: "unassessed", tests: "unassessed",
      artifactCodeSignature: "unassessed", controllerObservation: "blocked", c3: "blocked" } } };
const empty: MimouseBuildObservationPage = { receipts: [], nextCursor: null };
const outcome = (state: MimouseBuildObservationRequestOutcome["state"]): MimouseBuildObservationRequestOutcome => ({ requestId, state,
  input: { requestId, profileId: "linux-x64", jobId: 42, expectedBinding: "b".repeat(64) },
  attemptCount: 1, createdAt: "2026-10-27T10:00:00.000Z", retryUntil: "2026-10-27T10:05:00.000Z", receipt: state === "terminal" ? receipt : null });
let host: HTMLDivElement, root: Root, client: QueryClient;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function mount(extra: Partial<typeof props> = {}) { await act(async () => root.render(<QueryClientProvider client={client}><MimouseBuildObservations {...props} {...extra} /></QueryClientProvider>)); await flush(); }
function button(label: string) {
  const found = [...host.querySelectorAll("button")].find(item => item.textContent === label);
  if (!found) throw Error(`Missing test button: ${label}`); return found;
}
async function click(element: HTMLElement) { await act(async () => element.click()); await flush(); }
async function open() { await click(button("buildObservations.title")); }
async function job(value = "42") {
  const input = host.querySelector("input"); if (!input) throw Error("Missing job input");
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true })); }); await flush();
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); localStorage.clear(); vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
  calls.read.mockImplementation(async url => url.endsWith("/context") ? context : url.endsWith("/requests/current") ? { request: null } : url.includes("/requests/") ? outcome("terminal") : empty);
  calls.post.mockResolvedValue(Response.json(outcome("terminal")));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); localStorage.clear(); });

it("is collapsed with zero I/O, then performs only manually opened local reads", async () => {
  await mount(); expect(calls.read).not.toHaveBeenCalled(); expect(calls.post).not.toHaveBeenCalled();
  await open(); expect(calls.read.mock.calls.map(([url]) => url)).toEqual([`${path}/context`, path, `${path}/requests/current`]);
  expect(calls.read.mock.calls.every(([, signal]) => signal instanceof AbortSignal)).toBe(true);
  expect(host.textContent).toContain("buildObservations.boundary");
  await act(async () => window.dispatchEvent(new Event("focus"))); await flush(); expect(calls.read).toHaveBeenCalledTimes(3);
  expect(client.getQueryCache().getAll().every(query => query.queryKey.slice(1, 7).join(":") === [props.companyId, props.userId, props.sessionId, props.authEpoch, props.deliveryId, props.headSha].join(":"))).toBe(true);
});
it("posts only exact selectors and current binding, keeping every receipt blocked", async () => {
  await mount(); await open(); await job(); await click(button("buildObservations.observe"));
  expect(calls.post).toHaveBeenCalledOnce(); const [url, init] = calls.post.mock.calls[0];
  expect(url).toBe(path); expect(init).toMatchObject({ method: "POST", cache: "no-store", signal: expect.any(AbortSignal) });
  expect(init?.body).toBe(JSON.stringify({ requestId, profileId: "linux-x64", jobId: 42, expectedBinding: "b".repeat(64) }));
  expect(host.textContent).toContain("buildObservations.state.terminal"); expect(host.textContent).toContain("buildObservations.provenance.verified_claim");
  expect(host.textContent).toContain("buildObservations.historical"); expect(host.textContent).toContain("2026-10-26T08:00:00Z");
  expect(host.textContent).toContain("2026-10-27T10:00:00.000Z"); expect(host.textContent).not.toContain("signatureVerified");
  expect([...host.querySelectorAll("button")].some(item => item.textContent === "buildObservations.retry")).toBe(false);
});
it.each(["0", "01", "-1", "1.5", "4e2", "9007199254740992", "abc"])("rejects noncanonical job ID %s without POST", async value => {
  await mount(); await open(); await job(value); expect(button("buildObservations.observe").disabled).toBe(true); expect(calls.post).not.toHaveBeenCalled();
});
it.each([{ userId: "local-board" }, { sessionId: "local-board" }])("local implicit identity cannot read or trigger observation", async identity => {
  await mount(identity); await open(); expect(host.textContent).toContain("buildObservations.loginRequired"); expect(calls.read).not.toHaveBeenCalled(); expect(calls.post).not.toHaveBeenCalled();
});
it("does not offer a mismatched-head profile", async () => {
  calls.read.mockImplementation(async url => url.endsWith("/context") ? { ...context, profiles: context.profiles.map(profile => ({ ...profile, headSha: "c".repeat(40) })) } : url.endsWith("/requests/current") ? { request: null } : empty);
  await mount(); await open(); expect(host.textContent).toContain("buildObservations.unavailable"); expect(host.querySelector("input")).toBeNull();
});
it("fences rapid duplicate clicks while a POST is still pending", async () => {
  let resolve!: (value: Response) => void; calls.post.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
  await mount(); await open(); await job(); const start = button("buildObservations.observe");
  await act(async () => { start.click(); start.click(); }); await flush();
  expect(calls.post).toHaveBeenCalledOnce(); expect(button("buildObservations.title").disabled).toBe(true);
  await act(async () => resolve(Response.json(outcome("terminal")))); await flush();
  await click(button("buildObservations.recover")); expect(calls.post).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("buildObservations.state.terminal"); expect(host.textContent).not.toContain("buildObservations.retry");
});
it("preserves an uncertain ID through collapse, never retries automatically, and only retries after a recoverable GET", async () => {
  calls.post.mockRejectedValueOnce(Error("raw-private-response")); await mount(); await open(); await job(); await click(button("buildObservations.observe"));
  expect(host.textContent).toContain(requestId); expect(host.textContent).toContain("buildObservations.uncertain"); expect(host.textContent).not.toContain("raw-private-response");
  await click(button("buildObservations.title")); await open(); expect(host.textContent).toContain(requestId); expect(calls.post).toHaveBeenCalledOnce();
  calls.read.mockResolvedValueOnce(outcome("running")); await click(button("buildObservations.recover"));
  expect(host.textContent).toContain("buildObservations.state.running"); expect(host.textContent).not.toContain("buildObservations.retry");
  calls.read.mockResolvedValueOnce(outcome("retryable")); await click(button("buildObservations.recover"));
  await click(button("buildObservations.retry")); expect(calls.post).toHaveBeenCalledTimes(2);
  expect(calls.post.mock.calls[1][1]?.body).toBe(calls.post.mock.calls[0][1]?.body);
  await click(button("buildObservations.refresh")); expect(calls.post).toHaveBeenCalledTimes(2);
});
it("hides stale private history when refresh is denied", async () => {
  calls.read.mockImplementation(async url => url.endsWith("/context") ? context : url.endsWith("/requests/current") ? { request: null } : { receipts: [receipt], nextCursor: null });
  await mount(); await open(); expect(host.textContent).toContain(receipt.result.artifact?.sha256);
  calls.read.mockRejectedValue(Error("forbidden-private-details")); await click(button("buildObservations.refresh"));
  expect(host.textContent).not.toContain(receipt.result.artifact?.sha256); expect(host.textContent).toContain("buildObservations.readError");
  expect(host.textContent).not.toContain("forbidden-private-details");
});
it.each([{ sessionId: "session-two" }, { authEpoch: 2 }, { companyId: "other" }, { headSha: "b".repeat(40) }])("aborts an old POST and ignores its late receipt on scope change %#", async extra => {
  let resolve!: (value: Response) => void; calls.post.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
  await mount(); await open(); await job(); await click(button("buildObservations.observe"));
  const signal = calls.post.mock.calls[0][1]?.signal; await mount(extra); expect(signal?.aborted).toBe(true);
  await act(async () => resolve(Response.json(outcome("terminal")))); await flush();
  expect(host.textContent).not.toContain(requestId); expect(host.textContent).not.toContain("observation_complete");
  expect(host.querySelector("section")).toBeNull();
});
it("aborts old scoped reads and rejects their late evidence", async () => {
  const pending: Array<{ resolve: (result: ReadResult) => void; signal: AbortSignal }> = [];
  calls.read.mockImplementation((_url, signal) => new Promise<ReadResult>(resolve => pending.push({ resolve, signal })));
  await mount(); await open(); expect(pending).toHaveLength(3);
  await mount({ sessionId: "session-two" }); expect(pending.every(item => item.signal.aborted)).toBe(true);
  await act(async () => { pending[0].resolve(context); pending[1].resolve({ receipts: [receipt], nextCursor: null }); pending[2].resolve({ request: outcome("terminal") }); }); await flush();
  expect(host.textContent).not.toContain(requestId); expect(host.textContent).not.toContain("app.bin");
});
it("uses distinct accessible labels when multiple delivery panels are open", async () => {
  await act(async () => root.render(<QueryClientProvider client={client}><MimouseBuildObservations {...props} /><MimouseBuildObservations {...props} deliveryId="other-delivery" /></QueryClientProvider>));
  for (const entry of [...host.querySelectorAll("button")]) await click(entry);
  const ids = [...host.querySelectorAll("input, select")].map(element => element.id); expect(new Set(ids).size).toBe(ids.length);
  for (const label of host.querySelectorAll("label")) expect(document.getElementById(label.htmlFor)).not.toBeNull();
});

it("hides a directly returned receipt too when a later metadata read loses access", async () => {
  await mount(); await open(); await job(); await click(button("buildObservations.observe"));
  expect(host.textContent).toContain(receipt.result.artifact?.sha256);
  calls.read.mockRejectedValue(Error("access-revoked")); await click(button("buildObservations.refresh"));
  expect(host.textContent).not.toContain(receipt.result.artifact?.sha256);
});

it("restores a persisted recoverable request after remount without POST and retries the server-returned body only explicitly", async () => {
  calls.read.mockImplementation(async url => url.endsWith("/context") ? context : url.endsWith("/requests/current") ? { request: outcome("retryable") } : url.includes("/requests/") ? outcome("retryable") : empty);
  await mount(); await open(); expect(host.textContent).toContain(requestId); expect(calls.post).not.toHaveBeenCalled();
  await act(async () => root.render(<QueryClientProvider client={client}><div /></QueryClientProvider>)); await flush();
  await mount(); await open(); expect(host.textContent).toContain(requestId); expect(button("buildObservations.retry").disabled).toBe(false);
  expect(calls.read.mock.calls.filter(([url]) => url.endsWith("/requests/current"))).toHaveLength(1);
  expect(calls.read.mock.calls.filter(([url]) => url.endsWith(`/requests/${requestId}`))).toHaveLength(1); expect(calls.post).not.toHaveBeenCalled();
  await click(button("buildObservations.retry")); expect(calls.post).toHaveBeenCalledOnce();
  expect(calls.post.mock.calls[0][1]?.body).toBe(JSON.stringify(outcome("retryable").input));
});
it("does not reinstall a dismissed terminal request on later metadata refresh", async () => {
  calls.read.mockImplementation(async url => url.endsWith("/context") ? context : url.endsWith("/requests/current") ? { request: outcome("terminal") } : empty);
  await mount(); await open(); await click(button("buildObservations.newRequest")); expect(host.querySelector("input")).not.toBeNull();
  await click(button("buildObservations.refresh")); expect(host.querySelector("input")).not.toBeNull(); expect(calls.post).not.toHaveBeenCalled();
});
it.each([{ sessionId: "session-two" }, { authEpoch: 2 }, { companyId: "other-company" }])("uses a fresh scoped recovery GET after identity navigation %# without resending", async extra => {
  calls.read.mockImplementation(async url => url.endsWith("/context") ? context : url.endsWith("/requests/current") ? { request: outcome("running") } : url.includes("/requests/") ? outcome("running") : empty);
  await mount(); await open(); await mount(extra); expect(host.querySelector("section")).toBeNull();
  await open(); expect(host.textContent).toContain(requestId); expect(host.textContent).toContain("buildObservations.state.running");
  expect(calls.read.mock.calls.filter(([url]) => url.includes("/requests/"))).toHaveLength(2); expect(calls.post).not.toHaveBeenCalled();
});
it.each([403, 404])("a %s on initial request recovery hides evidence and never creates a replacement", async status => {
  calls.read.mockImplementation(async url => {
    if (url.endsWith("/requests/current")) throw Object.assign(Error("private-current-error"), { status });
    return url.endsWith("/context") ? context : { receipts: [receipt], nextCursor: null };
  });
  await mount(); await open(); expect(host.querySelector("input")).toBeNull(); expect(host.textContent).toContain("buildObservations.readError");
  expect(host.textContent).not.toContain(receipt.result.artifact?.sha256); expect(host.textContent).not.toContain("private-current-error");
  await click(button("buildObservations.refresh")); expect(calls.post).not.toHaveBeenCalled();
});
it("cannot start while initial persisted-request discovery is unresolved", async () => {
  let resolve!: (result: ReadResult) => void;
  calls.read.mockImplementation(async url => url.endsWith("/context") ? context : url.endsWith("/requests/current")
    ? new Promise<ReadResult>(done => { resolve = done; }) : { receipts: [receipt], nextCursor: null });
  await mount(); await open(); expect(host.querySelector("input")).toBeNull(); expect(host.textContent).not.toContain(receipt.result.artifact?.sha256);
  await act(async () => resolve({ request: null })); await flush(); expect(host.querySelector("input")).not.toBeNull(); expect(calls.post).not.toHaveBeenCalled();
});

const journalScope = { companyId: props.companyId, userId: props.userId, deliveryId: props.deliveryId };
function pendingJournal() { ensureBuildObservationJournal(journalScope, outcome("running").input); }
it.each([{ sessionId: "session-two" }, { authEpoch: 2 }, { headSha: "c".repeat(40) }])("keeps a journaled request across same-user identity/head changes %# and recovers its exact ID", async extra => {
  pendingJournal(); calls.read.mockImplementation(async url => url.endsWith("/context") ? context : url.endsWith(`/requests/${requestId}`) ? outcome("retryable") : url.endsWith("/requests/current") ? { request: null } : empty);
  await mount(); await open(); await mount(extra); await open();
  expect(host.textContent).toContain(requestId); expect(calls.read.mock.calls.filter(([url]) => url.endsWith(`/requests/${requestId}`))).toHaveLength(2);
  expect(calls.read.mock.calls.some(([url]) => url.endsWith("/requests/current"))).toBe(false); expect(calls.post).not.toHaveBeenCalled();
});
it("does not reveal another user's journal or erase it", async () => {
  pendingJournal(); await mount({ userId: "different-user" }); await open();
  expect(host.textContent).not.toContain(requestId); expect(calls.read.mock.calls.some(([url]) => url.endsWith(`/requests/${requestId}`))).toBe(false);
  expect(readBuildObservationJournal(journalScope)).toHaveLength(1); expect(calls.post).not.toHaveBeenCalled();
});
it.each(["403", "404", "null", "old-terminal"])("keeps a journal after exact recovery returns %s, without falling back to current or opening a new ID", async kind => {
  pendingJournal(); calls.read.mockImplementation(async url => {
    if (url.endsWith(`/requests/${requestId}`)) {
      if (kind === "403" || kind === "404") throw Object.assign(Error("private"), { status: Number(kind) });
      if (kind === "null") return null;
      return { ...outcome("terminal"), requestId: "8537f5ba-ae42-4a48-89a1-79949638fd83" };
    }
    return url.endsWith("/context") ? context : url.endsWith("/requests/current") ? { request: outcome("terminal") } : empty;
  });
  await mount(); await open(); expect(host.textContent).toContain(requestId); expect(host.querySelector("input")).toBeNull();
  expect(host.textContent).not.toContain("buildObservations.newRequest"); expect(readBuildObservationJournal(journalScope)).toHaveLength(1);
  expect(calls.read.mock.calls.some(([url]) => url.endsWith("/requests/current"))).toBe(false); expect(calls.post).not.toHaveBeenCalled();
});
it("blocks POST when journal persistence or removal cannot be confirmed", async () => {
  await mount(); await open(); await job();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("quota-secret-details"); });
  await click(button("buildObservations.observe")); expect(calls.post).not.toHaveBeenCalled(); expect(host.textContent).toContain("buildObservations.storageError");
  expect(host.textContent).not.toContain("quota-secret-details");
});
it("does not forget a delayed reservation after remount even if current was initially null", async () => {
  let resolve!: (response: Response) => void; calls.post.mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
  await mount(); await open(); await job(); await click(button("buildObservations.observe"));
  expect(readBuildObservationJournal(journalScope)).toHaveLength(1);
  await act(async () => root.render(<QueryClientProvider client={client}><div /></QueryClientProvider>)); await flush();
  calls.read.mockImplementation(async url => { if (url.endsWith(`/requests/${requestId}`)) throw Object.assign(Error("not reserved yet"), { status: 404 });
    return url.endsWith("/context") ? context : url.endsWith("/requests/current") ? { request: null } : empty; });
  await mount(); await open(); expect(host.querySelector("input")).toBeNull(); expect(host.textContent).toContain(requestId);
  await act(async () => resolve(Response.json(outcome("terminal")))); await flush();
  expect(readBuildObservationJournal(journalScope)).toHaveLength(1); expect(calls.post).toHaveBeenCalledOnce();
});
it("selects the next unresolved journal rather than opening a fresh ID after one terminal receipt", async () => {
  pendingJournal(); const firstKey = localStorage.key(0)!;
  const second = { ...outcome("running").input, requestId: "8537f5ba-ae42-4a48-89a1-79949638fd83" };
  localStorage.setItem(firstKey.replace(requestId, second.requestId), JSON.stringify(second));
  calls.read.mockImplementation(async url => url.endsWith("/context") ? context : url.endsWith(`/requests/${requestId}`) ? outcome("terminal")
    : url.endsWith(`/requests/${second.requestId}`) ? { ...outcome("running"), requestId: second.requestId, input: second } : empty);
  await mount(); await open(); await click(button("buildObservations.newRequest"));
  expect(host.textContent).toContain(second.requestId); expect(host.querySelector("input")).toBeNull();
  expect(readBuildObservationJournal(journalScope)).toEqual([second]); expect(calls.post).not.toHaveBeenCalled();
});
it("requires two explicit actions to close unknown locally and clears only the matching durable terminal response", async () => {
  pendingJournal(); calls.read.mockImplementation(async url => { if (url.endsWith(`/requests/${requestId}`)) throw Object.assign(Error("not found"), { status: 404 });
    return url.endsWith("/context") ? context : empty; });
  await mount(); await open(); expect(calls.post).not.toHaveBeenCalled();
  await click(button("buildObservations.closeUnknown")); expect(host.textContent).toContain("buildObservations.closeBoundary"); expect(calls.post).not.toHaveBeenCalled();
  await click(button("common.cancel")); expect(calls.post).not.toHaveBeenCalled();
  await click(button("buildObservations.closeUnknown")); await click(button("buildObservations.confirmClose"));
  expect(calls.post).toHaveBeenCalledWith(`${path}/requests/${requestId}/close-unknown`, expect.objectContaining({ method: "POST",
    body: JSON.stringify({ ...outcome("running").input, confirmClose: true }), signal: expect.any(AbortSignal) }));
  expect(readBuildObservationJournal(journalScope)).toEqual([]);
});
it("retains the journal when close is denied for an active request or its response is unknown", async () => {
  pendingJournal(); calls.read.mockImplementation(async url => url.endsWith("/context") ? context : url.endsWith(`/requests/${requestId}`) ? outcome("running") : empty);
  calls.post.mockRejectedValue(Object.assign(Error("observation_execution_active"), { status: 409 }));
  await mount(); await open(); await click(button("buildObservations.closeUnknown")); await click(button("buildObservations.confirmClose"));
  expect(readBuildObservationJournal(journalScope)).toHaveLength(1); expect(host.textContent).toContain("buildObservations.uncertain");
  expect(host.textContent).not.toContain("buildObservations.newRequest"); expect(calls.post).toHaveBeenCalledOnce();
});
