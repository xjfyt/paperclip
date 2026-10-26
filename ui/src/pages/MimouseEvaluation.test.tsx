// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import en from "@/i18n/contributions/evaluationUi/en.json";
import zh from "@/i18n/contributions/evaluationUi/zh-CN.json";
import es from "@/i18n/contributions/evaluationUi/es.json";
import ja from "@/i18n/contributions/evaluationUi/ja.json";
import { MimouseEvaluation } from "./MimouseEvaluation";
const calls = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), companyId: "company-a", breadcrumbs: vi.fn() }));
vi.mock("./MimouseEvaluationRestore", () => ({ MimouseEvaluationRestore: () => <div data-testid="restore-panel" /> }));
vi.mock("@/api/client", () => ({ api: { get: calls.get, post: calls.post } }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: async () => ({ user: { id: "owner" } }) } }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: calls.companyId }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: calls.breadcrumbs }) }));
const report = { id: "report-a", companyId: "company-a", datasetId: "dataset-a", report: { reportHash: "a".repeat(64), baseline: { versionId: "base", cases: 1, passed: 1, blocked: 0, totalCostCents: null, knownCostCents: 0 }, candidate: { versionId: "next", cases: 1, passed: 1, blocked: 0, totalCostCents: null, knownCostCents: 0 }, passCountDelta: 0, eligibleForHumanReview: false, blockers: ["candidate_cost_unknown"], results: [] } };
let host: HTMLDivElement, root: Root, client: QueryClient;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function mount() { await act(async () => root.render(<QueryClientProvider client={client}><MimouseEvaluation /></QueryClientProvider>)); await flush(); }
beforeEach(async () => {
  for (const [locale, value] of Object.entries({ en, "zh-CN": zh, es, ja })) i18n.addResourceBundle(locale, "translation", { evaluationUi: value }, true, true);
  await i18n.changeLanguage("en"); calls.companyId = "company-a"; calls.post.mockReset();
  calls.get.mockReset(); calls.get.mockImplementation(async (url: string) => ({ items: url.endsWith("comparisons") ? [report] : [], nextBeforeId: null }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
it("shows unknown costs and the separate controlled-restore panel in every locale without executing", async () => {
  await mount(); const button = [...host.querySelectorAll("button")].find(item => item.textContent === "report-a")!;
  await act(async () => button.click()); await flush();
  for (const locale of ["en", "zh-CN", "es", "ja"]) {
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(host.textContent).toContain(i18n.t("evaluationUi.unknown")); expect(host.querySelector('[data-testid="restore-panel"]')).not.toBeNull();
    expect(host.textContent).toContain(i18n.t("evaluationUi.candidate_cost_unknown"));
  }
  expect(calls.post).not.toHaveBeenCalled();
});
it("hides reports and forms when read access fails", async () => {
  calls.get.mockRejectedValue(new Error("403")); await mount(); await flush();
  expect(host.querySelector("form")).toBeNull(); expect(host.textContent).toContain(i18n.t("evaluationUi.readError")); expect(host.textContent).not.toContain("report-a");
});
it("does not carry selected evidence across companies", async () => {
  await mount(); await act(async () => [...host.querySelectorAll("button")].find(item => item.textContent === "report-a")!.click());
  calls.companyId = "company-b"; await mount();
  expect(host.textContent).not.toContain("report-a"); expect(host.textContent).not.toContain("a".repeat(64));
});

it("does not round a nonzero fractional-cent ledger record down to a displayed zero", async () => {
  const tiny = { ...report, report: { ...report.report, candidate: { ...report.report.candidate, totalCostCents: 0.0000001, knownCostCents: 0.0000001 } } };
  calls.get.mockImplementation(async (url: string) => ({ items: url.endsWith("comparisons") ? [tiny] : [], nextBeforeId: null }));
  await mount(); await act(async () => [...host.querySelectorAll("button")].find(item => item.textContent === "report-a")!.click());
  expect(host.textContent).toContain("0.0000001");
});
it("labels completed superseded evidence as historical rather than hiding the comparison", async () => {
  const historical = { ...report, report: { ...report.report, results: [{ caseId: "case-a", versionId: "base", runId: "old-run", supersededAt: "2026-10-26T00:00:00.000Z", passed: true, blocked: null }] } };
  calls.get.mockImplementation(async (url: string) => ({ items: url.endsWith("comparisons") ? [historical] : [], nextBeforeId: null }));
  await mount(); await act(async () => [...host.querySelectorAll("button")].find(item => item.textContent === "report-a")!.click());
  expect(host.textContent).toContain(i18n.t("evaluationUi.historicalRun")); expect(host.textContent).toContain("old-run");
});
