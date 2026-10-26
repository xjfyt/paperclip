// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import en from "@/i18n/contributions/langfuseUi/en.json";
import zh from "@/i18n/contributions/langfuseUi/zh-CN.json";
import es from "@/i18n/contributions/langfuseUi/es.json";
import ja from "@/i18n/contributions/langfuseUi/ja.json";
import { MimouseLangfusePanel } from "./MimouseLangfusePanel";
const calls = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/api/client", () => ({ api: calls }));
const job = { id: "pull-a", projectId: "project-a", product: "Product", from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z", pages: 0, imported: 0, completed: false };
let host: HTMLDivElement, root: Root;
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
async function mount(company = "a") { await act(async () => root.render(<MimouseLangfusePanel companyId={company} />)); await flush(); }
const button = (key: string) => [...host.querySelectorAll("button")].find(node => node.textContent === i18n.t(`langfuseUi.${key}`))!;
async function click(key: string) { await act(async () => button(key).click()); await flush(); }
beforeEach(async () => {
  for (const [lang, value] of Object.entries({ en, "zh-CN": zh, es, ja })) i18n.addResourceBundle(lang, "translation", { langfuseUi: value }, true, true);
  await i18n.changeLanguage("en"); calls.get.mockReset(); calls.post.mockReset();
  calls.get.mockResolvedValue([job]); calls.post.mockResolvedValue(job);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); await i18n.changeLanguage("en"); });
it("reads nothing automatically and requires explicit page/replay actions", async () => {
  await mount(); expect(calls.post).not.toHaveBeenCalled(); await click("pull");
  expect(calls.post).toHaveBeenCalledWith("/companies/a/feedback-langfuse/pulls/pull-a/pull", {}, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  calls.post.mockClear(); await click("restart"); expect(calls.post).not.toHaveBeenCalled();
  await click("confirm"); expect(calls.post).toHaveBeenCalledWith("/companies/a/feedback-langfuse/pulls/pull-a/restart", { confirm: true }, expect.anything());
});
it("disables repeated clicks, cancels and ignores stale completion", async () => {
  let resolve!: (value: unknown) => void;
  calls.post.mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount(); await click("pull"); expect(button("pull").disabled).toBe(true);
  await click("pull"); expect(calls.post).toHaveBeenCalledTimes(1);
  const signal = calls.post.mock.calls[0][2].signal as AbortSignal;
  await click("cancel"); expect(signal.aborted).toBe(true);
  await act(async () => resolve(job)); await flush();
  expect(host.textContent).toContain(en.cancelled); expect(host.textContent).not.toContain(en.updated);
});
it("aborts on company switch without showing old-company rows", async () => {
  let resolve!: (value: unknown) => void;
  calls.post.mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount(); await click("pull"); const signal = calls.post.mock.calls[0][2].signal as AbortSignal;
  calls.get.mockResolvedValue([]); await mount("b"); expect(signal.aborted).toBe(true);
  await act(async () => resolve(job)); await flush(); expect(host.textContent).not.toContain("project-a");
  expect(calls.get).toHaveBeenCalledWith("/companies/b/feedback-langfuse/pulls", expect.anything());
});
it("shows unsupported capability without a retry loop", async () => {
  calls.post.mockRejectedValue({ body: { code: "unsupported" } }); await mount(); await click("pull");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(en.unsupported); expect(calls.post).toHaveBeenCalledTimes(1);
});
it.each(["en", "zh-CN", "es", "ja"] as const)("renders complete %s controls", async lang => {
  await i18n.changeLanguage(lang); await mount();
  expect(host.textContent).toContain(i18n.t("langfuseUi.boundary")); expect(host.textContent).not.toContain("langfuseUi.");
  expect(Object.keys({ en, "zh-CN": zh, es, ja }[lang])).toEqual(Object.keys(en));
});
