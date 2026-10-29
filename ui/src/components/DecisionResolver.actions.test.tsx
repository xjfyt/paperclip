// @vitest-environment jsdom
import { i18n } from "../i18n/decision-card-test-resources";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionResolver } from "./DecisionResolver";
import { queryKeys } from "../lib/queryKeys";
import type { DecisionOutcome } from "../api/decisions";
const state = vi.hoisted(() => ({ companyId: "c1", decide: vi.fn(), dismiss: vi.fn(), get: vi.fn(), list: vi.fn() }));
vi.mock("../api/decisions", () => ({ decisionsApi: { decide: state.decide, dismiss: state.dismiss, list: state.list, get: state.get } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.companyId, selectedCompany: { issuePrefix: "PAP" } }) }));
vi.mock("@/lib/router", async () => await import("react-router-dom"));
vi.mock("./MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <p>{children}</p> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
const fixture = (id = "d1", companyId = "c1") => ({
  id, companyId, title: "Raw decision", body: "", status: "open", options: [{ id: "yes", label: "Do it", effects: [] }],
  inputs: [{ id: "reason", label: "Reason", required: false }], targetSnapshots: {}, metadata: {}, executions: [],
} as unknown as DecisionOutcome);
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };
async function render(id = "d1", onResolved = vi.fn()) {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><DecisionResolver companyId={state.companyId} decisionId={id} initialDecision={fixture(id, state.companyId)} onResolved={onResolved} /></MemoryRouter></QueryClientProvider>));
  await flush();
}
beforeEach(() => {
  state.companyId = "c1"; state.decide.mockReset(); state.dismiss.mockReset(); state.get.mockReset().mockResolvedValue(fixture()); state.list.mockReset().mockResolvedValue([]);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(queryKeys.auth.session, { user: { id: "viewer-1" }, session: { id: "session-1" } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.useRealTimers(); await i18n.changeLanguage("en"); });
describe("DecisionResolver actual host action boundary", () => {
  it("reserves decide synchronously before TanStack reports pending", async () => {
    state.decide.mockImplementation(() => new Promise(() => {}));
    await render();
    const button = host.querySelector("button")!;
    await act(async () => { button.click(); button.click(); });
    expect(state.decide).toHaveBeenCalledTimes(1);
    expect(state.decide.mock.calls[0]?.[0]).toBe("d1");
    expect(state.decide.mock.calls[0]?.[1]).toMatchObject({ optionId: "yes", inputValues: {}, idempotencyKey: expect.any(String) });
  });
  it("hot-switches the real resolver without rereading, submitting, or replacing its focused draft", async () => {
    await render();
    const field = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "raw draft Ω");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    field.focus(); field.setSelectionRange(1, 5);
    const reads = state.list.mock.calls.length;
    for (const locale of ["zh-CN", "es", "ja", "en"]) {
      await act(async () => { await i18n.changeLanguage(locale); });
      expect(host.querySelector("textarea")).toBe(field);
      expect(field.value).toBe("raw draft Ω");
      expect(document.activeElement).toBe(field);
      expect([field.selectionStart, field.selectionEnd]).toEqual([1, 5]);
      expect(state.list).toHaveBeenCalledTimes(reads);
      expect(state.decide).not.toHaveBeenCalled();
      expect(state.get).not.toHaveBeenCalled();
    }
  });
  it("retries with the same idempotency key and captured payload while the scope stays current", async () => {
    state.decide.mockRejectedValueOnce(new Error("temporary"));
    state.decide.mockResolvedValueOnce({ ...fixture(), status: "decided" });
    await render(); vi.useFakeTimers();
    await act(async () => host.querySelector("button")!.click());
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(state.decide).toHaveBeenCalledTimes(2);
    expect(state.decide.mock.calls[1]).toEqual(state.decide.mock.calls[0]);
    vi.useRealTimers();
  });
  it("does not send an automatic retry using a replacement viewer's credentials", async () => {
    state.decide.mockRejectedValue(new Error("temporary"));
    await render(); vi.useFakeTimers();
    await act(async () => host.querySelector("button")!.click());
    await act(async () => { client.setQueryData(queryKeys.auth.session, { user: { id: "viewer-2" }, session: { id: "session-2" } }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(state.decide).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("temporary");
    vi.useRealTimers();
  });
  it.each(["company", "decision", "identity", "identity-roundtrip", "unmount"])("ignores late completion after %s changes", async (kind) => {
    let resolve!: (value: DecisionOutcome) => void;
    state.decide.mockImplementation(() => new Promise(yes => { resolve = yes; }));
    const resolved = vi.fn(); await render("d1", resolved);
    await act(async () => host.querySelector("button")!.click());
    if (kind === "company") { state.companyId = "c2"; await render("d2", resolved); }
    if (kind === "decision") await render("d2", resolved);
    if (kind.startsWith("identity")) await act(async () => {
      client.setQueryData(queryKeys.auth.session, { user: { id: "viewer-2" }, session: { id: "session-2" } });
      if (kind === "identity-roundtrip") client.setQueryData(queryKeys.auth.session, { user: { id: "viewer-1" }, session: { id: "session-1" } });
    });
    if (kind === "unmount") await act(async () => root.render(null));
    await act(async () => resolve({ ...fixture(), status: "decided", executionStatus: "succeeded" })); await flush();
    expect(resolved).not.toHaveBeenCalled();
    expect(client.getQueryData<DecisionOutcome>(queryKeys.decisions.detail("d2"))?.status).not.toBe("decided");
  });
});
