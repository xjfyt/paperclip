// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MimousePromptRegistryPage } from "./MimousePromptRegistryPage";
const calls = vi.hoisted(() => ({ session: vi.fn(), company: "company-a", breadcrumbs: vi.fn() }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: calls.session } }));
vi.mock("@/lib/queryKeys", () => ({ queryKeys: { auth: { session: ["session"] } } }));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: calls.company }) }));
vi.mock("@/context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: calls.breadcrumbs }) }));
vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./MimousePromptRegistry", () => ({ MimousePromptRegistry: (p: { companyId: string; userId: string; sessionId: string }) => <div data-testid="registry">{`${p.companyId}:${p.userId}:${p.sessionId}`}</div> }));
let root: Root, host: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  calls.company = "company-a"; calls.session.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function mount() { await act(async () => root.render(<QueryClientProvider client={client}><MimousePromptRegistryPage /></QueryClientProvider>)); }
it("never substitutes a local implicit identity for a real session", async () => {
  calls.session.mockResolvedValue(null); await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("promptRegistryUi.denied"));
  expect(host.querySelector('[data-testid="registry"]')).toBeNull();
});
it("passes the exact confirmed company, user and session to the registry", async () => {
  calls.session.mockResolvedValue({ user: { id: "owner" }, session: { id: "owner-session" } }); await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("company-a:owner:owner-session"));
});
it("unmounts sensitive state during identity revalidation and passes only the new identity", async () => {
  calls.session.mockResolvedValue({ user: { id: "owner" }, session: { id: "old-session" } }); await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("old-session"));
  let finish!: (value: unknown) => void;
  calls.session.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { void client.invalidateQueries({ queryKey: ["session"] }); });
  await vi.waitFor(() => expect(host.querySelector('[data-testid="registry"]')).toBeNull());
  await act(async () => { finish({ user: { id: "other" }, session: { id: "new-session" } }); });
  await vi.waitFor(() => expect(host.textContent).toContain("company-a:other:new-session"));
  expect(host.textContent).not.toContain("old-session");
});
it("rejects incomplete session identities without exposing the editor", async () => {
  calls.session.mockResolvedValue({ user: { id: "owner" }, session: null }); await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("promptRegistryUi.denied"));
  expect(host.querySelector('[data-testid="registry"]')).toBeNull();
});
