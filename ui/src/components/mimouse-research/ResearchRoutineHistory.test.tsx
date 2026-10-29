// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { ResearchRoutineHistory } from "./ResearchRoutineHistory";
const calls = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/research-private", () => ({ researchPrivateGet: calls.get }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a> }));
let host: HTMLDivElement, root: Root, client: QueryClient;
const item = { id: "first", createdAt: "2026-10-29T00:00:00Z", status: "received", reportState: "not_received", issueId: null, attempts: [], reports: [] };
const page = (companyId = "company", routineId = "routine") => ({ companyId, routineId, items: [item], nextBeforeId: null });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function mount(companyId = "company", userId = "owner", sessionId = "session", routineId = "routine") {
  await act(async () => root.render(<QueryClientProvider client={client}><ResearchRoutineHistory companyId={companyId} userId={userId} sessionId={sessionId} routineId={routineId} /></QueryClientProvider>)); await flush();
}
async function click(text: string) { await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === text)!.click()); await flush(); }
beforeEach(async () => { vi.clearAllMocks(); await i18n.changeLanguage("en"); calls.get.mockResolvedValue(page()); host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });
it("shows loading, retry, empty, unknown, and visible-only paging", async () => {
  let resolve!: (value: unknown) => void; calls.get.mockImplementationOnce(() => new Promise(accept => { resolve = accept; }));
  await mount(); expect(host.textContent).toContain("Loading history");
  await act(async () => resolve({ ...page(), items: [{ ...item, status: "DO_NOT_ECHO_UNKNOWN_STATUS" }], nextBeforeId: "first" })); await flush();
  expect(host.textContent).toContain("Unknown"); expect(host.textContent).not.toContain("DO_NOT_ECHO_UNKNOWN_STATUS");
  calls.get.mockRejectedValueOnce(Error("private backend text")); await click("Older");
  expect(calls.get.mock.lastCall?.[0]).toContain("beforeId=first"); expect(host.textContent).toContain("History could not be read"); expect(host.textContent).not.toContain("private backend text");
  calls.get.mockResolvedValueOnce({ ...page(), items: [] }); await click("Retry"); expect(host.textContent).toContain("No visible history");
  await click("Latest"); expect(calls.get.mock.lastCall?.[0]).not.toContain("beforeId=");
});
it.each(["company", "user", "session", "routine"])("ignores late history across %s identity changes", async scope => {
  let resolve!: (value: unknown) => void; calls.get.mockImplementationOnce(() => new Promise(accept => { resolve = accept; }));
  await mount(); const oldSignal = calls.get.mock.calls[0][1] as AbortSignal;
  const companyId = scope === "company" ? "other" : "company", routineId = scope === "routine" ? "other-routine" : "routine";
  calls.get.mockResolvedValue({ ...page(companyId, routineId), items: [] });
  await mount(companyId, scope === "user" ? "other-user" : "owner", scope === "session" ? "other-session" : "session", routineId);
  await act(async () => resolve({ ...page(), items: [{ ...item, createdAt: "OLD_PRIVATE_RESULT" }] })); await flush();
  expect(oldSignal.aborted).toBe(true); expect(host.textContent).not.toContain("OLD_PRIVATE_RESULT"); expect(calls.get).toHaveBeenCalledTimes(2);
});
it("rejects a mismatched response scope", async () => { calls.get.mockResolvedValue(page("foreign")); await mount(); expect(host.textContent).toContain("History could not be read"); });
it.each(["zh-CN", "es", "ja"])("updates %s language without another read or dispatch", async locale => {
  await mount(); const before = calls.get.mock.calls.length;
  await act(async () => { await i18n.changeLanguage(locale); }); await flush();
  expect(host.textContent).not.toContain("Routine history"); expect(calls.get).toHaveBeenCalledTimes(before);
  expect(host.querySelector("a")).toBeNull();
});
