// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CapabilityEvidenceLedger } from "./CapabilityEvidenceLedger";
import { queryKeys } from "@/lib/queryKeys";
const state = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), append: vi.fn() }));
vi.mock("@/api/auth", () => ({ authApi: { getSession: state.session } }));
vi.mock("@/api/health", () => ({ healthApi: { get: async () => ({ deploymentMode: "authenticated" }) } }));
vi.mock("@/api/capability-evidence", () => ({ capabilityEvidenceApi: { list: state.list, append: state.append } }));
vi.mock("@/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/ui/button", () => ({ Button: ({ children, variant: _variant, ...props }: { children: ReactNode; variant?: string }) => <button {...props}>{children}</button> }));
const metadata = ["private-account", "private-environment", "private-source", "private-reviewer"];
const page = { nextRevision: null, events: [{ id: "receipt", companyId: "company", revision: 1, action: "record", targetId: null, reviewerId: metadata[3], createdAt: "2026-01-01T00:00:00Z", receipt: { adapterType: "qoder_cn", capability: "localExecution", runtime: "qoder", runtimeVersion: "1", accountAlias: metadata[0], environmentAlias: metadata[1], sourceResourceId: metadata[2], sourceRunId: "run", testedCommit: "a".repeat(40), testedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-02T00:00:00Z", level: "C3", result: "passed" } }] };
let root: Root, host: HTMLDivElement, client: QueryClient;
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function render() { await act(async () => root.render(<QueryClientProvider client={client}><CapabilityEvidenceLedger companyId="company" adapterType="qoder_cn" /></QueryClientProvider>)); await settle(); await settle(); }
function button(label: string) { return [...host.querySelectorAll("button")].find(node => node.textContent === `capabilityEvidence.${label}`)!; }
function expectPrivateHidden() { for (const value of metadata) expect(host.textContent).not.toContain(value); expect(host.querySelector('[role="group"]')).toBeNull(); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.session.mockReset().mockResolvedValue({ user: { id: "admin-a" }, session: { id: "session-a" } });
  state.list.mockReset().mockResolvedValue(page); state.append.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });
it("isolates a reused QueryClient when admin A becomes nonadmin B", async () => {
  await render(); expect(host.textContent).toContain(metadata[0]);
  await act(async () => button("revoke").click()); expect(host.querySelector('[role="group"]')).not.toBeNull();
  state.list.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
  await act(async () => client.setQueryData(queryKeys.auth.session, { user: { id: "user-b" }, session: { id: "session-b" } }));
  await settle(); expectPrivateHidden(); expect(state.append).not.toHaveBeenCalled();
  expect(host.textContent).toContain("capabilityEvidence.loadError");
});
it("fails closed on same-user permission revocation and clears stale confirmation", async () => {
  await render(); await act(async () => button("revoke").click());
  state.list.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
  await act(async () => button("refresh").click()); await settle();
  expectPrivateHidden(); expect(host.textContent).toContain("capabilityEvidence.loadError");
  state.list.mockResolvedValue(page); await act(async () => button("refresh").click()); await settle();
  expect(host.textContent).toContain(metadata[0]); expect(host.querySelector('[role="group"]')).toBeNull();
  expect(state.append).not.toHaveBeenCalled();
});
it("does not query or retain confirmation during null authenticated session", async () => {
  await render(); await act(async () => button("revoke").click()); const count = state.list.mock.calls.length;
  await act(async () => client.setQueryData(queryKeys.auth.session, null)); await settle();
  expectPrivateHidden(); expect(state.list).toHaveBeenCalledTimes(count);
});
