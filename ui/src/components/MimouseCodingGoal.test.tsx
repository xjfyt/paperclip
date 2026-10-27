// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import en from "@/i18n/contributions/codingGoal/en.json";
import zh from "@/i18n/contributions/codingGoal/zh-CN.json";
import es from "@/i18n/contributions/codingGoal/es.json";
import ja from "@/i18n/contributions/codingGoal/ja.json";
import { ApiError } from "@/api/client";
import { MimouseCodingGoal } from "./MimouseCodingGoal";
const calls = vi.hoisted(() => ({ put: vi.fn(), read: vi.fn() }));
vi.mock("@/api/client", async original => ({ ...await original<typeof import("@/api/client")>(), api: { put: calls.put } }));
vi.mock("@/api/coding-read", () => ({ readCodingEvidence: calls.read }));
const props = { companyId: "company", issueId: "10000000-0000-4000-8000-000000000001", userId: "owner", sessionId: "session", authEpoch: 1 };
const goal = { schemaVersion: 1, problemValue: "Fix bug", acceptanceScenarios: ["test case"], allowedRepositories: [{ repoUrl: "https://git.example/repo.git", paths: ["src"] }], baseSha: "a".repeat(40), testCommands: ["pnpm test"], budget: { maxCostCents: 10 }, maxRepairRounds: 2, artifactRequirements: ["manifest"], humanReviewActions: ["publish"] };
const receipt = { issueId: props.issueId, goal, revisionId: "20000000-0000-4000-8000-000000000001", planningOnly: true };
let root: Root, host: HTMLDivElement;
const text = (key: string) => i18n.t(`codingGoal.${key}`);
const button = (key: string) => [...host.querySelectorAll("button")].find(value => value.textContent === text(key))!;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount(overrides: Partial<typeof props> = {}) { await act(async () => root.render(<MimouseCodingGoal {...props} {...overrides} />)); await flush(); }
async function click(target: HTMLElement) { await act(async () => target.click()); await flush(); }
async function edit(value: string) {
  const input = host.querySelector<HTMLTextAreaElement>(`[aria-label="${text("problemValue")}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const [locale, data] of Object.entries({ en, "zh-CN": zh, es, ja })) i18n.addResourceBundle(locale, "translation", { codingGoal: data }, true, true);
  await i18n.changeLanguage("en"); vi.clearAllMocks(); calls.read.mockResolvedValue(receipt); calls.put.mockResolvedValue({ ...receipt, revisionId: "20000000-0000-4000-8000-000000000002" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("does not read or write before opening and requires a task UUID", async () => {
  await mount({ issueId: "" }); expect(button("title").disabled).toBe(true); expect(calls.read).not.toHaveBeenCalled();
  await mount(); expect(calls.read).not.toHaveBeenCalled(); expect(calls.put).not.toHaveBeenCalled();
});
it("renders the nine fields and four localized planning boundaries", async () => {
  for (const data of [zh, es, ja]) expect(Object.keys(data).sort()).toEqual(Object.keys(en).sort());
  await mount(); await click(button("title")); expect(host.querySelectorAll("textarea")).toHaveLength(6);
  for (const locale of ["en", "zh-CN", "es", "ja"]) { await act(async () => { await i18n.changeLanguage(locale); }); expect(host.textContent).toContain(text("boundary")); }
});
it("saves literal commands with the exact read revision; double submit issues one write", async () => {
  let finish!: (value: unknown) => void; calls.put.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await click(button("title")); const save = button("save"); await act(async () => { save.click(); save.click(); });
  expect(calls.put).toHaveBeenCalledExactlyOnceWith(`/companies/company/coding/tasks/${props.issueId}/goal`, { goal, baseRevisionId: receipt.revisionId });
  expect(button("close").disabled).toBe(true); await act(async () => finish(receipt)); await flush(); expect(host.textContent).toContain(text("saved"));
});
it("unknown writes remain disabled until an explicit current-revision read, never auto-resubmit", async () => {
  calls.put.mockRejectedValue(Error("response lost")); await mount(); await click(button("title")); await click(button("save"));
  expect(host.textContent).toContain(text("unknown")); expect(button("save").disabled).toBe(true); expect(calls.read).toHaveBeenCalledTimes(1);
  await click(button("reload")); expect(calls.read).toHaveBeenCalledTimes(2); expect(calls.put).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain(receipt.revisionId); expect(host.textContent).not.toContain(text("saved"));
});
it("stale revisions and malformed receipts require a reread instead of retry", async () => {
  calls.put.mockRejectedValue(new ApiError("stale", 409, null)); await mount(); await click(button("title")); await click(button("save"));
  expect(button("save").disabled).toBe(true); await click(button("reload")); calls.put.mockResolvedValue({ ...receipt, issueId: "wrong-task" }); await click(button("save")); expect(host.textContent).toContain(text("unknown"));
});
it.each(["companyId", "issueId", "userId", "sessionId", "authEpoch"] as const)("drops draft and ignores old completion when %s changes", async dimension => {
  let finish!: (value: unknown) => void; calls.put.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await click(button("title")); await click(button("save"));
  await mount({ [dimension]: dimension === "authEpoch" ? 2 : "30000000-0000-4000-8000-000000000003" }); expect(host.querySelector("form")).toBeNull();
  await act(async () => finish(receipt)); await flush(); expect(host.textContent).not.toContain(text("saved"));
});
it("closing and reopening discards edits and rereads the document", async () => {
  await mount(); await click(button("title")); await edit("unsaved"); await click(button("close")); await click(button("title"));
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(goal.problemValue); expect(calls.read).toHaveBeenCalledTimes(2); expect(calls.put).not.toHaveBeenCalled();
});
it.each([401, 403, 404])("clears sensitive controls after HTTP %s", async status => {
  calls.put.mockRejectedValue(new ApiError("denied", status, null)); await mount(); await click(button("title")); await click(button("save"));
  expect(host.querySelector("form")).toBeNull(); expect(host.textContent).toContain(text("denied"));
});
it("invalid or cross-task read receipts never unlock the editor", async () => {
  calls.read.mockResolvedValue({ ...receipt, issueId: "wrong" }); await mount(); await click(button("title")); expect(button("save").disabled).toBe(true); expect(host.textContent).toContain(text("error"));
});
it.each(["companyId", "issueId", "userId", "sessionId", "authEpoch"] as const)("ignores a late private read after %s changes", async dimension => {
  let finish!: (value: unknown) => void; calls.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await click(button("title"));
  const signal = calls.read.mock.calls[0][1] as AbortSignal;
  await mount({ [dimension]: dimension === "authEpoch" ? 2 : "30000000-0000-4000-8000-000000000003" }); expect(signal.aborted).toBe(true);
  await act(async () => finish(receipt)); await flush(); expect(host.querySelector("form")).toBeNull(); expect(host.textContent).not.toContain(receipt.revisionId);
});
it("a successful response containing a different goal cannot claim a confirmed write", async () => {
  calls.put.mockResolvedValue({ ...receipt, goal: { ...goal, problemValue: "some other goal" } });
  await mount(); await click(button("title")); await click(button("save")); expect(host.textContent).toContain(text("unknown")); expect(button("save").disabled).toBe(true);
});
