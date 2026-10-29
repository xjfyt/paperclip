// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/decision-desk-test-resources";
import { AgingItemRow } from "./DecisionShelf";
import { DecisionTriageStrip } from "./DecisionTriageStrip";
import { queryKeys } from "../lib/queryKeys";
import type { AttentionItem } from "@paperclipai/shared";
const state = vi.hoisted(() => ({ companyId: "c1", create: vi.fn(), add: vi.fn(), triage: vi.fn(), toast: vi.fn(), list: vi.fn(), keep: vi.fn() }));
vi.mock("../api/decisionQueues", () => ({ decisionQueuesApi: { create: state.create, addItem: state.add, updateTriage: state.triage, list: state.list, setKeep: state.keep } }));
vi.mock("./AttentionQueueRow", () => ({ AttentionQueueRow: () => <div>row</div> }));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast: state.toast }) }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.companyId }) }));
vi.mock("@/lib/router", () => ({ useLocation: () => ({ pathname: "/decisions", key: "route1" }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
const item = { id: "row1", sourceKind: "decision", subject: { id: "d1", kind: "decision", metadata: {} }, queues: [] } as unknown as AttentionItem;
const button = (text: string) => [...document.querySelectorAll("button")].find(node => node.textContent === text)!;
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><DecisionTriageStrip companyId={state.companyId} item={item} /></QueryClientProvider>)); await flush(); }
async function type(value: string) { await act(async () => {
  const field = document.querySelector<HTMLInputElement>('input:not([type="date"])')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}); }
beforeEach(() => {
  state.companyId = "c1"; state.create.mockReset(); state.add.mockReset(); state.triage.mockReset(); state.toast.mockReset(); state.keep.mockReset(); state.list.mockReset().mockResolvedValue([]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(queryKeys.auth.session, { user: { id: "viewer1" }, session: { id: "session1" } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
describe("actual triage queue creation boundary", () => {
  it("does not repeat decide-by mutations in the same event turn", async () => {
    state.triage.mockImplementation(() => new Promise(() => {})); await render();
    const today = button("Today"); await act(async () => { today.click(); today.click(); });
    expect(state.triage).toHaveBeenCalledExactlyOnceWith("c1", "decision", "d1", { decideBy: "today" });
  });
  it("keeps a newer company's pending lock when the older request fails", async () => {
    let rejectOld!: (error: Error) => void;
    state.triage.mockImplementationOnce(() => new Promise((_yes, no) => { rejectOld = no; }));
    state.triage.mockImplementationOnce(() => new Promise(() => {}));
    await render(); await act(async () => button("Today").click());
    state.companyId = "c2"; await render(); await act(async () => button("Today").click());
    await act(async () => rejectOld(new Error("old provider diagnostic"))); await flush();
    expect(state.triage).toHaveBeenCalledTimes(2);
    expect(state.triage.mock.calls.map(call => call[0])).toEqual(["c1", "c2"]);
    expect(button("Today").disabled).toBe(true);
    expect(state.toast).not.toHaveBeenCalled();
  });
  it("reserves queue creation for Enter and click in the same turn", async () => {
    state.create.mockImplementation(() => new Promise(() => {}));
    await render(); await act(async () => button("Queue").click()); await flush();
    await act(async () => button("New queue…").click()); await type("Original queue");
    const field = document.querySelector("input")!;
    await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); button("Create").click(); });
    expect(state.create).toHaveBeenCalledExactlyOnceWith("c1", { key: "original-queue", title: "Original queue" });
  });
  it.each(["company", "identity", "draft"])("does not auto-add the old created queue or clear a new draft after %s changes", async (kind) => {
    let resolve!: (value: unknown) => void; state.create.mockImplementation(() => new Promise(yes => { resolve = yes; }));
    await render(); await act(async () => button("Queue").click()); await flush();
    await act(async () => button("New queue…").click()); await type("Original queue");
    await act(async () => button("Create").click());
    if (kind === "company") { state.companyId = "c2"; await render(); }
    if (kind === "identity") await act(async () => { client.setQueryData(queryKeys.auth.session, { user: { id: "viewer2" }, session: { id: "session2" } }); });
    await type("New draft");
    await act(async () => resolve({ key: "old-created-queue", title: "Original queue" })); await flush();
    expect(state.add).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLInputElement>('input:not([type="date"])')?.value).toBe("New draft");
    expect(state.toast).not.toHaveBeenCalled();
  });
});

it("keeps aging actions single-flight and suppresses old-company feedback", async () => {
  let resolve!: (value: unknown) => void; state.keep.mockImplementation(() => new Promise(yes => { resolve = yes; }));
  const draw = async () => { await act(async () => root.render(<QueryClientProvider client={client}><AgingItemRow item={{ ...item, createdAt: "2026-09-01", activityAt: "2026-09-01" }} companyId={state.companyId} now={Date.now()} agentMap={new Map()} agents={[]} currentUserId="viewer1" expanded={false} onToggleExpand={vi.fn()} onDismiss={vi.fn()} onSnooze={vi.fn()} /></QueryClientProvider>)); };
  await draw(); const keep = button("Keep on desk");
  await act(async () => { keep.click(); keep.click(); });
  expect.soft(state.keep).toHaveBeenCalledTimes(1);
  state.companyId = "c2"; await draw();
  await act(async () => resolve({})); await flush();
  expect(state.toast).not.toHaveBeenCalled();
});
