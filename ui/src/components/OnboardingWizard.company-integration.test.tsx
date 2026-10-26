// @vitest-environment jsdom
import "../i18n/optional-onboarding-test-resources";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { Company } from "@paperclipai/shared";
import { CompanyProvider, useCompany } from "../context/CompanyContext";
import { DialogProvider, useDialogActions } from "../context/DialogContext";
import { companyListQueryOptions, type CompanyListResult } from "../api/companies-query";
import { queryKeys } from "../lib/queryKeys";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), detachInflightList: vi.fn() }));
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../api/companies", () => ({ companiesApi: api }));
vi.mock("../api/auth", () => ({ authApi: auth }));
vi.mock("@/api/health", () => ({ healthApi: { get: async () => ({ deploymentMode: "local_trusted" }) } }));
vi.mock("../adapters", () => ({ listUIAdapters: () => [], getUIAdapter: () => undefined }));
vi.mock("../adapters/use-disabled-adapters", () => ({ useDisabledAdaptersSync: () => new Set(), useAdapterRegistryLoaded: () => true }));
vi.mock("./onboarding/OnboardingCharacter", () => ({ OnboardingCharacter: () => null }));
const { OnboardingWizard } = await import("./OnboardingWizard");
const session = (id: string) => ({ user: { id }, session: { id: `session-${id}`, userId: id } });
const company = (id: string, prefix: string) => ({ id, name: id, issuePrefix: prefix, status: "active" }) as Company;

function Start() {
  const { openOnboarding } = useDialogActions();
  return <button onClick={() => openOnboarding()}>New Organization</button>;
}
function DashboardProbe() {
  const { companyPrefix } = useParams();
  const { companies, selectedCompanyId } = useCompany();
  const matched = companies.find(item => item.issuePrefix === companyPrefix);
  return <output>{matched ? `Dashboard:${matched.id}:selected:${selectedCompanyId}` : "invalid_company_prefix"}</output>;
}
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); auth.getSession.mockResolvedValue(session("user-1")); api.list.mockResolvedValue([]); });

it.each([false, true])("enters the exact created dashboard before a stale list can overwrite it (existing=%s)", async existing => {
  const previous = existing ? [company("old", "OLD")] : [];
  const created = company("created", "NEW");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.auth.session, session("user-1"));
  client.setQueryData(queryKeys.companies.list("user-1"), { companies: previous, unauthorized: false });
  // A saved existing-company draft must not hijack an explicit New Organization.
  if (existing) localStorage.setItem("paperclip-onboarding-state", JSON.stringify({ step: 4, createdCompanyId: "old", companyName: "old", agentName: "Saved agent" }));
  api.list.mockResolvedValue(previous);
  api.create.mockResolvedValue(created);
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><CompanyProvider><DialogProvider><MemoryRouter><Routes><Route path="/" element={<Start />} /><Route path="/:companyPrefix/dashboard" element={<DashboardProbe />} /></Routes><OnboardingWizard /></MemoryRouter></DialogProvider></CompanyProvider></QueryClientProvider>));
    await settle();
    expect(document.querySelector('[data-testid="onboarding-wizard"]')).toBeNull();
    await act(async () => container.querySelector("button")!.click());
    await settle();
    const name = document.querySelector("#onboarding-company-name") as HTMLInputElement;
    expect(name).not.toBeNull(); expect(name.value).toBe("");
    let resolveStale!: (companies: Company[]) => void;
    api.list.mockReturnValueOnce(new Promise(resolve => { resolveStale = resolve; }));
    const staleFetch = client.fetchQuery({ ...companyListQueryOptions("user-1"), staleTime: 0 }).catch(() => undefined);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "New organization");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => [...document.querySelectorAll("button")].find(button => button.textContent?.trim() === "Create and open dashboard")!.click());
    await settle();
    expect(api.create).toHaveBeenCalledExactlyOnceWith({ name: "New organization" });
    expect(container.textContent).toContain("Dashboard:created:selected:created");
    expect(container.textContent).not.toContain("invalid_company_prefix");
    await act(async () => resolveStale(previous)); await staleFetch; await settle();
    expect(container.textContent).toContain("Dashboard:created:selected:created");
    expect(client.getQueryData<CompanyListResult>(queryKeys.companies.list("user-1"))?.companies.map(item => item.id)).toEqual([...previous.map(item => item.id), "created"]);
    api.list.mockRejectedValueOnce(new Error("list temporarily unavailable"));
    await act(async () => { void client.fetchQuery({ ...companyListQueryOptions("user-1"), staleTime: 0 }).catch(() => undefined); });
    await settle();
    expect(container.textContent).toContain("Dashboard:created:selected:created");
  } finally { await act(async () => root.unmount()); client.clear(); container.remove(); }
});

it("does not cache or navigate an old account's create result after a same-path account switch", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.auth.session, session("user-1"));
  client.setQueryData(queryKeys.companies.list("user-1"), { companies: [], unauthorized: false });
  client.setQueryData(queryKeys.companies.list("user-2"), { companies: [], unauthorized: false });
  let resolveCreate!: (value: Company) => void;
  api.create.mockReturnValue(new Promise(resolve => { resolveCreate = resolve; }));
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><CompanyProvider><DialogProvider><MemoryRouter><Routes><Route path="/" element={<Start />} /><Route path="/:companyPrefix/dashboard" element={<DashboardProbe />} /></Routes><OnboardingWizard /></MemoryRouter></DialogProvider></CompanyProvider></QueryClientProvider>));
    await settle();
    await act(async () => container.querySelector("button")!.click());
    await settle();
    const name = document.querySelector("#onboarding-company-name") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "New organization");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => [...document.querySelectorAll("button")].find(button => button.textContent?.trim() === "Create and open dashboard")!.click());
    expect(api.create).toHaveBeenCalledTimes(1);
    auth.getSession.mockResolvedValue(session("user-2"));
    await act(async () => { client.setQueryData(queryKeys.auth.session, session("user-2")); });
    await act(async () => resolveCreate(company("old-account-created", "PRIVATE")));
    await settle();
    expect(container.querySelector("output")).toBeNull();
    for (const id of ["user-1", "user-2"]) expect(client.getQueryData<CompanyListResult>(queryKeys.companies.list(id))?.companies).toEqual([]);
    expect(localStorage.getItem("paperclip.selectedCompanyId")).not.toBe("old-account-created");
  } finally { await act(async () => root.unmount()); client.clear(); container.remove(); }
});
