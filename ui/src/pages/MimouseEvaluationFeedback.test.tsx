// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import en from "@/i18n/contributions/evaluationUi/en.json";
import zh from "@/i18n/contributions/evaluationUi/zh-CN.json";
import es from "@/i18n/contributions/evaluationUi/es.json";
import ja from "@/i18n/contributions/evaluationUi/ja.json";
import { MimouseEvaluationFeedback } from "./MimouseEvaluationFeedback";
const calls = vi.hoisted(() => ({ post: vi.fn(), add: vi.fn(() => true) }));
vi.mock("@/api/client", () => ({ api: { post: calls.post } }));
const uid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
let host: HTMLDivElement, root: Root;
async function mount(disabled = false, key = "a") { await act(async () => root.render(<MimouseEvaluationFeedback key={key} root="/companies/company/skill-evaluations" skillId={uid(1)} disabled={disabled} onAdd={calls.add} />)); }
async function fill(index: number, value: string) {
  const element = host.querySelectorAll("input,textarea")[index] as HTMLInputElement | HTMLTextAreaElement;
  await act(async () => { Object.getOwnPropertyDescriptor(element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function click(text: string) { await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === text)!.click()); }
async function populate() { await fill(0, uid(2)); await fill(1, uid(3)); await fill(2, "answer"); }
const preview = { inputId: uid(2), expected: "answer", input: "safe input", sourceInputSnapshot: " safe input ", source: { feedbackId: uid(3), sourceTrust: "quarantined", reproductionStatus: "not_reproduced" }, previewDigest: "a".repeat(64), executionStarted: false };
beforeEach(async () => {
  for (const [locale, value] of Object.entries({ en, "zh-CN": zh, es, ja })) i18n.addResourceBundle(locale, "translation", { evaluationUi: value }, true, true);
  await i18n.changeLanguage("en"); calls.post.mockReset().mockResolvedValue(preview); calls.add.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("requires exact preview and explicit review; only appends reference and never freezes or executes", async () => {
  await mount(); await populate(); await click(en.feedbackPreview);
  expect(host.textContent).toContain(" safe input "); expect(host.textContent).toContain("not_reproduced");
  const add = [...host.querySelectorAll("button")].find(button => button.textContent === en.feedbackAdd)!;
  expect(add.disabled).toBe(true); expect(calls.add).not.toHaveBeenCalled();
  await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click()); await click(en.feedbackAdd);
  expect(calls.add).toHaveBeenCalledWith({ inputId: uid(2), expected: "answer", feedback: { feedbackId: uid(3), previewDigest: "a".repeat(64), reviewed: true } });
  expect(calls.post).toHaveBeenCalledTimes(1); expect(calls.post.mock.calls[0]![0]).toMatch(/feedback-preview$/); expect(host.querySelector("pre")).toBeNull();
});
it("editing expected output invalidates previous confirmation; scope remount clears reviewed evidence", async () => {
  await mount(); await populate(); await click(en.feedbackPreview);
  await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
  await fill(2, "different"); expect(host.querySelector("pre")).toBeNull(); expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  await click(en.feedbackPreview); await mount(false, "other-company"); expect(host.querySelector("pre")).toBeNull(); expect((host.querySelector("input") as HTMLInputElement).value).toBe("");
});
it("disables local sessions and pending fields, discards late preview after scope change, and surfaces errors", async () => {
  await mount(true); expect((host.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true); expect(calls.post).not.toHaveBeenCalled();
  await mount(false); await populate(); let resolve!: (value: typeof preview) => void;
  calls.post.mockImplementation(() => new Promise(done => { resolve = done; })); await click(en.feedbackPreview);
  expect((host.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  await mount(false, "new-scope"); await act(async () => resolve(preview)); expect(host.querySelector("pre")).toBeNull();
  calls.post.mockRejectedValue(new Error("409")); await populate(); await click(en.feedbackPreview); expect(host.querySelector('[role="alert"]')?.textContent).toBe(en.feedbackError);
});
it("shows translated trust and review boundaries in four languages", async () => {
  await mount();
  for (const [locale, text] of Object.entries({ en, "zh-CN": zh, es, ja })) {
    await act(async () => { await i18n.changeLanguage(locale); }); expect(host.textContent).toContain(text.feedbackBoundary); expect(host.textContent).toContain(text.feedbackPreview);
  }
});
