// @vitest-environment jsdom
import { BreadcrumbProvider } from "@/context/BreadcrumbContext";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { MimouseNotifications } from "./MimouseNotifications";
const company = vi.hoisted(() => ({ selectedCompanyId: "company-a" }));
const api = vi.hoisted(() => Object.fromEntries(["policy", "get", "create", "revise", "history", "review", "reviews", "toggle", "subscribe", "toggleSubscription", "preview", "retry", "test"].map(key => [key, vi.fn()])));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => company }));
vi.mock("@/api/mimouse-notifications", () => ({ notificationApi: api }));
const data = () => ({ enabled: true, dispatchEnabled: true, connectedEvents: ["approval.requested", "run.failed", "coding.mr_ready", "coding.ci_failed", "coding.artifact_ready", "budget.threshold_reached"], unconnectedEvents: [], endpoints: [{ id: "endpoint-1", name: "Test channel", kind: "wecom_webhook", enabled: true, config: {}, secretRef: "11111111-1111-4111-8111-111111111111", secretVersion: 1, configVersion: 1 }], subscriptions: [{ id: "subscription-1", endpointId: "endpoint-1", eventType: "run.failed", locale: "en", enabled: true }], deliveries: [{ id: "delivery-1", endpointId: "endpoint-1", state: "indeterminate", attempt: 1, lastCode: "transport_unconfirmed", createdAt: "2026-10-25T00:00:00Z" }] });
let host: HTMLDivElement, root: Root, client: QueryClient;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function mount() { await act(async () => root.render(<BreadcrumbProvider><QueryClientProvider client={client}><MimouseNotifications /></QueryClientProvider></BreadcrumbProvider>)); await flush(); }
async function click(element: Element | null) { expect(element).not.toBeNull(); await act(async () => { element!.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); }
function button(text: string) { return [...host.querySelectorAll("button")].find(item => item.textContent === text) ?? null; }
async function fill(id: string, value: string) { await act(async () => { const input = host.querySelector(`#${id}`)!; const proto = input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value); input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true })); }); }
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  company.selectedCompanyId = "company-a"; await i18n.changeLanguage("en"); vi.clearAllMocks();
  for (const fn of Object.values(api)) fn.mockResolvedValue({}); api.get.mockImplementation(async () => data()); api.reviews.mockResolvedValue([]);
  api.preview.mockResolvedValue({ id: "delivery-1", state: "indeterminate", endpointName: "Test channel", kind: "wecom_webhook", title: "Original title", text: "Original body", target: null, secretVersion: 1, locale: "en", templateData: null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } }); client.setQueryData(["mimouse-notifications", "company-a"], data());
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); await i18n.changeLanguage("en"); });
it("can manage all six subscriptions without a test send", async () => {
  await mount(); expect(host.querySelectorAll('[aria-label$="Enable subscription"]')).toHaveLength(5);
  await click(host.querySelector('[aria-label="Run failed: Pause subscription"]'));
  expect(api.toggleSubscription).toHaveBeenCalledWith("company-a", "subscription-1", false); expect(api.test).not.toHaveBeenCalled();
});
it("saving a Lark channel does not send a message", async () => {
  await mount(); await fill("channel-name", "Lark fixture"); await fill("channel-secret", "11111111-1111-4111-8111-111111111111"); await fill("channel-kind", "feishu_webhook"); await fill("channel-brand", "lark");
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await flush();
  expect(api.create).toHaveBeenCalledWith("company-a", expect.objectContaining({ kind: "feishu_webhook", config: { brand: "lark" } })); expect(api.test).not.toHaveBeenCalled();
});
it("requires preview and both risk acknowledgments before creating an explicit retry", async () => {
  await mount(); await click(button("Review before retrying")); expect(host.textContent).toContain("Original body");
  const confirm = button("Confirm a new delivery") as HTMLButtonElement; expect(confirm.disabled).toBe(true); expect(api.retry).not.toHaveBeenCalled();
  const checks = host.querySelectorAll('input[type="checkbox"]'); expect(checks).toHaveLength(2);
  await click(checks[0]); expect(confirm.disabled).toBe(true); await click(checks[1]); expect(confirm.disabled).toBe(false); await click(confirm);
  expect(api.retry).toHaveBeenCalledWith("company-a", "delivery-1", expect.any(String)); expect(api.retry).toHaveBeenCalledTimes(1);
});
it("clears sensitive drafts and confirmations when company changes", async () => {
  await mount(); await fill("channel-secret", "old-company-reference"); await click(button("Review before retrying"));
  company.selectedCompanyId = "company-b"; client.setQueryData(["mimouse-notifications", "company-b"], data()); await mount();
  expect((host.querySelector("#channel-secret") as HTMLInputElement).value).toBe(""); expect(host.textContent).not.toContain("Original body"); expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
});
it.each([["en", "MR ready for review"], ["zh-CN", "合并请求待审查"], ["es", "MR listo para revisión"], ["ja", "MR のレビュー待ち"]])("renders new event controls in %s", async (locale, label) => { await i18n.changeLanguage(locale); await mount(); expect(host.textContent).toContain(label); expect(host.textContent).toContain("Test channel"); });
it("ignores a late preview so acknowledgments cannot authorize a different delivery", async () => {
  const state = data(); state.deliveries.push({ ...state.deliveries[0], id: "delivery-2" }); client.setQueryData(["mimouse-notifications", "company-a"], state);
  let releaseFirst!: (value: unknown) => void;
  api.preview.mockImplementationOnce(() => new Promise(resolve => { releaseFirst = resolve; })).mockResolvedValueOnce({ id: "delivery-2", state: "indeterminate", endpointName: "Test channel", kind: "wecom_webhook", title: "Second title", text: "Second body", target: null, secretVersion: 1, locale: "en", templateData: null });
  await mount(); const previews = [...host.querySelectorAll("button")].filter(item => item.textContent === "Review before retrying"); await click(previews[0]); await click(previews[1]);
  const checks = host.querySelectorAll('input[type="checkbox"]'); await click(checks[0]); await click(checks[1]);
  await act(async () => { releaseFirst({ id: "delivery-1", title: "First title", text: "First body", endpointName: "Test channel", secretVersion: 1 }); }); await flush();
  expect(host.textContent).toContain("Second body"); expect(host.textContent).not.toContain("First body"); await click(button("Confirm a new delivery")); expect(api.retry).toHaveBeenCalledWith("company-a", "delivery-2", expect.any(String));
});

