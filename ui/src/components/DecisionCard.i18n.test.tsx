// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionCard } from "./DecisionCard";
import type { Decision } from "../api/decisions";
import { decisionCardMessages, i18n } from "../i18n/decision-card-test-resources";
import { validateLocaleMessages } from "../i18n/locale-validation";
vi.mock("./MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <p>{children}</p> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const decision = {
  id: "d1", companyId: "c1", title: "Raw 标题 <b>", body: "Raw description Ω", status: "open",
  options: [{ id: "cancel", label: "Raw option", description: "Raw provider text", effects: [{ type: "cancel_issue_tree", targetIssueId: "ID_RAW", staleness: "strict", reasonComment: "raw reason" }] }],
  inputs: [{ id: "reason", label: "Raw field", placeholder: "Raw hint", required: true }], targetSnapshots: {}, metadata: {},
} as unknown as Decision;
const language = async (locale: string) => { await act(async () => { await i18n.changeLanguage(locale); }); };
async function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) { await act(async () => {
  Object.getOwnPropertyDescriptor(node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, "value")!.set!.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
}); }
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); await language("en"); });
describe.each(Object.entries(decisionCardMessages))("decision card %s", (locale, strings) => {
  it("validates resources and localizes chrome while leaving provider inputs/errors untouched", async () => {
    expect(validateLocaleMessages(strings, decisionCardMessages.en)).toEqual([]);
    await language(locale);
    await act(async () => root.render(<DecisionCard decision={decision} errorMessage="raw_error <b> Ω" />));
    for (const text of [strings.pending, strings.destructive, strings.notNow, strings.dismissNoEffects, "Raw 标题 <b>", "Raw description Ω", "Raw option", "Raw provider text", "Raw field", "raw_error <b> Ω"]) expect(host.textContent).toContain(text);
    expect(host.querySelector("b")).toBeNull();
    expect(host.querySelector("textarea")?.placeholder).toBe("Raw hint");
    expect(host.querySelector("[data-decision-state]")?.getAttribute("data-decision-state")).toBe("pending");
    expect(host.textContent).not.toContain("decisionCardUi.");
  });
  it("localizes outcomes while preserving unrecognized statuses and provider errors", async () => {
    await language(locale);
    await act(async () => root.render(<DecisionCard decision={{ ...decision, status: "decided", executionStatus: "partial" }} executions={[
      { id: "e1", targetIssueId: "ID_RAW", effectType: "comment_on_issue", status: "failed", error: "raw_provider_error_<b>", result: null } as never,
      { id: "e2", targetIssueId: "ID_RAW", effectType: "comment_on_issue", status: "provider_future_status", error: null, result: null } as never,
    ]} />));
    expect(host.textContent).toContain(strings.partial);
    expect(host.textContent).toContain(strings.partialHelp);
    expect(host.textContent).toContain("raw_provider_error_<b>");
    expect(host.textContent).toContain("provider_future_status");
    expect(host.querySelector("b")).toBeNull();
    expect(host.textContent).not.toContain("decisionCardUi.");
  });

});
it("hot-switches without resetting draft, confirmation, focus, selection or submitting", async () => {
  const onDecide = vi.fn();
  const original = JSON.stringify(decision);
  await act(async () => root.render(<DecisionCard decision={decision} onDecide={onDecide} />));
  const textarea = host.querySelector("textarea")!;
  await input(textarea, "reason 原样 Ω");
  await act(async () => host.querySelector("button")!.click());
  const confirmation = host.querySelector("input")!;
  await input(confirmation, "ID_RAW");
  confirmation.focus(); confirmation.setSelectionRange(1, 4);
  for (const [locale, strings] of Object.entries(decisionCardMessages)) {
    await language(locale);
    expect(host.querySelector("textarea")).toBe(textarea);
    expect(textarea.value).toBe("reason 原样 Ω");
    expect(host.querySelector("input")).toBe(confirmation);
    expect(confirmation.value).toBe("ID_RAW");
    expect(document.activeElement).toBe(confirmation);
    expect([confirmation.selectionStart, confirmation.selectionEnd]).toEqual([1, 4]);
    expect(confirmation.getAttribute("aria-label")).toBe(strings.typeLabel);
    expect(host.textContent).toContain(strings.treeWarning);
    expect(onDecide).not.toHaveBeenCalled();
  }
  await act(async () => [...host.querySelectorAll("button")].find(node => node.textContent === decisionCardMessages.ja.cancelTree)!.click());
  expect(onDecide).toHaveBeenCalledExactlyOnceWith("cancel", { reason: "reason 原样 Ω" });
  expect(JSON.stringify(decision)).toBe(original);
});
