// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { EvaluationComparisonRecord } from "@paperclipai/shared/mimouse-evaluation";
import { i18n } from "@/i18n";
import en from "@/i18n/contributions/evaluationRestoreUi/en.json";
import zh from "@/i18n/contributions/evaluationRestoreUi/zh-CN.json";
import es from "@/i18n/contributions/evaluationRestoreUi/es.json";
import ja from "@/i18n/contributions/evaluationRestoreUi/ja.json";
import { MimouseEvaluationRestore } from "./MimouseEvaluationRestore";
const calls = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/api/client", () => ({ api: calls }));
const comparison = { id: "report", companyId: "company", report: { baseline: { versionId: "base" }, candidate: { versionId: "next" }, reportHash: "a".repeat(64) } } as EvaluationComparisonRecord;
const readiness = { blockers: [], currentVersionId: "base", pendingOperationId: null, lastRestoreId: null, sourceType: "local_path", sourceKind: "managed_local" };
let host: HTMLDivElement, root: Root, client: QueryClient;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function mount() { await act(async () => root.render(<QueryClientProvider client={client}><MimouseEvaluationRestore companyId="company" userId="owner" comparison={comparison} /></QueryClientProvider>)); await flush(); }
const button = (key: string) => [...host.querySelectorAll("button")].find(value => value.textContent === i18n.t(`evaluationRestoreUi.${key}`))!;
beforeEach(async () => {
  for (const [locale, value] of Object.entries({ en, "zh-CN": zh, es, ja })) i18n.addResourceBundle(locale, "translation", { evaluationRestoreUi: value }, true, true);
  await i18n.changeLanguage("en"); calls.get.mockReset(); calls.post.mockReset();
  calls.get.mockImplementation(async (url: string) => url.includes("readiness") ? readiness : []);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
it("requires explicit confirmation and sends fixed version/report identity, never executes automatically", async () => {
  await mount(); expect(button("activate").disabled).toBe(true); expect(calls.post).not.toHaveBeenCalled();
  for (const locale of ["en", "zh-CN", "es", "ja"]) { await act(async () => { await i18n.changeLanguage(locale); }); expect(host.textContent).toContain(i18n.t("evaluationRestoreUi.boundary")); }
  calls.post.mockResolvedValue({ item: { companyId: "company", reportId: "report", id: "receipt", status: "prepared" } });
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await act(async () => button("activate").click()); await flush();
  expect(calls.post).toHaveBeenCalledWith("/companies/company/skill-evaluations/restores", expect.objectContaining({ reportId: "report", expectedReportHash: comparison.report.reportHash, expectedCurrentVersionId: "base", action: "activate", confirm: true }));
  expect(host.querySelector('[role="status"]')?.textContent).toBe(i18n.t("evaluationRestoreUi.prepared"));
});
it("hides write controls if administrator readiness is forbidden", async () => {
  calls.get.mockRejectedValue(Error("403")); await mount(); await flush(); expect(host.querySelector('input[type="checkbox"]')).toBeNull(); expect(host.textContent).toContain(i18n.t("evaluationRestoreUi.sessionRequired")); expect(calls.post).not.toHaveBeenCalled();
});
it("pending compensation cannot switch back to apply and requires separate recovery confirmation", async () => {
  const receipt = { id: "pending", companyId: "company", reportId: "report", status: "prepared", action: "activate", resolution: "compensate", operationHash: "b".repeat(64), beforeHash: "c".repeat(64), targetHash: "d".repeat(64) };
  calls.get.mockImplementation(async (url: string) => url.includes("readiness") ? { ...readiness, blockers: ["restore_pending_recovery"], pendingOperationId: receipt.id } : url.endsWith(receipt.id) ? receipt : [receipt]);
  calls.post.mockResolvedValue({ ...receipt, status: "compensated" }); await mount(); await flush();
  expect(button("finish").disabled).toBe(true); expect(button("compensate").disabled).toBe(true);
  await act(async () => [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].at(-1)!.click());
  expect(button("finish").disabled).toBe(true); await act(async () => button("compensate").click()); await flush();
  expect(calls.post).toHaveBeenCalledWith("/companies/company/skill-evaluations/restores/pending/recover", { expectedOperationHash: receipt.operationHash, resolution: "compensate", confirm: true });
});
