// @vitest-environment jsdom
import { decisionDeskMessages, i18n } from "../i18n/decision-desk-test-resources";
import { validateLocaleMessages } from "../i18n/locale-validation";
import { decisionGroupLabel } from "../i18n/decision-desk-display";
import { WhatNeedsMe } from "./WhatNeedsMe";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionQueuePage } from "./DecisionQueuePage";
import { queryKeys } from "../lib/queryKeys";
const state = vi.hoisted(() => ({ companyId: "c1", queue: "q1", toast: vi.fn(), remove: vi.fn(), update: vi.fn(), list: vi.fn(), history: vi.fn() }));
vi.mock("@/lib/router", () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams(), vi.fn()], useParams: () => ({ key: state.queue }), useLocation: () => ({ pathname: `/decisions/queues/${state.queue}`, key: state.queue }), Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.companyId }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: () => {} }) }));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast: state.toast }) }));
vi.mock("../hooks/useInboxBadge", () => ({ useInboxDismissals: () => ({ dismiss: vi.fn(), snooze: vi.fn() }) }));
vi.mock("../components/AttentionQueueRow", () => ({ AttentionQueueRow: () => <div>Actual row content</div> }));
vi.mock("../api/decisionQueues", () => ({ decisionQueuesApi: { list: async () => [{ key: state.queue, title: "Raw queue", seedRules: [], itemCount: 1 }], removeItem: state.remove, update: state.update } }));
vi.mock("../api/agents", () => ({ agentsApi: { list: async () => [] } }));
vi.mock("../api/auth", () => ({ authApi: { getSession: async () => ({ user: { id: "viewer1" }, session: { id: "session1" } }) } }));
vi.mock("../api/decisions", () => ({ decisionsApi: { list: state.history } }));
vi.mock("../api/attention", () => ({ attentionApi: { list: (...args: unknown[]) => { state.list(...args); return Promise.resolve({ generatedAt: "2026-10-29T00:00:00Z", items: [{ id: "a1", companyId: state.companyId, sourceKind: "decision", subject: { id: "d1", title: "Raw title" }, queues: [], shelf: false, keep: false, severity: "medium", createdAt: "2026-10-29T00:00:00Z", activityAt: "2026-10-29T00:00:00Z", dismissal: null }] }); } } }));
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
  state.companyId = "c1"; state.queue = "q1"; state.toast.mockReset(); state.remove.mockReset(); state.list.mockReset(); state.history.mockReset().mockResolvedValue([]); localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(queryKeys.auth.session, { user: { id: "viewer1" }, session: { id: "session1" } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });
describe("actual queue page exclusion boundary", () => {
  it("reserves exclusion synchronously and snapshots its reason", async () => {
    state.remove.mockImplementation(() => new Promise(() => {}));
    await render(); await act(async () => button("Exclude").click()); await type("original reason");
    const submit = button("Exclude", true);
    await act(async () => { submit.click(); submit.click(); });
    expect(state.remove).toHaveBeenCalledExactlyOnceWith("c1", "q1", "decision", "d1", "original reason");
  });
  it.each(["company", "queue", "identity", "scope", "draft"])("keeps new reason and suppresses stale feedback after %s changes", async (kind) => {
    let resolve!: () => void; state.remove.mockImplementation(() => new Promise<void>(yes => { resolve = yes; }));
    await render(); await act(async () => button("Exclude").click()); await type("old reason");
    await act(async () => button("Exclude", true).click());
    if (kind === "company") { state.companyId = "c2"; await render(); }
    if (kind === "queue") { state.queue = "q2"; await render(); }
    if (kind === "scope") await act(async () => { client.setQueryData(queryKeys.auth.session, { user: { id: "viewer1" }, session: { id: "session1", scopeKey: "b".repeat(64) } }); });
    if (kind === "identity") await act(async () => { client.setQueryData(queryKeys.auth.session, { user: { id: "viewer2" }, session: { id: "session2" } }); });
    if (!document.querySelector("textarea")) await act(async () => button("Exclude").click());
    await type("new reason");
    await act(async () => resolve()); await flush();
    expect(document.querySelector("textarea")?.value).toBe("new reason");
    expect(state.toast).not.toHaveBeenCalled();
  });
});


