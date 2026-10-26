// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, RoutineVariable } from "@paperclipai/shared";
import { i18n } from "../i18n";
import en from "../i18n/contributions/stabilizationUi/en.json";
import zh from "../i18n/contributions/stabilizationUi/zh-CN.json";
import es from "../i18n/contributions/stabilizationUi/es.json";
import ja from "../i18n/contributions/stabilizationUi/ja.json";
import { RoutineRunVariablesDialog } from "./RoutineRunVariablesDialog";
import { RoutineVariablesEditor, RoutineVariablesHint } from "./RoutineVariablesEditor";
import { RoutineSaveBar, RoutineReadOnlyStrip } from "./RoutineSaveBar";
vi.mock("../api/instanceSettings", () => ({ instanceSettingsApi: { getExperimental: vi.fn(async () => ({ enableIsolatedWorkspaces: false })) } }));
vi.mock("./IssueWorkspaceCard", () => ({ IssueWorkspaceCard: () => null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); await i18n.changeLanguage("en"); });
const languages = [["en", en], ["zh-CN", zh], ["es", es], ["ja", ja]] as const;
const agent = { id: "agent-original", name: "原始 Agent Ω", status: "idle", role: "engineer", adapterType: "process" } as Agent;
const variable: RoutineVariable = { name: "releaseOn", label: "客户日期 Ω", type: "date", defaultValue: "2026-10-26", required: true, options: [] };
const button = (label: string) => Array.from(document.querySelectorAll("button")).find(b => b.textContent === label)!;
async function language(locale: string) { await act(async () => { await i18n.changeLanguage(locale); }); }

describe.each(languages)("routine workflow in %s", (locale, strings) => {
  it("has actual resource values for every contribution key, not key fallback", async () => {
    await language(locale);
    for (const [key, value] of Object.entries(strings)) {
      expect(i18n.getResource(locale, "translation", `stabilizationUi.${key}`)).toBe(value);
      expect(i18n.t(`stabilizationUi.${key}`, { count: 2, names: "原文", placeholder: "{{variable_name}}" })).not.toBe(`stabilizationUi.${key}`);
    }
  });
  it("renders run configuration and submits original IDs and date without changing routine defaults", async () => {
    await language(locale);
    const onSubmit = vi.fn(); const onOpenChange = vi.fn();
    const props = { open: true, onOpenChange, companyId: "company-original", routineName: "客户例行任务 Ω", projects: [], agents: [agent], defaultAssigneeAgentId: agent.id, variables: [variable], isPending: false, onSubmit };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const render = async (isPending: boolean) => act(async () => root.render(<QueryClientProvider client={client}><RoutineRunVariablesDialog {...props} isPending={isPending} /></QueryClientProvider>));
    await render(false);
    expect(document.body.textContent).toContain(strings.runDescription);
    expect(document.body.textContent).toContain("客户例行任务 Ω");
    expect(document.body.textContent).toContain("原始 Agent Ω");
    expect(document.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe("2026-10-26");
    await act(async () => button(strings.run).click());
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ variables: { releaseOn: "2026-10-26" }, assigneeAgentId: agent.id, projectId: null });
    await render(true);
    expect(button(strings.running).disabled).toBe(true);
    await act(async () => button(strings.running).click());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    client.clear();
  });
  it("keeps missing input and agent guards localized and non-submitting", async () => {
    await language(locale);
    const onSubmit = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const variables = [{ ...variable, defaultValue: null }];
    const render = async (defaultAssigneeAgentId: string) => act(async () => root.render(<QueryClientProvider client={client}><RoutineRunVariablesDialog open onOpenChange={vi.fn()} companyId="company-original" projects={[]} agents={[agent]} defaultAssigneeAgentId={defaultAssigneeAgentId} variables={variables} isPending={false} onSubmit={onSubmit} /></QueryClientProvider>));
    await render(agent.id);
    expect(document.body.textContent).toContain(strings.missing.replace("{{names}}", "客户日期 Ω"));
    expect(button(strings.run).disabled).toBe(true);
    await act(async () => button(strings.run).click());
    expect(onSubmit).not.toHaveBeenCalled();
    await render("");
    expect(document.body.textContent).toContain(strings.agentRequired);
    expect(button(strings.run).disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    client.clear();
  });
  it("renders variable editor and help while retaining placeholders, labels and UTC semantics", async () => {
    await language(locale); const onChange = vi.fn();
    await act(async () => root.render(<><RoutineVariablesEditor title="计划 {{releaseOn}}" description="" value={[variable]} onChange={onChange} /><RoutineVariablesHint /></>));
    expect(host.textContent).toContain(strings.variables);
    expect(host.textContent).toContain(strings.required);
    expect(host.textContent).toContain("{{releaseOn}}");
    expect(host.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe("2026-10-26");
    expect(Array.from(host.querySelectorAll("input")).some(i => i.value === "客户日期 Ω")).toBe(true);
    await act(async () => document.querySelector<HTMLButtonElement>(`button[aria-label="${strings.help}"]`)!.click());
    expect(document.body.textContent).toContain(strings.helpTitle);
    expect(document.body.textContent).toContain(strings.dateDescription);
    expect(document.body.textContent).toContain(strings.timestampDescription);
    expect(document.body.textContent).toContain("{{variable_name}}");
    expect(document.body.textContent).not.toContain("stabilizationUi.");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("renders discard confirmation, keeps editing, and preserves conflict retry callbacks", async () => {
    await language(locale);
    const onSave = vi.fn(), onDiscard = vi.fn(), onReload = vi.fn();
    const props = { dirtyFields: [{ key: "title", label: "客户标题 Ω" }], isSaving: false, saveConflict: false, onSave, onDiscard, onReload };
    await act(async () => root.render(<RoutineSaveBar {...props} />));
    expect(host.textContent).toContain(strings.unsaved_one.replace("{{count}}", "1"));
    await act(async () => button(strings.discard).click());
    expect(document.body.textContent).toContain(strings.discardTitle);
    expect(document.body.textContent).toContain(strings.discardDescription_one.replace("{{count}}", "1"));
    await act(async () => button(strings.keepEditing).click());
    expect(onDiscard).not.toHaveBeenCalled();
    await act(async () => root.render(<><RoutineSaveBar {...props} saveConflict /><RoutineReadOnlyStrip /></>));
    expect(host.textContent).toContain(strings.conflict);
    expect(host.textContent).toContain(strings.readOnly);
    await act(async () => button(strings.reload).click());
    expect(onReload).toHaveBeenCalledTimes(1);
    await act(async () => button(strings.overwrite).click());
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

it("switches language without resetting typed values or submitting composition Enter", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSubmit = vi.fn(); const variables = [{ ...variable, type: "text" as const, defaultValue: "" }];
  await act(async () => root.render(<QueryClientProvider client={client}><RoutineRunVariablesDialog open onOpenChange={vi.fn()} companyId="company-original" projects={[]} agents={[agent]} defaultAssigneeAgentId={agent.id} variables={variables} isPending={false} onSubmit={onSubmit} /></QueryClientProvider>));
  const input = document.querySelector<HTMLInputElement>('input[type="text"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "入力中 Ω"); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })); });
  await language("ja");
  expect(input.value).toBe("入力中 Ω");
  expect(onSubmit).not.toHaveBeenCalled();
  await act(async () => button(ja.run).click());
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ variables: { releaseOn: "入力中 Ω" }, assigneeAgentId: agent.id, projectId: null });
  client.clear();
});
