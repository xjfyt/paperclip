// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { MimouseNotifications } from "./MimouseNotifications";
const company = vi.hoisted(() => ({ selectedCompanyId: "company-a" }));
const api = vi.hoisted(() => Object.fromEntries(["get", "create", "toggle", "subscribe", "toggleSubscription", "preview", "retry", "test"].map(key => [key, vi.fn()])));
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => company }));
vi.mock("@/api/mimouse-notifications", () => ({ notificationApi: api }));
const data = () => ({ enabled: true, dispatchEnabled: true, connectedEvents: ["approval.requested", "run.failed", "coding.mr_ready", "coding.ci_failed", "coding.artifact_ready", "budget.threshold_reached"], unconnectedEvents: [], endpoints: [{ id: "endpoint-1", name: "Test channel", kind: "wecom_webhook", enabled: true, config: {}, secretRef: "11111111-1111-4111-8111-111111111111", secretVersion: 1 }], subscriptions: [{ id: "subscription-1", endpointId: "endpoint-1", eventType: "run.failed", locale: "en", enabled: true }], deliveries: [{ id: "delivery-1", endpointId: "endpoint-1", state: "indeterminate", attempt: 1, lastCode: "transport_unconfirmed", createdAt: "2026-10-25T00:00:00Z" }] });
let host: HTMLDivElement, root: Root, client: QueryClient;
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
async function mount() { await act(async () => root.render(<QueryClientProvider client={client}><MimouseNotifications /></QueryClientProvider>)); await flush(); }
async function click(element: Element | null) { expect(element).not.toBeNull(); await act(async () => { element!.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); }
function button(text: string) { return [...host.querySelectorAll("button")].find(item => item.textContent === text) ?? null; }
async function fill(id: string, value: string) { await act(async () => { const input = host.querySelector(`#${id}`)!; const proto = input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value); input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true })); }); }
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  company.selectedCompanyId = "company-a"; await i18n.changeLanguage("en"); vi.clearAllMocks();
  for (const fn of Object.values(api)) fn.mockResolvedValue({}); api.get.mockImplementation(async () => data());
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