describe.each(Object.entries(decisionDeskMessages))("actual decision desk %s", (locale, strings) => {
  it("localizes real page headings, history curtains and lazy empty results", async () => {
    expect(validateLocaleMessages(strings, decisionDeskMessages.en)).toEqual([]);
    await i18n.changeLanguage(locale);
    await act(async () => root.render(<QueryClientProvider client={client}><WhatNeedsMe /></QueryClientProvider>)); await flush();
    expect(host.querySelector("h1")?.textContent).toBe(strings.decisions);
    expect(host.textContent).toContain(strings.shelf["new-today"]);
    expect(host.textContent).toContain(strings.decided);
    expect(host.textContent).toContain(strings.expired);
    expect(state.history).not.toHaveBeenCalled();
    const curtain = [...host.querySelectorAll("button")].find(node => node.textContent?.includes(strings.decided))!;
    await act(async () => curtain.click()); await flush();
    expect(host.textContent).toContain(strings.emptyDecided);
    expect(state.history).toHaveBeenCalledExactlyOnceWith("c1", { status: "decided", limit: 51 });
    expect(host.textContent).not.toContain("decisionDeskUi.");
    expect(decisionGroupLabel({ key: "project:user-id", label: "Earlier", items: [] })).toBe("Earlier");
  });
});
it("hot-switches the actual queue exclusion form without losing reason/focus or issuing requests", async () => {
  await render(); await act(async () => button("Exclude").click()); await type("raw reason Ω");
  const field = document.querySelector("textarea")!; field.focus(); field.setSelectionRange(1, 4);
  const reads = state.list.mock.calls.length;
  for (const [locale, strings] of Object.entries(decisionDeskMessages)) {
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(document.querySelector("textarea")).toBe(field);
    expect(field.value).toBe("raw reason Ω");
    expect(field.placeholder).toBe(strings.reasonPlaceholder);
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([1, 4]);
    expect(host.querySelector("h1")?.textContent).toBe("Raw queue");
    expect(state.list).toHaveBeenCalledTimes(reads);
    expect(state.remove).not.toHaveBeenCalled();
  }
});
it("retains the actual filter menu and canonical checked selection across all locales", async () => {
  await render(); await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Filter"]')!.click());
  await act(async () => button("No project").click());
  const panel = document.querySelector('[data-slot="popover-content"]');
  const reads = state.list.mock.calls.length;
  for (const [locale, strings] of Object.entries(decisionDeskMessages)) {
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(document.querySelector('[data-slot="popover-content"]')).toBe(panel);
    expect(button(strings.noProject).querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("true");
    expect(state.list).toHaveBeenCalledTimes(reads);
    expect(state.remove).not.toHaveBeenCalled();
  }
});
it("keeps custom native date input values and open popover stable while display language changes", async () => {
  await render(); await act(async () => button("Custom").click());
  const from = document.querySelector<HTMLInputElement>('input[type="date"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(from, "2026-10-01");
    from.dispatchEvent(new Event("input", { bubbles: true }));
  }); await flush();
  const reads = state.list.mock.calls.length;
  for (const [locale, strings] of Object.entries(decisionDeskMessages)) {
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(document.querySelector('input[type="date"]')).toBe(from);
    expect(from.value).toBe("2026-10-01");
    expect(from.getAttribute("aria-label")).toBe(strings.from);
    expect(state.list).toHaveBeenCalledTimes(reads);
  }
});

