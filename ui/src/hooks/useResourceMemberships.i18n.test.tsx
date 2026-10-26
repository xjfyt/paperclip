// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { i18n, managementMessages } from "../i18n/management-test-resources";
import { useResourceMembershipMutation } from "./useResourceMemberships";
const mocks = vi.hoisted(() => ({ update: vi.fn(), toast: vi.fn() }));
vi.mock("../api/resourceMemberships", () => ({ resourceMembershipsApi: { updateAgent: mocks.update, updateProject: mocks.update } }));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast: mocks.toast }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => { vi.clearAllMocks(); await i18n.changeLanguage("en"); });
it.each(Object.entries(managementMessages))("uses complete localized mutation failures in %s without changing IDs", async (locale, messages) => {
  await i18n.changeLanguage(locale);
  mocks.update.mockRejectedValue("unknown failure");
  const host = document.createElement("div"), root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { gcTime: 0 } } });
  let mutation!: ReturnType<typeof useResourceMembershipMutation>;
  function Harness() { mutation = useResourceMembershipMutation("company-a"); return null; }
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); });
    for (const [change, key] of [
      [{ starred: true }, "starFailed"], [{ starred: false }, "unstarFailed"],
      [{ state: "left" as const }, "leaveFailed"], [{ state: "joined" as const }, "joinFailed"],
    ] as const) {
      await act(async () => { await mutation.mutateAsync({ resourceType: "agent", resourceId: "id-a", resourceName: "Original <Agent>", ...change }).catch(() => {}); });
      expect(mocks.toast).toHaveBeenLastCalledWith({ title: messages[key].replace("{{name}}", "Original <Agent>"), body: messages.tryAgain, tone: "error" });
      expect(mocks.update).toHaveBeenLastCalledWith("company-a", "id-a", { state: undefined, starred: undefined, ...change });
    }
  } finally { await act(async () => { root.unmount(); }); client.clear(); }
});
