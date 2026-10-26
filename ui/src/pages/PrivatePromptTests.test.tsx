// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { i18n } from "@/i18n";
import en from "@/i18n/contributions/privatePromptTestsUi/en.json";
import zh from "@/i18n/contributions/privatePromptTestsUi/zh-CN.json";
import es from "@/i18n/contributions/privatePromptTestsUi/es.json";
import ja from "@/i18n/contributions/privatePromptTestsUi/ja.json";
import { PrivatePromptTests } from "./PrivatePromptTests";
import { MimousePromptRegistry } from "./MimousePromptRegistry";
import registryEn from "@/i18n/contributions/promptRegistryUi/en.json";
const calls = vi.hoisted(() => ({ capabilities: vi.fn(), list: vi.fn(), detail: vi.fn(), create: vi.fn() }));
vi.mock("@/api/private-prompt-tests", () => ({ privatePromptTestsApi: () => calls }));
const registry = vi.hoisted(() => ({ list: vi.fn(), revisions: vi.fn(), receipts: vi.fn(), content: vi.fn(), create: vi.fn(), select: vi.fn() }));
vi.mock("@/api/prompt-registry", () => ({ promptRegistryApi: () => registry }));
const id = "22222222-2222-4222-8222-222222222222";
const item = { id: "test", promptId: "prompt", revisionId: id, status: "completed", prepared: { promptHash: "hash", runtimeConfigHash: "derived-hash" }, spawnedAt: "2026-10-26", errorCode: null };
let host: HTMLDivElement, root: Root;
const pending = vi.fn(), denied = vi.fn();
const text = (key: string) => i18n.t(`privatePromptTestsUi.${key}`);
const button = (key: string) => [...host.querySelectorAll("button")].find(element => element.textContent === text(key))!;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount(patch: Record<string, unknown> = {}) { await act(async () => root.render(<PrivatePromptTests companyId="company" userId="user" sessionId="session" promptId="prompt" revisionId={id} headReceiptId={null} onPendingChange={pending} onAccessLost={denied} {...patch} />)); await flush(); }
async function click(element: HTMLElement) { await act(async () => element.click()); await flush(); }
async function fill(field: string, value = id) { const input = host.querySelector<HTMLInputElement>(`[aria-label="${text(field)}"]`)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function approve() { for (const key of ["agentId", "datasetId", "caseId", "skillVersionId"]) await fill(key); for (const input of host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) await click(input); }
beforeEach(async () => {
  for (const [locale, data] of Object.entries({ en, "zh-CN": zh, es, ja })) i18n.addResourceBundle(locale, "translation", { privatePromptTestsUi: data }, true, true);
  i18n.addResourceBundle("en", "translation", { promptRegistryUi: registryEn }, true, true);
  await i18n.changeLanguage("en"); Object.values(calls).forEach(call => call.mockReset()); pending.mockClear(); denied.mockClear();
  calls.capabilities.mockResolvedValue({ enabled: true, profile: "claude_cli_bare_api_key_v1", toolsEnabled: false, privateResults: true, completeContextCaptured: false });
  calls.list.mockResolvedValue({ items: [item], nextBeforeId: null }); calls.detail.mockResolvedValue({ item, privateResult: { summary: "<script>not executed</script>", resultJson: { result: "exact" } }, contentDisposition: "untrusted_inert_text" });
  calls.create.mockResolvedValue({ item, duplicate: false }); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("requires all three confirmations and fixed UUID references; never starts automatically", async () => {
  await mount(); expect(calls.create).not.toHaveBeenCalled(); expect(button("execute").disabled).toBe(true);
  await approve(); expect(button("execute").disabled).toBe(false); await click(button("execute"));
  expect(calls.create).toHaveBeenCalledExactlyOnceWith("prompt", expect.objectContaining({ revisionId: id, expectedHeadReceiptId: null, executionProfile: "claude_cli_bare_api_key_v1", confirmRestrictedProfile: true, confirmExecution: true, confirmPossibleCharges: true }));
  expect(pending).toHaveBeenCalledWith(true); expect(pending).toHaveBeenLastCalledWith(false);
  expect(host.textContent).toContain(text("completedBoundary")); expect(host.textContent).toContain(`${text("runtimeHash")}: derived-hash`); expect(host.querySelector("script")).toBeNull();
  expect(host.querySelector("pre")?.textContent).toContain("<script>not executed</script>");
});
it("shows all four languages with the same warning and status keys", async () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort()); expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort()); expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort());
  await mount(); for (const locale of ["en", "zh-CN", "es", "ja"]) { await act(async () => { await i18n.changeLanguage(locale); }); expect(host.textContent).toContain(text("boundary")); expect(host.textContent).toContain(text("profile")); }
});
it("disables execution when the server gate is closed without hiding historical results", async () => {
  calls.capabilities.mockResolvedValue({ enabled: false, profile: "claude_cli_bare_api_key_v1", toolsEnabled: false, completeContextCaptured: false });
  await mount(); expect(host.querySelector("fieldset")!.disabled).toBe(true); expect(host.textContent).toContain(text("disabled"));
  await click([...host.querySelectorAll("button")].find(element => element.textContent === "test")!); expect(host.querySelector("pre")).not.toBeNull(); expect(calls.create).not.toHaveBeenCalled();
});
it("freezes an uncertain POST and recovers the same exact request once", async () => {
  calls.create.mockRejectedValueOnce(Error("response lost")); await mount(); await approve(); await click(button("execute"));
  const original = calls.create.mock.calls[0]![1]; expect(host.querySelector("fieldset")!.disabled).toBe(true); expect(button("refresh").disabled).toBe(true); expect(pending).toHaveBeenLastCalledWith(true);
  await click(button("recover")); expect(calls.create.mock.calls[1]![1]).toEqual(original); expect(pending).toHaveBeenLastCalledWith(false);
});
it.each(["companyId", "userId", "sessionId", "revisionId"])("drops late private reads and drafts when %s changes", async dimension => {
  let finish!: (value: unknown) => void; calls.detail.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await fill("agentId"); await click([...host.querySelectorAll("button")].find(element => element.textContent === "test")!);
  await mount({ [dimension]: dimension === "revisionId" ? "33333333-3333-4333-8333-333333333333" : "new" });
  await act(async () => finish({ item, privateResult: { summary: "old secret" }, contentDisposition: "untrusted_inert_text" })); await flush();
  expect(host.textContent).not.toContain("old secret"); expect(host.querySelector<HTMLInputElement>(`[aria-label="${text("agentId")}"]`)!.value).toBe("");
});
it("revocation clears private result and drafts and informs the registry", async () => {
  await mount(); await click([...host.querySelectorAll("button")].find(element => element.textContent === "test")!); calls.capabilities.mockRejectedValueOnce(new ApiError("forbidden", 403, null));
  await click(button("refresh")); expect(host.querySelector("pre")).toBeNull(); expect(host.querySelector("fieldset")).toBeNull(); expect(denied).toHaveBeenCalledOnce();
  await click(button("refresh")); expect(host.querySelector<HTMLInputElement>(`[aria-label="${text("agentId")}"]`)!.value).toBe("");
});
it("409 clears confirmation and never automatically issues a new intent", async () => {
  calls.create.mockRejectedValueOnce(new ApiError("conflict", 409, null)); await mount(); await approve(); await click(button("execute"));
  expect(calls.create).toHaveBeenCalledTimes(1); expect(button("execute").disabled).toBe(true); expect(host.textContent).toContain(text("conflict")); expect(pending).toHaveBeenLastCalledWith(false);
});
it("an offline read hides the previous result and all mutation controls", async () => {
  await mount(); await click([...host.querySelectorAll("button")].find(element => element.textContent === "test")!); calls.list.mockRejectedValueOnce(Error("offline")); await click(button("refresh"));
  expect(host.querySelector("pre")).toBeNull(); expect(host.querySelector("fieldset")).toBeNull(); expect(denied).not.toHaveBeenCalled();
});