it("owns the localized page title instead of retaining the previous route", async () => {
  document.title = "Previous approval";
  await i18n.changeLanguage("zh-CN"); await mount();
  expect(document.title).toBe("通知中心 • Paperclip");
  await act(async () => { await i18n.changeLanguage("es"); }); await flush();
  expect(document.title).toBe("Notificaciones • Paperclip");
});

it("edits a fixed configuration revision without enabling or test-sending", async () => {
  await mount(); await click(button("Edit configuration"));
  expect((host.querySelector("#channel-kind") as HTMLSelectElement).disabled).toBe(true);
  expect(host.textContent).toContain("Saving pauses the channel");
  await fill("channel-name", "Updated channel");
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await flush();
  expect(api.revise).toHaveBeenCalledWith("company-a", "endpoint-1", expect.objectContaining({ expectedVersion: 1, name: "Updated channel", secretVersion: 1 }));
  expect(api.create).not.toHaveBeenCalled(); expect(api.toggle).not.toHaveBeenCalled(); expect(api.test).not.toHaveBeenCalled();
  expect((host.querySelector("#channel-name") as HTMLInputElement).value).toBe("");
});
it("retains an unsaved draft on revision conflict and allows cancelling", async () => {
  api.revise.mockRejectedValueOnce(Error("configuration conflict")); await mount(); await click(button("Edit configuration")); await fill("channel-name", "Keep this draft");
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); await flush();
  expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect((host.querySelector("#channel-name") as HTMLInputElement).value).toBe("Keep this draft");
  await click(button("Cancel")); expect((host.querySelector("#channel-name") as HTMLInputElement).value).toBe(""); expect(api.revise).toHaveBeenCalledTimes(1);
});
it("opens revision history read-only and scopes the lookup to the selected company", async () => {
  api.history.mockResolvedValueOnce([{ id: "revision-1", companyId: "company-a", endpointId: "endpoint-1", configVersion: 1, actorId: "fixture-admin", createdAt: "2026-10-25T00:00:00Z", snapshot: { ...data().endpoints[0] } }]);
  await mount(); await click(button("Configuration history"));
  expect(api.history).toHaveBeenCalledWith("company-a", "endpoint-1"); expect(host.textContent).toContain("fixture-admin"); expect(api.test).not.toHaveBeenCalled();
  company.selectedCompanyId = "company-b"; client.setQueryData(["mimouse-notifications", "company-b"], data()); await mount(); expect(host.textContent).not.toContain("fixture-admin");
});
it.each([["en", "Edit configuration"], ["zh-CN", "编辑配置"], ["es", "Editar configuración"], ["ja", "設定を編集"]])("renders revision controls in %s", async (locale, label) => {
  await i18n.changeLanguage(locale); await mount(); await click(button(label)); expect(host.querySelector('[role="status"]')?.textContent).toContain("1");
});


