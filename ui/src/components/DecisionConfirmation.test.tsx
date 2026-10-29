// @vitest-environment jsdom
import "../i18n/decision-card-test-resources";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionCard } from "./DecisionCard";
import { DecisionDateChips } from "./DecisionDateChips";
import { DecisionTriageStrip } from "./DecisionTriageStrip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AttentionItem } from "@paperclipai/shared";
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast: vi.fn() }) }));
import type { Decision } from "../api/decisions";
vi.mock("./MarkdownBody", () => ({ MarkdownBody: ({ children }: { children: string }) => <p>{children}</p> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const decision = {
  id: "decision-1", companyId: "c1", title: "raw title", body: "", status: "open",
  options: [{ id: "cancel", label: "Cancel the tree", effects: [{ type: "cancel_issue_tree", targetIssueId: "target-1", staleness: "strict", reasonComment: "raw reason" }] }],
  inputs: [], targetSnapshots: {}, metadata: {},
} as unknown as Decision;
let props: ComponentProps<typeof DecisionCard>;
async function render(next: Partial<typeof props> = {}) {
  props = { ...props, ...next };
  await act(async () => root.render(<DecisionCard {...props} />));
}
const button = (text: string) => [...document.querySelectorAll("button")].find(node => node.textContent === text)!;
async function click(text: string) { await act(async () => button(text).click()); }
async function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(node instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = { decision, onDecide: vi.fn() };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
describe("explicit decision confirmation", () => {
  it("never submits from a second option click, even after typing the confirmation", async () => {
    await render();
    const option = host.querySelector("button")!;
    await act(async () => option.click());
    await act(async () => option.click());
    expect(props.onDecide).not.toHaveBeenCalled();
    await input(host.querySelector("input")!, "target-1");
    await act(async () => option.click());
    expect(props.onDecide).not.toHaveBeenCalled();
    await click("Cancel tree");
    expect(props.onDecide).toHaveBeenCalledExactlyOnceWith("cancel", {});
  });
  it("revalidates strict targets and required input at the final confirmation", async () => {
    await render({ decision: { ...decision, inputs: [{ id: "reason", label: "Raw input", required: true }] } });
    await input(host.querySelector("textarea")!, "because");
    await act(async () => host.querySelector("button")!.click());
    await input(host.querySelector("input")!, "target-1");
    expect(button("Cancel tree").disabled).toBe(false);
    await render({ targetChanged: { "target-1": true } });
    expect(button("Cancel tree").disabled).toBe(true);
    await click("Cancel tree");
    expect(props.onDecide).not.toHaveBeenCalled();
    await render({ targetChanged: {} });
    await input(host.querySelector("textarea")!, "  ");
    expect(button("Cancel tree").disabled).toBe(true);
    await click("Cancel tree");
    expect(props.onDecide).not.toHaveBeenCalled();
  });
  it.each(["running", null, "future_state"])("does not mislabel %s as failed", async (executionStatus) => {
    await render({ decision: { ...decision, status: "decided", executionStatus: executionStatus as Decision["executionStatus"] } });
    expect(host.textContent).not.toContain("Failed");
    expect(host.querySelector("[data-decision-state]")?.getAttribute("data-decision-state")).toBe(executionStatus === "running" ? "running" : executionStatus === null ? "decided" : "unknown");
  });
  it("forwards the real triage date trigger events and accessibility attributes", async () => {
    const client = new QueryClient();
    const item = { sourceKind: "decision", subject: { id: "d1", kind: "decision", metadata: {} }, queues: [] } as unknown as AttentionItem;
    await act(async () => root.render(<QueryClientProvider client={client}><DecisionTriageStrip companyId="c1" item={item} /></QueryClientProvider>));
    const trigger = button("Pick date");
    await act(async () => trigger.click());
    expect(document.querySelector('input[type="date"]')).not.toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    client.clear();
  });
  it("opens the actual custom-date popover and retains the native button trigger", async () => {
    await act(async () => root.render(<DecisionDateChips value="all" custom={{ from: null, to: null }} onChange={vi.fn()} />));
    const trigger = button("Custom");
    await act(async () => trigger.click());
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(2);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await act(async () => trigger.click());
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(0);
  });
});
