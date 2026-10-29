// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionQueuePage } from "./DecisionQueuePage";
import { queryKeys } from "../lib/queryKeys";
const state = vi.hoisted(() => ({ companyId: "c1", queue: "q1", toast: vi.fn(), remove: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/router", () => ({ useParams: () => ({ key: state.queue }), useLocation: () => ({ pathname: `/decisions/queues/${state.queue}`, key: state.queue }), Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.companyId }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: () => {} }) }));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast: state.toast }) }));
vi.mock("../hooks/useInboxBadge", () => ({ useInboxDismissals: () => ({ dismiss: vi.fn(), snooze: vi.fn() }) }));
vi.mock("../components/AttentionQueueRow", () => ({ AttentionQueueRow: () => <div>Actual row content</div> }));
vi.mock("../api/decisionQueues", () => ({ decisionQueuesApi: { list: async () => [{ key: state.queue, title: "Raw queue", seedRules: [], itemCount: 1 }], removeItem: state.remove, update: state.update } }));
vi.mock("../api/agents", () => ({ agentsApi: { list: async () => [] } }));
vi.mock("../api/auth", () => ({ authApi: { getSession: async () => ({ user: { id: "viewer1" }, session: { id: "session1" } }) } }));
vi.mock("../api/attention", () => ({ attentionApi: { list: async () => ({ generatedAt: "2026-10-29T00:00:00Z", items: [{ id: "a1", companyId: state.companyId, sourceKind: "decision", subject: { id: "d1", title: "Raw title" }, queues: [], shelf: false, keep: false, severity: "medium", activityAt: "2026-10-29T00:00:00Z", dismissal: null }] }) } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };
const button = (text: string, last = false) => [...document.querySelectorAll("button")].filter(node => node.textContent === text) .at(last ? -1 : 0)!;
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><DecisionQueuePage /></QueryClientProvider>)); await flush(); }
async function type(value: string) { await act(async () => {
  const input = document.querySelector("textarea")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}); }
beforeEach(() => {
  state.companyId = "c1"; state.queue = "q1"; state.toast.mockReset(); state.remove.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(queryKeys.auth.session, { user: { id: "viewer1" }, session: { id: "session1" } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
describe("actual queue page exclusion boundary", () => {
  it("reserves exclusion synchronously and snapshots its reason", async () => {
    state.remove.mockImplementation(() => new Promise(() => {}));
    await render(); await act(async () => button("Exclude").click()); await type("original reason");
    const submit = button("Exclude", true);
    await act(async () => { submit.click(); submit.click(); });
    expect(state.remove).toHaveBeenCalledExactlyOnceWith("c1", "q1", "decision", "d1", "original reason");
  });
  it.each(["company", "queue", "identity", "draft"])("keeps new reason and suppresses stale feedback after %s changes", async (kind) => {
    let resolve!: () => void; state.remove.mockImplementation(() => new Promise<void>(yes => { resolve = yes; }));
    await render(); await act(async () => button("Exclude").click()); await type("old reason");
    await act(async () => button("Exclude", true).click());
    if (kind === "company") { state.companyId = "c2"; await render(); }
    if (kind === "queue") { state.queue = "q2"; await render(); }
    if (kind === "identity") await act(async () => { client.setQueryData(queryKeys.auth.session, { user: { id: "viewer2" }, session: { id: "session2" } }); });
    if (!document.querySelector("textarea")) await act(async () => button("Exclude").click());
    await type("new reason");
    await act(async () => resolve()); await flush();
    expect(document.querySelector("textarea")?.value).toBe("new reason");
    expect(state.toast).not.toHaveBeenCalled();
  });
});
