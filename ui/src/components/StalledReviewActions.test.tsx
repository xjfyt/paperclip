// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/review-policy-test-resources";
import { issueReviewPolicyBadge, formatReviewPolicyValue } from "@/lib/review-policy";
import { StalledReviewActions } from "./StalledReviewActions";
const mocks = vi.hoisted(() => ({ decide: vi.fn(), toast: vi.fn(), resolved: vi.fn() }));
vi.mock("../api/issues", () => ({ issuesApi: { decideStalledReview: mocks.decide } }));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast: mocks.toast }) }));
const cases = [
  ["en", "Anyone else", "Human only", "Approve", "Request changes", "Review approved — issue marked done.", "Could not record the review decision"],
  ["zh-CN", "其他审核人", "仅限人工", "批准", "请求修改", "审核已批准，任务已标记为完成。", "无法记录审核决定"],
  ["es", "Otra persona", "Solo humanos", "Aprobar", "Solicitar cambios", "Revisión aprobada; tarea marcada como completada.", "No se pudo registrar la decisión de revisión"],
  ["ja", "依頼者以外", "人間のみ", "承認", "変更を依頼", "レビューを承認し、タスクを完了にしました。", "レビューの判断を記録できませんでした"],
] as const;
describe("stalled review localized policy and actions", () => {
  let root: Root; let container: HTMLDivElement; let client: QueryClient;
  beforeEach(async () => {
    vi.clearAllMocks(); mocks.decide.mockReset(); await i18n.changeLanguage("en");
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  });
  afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); await i18n.changeLanguage("en"); });
  async function render(policy: "not_creator" | "human_only" | "anyone" = "not_creator") {
    await act(async () => { root.render(<QueryClientProvider client={client}><StalledReviewActions issueId="original-issue" companyId="original-company" reviewPolicy={policy} onResolved={mocks.resolved} /></QueryClientProvider>); });
  }
  const button = (id: string) => container.querySelector<HTMLButtonElement>(`[data-testid="stalled-review-${id}"]`)!;
  async function settle(assertion: () => void) { await act(async () => { await vi.waitFor(assertion); }); }
  async function note(value: string) {
    const element = container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  it.each(cases)("hot switches labels and preserves policy wire in %s", async (locale, notCreator, human, approve, request) => {
    await render(); await act(async () => { await i18n.changeLanguage(locale); });
    expect(container.querySelector('[data-testid="review-policy-badge"]')?.textContent).toBe(notCreator);
    expect(container.querySelector('[data-testid="review-policy-badge"]')?.getAttribute("data-review-policy")).toBe("not_creator");
    expect(button("approve").textContent).toBe(approve); expect(button("request-changes").textContent).toBe(request);
    expect(button("request-changes").disabled).toBe(true); expect(button("request-changes").title).not.toBe("");
    expect(mocks.decide).not.toHaveBeenCalled();
    await render("human_only"); expect(container.querySelector('[data-testid="review-policy-badge"]')?.textContent).toBe(human);
    expect(container.querySelector('[data-testid="review-policy-badge"]')?.getAttribute("title")).toBe(issueReviewPolicyBadge("human_only")?.description);
    expect(formatReviewPolicyValue("future_policy")).toBe("future policy");
    expect(formatReviewPolicyValue("constructor")).toBe("constructor");
    expect(issueReviewPolicyBadge("constructor" as never)).toBeNull();
    expect(issueReviewPolicyBadge("anyone")).toBeNull(); await render("anyone");
    expect(container.querySelector('[data-testid="review-policy-badge"]')).toBeNull();
  });
  it.each(cases)("keeps pending and latest-language success truthful in %s", async (locale, _n, _h, _a, _r, success) => {
    let resolve!: (value: unknown) => void; mocks.decide.mockReturnValue(new Promise(done => { resolve = done; }));
    await render(); await act(async () => button("approve").click());
    await settle(() => expect(mocks.decide).toHaveBeenCalledExactlyOnceWith("original-issue", { action: "approve", note: undefined }));
    await settle(() => expect(button("approve").disabled).toBe(true));
    await act(async () => { button("approve").click(); await i18n.changeLanguage(locale); });
    expect(mocks.decide).toHaveBeenCalledTimes(1); expect(mocks.toast).not.toHaveBeenCalled();
    await act(async () => { resolve({}); });
    await settle(() => expect(mocks.toast).toHaveBeenCalledWith({ title: success, tone: "success" }));
    expect(mocks.resolved).toHaveBeenCalledExactlyOnceWith("approve");
  });
  it.each(cases)("preserves trimmed note, raw error and retry state in %s", async (locale, _n, _h, _a, _r, _s, failure) => {
    mocks.decide.mockRejectedValue(new Error("Original diagnostic 原始"));
    await render(); await act(async () => { await i18n.changeLanguage(locale); });
    await note("  Customer text 原文  "); expect(button("request-changes").disabled).toBe(false);
    await act(async () => button("request-changes").click());
    await settle(() => expect(mocks.toast).toHaveBeenCalledWith({ title: failure, body: "Original diagnostic 原始", tone: "error" }));
    expect(mocks.decide).toHaveBeenCalledExactlyOnceWith("original-issue", { action: "request_changes", note: "Customer text 原文" });
    expect(mocks.resolved).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("  Customer text 原文  ");
  });
});
