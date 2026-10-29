// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { AgentSkillsTab } from "./AgentSkillsTab";
import { TooltipProvider } from "../../components/ui/tooltip";
import { i18n, agentSkillsMessages } from "../../i18n/agent-skills-test-resources";
import { validateLocaleMessages } from "../../i18n/locale-validation";
import { queryKeys } from "../../lib/queryKeys";
const api = vi.hoisted(() => ({ skills: vi.fn(), library: vi.fn(), sync: vi.fn() }));
vi.mock("../../api/agents", () => ({ agentsApi: { skills: api.skills, syncSkills: api.sync } }));
vi.mock("../../api/companySkills", () => ({ companySkillsApi: { list: api.library } }));
vi.mock("../../api/instanceSettings", () => ({ instanceSettingsApi: { getExperimental: async () => ({ enableBetaSkills: false }) } }));
vi.mock("../../components/agent-config-primitives", () => ({ adapterLabels: { codex_local: "Codex CLI" } }));
vi.mock("@/lib/router", async () => await import("react-router-dom"));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const locales = ["en", "zh-CN", "es", "ja"] as const;
const agent = { id: "agent-original", urlKey: "agent-route", companyId: "company-original", adapterType: "codex_local", adapterConfig: {} } as Agent;
const key = "raw/provider/技能";
const snapshot = { adapterType: "codex_local", supported: true, mode: "ephemeral", desiredSkills: [key], entries: [], warnings: [] };
const library = [{ id: "skill-original", key, name: "Original 技能", description: "User prose <raw>", categories: ["raw category"], sourceKind: "local", sourceType: "local", sourceLabel: "/raw/path" }];
let root: Root; let container: HTMLDivElement; let client: QueryClient;
const t = (key: string) => i18n.t(`agentSkillsUi.${key}`);
beforeEach(async () => {
  await i18n.changeLanguage("en"); Object.values(api).forEach(mock => mock.mockReset());
  api.skills.mockResolvedValue(snapshot); api.library.mockResolvedValue(library); api.sync.mockImplementation(async (_id, keys) => ({ ...snapshot, desiredSkills: keys }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); await i18n.changeLanguage("en"); });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function mount() { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><TooltipProvider><AgentSkillsTab agent={agent} companyId={agent.companyId} /></TooltipProvider></MemoryRouter></QueryClientProvider>)); await flush(); }
async function click(text: string) { const button = [...container.querySelectorAll("button")].find(el => el.textContent === text); expect(button).toBeDefined(); await act(async () => button!.click()); await flush(); }
async function language(locale: string) { await act(async () => { await i18n.changeLanguage(locale); }); }
async function waitFor(check: () => void) { await vi.waitFor(async () => { await flush(); check(); }); }
it.each(locales)("validates skill strings in %s", locale => { expect(validateLocaleMessages(agentSkillsMessages[locale], agentSkillsMessages.en)).toEqual([]); });
it.each(locales)("retains real skill rows, search focus and exact sync payload across %s", async locale => {
  await mount(); await waitFor(() => expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true"));
  const input = container.querySelector("input")!; input.focus();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Original"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await language(locale);
  expect(container.querySelector("input")).toBe(input); expect(document.activeElement).toBe(input); expect(input.value).toBe("Original");
  expect(input.getAttribute("placeholder")).toBe(t("search")); expect(container.textContent).toContain("Original 技能");
  expect(container.querySelector('a[href="/skills/skill-original"]')).not.toBeNull();
  expect(api.skills).toHaveBeenCalledExactlyOnceWith(agent.id, agent.companyId); expect(api.library).toHaveBeenCalledExactlyOnceWith(agent.companyId); expect(api.sync).not.toHaveBeenCalled();
  const toggle = container.querySelector<HTMLButtonElement>('[role="switch"]')!;
  expect(toggle.getAttribute("aria-label")).toBe(i18n.t("agentSkillsUi.disableSkill", { name: "Original 技能" }));
  await act(async () => toggle.click()); await language(locale === "ja" ? "zh-CN" : "ja");
  await waitFor(() => expect(api.sync).toHaveBeenCalledExactlyOnceWith(agent.id, [], "replace", agent.companyId));
});
it.each(locales.flatMap(locale => ["skills", "library"].map(source => ({ locale, source }))))("does not mistake a $source read failure for empty, missing or saved in $locale", async ({ locale, source }) => {
  api[source as "skills" | "library"].mockRejectedValueOnce(new Error("Original diagnostic <raw>")); await language(locale); await mount();
  await waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain("Original diagnostic <raw>"));
  expect(container.textContent).not.toContain(t("empty")); expect(container.textContent).not.toContain(t("missing")); expect(container.textContent).not.toContain(t("saved"));
  const counts = [api.skills.mock.calls.length, api.library.mock.calls.length];
  await language(locale === "ja" ? "es" : "ja"); expect([api.skills.mock.calls.length, api.library.mock.calls.length]).toEqual(counts);
  await click(t(source === "skills" ? "retrySnapshot" : "retryLibrary"));
  await waitFor(() => expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true"));
  expect(api[source as "skills" | "library"]).toHaveBeenCalledTimes(2); expect(api[source === "skills" ? "library" : "skills"]).toHaveBeenCalledTimes(1); expect(api.sync).not.toHaveBeenCalled();
});
it("keeps cached rows visible and read-only when a library refresh fails", async () => {
  await mount(); await waitFor(() => expect(container.textContent).toContain("Original 技能")); api.library.mockRejectedValueOnce(new Error("raw refresh error"));
  await act(async () => { await client.refetchQueries({ queryKey: queryKeys.companySkills.list(agent.companyId) }); }); await flush();
  expect(container.textContent).toContain("Original 技能"); expect(container.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true);
  expect(container.textContent).not.toContain(t("missing")); expect(container.textContent).not.toContain(t("saved")); expect(api.sync).not.toHaveBeenCalled();
});
it.each(locales)("opts into source display without translating provider-authored labels in %s", async locale => {
  const { buildAgentSkillSourceMeta } = await import("./agent-skill-source");
  await language(locale);
  const source = { sourceType: "catalog", sourceLabel: null } as Parameters<typeof buildAgentSkillSourceMeta>[0];
  expect(buildAgentSkillSourceMeta(source).label).toBe("Catalog");
  expect(buildAgentSkillSourceMeta(source, { display: true }).label).toBe(t("sourceCatalog"));
  expect(buildAgentSkillSourceMeta({ ...source, sourceLabel: "Catalog" }, { display: true }).label).toBe("Catalog");
});
