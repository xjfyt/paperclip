// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { costHistoryMessages, i18n } from "@/i18n/cost-history-test-resources";
import { formatDateTime, formatDetailedCents, formatNumber } from "@/lib/utils";
import { DecisionHistory, DecisionHistoryTable } from "./DecisionHistory";
import { entry } from "../../../storybook/stories/decision-models/fixtures";

const history = vi.hoisted(() => vi.fn());
vi.mock("@/api/decision-models", () => ({ decisionModelsApi: { history } }));
vi.mock("@/hooks/useFastResponsesEnabled", () => ({ useFastResponsesEnabled: () => ({ enabled: true }) }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompany: { issuePrefix: "ACM" } }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };
const language = async (locale: string) => { await act(async () => { await i18n.changeLanguage(locale); }); };
async function render(children: React.ReactNode) {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>));
}
beforeEach(() => {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  history.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await language("en"); });

describe.each(Object.entries(costHistoryMessages))("decision history %s", (locale, strings) => {
  it("localizes metadata and all known outcomes without mutating raw data or treating unknown cost as zero", async () => {
    await language(locale);
    const rows = Object.keys(strings.status).map((status, index) => ({
      ...entry, id: String(index), status, startedAt: "2026-10-29T00:15:00Z", durationMs: 1234,
      actorType: index === 0 ? "system" : "user", userName: index === 1 ? "客户 <b> Ω" : null,
      responsibleUserId: index === 2 ? "local-board" : null,
      model: "provider/raw-model_Ω", feature: index === 0 ? "settings.test" : "feature.custom_Ω",
      errorCode: index === 3 ? "provider_error_<b>" : null,
      costCents: index === 0 ? null : index === 1 ? "0" : "0.0014000",
      costStatus: index === 0 ? "unpriced" : index === 1 ? "reported" : "estimated",
      inputTokens: index === 0 ? null : 12345, outputTokens: 0,
      issueId: "task-id", issueIdentifier: index === 1 ? "ACM-99" : null,
    }));
    const original = JSON.stringify(rows);
    await render(<DecisionHistoryTable entries={rows} />);
    expect(host.querySelector("table")?.getAttribute("aria-label")).toBe(strings.decisions);
    expect([...host.querySelectorAll("th")].map(node => node.textContent)).toEqual(Object.entries(strings.columns).filter(([key]) => key !== "connection").map(([, value]) => value));
    for (const value of Object.values(strings.status)) expect(host.textContent).toContain(value);
    for (const value of [strings.privacy, strings.setupTest, strings.services, strings.board, strings.formerUser, strings.viewTask, strings.unknownCost, strings.cost.reported, strings.cost.estimated]) expect(host.textContent).toContain(value);
    const cells = [...host.querySelectorAll("tbody tr")].map(row => row.querySelectorAll("td"));
    expect(cells[0]![7]!.textContent).toBe(strings.unknownCost);
    expect(cells[1]![7]!.textContent).toBe(formatDetailedCents("0") + strings.cost.reported);
    expect(cells[2]![7]!.textContent).toBe(formatDetailedCents("0.0014000") + strings.cost.estimated);
    expect(host.textContent).toContain(formatDateTime(rows[0]!.startedAt));
    expect(host.textContent).toContain(formatNumber(12345, { notation: "compact", maximumFractionDigits: 1 }));
    expect(host.textContent).toContain(formatNumber(1.234, { style: "unit", unit: "second", unitDisplay: "narrow", minimumFractionDigits: 1, maximumFractionDigits: 1 }));
    for (const value of ["客户 <b> Ω", "provider/raw-model_Ω", "feature.custom_Ω", "provider_error_<b>", "ACM-99"]) expect(host.textContent).toContain(value);
    expect(host.querySelector("b")).toBeNull();
    expect(host.querySelector('a[href="/ACM/issues/ACM-99"]')).not.toBeNull();
    expect(JSON.stringify(rows)).toBe(original);
    expect(host.textContent).not.toContain("costHistoryUi.");
  });
  it("keeps loading and failure distinct from empty, then retries the same company/date query", async () => {
    await language(locale);
    let reject!: (error: Error) => void;
    history.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    await render(<DecisionHistory companyId="company-1" from="2026-10-01" to="2026-10-29" />);
    expect(host.textContent).toBe(strings.loadingDecisions);
    await act(async () => { reject(new Error("provider diagnostic")); }); await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(strings.failedDecisions);
    expect(host.querySelector("a")).toBeNull();
    history.mockResolvedValue([]);
    await act(async () => host.querySelector("button")!.click()); await flush();
    expect(history).toHaveBeenCalledTimes(2);
    expect(history).toHaveBeenLastCalledWith("company-1", "2026-10-01", "2026-10-29");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/ACM/company/settings/connections");
    expect(host.textContent).not.toContain(strings.failedDecisions);
    expect(host.textContent).not.toContain("costHistoryUi.");
  });
});
it("hot-switches table labels and formatting without rereading or changing filters/cache", async () => {
  const row = { ...entry, feature: "custom.feature", status: "provider_new_state", costStatus: "provider_price_state", errorCode: "raw_error_code" };
  history.mockResolvedValue([row]);
  await render(<DecisionHistory companyId="company-2" from="2026-09-01" to={null} />); await flush();
  const originalTable = host.querySelector("table");
  for (const [locale, strings] of Object.entries(costHistoryMessages)) {
    await language(locale);
    expect(host.querySelector("table")).toBe(originalTable);
    expect(originalTable?.getAttribute("aria-label")).toBe(strings.decisions);
    for (const value of [row.model, row.feature, row.status, row.costStatus, row.errorCode]) expect(host.textContent).toContain(value);
    expect(history).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(["decision-history", "company-2", "2026-09-01", null])).toEqual([row]);
  }
});
