// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { costHistoryMessages, i18n } from "@/i18n/cost-history-test-resources";
import { FastResponseHistory } from "./FastResponseHistory";
import { DecisionHistoryTable } from "@/components/decision-models/DecisionHistory";
import { entry } from "../../../storybook/stories/decision-models/fixtures";

const history = vi.hoisted(() => vi.fn());
vi.mock("@/api/fast-responses", () => ({ fastResponsesApi: { history } }));
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
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } }); history.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await language("en"); });

describe.each(Object.entries(costHistoryMessages))("fast response history %s", (locale, strings) => {
  it("localizes publication states, removed connections and empty setup routes, leaving custom names/statuses literal", async () => {
    await language(locale);
    const rows = [...Object.keys(strings.publication), "custom_publication_<b>"].map((publicationStatus, index) => ({ ...entry, id: String(index), publicationStatus, connectionName: index === 0 ? "客户 <b> Ω" : null }));
    const original = JSON.stringify(rows);
    await render(<DecisionHistoryTable entries={rows} fastResponse />);
    expect(host.querySelector("table")?.getAttribute("aria-label")).toBe(strings.fastResponses);
    expect([...host.querySelectorAll("th")].map(node => node.textContent)).toEqual(Object.values(strings.columns));
    for (const value of [...Object.values(strings.publication), strings.removedConnection, "客户 <b> Ω", "custom_publication_<b>"]) expect(host.textContent).toContain(value);
    expect(host.querySelector("b")).toBeNull(); expect(JSON.stringify(rows)).toBe(original);
    for (const enabled of [true, false]) {
      await render(<DecisionHistoryTable entries={[]} fastResponse connectionsEnabled={enabled} />);
      expect(host.querySelector("a")?.getAttribute("href")).toBe(enabled ? "/ACM/company/settings/connections" : "/ACM/company/settings/instance/experimental");
      expect(host.textContent).toBe((enabled ? strings.emptyFast : strings.emptyFastDisabled).replace(/<\/?0>/g, ""));
    }
  });
  it("does not present read failure as empty and retries the captured date window", async () => {
    await language(locale); let reject!: (error: Error) => void;
    history.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    await render(<FastResponseHistory companyId="company-1" from="2026-10-01" to="2026-10-29" />);
    expect(host.textContent).toBe(strings.loadingFast);
    await act(async () => { reject(new Error("read failed")); }); await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(strings.failedFast);
    expect(host.querySelector("a")).toBeNull();
    history.mockResolvedValue([]); await act(async () => host.querySelector("button")!.click()); await flush();
    expect(history).toHaveBeenCalledTimes(2);
    expect(history).toHaveBeenLastCalledWith("company-1", "2026-10-01", "2026-10-29");
    expect(host.textContent).toBe(strings.emptyFast.replace(/<\/?0>/g, ""));
    expect(host.textContent).not.toContain(strings.failedFast);
  });
});
it("hot-switches query feedback and retained rows without rereading or mutating the request", async () => {
  const rows = [{ ...entry, publicationStatus: "published", connectionName: "custom connection Ω" }];
  history.mockResolvedValue(rows);
  await render(<FastResponseHistory companyId="company-2" from={null} to="2026-10-29" />); await flush();
  const table = host.querySelector("table");
  for (const [locale, strings] of Object.entries(costHistoryMessages)) {
    await language(locale);
    expect(host.querySelector("table")).toBe(table);
    expect(table?.getAttribute("aria-label")).toBe(strings.fastResponses);
    expect(host.textContent).toContain(strings.publication.published);
    expect(host.textContent).toContain(rows[0]!.connectionName);
    expect(history).toHaveBeenCalledTimes(1);
    expect(history).toHaveBeenLastCalledWith("company-2", undefined, "2026-10-29");
    expect(client.getQueryData(["fast-response-history", "company-2", null, "2026-10-29"])).toEqual(rows);
  }
});
