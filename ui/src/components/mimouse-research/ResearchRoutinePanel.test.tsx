// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { ResearchRoutinePanel } from "./ResearchRoutinePanel";
const calls = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), list: vi.fn(), create: vi.fn() }));
vi.mock("@/api/client", () => ({ api: { get: calls.get, put: calls.put } }));
vi.mock("@/api/routines", () => ({ routinesApi: { list: calls.list, create: calls.create } }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a> }));
let host: HTMLDivElement, root: Root, client: QueryClient;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function mount(companyId = "company") { await act(async () => root.render(<QueryClientProvider client={client}><ResearchRoutinePanel key={companyId} companyId={companyId} userId="owner" /></QueryClientProvider>)); await flush(); await flush(); }
async function setProduct(value: string) { const input = host.querySelector('input:not([type="checkbox"])') as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
async function click(text: string) { const button = [...host.querySelectorAll("button")].find(node => node.textContent === text)!;
  await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true }))); await flush(); }
beforeEach(async () => {
  vi.clearAllMocks(); await i18n.changeLanguage("en"); calls.get.mockImplementation(async (path: string) => path.endsWith("/available") ? [{ id: "routine", title: "Existing", status: "paused" }] : []);
  calls.create.mockResolvedValue({ id: "new-routine", status: "paused" }); calls.put.mockResolvedValue({ routineStarted: false });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });
it("creates only a paused existing-system routine and a disabled binding", async () => {
  await mount(); await setProduct("MiWork"); await click("Create paused research routine");
  expect(calls.create).toHaveBeenCalledTimes(1);
  expect(calls.create).toHaveBeenCalledWith("company", expect.objectContaining({ status: "paused" }));
  const body = calls.create.mock.calls[0][1]; expect(body).not.toHaveProperty("assigneeAgentId"); expect(body).not.toHaveProperty("triggers");
  expect(body.description).toContain("originRunId"); expect(body.description).toContain("quarantined");
  expect(calls.put).toHaveBeenCalledWith("/companies/company/research-routines/new-routine", { product: "MiWork", enabled: false });
});
it("shows partial-save errors instead of pretending a routine was activated", async () => {
  calls.put.mockRejectedValue(Error("fixture bind failure")); await mount(); await setProduct("MiWork"); await click("Create paused research routine");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("may remain paused"); expect(calls.create).toHaveBeenCalledTimes(1);
});
it("drops draft state when the parent changes company identity", async () => {
  await mount(); await setProduct("Private A product"); await mount("other");
  expect((host.querySelector('input:not([type="checkbox"])') as HTMLInputElement).value).toBe(""); expect(calls.put).not.toHaveBeenCalled();
});
it("denied binding read hides the mutation controls", async () => {
  calls.get.mockRejectedValue(Error("403")); await mount(); expect(host.querySelector("form")).toBeNull(); expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
it.each(["zh-CN", "es", "ja"])("renders localized scheduled-research controls in %s", async language => {
  await i18n.changeLanguage(language); await mount(); expect(host.textContent).not.toContain("Create paused research routine"); expect(host.querySelectorAll("button")).toHaveLength(2);
});
it("uses only the privacy-filtered research routine selector", async () => {
  await mount(); expect(calls.get).toHaveBeenCalledWith("/companies/company/research-routines/available");
  expect(calls.list).not.toHaveBeenCalled(); expect(host.textContent).toContain("configure an open project or parent");
});