it("drops a late successful POST after replacement session and does not read its private result", async () => {
  let finish!: (value: unknown) => void; calls.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await approve(); await click(button("execute")); await mount({ sessionId: "replacement" });
  await act(async () => finish({ item: { ...item, id: "old-test" } })); await flush();
  expect(calls.detail).not.toHaveBeenCalled(); expect(host.textContent).not.toContain("old-test"); expect(button("execute").disabled).toBe(true);
});
it("freezes the containing registry during unknown execution and releases it only after recovery", async () => {
  const head = { id: "prompt", promptKey: "reviewer", selectedRevisionId: id, headReceiptId: null };
  registry.list.mockResolvedValue({ items: [head], nextBeforeId: null }); registry.revisions.mockResolvedValue({ head, items: [{ id, contentHash: "hash" }], nextBeforeId: null });
  registry.receipts.mockResolvedValue({ head, items: [], nextBeforeId: null }); registry.content.mockResolvedValue({ id, content: "private revision", contentHash: "hash" });
  calls.create.mockRejectedValueOnce(Error("lost"));
  await act(async () => root.render(<MimousePromptRegistry companyId="company" userId="user" sessionId="session" />)); await flush();
  await click([...host.querySelectorAll("button")].find(element => element.textContent === "reviewer")!);
  await click([...host.querySelectorAll("button")].find(element => element.textContent === id)!);
  await approve(); await click(button("execute"));
  expect(host.querySelector("fieldset")!.disabled).toBe(true);
  const refreshRegistry = [...host.querySelectorAll("button")].find(element => element.textContent === i18n.t("promptRegistryUi.refresh"))!;
  expect(refreshRegistry.disabled).toBe(true); expect(registry.select).not.toHaveBeenCalled();
  await click(button("recover")); expect(host.querySelector("fieldset")!.disabled).toBe(false); expect(refreshRegistry.disabled).toBe(false);
});

it("keeps the exact request after a generic 422 because it may follow a committed intent", async () => {
  calls.create.mockRejectedValueOnce(new ApiError("private_operation_failed", 422, null));
  await mount(); await approve(); await click(button("execute"));
  const original = calls.create.mock.calls[0]![1]; expect(pending).toHaveBeenLastCalledWith(true);
  expect(host.querySelector("fieldset")!.disabled).toBe(true);
  await click(button("recover")); expect(calls.create.mock.calls[1]![1]).toEqual(original);
});
