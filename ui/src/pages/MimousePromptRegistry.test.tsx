// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { i18n } from "@/i18n";
import en from "@/i18n/contributions/promptRegistryUi/en.json";
import zh from "@/i18n/contributions/promptRegistryUi/zh-CN.json";
import es from "@/i18n/contributions/promptRegistryUi/es.json";
import ja from "@/i18n/contributions/promptRegistryUi/ja.json";
import { MimousePromptRegistry } from "./MimousePromptRegistry";
const calls = vi.hoisted(() => ({ list: vi.fn(), revisions: vi.fn(), receipts: vi.fn(), content: vi.fn(), create: vi.fn(), select: vi.fn() }));
vi.mock("@/api/prompt-registry", () => ({ promptRegistryApi: () => calls }));
const head = { id: "prompt", promptKey: "reviewer", companyId: "company", selectedRevisionId: "selected", headReceiptId: "head", runtimeApplied: false };
const revision = { id: "candidate", promptId: "prompt", contentHash: "hash", companyId: "company" };
const receipt = { id: "head", action: "promote", beforeRevisionId: "before", selectedRevisionId: "selected", previousReceiptId: "older" };
let host: HTMLDivElement, root: Root;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount(companyId = "company", userId = "user", sessionId = "session") { await act(async () => root.render(<MimousePromptRegistry {...{ companyId, userId, sessionId }} />)); await flush(); }
const text = (key: string) => i18n.t(`promptRegistryUi.${key}`);
const button = (key: string) => [...host.querySelectorAll("button")].find(value => value.textContent === text(key))!;
async function click(value: HTMLElement) { await act(async () => value.click()); await flush(); }
async function fill(key: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${text(key)}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function inspect() { await click([...host.querySelectorAll("button")].find(value => value.textContent === "reviewer")!); }
async function detail() { await inspect(); await click([...host.querySelectorAll("button")].find(value => value.textContent === "candidate")!); }
beforeEach(async () => {
  for (const [locale, data] of Object.entries({ en, "zh-CN": zh, es, ja })) i18n.addResourceBundle(locale, "translation", { promptRegistryUi: data }, true, true);
  await i18n.changeLanguage("en"); for (const call of Object.values(calls)) call.mockReset();
  calls.list.mockResolvedValue({ items: [head], nextBeforeId: null }); calls.revisions.mockResolvedValue({ head, items: [revision], nextBeforeId: null });
  calls.receipts.mockResolvedValue({ head, items: [receipt], nextBeforeId: null }); calls.content.mockResolvedValue({ ...revision, content: '<script>window.bad=true</script>\n  exact ', contentDisposition: "untrusted_inert_text" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("renders four languages and inert exact content; confirmation sends authoritative head CAS", async () => {
  await mount(); await detail(); expect(host.querySelector("script")).toBeNull(); expect(host.querySelector("pre")!.textContent).toBe('<script>window.bad=true</script>\n  exact ');
  expect(button("select").disabled).toBe(true); expect(calls.select).not.toHaveBeenCalled();
  for (const locale of ["en", "zh-CN", "es", "ja"]) { await act(async () => { await i18n.changeLanguage(locale); }); expect(host.textContent).toContain(text("boundary")); }
  calls.select.mockResolvedValue({ item: { id: "saved" }, duplicate: false });
  await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!); await click(button("select"));
  expect(calls.select).toHaveBeenCalledWith("prompt", expect.objectContaining({ action: "promote", revisionId: "candidate", expectedHeadReceiptId: "head", confirmRegistryOnly: true }));
});
it("rollback references the actual head receipt, never first UUID row", async () => {
  calls.receipts.mockResolvedValue({ head, items: [{ ...receipt, id: "not-head", beforeRevisionId: "wrong" }, receipt], nextBeforeId: null });
  await mount(); await inspect(); const select = host.querySelector("select")!;
  await act(async () => { select.value = "rollback"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.textContent).toContain(`${text("target")}: before`); calls.select.mockResolvedValue({ item: { id: "rolled" } });
  await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!); await click(button("select"));
  expect(calls.select).toHaveBeenCalledWith("prompt", expect.objectContaining({ action: "rollback", rollbackOfReceiptId: "head", expectedHeadReceiptId: "head" }));
});
it.each(["company", "user", "session"])("clears drafts, confirmation and ignores a late write after %s changes", async dimension => {
  let finish!: (value: unknown) => void; calls.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await fill("key", "reviewer"); await fill("content", "old private draft"); await click(button("create"));
  await mount(dimension === "company" ? "other" : "company", dimension === "user" ? "other" : "user", dimension === "session" ? "other" : "session");
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(""); expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')).toBeNull();
  await act(async () => finish({ item: { id: "late-old-result" } })); await flush(); expect(host.textContent).not.toContain("late-old-result");
});
it("retains exact request on unknown write and only creates a new ID for new intent", async () => {
  calls.create.mockRejectedValueOnce(Error("network response lost")).mockResolvedValue({ item: { id: "recovered" }, duplicate: true });
  await mount(); await fill("key", "reviewer"); await fill("content", "same exact content"); await click(button("create"));
  const original = calls.create.mock.calls[0]![0]; expect(host.querySelector("fieldset")!.disabled).toBe(true);
  await click(button("recover")); expect(calls.create.mock.calls[1]![0]).toEqual(original);
  await fill("content", "same exact content"); await click(button("create")); expect(calls.create.mock.calls[2]![0].requestId).not.toBe(original.requestId);
});
it("403 revocation hides private data and clears draft; read recovery never restores it", async () => {
  await mount(); await fill("content", "private"); await detail(); calls.list.mockRejectedValueOnce(new ApiError("forbidden", 403, null));
  await click(button("refresh")); expect(host.querySelector("pre")).toBeNull(); expect(host.querySelector("textarea")).toBeNull(); expect(host.querySelector("fieldset")).toBeNull();
  await click(button("refresh")); expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(""); expect(calls.select).not.toHaveBeenCalled();
});
it("CAS conflict requires a fresh inspection and confirmation, never an automatic overwrite", async () => {
  calls.select.mockRejectedValue(new ApiError("changed", 409, null)); await mount(); await detail();
  await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!); await click(button("select"));
  expect(calls.select).toHaveBeenCalledTimes(1); expect(host.textContent).toContain(text("conflict")); expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  await detail(); expect(button("select").disabled).toBe(true);
});
it("late sensitive content from old session cannot appear in replacement session", async () => {
  let finish!: (value: unknown) => void; calls.content.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await inspect(); await click([...host.querySelectorAll("button")].find(value => value.textContent === "candidate")!);
  await mount("company", "user", "new-session");
  await act(async () => finish({ ...revision, content: "old-session-private-content" })); await flush();
  expect(host.querySelector("pre")).toBeNull(); expect(host.textContent).not.toContain("old-session-private-content");
});
it("confirmation is discarded on session change even without an outstanding write", async () => {
  await mount(); await detail(); await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  expect(button("select").disabled).toBe(false); await mount("company", "user", "replacement"); await detail();
  expect(button("select").disabled).toBe(true); expect(calls.select).not.toHaveBeenCalled();
});
it("missing current head receipt needs explicit pagination before rollback confirmation", async () => {
  calls.receipts.mockResolvedValueOnce({ head, items: [{ ...receipt, id: "other" }], nextBeforeId: "cursor" }).mockResolvedValue({ head, items: [receipt], nextBeforeId: null });
  await mount(); await inspect(); const select = host.querySelector("select")!;
  await act(async () => { select.value = "rollback"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
  await click(button("moreReceipts")); expect(calls.receipts).toHaveBeenLastCalledWith("prompt", "cursor");
  expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(false); expect(button("select").disabled).toBe(true);
});
it("unknown selection response recovers exact CAS/request identity instead of minting a replacement", async () => {
  calls.select.mockRejectedValueOnce(Error("response lost")).mockResolvedValue({ item: { id: "durable-receipt" }, duplicate: true });
  await mount(); await detail(); await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!); await click(button("select"));
  const original = calls.select.mock.calls[0]![1]; await click(button("recover"));
  expect(calls.select.mock.calls[1]![1]).toEqual(original); expect(host.textContent).toContain("durable-receipt"); expect(host.querySelector('input[type="checkbox"]')).toBeNull();
});
it("a non-permission read error also hides all prior content and mutation controls", async () => {
  await mount(); await detail(); calls.list.mockRejectedValueOnce(Error("offline")); await click(button("refresh"));
  expect(host.querySelector("pre")).toBeNull(); expect(host.querySelector("fieldset")).toBeNull(); expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
