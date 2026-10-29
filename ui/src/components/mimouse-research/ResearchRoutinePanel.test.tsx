// @vitest-environment jsdom
import { useAuthSessionFence } from "@/hooks/useAuthSessionFence";
import { queryKeys } from "@/lib/queryKeys";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { ResearchRoutinePanel } from "./ResearchRoutinePanel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const calls = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), list: vi.fn(), create: vi.fn() }));
vi.mock("@/api/client", () => ({ api: { put: calls.put } }));
vi.mock("@/api/research-private", () => ({ researchPrivateGet: calls.get }));
vi.mock("./ResearchRoutineHistory", () => ({ ResearchRoutineHistory: () => null }));
vi.mock("@/api/routines", () => ({ routinesApi: { list: calls.list, create: calls.create } }));
vi.mock("@/lib/router", () => ({ Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a> }));
let host: HTMLDivElement, root: Root, client: QueryClient;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function mount(companyId = "company", userId = "owner", sessionId = "session") { await act(async () => root.render(<QueryClientProvider client={client}><ResearchRoutinePanel companyId={companyId} userId={userId} sessionId={sessionId} /></QueryClientProvider>)); await flush(); await flush(); }
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
  await mount(); expect(calls.get).toHaveBeenCalledWith("/companies/company/research-routines/available", expect.any(AbortSignal));
  expect(calls.list).not.toHaveBeenCalled(); expect(host.textContent).toContain("configure an open project or parent");
});
it("subscribes to language changes after mount and translates status without changing IDs", async () => {
  await mount(); expect(host.textContent).toContain("Scheduled research");
  await act(async () => { await i18n.changeLanguage("zh-CN"); }); await flush();
  expect(host.textContent).toContain("定期调研"); expect(host.textContent).not.toContain("Create paused research routine");
  const option = host.querySelector('option[value="routine"]'); expect(option).not.toBeNull();
  expect(option?.textContent).toContain(i18n.t("statuses.paused")); expect(option?.textContent).not.toContain("paused");
  expect(calls.create).not.toHaveBeenCalled(); expect(calls.put).not.toHaveBeenCalled();
});
it("does not create a second routine while the first creation is pending", async () => {
  let finish!: (value: { id: string; status: string }) => void;
  calls.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await setProduct("MiWork"); await click("Create paused research routine"); await click("Create paused research routine");
  expect(calls.create).toHaveBeenCalledTimes(1); expect(calls.put).not.toHaveBeenCalled();
  await act(async () => finish({ id: "new-routine", status: "paused" })); await flush();
  expect(calls.put).toHaveBeenCalledTimes(1);
  expect(calls.put).toHaveBeenCalledWith("/companies/company/research-routines/new-routine", { product: "MiWork", enabled: false });
});

it.each(["company", "user", "session"])("does not bind a late create after a %s change", async scope => {
  let finish!: (value: { id: string; status: string }) => void;
  calls.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(); await setProduct("Old private draft"); await click("Create paused research routine");
  await mount(scope === "company" ? "other" : "company", scope === "user" ? "other-owner" : "owner", scope === "session" ? "new-session" : "session");
  await setProduct("New draft");
  await act(async () => finish({ id: "old-routine", status: "paused" })); await flush();
  expect(calls.put).not.toHaveBeenCalled();
  expect((host.querySelector('input:not([type="checkbox"])') as HTMLInputElement).value).toBe("New draft");
});

it("does not bind a late create under another real session with the same public ID", async () => {
  const session = (scopeKey: string) => ({ user: { id: "owner" }, session: { id: "paperclip:session:owner", userId: "owner", scopeKey } });
  client.setQueryDefaults(queryKeys.auth.session, { gcTime: Infinity });
  client.setQueryData(queryKeys.auth.session, session("a".repeat(64)));
  function Host() { const auth = useAuthSessionFence(); return <ResearchRoutinePanel companyId="company" userId="owner" sessionId="paperclip:session:owner" isSessionCurrent={auth.isCurrent} />; }
  let finish!: (value: { id: string; status: string }) => void;
  calls.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => root.render(<QueryClientProvider client={client}><Host /></QueryClientProvider>)); await flush();
  await setProduct("Old private draft"); await click("Create paused research routine");
  await act(async () => { client.setQueryData(queryKeys.auth.session, session("b".repeat(64))); finish({ id: "old-routine", status: "paused" }); }); await flush();
  expect(calls.put).not.toHaveBeenCalled();
});