it.each(["decided", "expired"] as const)("surfaces %s history read failure instead of claiming empty history", async status => {
  state.history.mockRejectedValue(new Error("Raw history provider <b> diagnostic"));
  await act(async () => root.render(<QueryClientProvider client={client}><WhatNeedsMe /></QueryClientProvider>)); await flush();
  const curtain = [...host.querySelectorAll("button")].find(node => node.textContent?.includes(decisionDeskMessages.en[status]))!;
  await act(async () => curtain.click()); await flush();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Raw history provider <b> diagnostic");
  expect(host.textContent).not.toContain(status === "decided" ? decisionDeskMessages.en.emptyDecided : decisionDeskMessages.en.emptyExpired);
  const errorPanel = host.querySelector('[role="alert"]')!; const retry = errorPanel.querySelector("button")!; retry.focus();
  for (const [locale, strings] of Object.entries(decisionDeskMessages)) {
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(host.querySelector('[role="alert"]')).toBe(errorPanel); expect(errorPanel.textContent).toContain(strings.historyError);
    expect(errorPanel.textContent).toContain("Raw history provider <b> diagnostic"); expect(errorPanel.querySelector("b")).toBeNull();
    expect(retry.textContent).toBe(strings.historyRetry); expect(document.activeElement).toBe(retry); expect(state.history).toHaveBeenCalledTimes(1);
  }
  let resolve!: (rows: unknown[]) => void; state.history.mockImplementation(() => new Promise(yes => { resolve = yes; }));
  await act(async () => { retry.click(); retry.click(); });
  expect(state.history).toHaveBeenCalledTimes(2); expect(state.history).toHaveBeenLastCalledWith("c1", { status, limit: 51 });
  await act(async () => resolve([])); await flush();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain(status === "decided" ? decisionDeskMessages.ja.emptyDecided : decisionDeskMessages.ja.emptyExpired);
});

it("keeps late history in its original company's cache without borrowing it for a new company's empty view", async () => {
  let resolve!: (rows: unknown[]) => void;
  state.history.mockImplementationOnce(() => new Promise(yes => { resolve = yes; })).mockResolvedValue([]);
  const draw = async () => { await act(async () => root.render(<QueryClientProvider client={client}><WhatNeedsMe /></QueryClientProvider>)); await flush(); };
  await draw();
  await act(async () => [...host.querySelectorAll("button")].find(node => node.textContent?.includes(decisionDeskMessages.en.decided))!.click()); await flush();
  expect(host.textContent).toContain(decisionDeskMessages.en.loadingDecided);
  expect(host.textContent).not.toContain(decisionDeskMessages.en.emptyDecided);
  state.companyId = "c2"; await draw();
  expect(host.textContent).toContain(decisionDeskMessages.en.emptyDecided);
  const oldRows = [{ id: "c1-private-history", title: "Old company private history" }];
  await act(async () => resolve(oldRows)); await flush();
  expect(client.getQueryData(queryKeys.decisions.list("c1", "decided"))).toEqual(oldRows);
  expect(client.getQueryData(queryKeys.decisions.list("c2", "decided"))).toEqual([]);
  expect(host.textContent).toContain(decisionDeskMessages.en.emptyDecided);
  expect(host.textContent).not.toContain("Old company private history");
  expect(state.history.mock.calls.map(call => call[0])).toEqual(["c1", "c2"]);
});

it.each(["click", "success", "failure"])("fences actual queue %s when only the real-session marker changes before commit", async mode => {
  const value = { user: { id: "viewer1" }, session: { id: "paperclip:session:viewer1", userId: "viewer1", scopeKey: "a".repeat(64) } };
  client.setQueryData(queryKeys.auth.session, value);
  let settle!: () => void;
  state.remove.mockImplementation(() => new Promise<void>((resolve, reject) => { settle = mode === "failure" ? () => reject(new Error("old failure")) : resolve; }));
  await render(); await act(async () => button("Exclude").click()); await type("unchanged reason");
  const submit = button("Exclude", true);
  if (mode !== "click") await act(async () => submit.click());
  await act(async () => {
    client.setQueryData(queryKeys.auth.session, { ...value, session: { ...value.session, scopeKey: "b".repeat(64) } });
    if (mode === "click") submit.click(); else settle();
  }); await flush();
  expect(state.remove).toHaveBeenCalledTimes(mode === "click" ? 0 : 1);
  expect(state.toast).not.toHaveBeenCalled();
  expect(document.querySelector("textarea")?.value).toBe("unchanged reason");
});
