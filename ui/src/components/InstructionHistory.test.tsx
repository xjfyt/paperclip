// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InstructionHistory } from "./InstructionHistory";
import { i18n, instructionHistoryMessages } from "../i18n/instruction-history-test-resources";
import { validateLocaleMessages } from "../i18n/locale-validation";
const api = vi.hoisted(() => ({ history: vi.fn(), diff: vi.fn(), restore: vi.fn(), restored: vi.fn() }));
vi.mock("../api/agents", () => ({ agentsApi: { instructionHistory: api.history, instructionDiff: api.diff, restoreInstructions: api.restore } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const locales = ["en", "zh-CN", "es", "ja"] as const;
const revision = { id: "original-revision-id", source: "raw/provider source", createdAt: "2026-01-02T03:04:00Z" };
const comparison = { from: { content: "User instruction 原文 <script>text</script>" }, removed: "raw removed", added: "raw added" };
const props = { agentId: "agent-original", companyId: "company-original", path: "/raw/指令.md", currentRevisionId: "current-revision", disabled: false, onRestored: api.restored };
let container: HTMLDivElement; let root: Root; let client: QueryClient;
const t = (key: string) => i18n.t(`instructionHistoryUi.${key}`);
beforeEach(async () => {
  await i18n.changeLanguage("en"); Object.values(api).forEach(mock => mock.mockReset());
  api.history.mockResolvedValue({ revisions: [revision], nextCursor: "raw-cursor" }); api.diff.mockResolvedValue(comparison); api.restore.mockResolvedValue({ path: props.path });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); await i18n.changeLanguage("en"); });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount(next = props) { await act(async () => root.render(<QueryClientProvider client={client}><InstructionHistory {...next} /></QueryClientProvider>)); await flush(); }
function button(text: string) { const el = [...container.querySelectorAll("button")].find(el => el.textContent === text); expect(el).toBeDefined(); return el!; }
async function click(text: string) { await act(async () => button(text).click()); await flush(); }
async function language(locale: string) { await act(async () => { await i18n.changeLanguage(locale); }); }
async function waitFor(check: () => void) { await vi.waitFor(async () => { await flush(); check(); }); }
it.each(locales)("validates instruction history strings in %s", locale => { expect(validateLocaleMessages(instructionHistoryMessages[locale], instructionHistoryMessages.en)).toEqual([]); });
it.each(locales)("retains selection, raw instruction bytes and exact restore payload across %s", async locale => {
  await mount(); await click(t("history")); await waitFor(() => expect(container.textContent).toContain(revision.source)); await click(revision.id.slice(0, 8));
  await waitFor(() => expect(container.querySelector("pre")?.textContent).toBe(comparison.from.content));
  const selection = button(revision.id.slice(0, 8)); selection.focus(); await language(locale);
  expect(document.activeElement).toBe(selection); expect(container.querySelector("pre")?.textContent).toBe(comparison.from.content); expect(container.querySelector("script")).toBeNull();
  expect(container.textContent).toContain(t("changes")); expect(container.textContent).toContain(revision.source);
  expect(api.diff).toHaveBeenCalledExactlyOnceWith(props.agentId, props.path, revision.id, props.currentRevisionId, props.companyId);
  expect(api.restore).not.toHaveBeenCalled(); await click(t("restore"));
  await waitFor(() => expect(api.restore).toHaveBeenCalledExactlyOnceWith(props.agentId, { path: props.path, revisionId: revision.id, baseRevisionId: props.currentRevisionId }, props.companyId));
});
it.each(locales)("retries only a failed history read and keeps its cached pages in %s", async locale => {
  await language(locale); await mount(); await click(t("history")); await waitFor(() => expect(container.textContent).toContain(revision.source));
  api.history.mockRejectedValueOnce(new Error("Raw diagnostic <error>")); await click(t("older"));
  await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("Raw diagnostic <error>"));
  expect(container.textContent).toContain(revision.source); expect(container.textContent).toContain(t("historyFailed"));
  const count = api.history.mock.calls.length; await language(locale === "ja" ? "es" : "ja"); expect(api.history).toHaveBeenCalledTimes(count);
  api.history.mockResolvedValueOnce({ revisions: [], nextCursor: null }); await click(t("retryHistory"));
  await waitFor(() => expect(api.history).toHaveBeenCalledTimes(count + 1));
  expect(api.history).toHaveBeenLastCalledWith(props.agentId, props.path, props.companyId, "raw-cursor"); expect(container.textContent).toContain(revision.source);
  expect(api.diff).not.toHaveBeenCalled(); expect(api.restore).not.toHaveBeenCalled();
});
it.each(locales)("retries only the selected comparison in %s", async locale => {
  api.diff.mockRejectedValueOnce(new Error("Raw comparison diagnostic")); await language(locale); await mount(); await click(t("history"));
  await waitFor(() => expect(container.textContent).toContain(revision.source)); await click(revision.id.slice(0, 8));
  await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain(t("diffFailed")));
  await language(locale === "ja" ? "zh-CN" : "ja"); await click(t("retryDiff"));
  await waitFor(() => expect(container.querySelector("pre")?.textContent).toBe(comparison.from.content));
  expect(api.diff).toHaveBeenCalledTimes(2); expect(api.diff).toHaveBeenLastCalledWith(props.agentId, props.path, revision.id, props.currentRevisionId, props.companyId);
  expect(api.history).toHaveBeenCalledTimes(1); expect(api.restore).not.toHaveBeenCalled();
});
it("does not carry a selected revision into a different resource", async () => {
  await mount(); await click(t("history")); await waitFor(() => expect(container.textContent).toContain(revision.source)); await click(revision.id.slice(0, 8));
  await waitFor(() => expect(api.diff).toHaveBeenCalledTimes(1)); await mount({ ...props, path: "/different/file.md" });
  expect(api.diff).toHaveBeenCalledTimes(1); expect(api.restore).not.toHaveBeenCalled(); expect(container.querySelector("pre")).toBeNull();
});
it.each(locales)("does not present a failed initial history read as an empty result in %s", async locale => {
  api.history.mockRejectedValueOnce("non-Error diagnostic"); await language(locale); await mount(); await click(t("history"));
  await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain(t("historyFailed")));
  expect(container.textContent).not.toContain(t("empty")); await click(t("retryHistory"));
  await waitFor(() => expect(container.textContent).toContain(revision.source));
  expect(api.history).toHaveBeenCalledTimes(2); expect(api.history).toHaveBeenLastCalledWith(props.agentId, props.path, props.companyId, undefined);
  expect(api.restore).not.toHaveBeenCalled(); expect(api.diff).not.toHaveBeenCalled();
});
