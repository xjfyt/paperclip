// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionItem } from "@paperclipai/shared";
import "../i18n/attention-row-test-resources";
import "../i18n/interaction-audience-test-resources";
import { AttentionQueueRow } from "./AttentionQueueRow";
import { queryKeys } from "../lib/queryKeys";
const state = vi.hoisted(() => ({ companyId: "c1", path: "/decisions", approve: vi.fn(), joinApprove: vi.fn(), toast: vi.fn() }));
vi.mock("../api/access", () => ({ accessApi: { approveJoinRequest: state.joinApprove } }));
vi.mock("../api/approvals", () => ({ approvalsApi: { approve: state.approve } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.companyId }) }));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast: state.toast }) }));
vi.mock("@/lib/router", () => ({ Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>, useLocation: () => ({ pathname: state.path, key: "route1" }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const item = { id: "row1", companyId: "c1", sourceKind: "approval", subject: { id: "approval1", kind: "approval", title: "Raw title", href: "/approvals/approval1" }, decisionVerbs: [{ id: "approve", label: "Approve" }], inlineResolvable: true, activityAt: "2026-10-29" } as AttentionItem;
let host: HTMLDivElement, root: Root, client: QueryClient;
const button = () => [...host.querySelectorAll("button")].find(node => node.textContent === "Approve")!;
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };
const render = async (target = item, expanded = false) => { await act(async () => root.render(<QueryClientProvider client={client}><AttentionQueueRow item={target} companyId={state.companyId} expanded={expanded} onToggleExpand={vi.fn()} onDismiss={vi.fn()} /></QueryClientProvider>)); };
beforeEach(() => { state.companyId = "c1"; state.path = "/decisions"; state.approve.mockReset(); state.joinApprove.mockReset(); state.toast.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); client.setQueryData(queryKeys.auth.session, { user: { id: "u1" }, session: { id: "s1" } }); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
describe("actual compact decision action boundaries", () => {
  it("reserves a same-turn approval synchronously before the network call", async () => {
    state.approve.mockImplementation(() => new Promise(() => {})); await render(); const approve = button();
    await act(async () => { approve.click(); approve.click(); });
    expect(state.approve).toHaveBeenCalledExactlyOnceWith("approval1");
  });
  it.each(["company", "identity", "route", "target"])("suppresses old success and preserves the newer pending lock after %s changes", async kind => {
    let resolveOld!: (value: unknown) => void;
    state.approve.mockImplementationOnce(() => new Promise(yes => { resolveOld = yes; })).mockImplementationOnce(() => new Promise(() => {}));
    const invalidations = vi.spyOn(client, "invalidateQueries");
    await render(); await act(async () => button().click());
    if (kind === "company") state.companyId = "c2";
    if (kind === "identity") await act(async () => { client.setQueryData(queryKeys.auth.session, { user: { id: "u2" }, session: { id: "s2" } }); });
    if (kind === "route") state.path = "/decision-queues/other";
    const next = kind === "target" ? { ...item, id: "row2", subject: { ...item.subject, id: "approval2" } } : { ...item, companyId: state.companyId };
    await render(next); await act(async () => button().click());
    await act(async () => resolveOld({})); await flush();
    expect.soft(state.approve).toHaveBeenCalledTimes(2);
    expect.soft(button().disabled).toBe(true); expect.soft(state.toast).not.toHaveBeenCalled(); expect(invalidations).not.toHaveBeenCalled();
  });
  it("checks auth immediately before invoking the API, not only in the click handler", async () => {
    state.approve.mockResolvedValue({}); await render(); const approve = button();
    await act(async () => { approve.click(); client.setQueryData(queryKeys.auth.session, { user: { id: "u2" }, session: { id: "s2" } }); });
    await flush(); expect(state.approve).not.toHaveBeenCalled(); expect(state.toast).not.toHaveBeenCalled();
  });
});

describe("actual expanded approval and join decisions", () => {
  it.each(["approval", "join_request"] as const)("serializes expanded %s approval before React commits pending state", async sourceKind => {
    const api = sourceKind === "approval" ? state.approve : state.joinApprove;
    api.mockImplementation(() => new Promise(() => {}));
    const target = { ...item, sourceKind }; await render(target, true); const approve = button();
    await act(async () => { approve.click(); approve.click(); });
    expect(api).toHaveBeenCalledTimes(1);
  });
  it.each(["approval", "join_request"] as const)("does not invalidate a newer company when old expanded %s succeeds", async sourceKind => {
    let resolve!: (value: unknown) => void;
    const api = sourceKind === "approval" ? state.approve : state.joinApprove;
    api.mockImplementation(() => new Promise(yes => { resolve = yes; }));
    const invalidations = vi.spyOn(client, "invalidateQueries");
    await render({ ...item, sourceKind }, true); await act(async () => button().click());
    state.companyId = "c2"; await render({ ...item, sourceKind, companyId: "c2", subject: { ...item.subject, id: "new-target" } }, true);
    await act(async () => resolve({})); await flush();
    expect(invalidations).not.toHaveBeenCalled(); expect(state.toast).not.toHaveBeenCalled();
  });
});

it.each(["approval", "join_request"] as const)("guards expanded %s network start against an intervening auth change", async sourceKind => {
  await render({ ...item, sourceKind }, true); const approve = button();
  await act(async () => { approve.click(); client.setQueryData(queryKeys.auth.session, null); });
  await flush(); expect(state.approve).not.toHaveBeenCalled(); expect(state.joinApprove).not.toHaveBeenCalled(); expect(state.toast).not.toHaveBeenCalled();
});
it.each([false, true])("does not apply stale source-company rows to the selected company (expanded=%s)", async expanded => {
  state.companyId = "c2"; await render(item, expanded); expect(button().disabled).toBe(true);
  await act(async () => button().click()); expect(state.approve).not.toHaveBeenCalled();
});
it("captures an expanded note with its target while retaining a newer draft and raw error", async () => {
  let reject!: (error: Error) => void; state.approve.mockImplementation(() => new Promise((_yes, no) => { reject = no; }));
  await render(item, true); const field = host.querySelector("textarea")!;
  const type = async (value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); }); };
  await type("  Raw note Ω  "); await act(async () => button().click());
  expect(state.approve).toHaveBeenCalledExactlyOnceWith("approval1", "Raw note Ω");
  await type("New draft Ω"); await act(async () => reject(new Error("Raw provider <b> Ω"))); await flush();
  expect(field.value).toBe("New draft Ω"); expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ body: "Raw provider <b> Ω", tone: "error" }));
});