it("records an observation only after explicit confirmation without retrying a delivery", async () => {
  await mount(); await click(button("Record delivery observation"));
  const save = button("Save observation") as HTMLButtonElement; expect(save.disabled).toBe(true);
  await act(async () => { const input = host.querySelector("#delivery-review-evidence")!; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Checked the provider console fixture"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(save.disabled).toBe(true); await click(host.querySelector('input[type="checkbox"]')); expect(save.disabled).toBe(false); await click(save);
  expect(api.review).toHaveBeenCalledWith("company-a", "delivery-1", expect.objectContaining({ confirm: true, outcome: "unknown", evidence: "Checked the provider console fixture", expectedState: "indeterminate", expectedAttempt: 1 }));
  expect(api.retry).not.toHaveBeenCalled(); expect(api.test).not.toHaveBeenCalled(); expect(api.toggle).not.toHaveBeenCalled();
});
it("clears the selected observation when switching company", async () => {
  await mount(); await click(button("Record delivery observation")); expect(host.querySelector("#delivery-review-evidence")).not.toBeNull();
  company.selectedCompanyId = "company-b"; client.setQueryData(["mimouse-notifications", "company-b"], data()); await mount(); expect(host.querySelector("#delivery-review-evidence")).toBeNull(); expect(api.review).not.toHaveBeenCalled();
});

async function fillPolicy(value: string) {
  await act(async () => {
    const input = host.querySelector('input[aria-label="Exact duplicate window (seconds, 0–300)"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("saves policy alone without enabling, testing or retrying and rejects out-of-range windows", async () => {
  await mount(); await fillPolicy("301"); expect((button("Save notification policy") as HTMLButtonElement).disabled).toBe(true);
  await fillPolicy("30"); await click(button("Save notification policy"));
  expect(api.policy).toHaveBeenCalledWith("company-a", "subscription-1", { minimumSeverity: "info", mergeWindowSeconds: 30, expectedVersion: 1 });
  expect(api.toggle).not.toHaveBeenCalled(); expect(api.subscribe).not.toHaveBeenCalled(); expect(api.test).not.toHaveBeenCalled(); expect(api.retry).not.toHaveBeenCalled();
});
it("keeps a policy draft on failure for explicit retry and resets it on company switch", async () => {
  api.policy.mockRejectedValueOnce(Error("policy unavailable")); await mount(); await fillPolicy("40"); await click(button("Save notification policy"));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect((host.querySelector('input[aria-label="Exact duplicate window (seconds, 0–300)"]') as HTMLInputElement).value).toBe("40");
  await click(button("Save notification policy")); expect(api.policy).toHaveBeenCalledTimes(2);
  company.selectedCompanyId = "company-b"; client.setQueryData(["mimouse-notifications", "company-b"], data()); await mount();
  expect((host.querySelector('input[aria-label="Exact duplicate window (seconds, 0–300)"]') as HTMLInputElement).value).toBe("0");
  expect(api.test).not.toHaveBeenCalled();
});
it("shows delayed, merged and filtered ledger rows without retry controls", async () => {
  const state = data(); client.setQueryData(["mimouse-notifications", "company-a"], { ...state, deliveries: [
    { ...state.deliveries[0], id: "leader", state: "pending", mergeUntil: new Date(Date.now() + 60000).toISOString() },
    { ...state.deliveries[0], id: "follower", state: "merged", mergedInto: "leader" },
    { ...state.deliveries[0], id: "filtered", state: "filtered" },
  ] });
  await mount(); expect(host.textContent).toContain("Collecting exact duplicates until"); expect(host.textContent).toContain("Merged exact duplicate"); expect(host.textContent).toContain("Filtered by severity");
  expect(host.querySelector('a[href="#notification-delivery-leader"]')).not.toBeNull();
  expect(button("Review before retrying")).toBeNull(); expect(api.retry).not.toHaveBeenCalled();
});
it.each([["en", "Notification policy", "always bypass"], ["zh-CN", "通知策略", "始终绕过"], ["es", "Política de notificaciones", "nunca se filtran"], ["ja", "通知ポリシー", "常にフィルター"]])("localizes severity policy and critical guard in %s", async (locale, title, guard) => {
  await i18n.changeLanguage(locale); await mount(); expect(host.textContent).toContain(title); expect(host.textContent).toContain(guard); expect(host.textContent).not.toContain("notificationPolicy.");
});

it("preserves the conflicting policy draft through polls and requires explicit reload before another write", async () => {
  api.policy.mockRejectedValueOnce(Object.assign(Error("conflict"), { status: 409 })); await mount(); await fillPolicy("40"); await click(button("Save notification policy"));
  expect(host.textContent).toContain("Your draft is preserved"); expect((button("Save notification policy") as HTMLButtonElement).disabled).toBe(true);
  const fresh = { ...data(), subscriptions: [{ ...data().subscriptions[0], policyVersion: 2, policy: { minimumSeverity: "warning", mergeWindowSeconds: 20 } }] };
  await act(async () => { client.setQueryData(["mimouse-notifications", "company-a"], fresh); });
  expect((host.querySelector('input[aria-label="Exact duplicate window (seconds, 0–300)"]') as HTMLInputElement).value).toBe("40");
  expect(api.policy).toHaveBeenCalledTimes(1); api.get.mockResolvedValue(fresh);
  await click(button("Discard draft and reload policy")); expect((host.querySelector('input[aria-label="Exact duplicate window (seconds, 0–300)"]') as HTMLInputElement).value).toBe("20");
  await fillPolicy("25"); await click(button("Save notification policy"));
  expect(api.policy).toHaveBeenLastCalledWith("company-a", "subscription-1", { minimumSeverity: "warning", mergeWindowSeconds: 25, expectedVersion: 2 });
  expect(api.toggle).not.toHaveBeenCalled(); expect(api.test).not.toHaveBeenCalled(); expect(api.retry).not.toHaveBeenCalled();
});
