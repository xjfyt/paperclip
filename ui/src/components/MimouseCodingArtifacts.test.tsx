// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { i18n } from "@/i18n";
import en from "@/i18n/contributions/codingArtifacts/en.json";
import zh from "@/i18n/contributions/codingArtifacts/zh-CN.json";
import es from "@/i18n/contributions/codingArtifacts/es.json";
import ja from "@/i18n/contributions/codingArtifacts/ja.json";
import { MimouseCodingArtifacts } from "./MimouseCodingArtifacts";
const calls = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/api/client", async original => ({ ...await original<typeof import("@/api/client")>(), api: calls }));
const base = { companyId: "company", userId: "owner", sessionId: "session", deliveryId: "delivery", projectId: 7, headSha: "a".repeat(40), onRefresh: vi.fn(async () => {}) };
const payload = { headSha: base.headSha, version: "1.2", artifacts: [{ path: "dist/app.zip", platform: "linux", arch: "x86_64", buildJob: "declared-job" }] };
const receipt = { schemaVersion: 1, project: "7", commitSha: base.headSha, version: "1.2", uploaded: false, productionReleased: false,
  artifacts: [{ ...payload.artifacts[0], sha256: "b".repeat(64), sizeBytes: 20, testStatus: "not_run", signatureStatus: "unknown" }] };
