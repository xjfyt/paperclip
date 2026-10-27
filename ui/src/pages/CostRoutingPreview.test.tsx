// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CostRoutingPreview } from "./CostRoutingPreview";
vi.mock("./RuntimeCostRouting", () => ({ RuntimeCostRouting: () => null }));
const calls = vi.hoisted(() => ({ current: vi.fn(), preview: vi.fn(), save: vi.fn(), session: vi.fn() }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: () => {} }) }));
vi.mock("@/api/cost-routing-preview", () => ({ costRoutingPreviewApi: calls }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: calls.session } }));
vi.mock("@/api/health", () => ({ healthApi: { get: async () => ({ deploymentMode: "authenticated" }) } }));
vi.mock("@/lib/queryKeys", () => ({ queryKeys: { auth: { session: ["session"] }, health: ["health"] } }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: "company-a" }) }));
vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/ui/button", () => ({ Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} /> }));
let host: HTMLDivElement, root: Root, client: QueryClient;
const policy = { revision: 1, policy: { privateAdminMarker: "admin-only-draft" }, createdAt: "2026-10-26T00:00:00Z" };
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function mount() { await act(async () => root.render(<QueryClientProvider client={client}><CostRoutingPreview /></QueryClientProvider>)); await flush(); await flush(); }
beforeEach(() => {
  calls.current.mockReset().mockResolvedValue(policy); calls.preview.mockReset(); calls.save.mockReset();
  calls.session.mockReset().mockResolvedValue({ user: { id: "admin" }, session: { id: "session-1" } });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
it("clears same-company admin draft when principal changes and new read is forbidden", async () => {
  await mount(); expect(host.querySelector("textarea")?.value).toContain("admin-only-draft");
  calls.current.mockRejectedValue({ status: 403 });
  await act(async () => client.setQueryData(["session"], { user: { id: "other" }, session: { id: "session-2" } }));
  await flush(); expect(host.querySelector("textarea")).toBeNull(); expect(host.textContent).not.toContain("admin-only-draft");
});
it("unmounts cached metadata while policy access revalidates and after a 403", async () => {
  await mount(); let reject!: (error: unknown) => void;
  calls.current.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  await act(async () => { void client.invalidateQueries({ queryKey: ["cost-routing-preview"] }); });
  await flush(); expect(host.querySelector("textarea")).toBeNull();
  await act(async () => reject({ status: 403 })); await flush();
  expect(host.querySelector("textarea")).toBeNull(); expect(host.textContent).not.toContain("admin-only-draft");
});
it("does not apply a pending preview after session identity changes", async () => {
  await mount(); let resolve!: (value: unknown) => void;
  calls.preview.mockImplementation(() => new Promise(done => { resolve = done; }));
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "costRoutingPreview.preview")!.click());
  calls.current.mockResolvedValue(null);
  await act(async () => client.setQueryData(["session"], { user: { id: "admin" }, session: { id: "new-session" } }));
  await flush(); await act(async () => resolve({ id: "late-secret-receipt", preview: {} })); await flush();
  expect(host.textContent).not.toContain("late-secret-receipt"); expect(host.querySelector("textarea")?.value).toBe("");
});
it("does not treat an unauthenticated session as local-board", async () => {
  calls.session.mockResolvedValue(null); await mount();
  expect(calls.current).not.toHaveBeenCalled(); expect(host.querySelector("textarea")).toBeNull();
});

it("clears loaded admin data when a mutation returns forbidden", async () => {
  await mount(); calls.preview.mockRejectedValue({ status: 403 });
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "costRoutingPreview.preview")!.click());
  await flush(); expect(host.querySelector("textarea")).toBeNull(); expect(host.textContent).not.toContain("admin-only-draft");
});
