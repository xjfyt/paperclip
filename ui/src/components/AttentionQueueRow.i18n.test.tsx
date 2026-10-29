// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionItem } from "@paperclipai/shared";
import { AttentionQueueRow } from "./AttentionQueueRow";
import { attentionRowMessages, i18n } from "../i18n/attention-row-test-resources";
import { decisionDeskMessages } from "../i18n/decision-desk-test-resources";
import { validateLocaleMessages } from "../i18n/locale-validation";
import { attentionDetailDisplay } from "../i18n/attention-row-display";
import { formatNumber } from "../lib/utils";
const state = vi.hoisted(() => ({ approve: vi.fn(), reject: vi.fn(), revise: vi.fn() }));
vi.mock("../api/approvals", () => ({ approvalsApi: { approve: state.approve, reject: state.reject, requestRevision: state.revise } }));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast: vi.fn() }) }));
vi.mock("@/lib/router", async () => {
  const { forwardRef } = await import("react");
  return { Link: forwardRef<HTMLAnchorElement, React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }>(({ children, to, ...props }, ref) => <a {...props} ref={ref} href={to}>{children}</a>) };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
const item = { id: "row1", companyId: "c1", sourceKind: "approval", subject: { id: "a1", kind: "approval", title: "Raw title <b> Ω", href: "/PAP/approvals/a1" }, decisionVerbs: [{ id: "approve", label: "Approve", description: "raw description" }], whyNow: "Raw why", inlineResolvable: true, severity: "medium", activityAt: "2026-10-29T00:00:00Z", decideBy: "today", decideByAttribution: { type: "agent", agentName: "Raw agent" }, detail: { kind: "questions", questionCount: 1234, firstQuestionText: "Raw provider <b>", images: [] } } as unknown as AttentionItem;
const language = async (locale: string) => { await act(async () => { await i18n.changeLanguage(locale); }); };
async function render(expanded = false, next = item) { await act(async () => root.render(<QueryClientProvider client={client}><AttentionQueueRow item={next} companyId="c1" expanded={expanded} onToggleExpand={vi.fn()} onDismiss={vi.fn()} onSnooze={vi.fn()} /></QueryClientProvider>)); }
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient(); vi.clearAllMocks(); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await language("en"); });
describe.each(Object.entries(attentionRowMessages))("actual attention row %s", (locale, strings) => {
  it("localizes system chrome and structured counts while preserving raw content", async () => {
    expect(validateLocaleMessages(strings, attentionRowMessages.en)).toEqual([]);
    await language(locale); await render();
    expect(host.textContent).toContain(decisionDeskMessages[locale as keyof typeof decisionDeskMessages].source.approval);
    expect(host.textContent).toContain(strings.more);
    expect(host.textContent).toContain(strings.action.approve);
    expect(host.textContent).toContain(formatNumber(1234));
    for (const raw of ["Raw title <b> Ω", "Raw provider <b>", "Raw agent"]) expect(host.textContent).toContain(raw);
    expect(host.querySelector("b")).toBeNull();
    expect(host.querySelector('[data-attention-source]')?.getAttribute("data-attention-source")).toBe("approval");
    expect(host.textContent).not.toContain("attentionRowUi.");
    expect(attentionDetailDisplay({ ...item, detail: { kind: "generic", summaryExcerpt: "Raw text", images: [] } })).toBe("“Raw text”");
  });
});
it("keeps the real approval note focused with selection intact across language switches", async () => {
  await render(true); const field = host.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Raw note Ω"); field.dispatchEvent(new Event("input", { bubbles: true })); });
  field.focus(); field.setSelectionRange(1, 4);
  for (const [locale, strings] of Object.entries(attentionRowMessages)) {
    await language(locale);
    expect(host.querySelector("textarea")).toBe(field);
    expect(field.value).toBe("Raw note Ω"); expect(field.placeholder).toBe(strings.note);
    expect(document.activeElement).toBe(field); expect([field.selectionStart, field.selectionEnd]).toEqual([1, 4]);
    expect(state.approve).not.toHaveBeenCalled(); expect(state.reject).not.toHaveBeenCalled(); expect(state.revise).not.toHaveBeenCalled();
  }
});
it("hot-switches an open real row menu without remounting it or activating an action", async () => {
  await render(); const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Row actions"]')!;
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  const menu = document.querySelector('[role="menu"]'); expect(menu).not.toBeNull();
  for (const [locale, strings] of Object.entries(attentionRowMessages)) {
    await language(locale);
    expect(document.querySelector('[role="menu"]')).toBe(menu);
    expect(menu?.textContent).toContain(strings.dismiss);
    expect(trigger.getAttribute("aria-label")).toBe(strings.rowActions);
    expect(state.approve).not.toHaveBeenCalled();
  }
});