let host: HTMLDivElement, root: Root;
const text = (key: string, number = 1) => i18n.t(`codingArtifacts.${key}`, { number });
const button = (key: string, number = 1) => [...host.querySelectorAll("button")].find(value => value.textContent === text(key, number))!;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount(props: Partial<typeof base> = {}) { await act(async () => root.render(<MimouseCodingArtifacts {...base} {...props} />)); await flush(); }
async function click(value: HTMLElement) { await act(async () => value.click()); await flush(); }
async function fill(key: string, value: string, number = 1) {
  const input = host.querySelector<HTMLInputElement>(`[aria-label="${text(key, number)}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function edit() { await click(button("title")); await fill("version", payload.version); await fill("path", payload.artifacts[0].path); await fill("buildJob", "declared-job"); }
async function confirm() { await click(button("review")); await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!); }
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const [locale, data] of Object.entries({ en, "zh-CN": zh, es, ja })) i18n.addResourceBundle(locale, "translation", { codingArtifacts: data }, true, true);
  await i18n.changeLanguage("en"); vi.clearAllMocks(); sessionStorage.clear(); calls.post.mockResolvedValue(receipt); base.onRefresh.mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it("has matching four-language keys/placeholders and renders the actual safety copy", async () => {
  const placeholders = (value: string) => value.match(/{{[^}]+}}/g) ?? [];
  for (const data of [zh, es, ja]) {
    expect(Object.keys(data).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as Array<keyof typeof en>) expect(placeholders(data[key])).toEqual(placeholders(en[key]));
  }
  await mount(); await click(button("title"));
  for (const locale of ["en", "zh-CN", "es", "ja"]) {
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(host.textContent).toContain(text("boundary")); expect(host.textContent).toContain(text("effects"));
  }
  expect(calls.post).not.toHaveBeenCalled();
});
it("sends only the actual API contract after explicit fixed-SHA confirmation", async () => {
  await mount(); await edit(); expect(calls.post).not.toHaveBeenCalled(); await click(button("review"));
  expect(button("save").disabled).toBe(true); expect(host.querySelector("fieldset")!.disabled).toBe(true);
  expect(host.textContent).toContain(base.headSha); await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!); await click(button("save"));
  expect(calls.post).toHaveBeenCalledExactlyOnceWith("/companies/company/coding/delivery/artifacts", payload);
  expect(base.onRefresh).toHaveBeenCalledOnce(); expect(host.textContent).toContain(text("saved")); expect(button("review").disabled).toBe(true);
  expect(sessionStorage.length).toBe(0);
});
it.each(["/etc/passwd", "C:\\outside.zip", "\\\\host\\share", "../escape", "dir/../escape", "./dist/app.zip", ""])("requires a plain relative file path: %s", async path => {
  await mount(); await edit(); await fill("path", path); expect(button("review").disabled).toBe(true); expect(calls.post).not.toHaveBeenCalled();
});
it("bounds file count and keeps explicit OS/architecture declarations", async () => {
  await mount(); await edit(); expect(button("remove").disabled).toBe(true);
  for (let index = 1; index < 30; index++) await click(button("add"));
  expect(button("add").disabled).toBe(true); expect(host.querySelectorAll("select")).toHaveLength(60);
  await click(button("remove", 30)); expect(button("add").disabled).toBe(false);
  expect(calls.post).not.toHaveBeenCalled();
});
it("cancel/reopen discards consent without writing or clearing a server review", async () => {
  await mount(); await edit(); await confirm(); await click([...host.querySelectorAll("button")].find(value => value.textContent === i18n.t("common.cancel"))!);
  await click(button("title")); await click(button("review")); expect(button("save").disabled).toBe(true); expect(calls.post).not.toHaveBeenCalled();
});
it("double-clicks issue one request and disable dismissal while the outcome is pending", async () => {
  let finish!: (value: unknown) => void; calls.post.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await edit(); await confirm(); const save = button("save");
  await act(async () => { save.click(); save.click(); });
  expect(calls.post).toHaveBeenCalledOnce(); expect(button("title").disabled).toBe(true); expect(host.textContent).toContain(text("pending"));
  await act(async () => finish(receipt)); await flush(); expect(host.textContent).toContain(text("saved"));
});
it.each(["companyId", "userId", "sessionId", "deliveryId", "headSha"] as const)("clears draft/consent and ignores late completion after %s changes", async dimension => {
  let finish!: (value: unknown) => void; calls.post.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await edit(); await confirm(); await click(button("save"));
  await mount({ [dimension]: dimension === "headSha" ? "c".repeat(40) : "other" }); await click(button("title"));
  expect(host.querySelector<HTMLInputElement>(`[aria-label="${text("version")}"]`)!.value).toBe("");
  expect(host.querySelector('input[type="checkbox"]')).toBeNull(); await act(async () => finish(receipt)); await flush();
  expect(host.textContent).not.toContain(text("saved")); expect(base.onRefresh).not.toHaveBeenCalled();
});
it("unknown POST survives remount and read-only refresh never retries or asserts success", async () => {
  calls.post.mockRejectedValue(Error("lost response")); await mount(); await edit(); await confirm(); await click(button("save"));
  expect(host.textContent).toContain(text("unknown")); expect(sessionStorage.length).toBe(1);
  expect(JSON.stringify(sessionStorage)).not.toContain("dist/app.zip");
  await act(async () => root.render(null)); await mount(); await click(button("title"));
  expect(host.textContent).toContain(text("unknown")); expect(button("newOperation").disabled).toBe(true);
  await click(button("refresh")); expect(calls.post).toHaveBeenCalledOnce(); expect(host.textContent).not.toContain(text("saved"));
  await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!); await click(button("newOperation"));
  expect(button("review").disabled).toBe(true); expect(sessionStorage.length).toBe(0); expect(calls.post).toHaveBeenCalledOnce();
});
it("failed reconciliation read keeps the unknown operation locked", async () => {
  calls.post.mockRejectedValue(Error("lost")); base.onRefresh.mockRejectedValue(Error("offline"));
  await mount(); await edit(); await confirm(); await click(button("save")); await click(button("refresh"));
  expect(host.textContent).toContain(text("refreshFailed")); expect(button("newOperation").disabled).toBe(true); expect(calls.post).toHaveBeenCalledOnce();
});
it.each([500, 502])( "HTTP %s remains unknown without a retry", async status => {
  calls.post.mockRejectedValue(new ApiError("server error", status, null)); await mount(); await edit(); await confirm(); await click(button("save"));
  expect(host.textContent).toContain(text("unknown")); expect(calls.post).toHaveBeenCalledOnce();
});
it.each([null, { ...receipt, commitSha: "c".repeat(40) }, { ...receipt, uploaded: true }])("invalid receipts cannot claim success", async value => {
  calls.post.mockResolvedValue(value); await mount(); await edit(); await confirm(); await click(button("save"));
  expect(host.textContent).toContain(text("unknown")); expect(base.onRefresh).not.toHaveBeenCalled();
});
it("known rejection requires correction and fresh confirmation, not automatic retry", async () => {
  calls.post.mockRejectedValue(new ApiError("invalid path", 422, null)); await mount(); await edit(); await confirm(); await click(button("save"));
  expect(host.textContent).toContain(text("rejected")); expect(sessionStorage.length).toBe(0); expect(calls.post).toHaveBeenCalledOnce();
  await click(button("review")); expect(button("save").disabled).toBe(true);
});
it.each([401, 403, 404])("HTTP %s removes sensitive draft and write controls", async status => {
  calls.post.mockRejectedValue(new ApiError("denied", status, null)); await mount(); await edit(); await confirm(); await click(button("save"));
  expect(host.querySelector("fieldset")).toBeNull(); expect(host.textContent).toContain(text("denied")); expect(calls.post).toHaveBeenCalledOnce();
});
it("storage failure prevents any new POST", async () => {
  await mount(); await edit(); await confirm(); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("disabled storage"); });
  await click(button("save")); expect(calls.post).not.toHaveBeenCalled(); expect(host.textContent).toContain(text("storage"));
});
it("a failed refresh after a confirmed write is not mislabeled as a failed POST", async () => {
  base.onRefresh.mockRejectedValue(Error("refresh lost")); await mount(); await edit(); await confirm(); await click(button("save"));
  expect(host.textContent).toContain(text("saved")); expect(host.textContent).toContain(text("refreshFailed")); expect(sessionStorage.length).toBe(0); expect(calls.post).toHaveBeenCalledOnce();
});

it.each(["success", "rejected"])("late operation A %s cannot clear replacement B's uncertainty token", async outcome => {
  const pending: Array<{ resolve: (value: unknown) => void; reject: (error: unknown) => void }> = [];
  calls.post.mockImplementation(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  await mount(); await edit(); await confirm(); await click(button("save"));
  const key = sessionStorage.key(0)!, first = sessionStorage.getItem(key);
  expect(first).toMatch(/^[a-f0-9-]{36}$/);
  await act(async () => root.render(null)); await mount(); await click(button("title"));
  await click(button("refresh")); await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!); await click(button("newOperation"));
  await fill("version", payload.version); await fill("path", payload.artifacts[0].path); await fill("buildJob", "declared-job");
  await confirm(); await click(button("save")); const second = sessionStorage.getItem(key);
  expect(second).not.toBe(first); expect(pending).toHaveLength(2);
  await act(async () => { if (outcome === "success") pending[0].resolve(receipt); else pending[0].reject(new ApiError("late rejected", 422, null)); });
  expect(sessionStorage.getItem(key)).toBe(second);
  await act(async () => root.render(null)); await mount(); await click(button("title"));
  expect(host.textContent).toContain(text("unknown")); expect(calls.post).toHaveBeenCalledTimes(2);
  await act(async () => pending[1].reject(Error("lost B"))); expect(sessionStorage.getItem(key)).toBe(second);
});

it("manual reconciliation cannot clear a token replaced after its read", async () => {
  calls.post.mockRejectedValue(Error("lost")); await mount(); await edit(); await confirm(); await click(button("save"));
  await click(button("refresh")); await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
  const key = sessionStorage.key(0)!, replacement = crypto.randomUUID(); sessionStorage.setItem(key, replacement);
  await click(button("newOperation")); expect(sessionStorage.getItem(key)).toBe(replacement);
  expect(host.textContent).toContain(text("unknown")); expect(button("newOperation").disabled).toBe(true); expect(calls.post).toHaveBeenCalledOnce();
});
