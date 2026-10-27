// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Terminal } from "lucide-react";
import { i18n } from "@/i18n";
import { toolActivityMessages } from "@/i18n/tool-activity-test-resources";
import { validateLocaleMessages } from "@/i18n/locale-validation";
import { MemoryRouter } from "@/lib/router";
import { ThemeProvider } from "@/context/ThemeContext";
import { TaskChatRunnerActivityGroup } from "./TaskChatRunnerActivityGroup";
import { TaskChatProtocolActivityRow } from "./TaskChatProtocolActivityRow";
import { TaskChatExpansionState } from "./expansion-state";
import { providerActivityPresentation } from "./task-chat-activity-presentation";
import { toolActivityDisplayLabels } from "./tool-activity-display";
import { humanizeToolName, toolActivityCopyDescriptor, toolActivityPresentation, toolTaxonomy,
  type ToolActivityCopyDescriptor, type ToolActivityPresentationInput } from "./tool-taxonomy";
import type { TaskChatProviderActivityItem, TaskChatToolItem } from "./task-chat-model";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const exactExamples = [
  ["apply_patch", "exact_apply_patch"],
  ["read", "exact_read"],
  ["write", "exact_write"],
  ["edit", "exact_edit"],
  ["notebook_read", "exact_notebook_read"],
  ["notebook_edit", "exact_notebook_edit"],
  ["glob", "exact_glob"],
  ["grep", "exact_grep"],
  ["tool_search", "exact_tool_search"],
  ["web_search", "exact_web_search"],
  ["web_fetch", "exact_web_fetch"],
  ["todo_write", "exact_todo_write"],
  ["task_create", "exact_task_create"],
  ["task_update", "exact_task_update"],
  ["task_list", "exact_task_list"],
  ["task_get", "exact_task_get"],
  ["enter_plan_mode", "exact_enter_plan_mode"],
  ["exit_plan_mode", "exact_exit_plan_mode"],
  ["skill", "exact_skill"],
  ["ask_user_question", "exact_ask_user_question"],
  ["request_human_input", "exact_ask_user_question"],
  ["agent", "exact_agent"],
  ["task", "exact_agent"],
  ["task_output", "exact_task_output"],
  ["task_stop", "exact_task_stop"],
  ["send_message", "exact_send_message"],
  ["spawn_agent", "exact_agent"],
  ["wait_agent", "exact_task_output"],
  ["wait_threads", "exact_wait_threads"],
  ["interrupt_agent", "exact_interrupt_agent"],
  ["report_findings", "exact_report_findings"],
  ["guardian_review", "exact_guardian_review"],
  ["lsp", "exact_lsp"],
  ["compact_conversation", "exact_compact_conversation"],
  ["image_generation", "exact_image_generation"],
  ["view_image", "exact_view_image"],
  ["multi_tool_use_parallel", "exact_multi_tool_use_parallel"],
  ["get_task_context", "exact_get_task_context"],
  ["get_task_history", "exact_get_task_history"],
  ["list_documents", "exact_list_documents"],
  ["read_document", "exact_read_document"],
  ["list_document_revisions", "exact_list_document_revisions"],
  ["report_progress", "exact_report_progress"],
  ["answer_status_question", "exact_answer_status_question"],
  ["write_document", "exact_write_document"],
  ["register_deliverable", "exact_register_deliverable"],
  ["finish_task", "exact_finish_task"],
  ["paperclip_finish", "exact_finish_task"],
  ["block_task", "exact_block_task"],
  ["paperclip_block", "exact_block_task"],
  ["request_review", "exact_request_review"],
  ["list_agents", "exact_list_agents"],
  ["get_agent", "exact_get_agent"],
  ["search_tasks", "exact_search_tasks"],
  ["list_approvals", "exact_list_approvals"],
  ["get_approval", "exact_get_approval"],
  ["get_approval_context", "exact_get_approval_context"],
  ["get_workspace_runtime", "exact_get_workspace_runtime"],
  ["control_workspace_service", "exact_control_workspace_service"],
  ["set_dependencies", "exact_set_dependencies"],
  ["set_task_title", "exact_set_task_title"],
  ["create_task", "exact_task_create"],
  ["request_approval", "exact_request_approval"],
  ["decide_approval", "exact_decide_approval"],
  ["comment_on_approval", "exact_comment_on_approval"],
  ["schedule_wake", "exact_schedule_wake"],
  ["generic_api_request", "exact_generic_api_request"],
] as const;
const actionExamples = [
  ["read", "get"], ["list", "list"], ["search", "search"], ["fetch", "fetch"],
  ["open", "open"], ["update", "update"], ["create", "create"], ["delete", "delete"],
  ["move", "move"], ["run", "execute"], ["request", "request"], ["post", "send"],
  ["start", "start"], ["stop", "stop"], ["wait", "wait"], ["finish", "finish"],
  ["block", "block"], ["think", "think"], ["switch", "switch"],
] as const;
const canonicalKeys = ["icon", "family", "runningLabel", "completedLabel", "failedLabel", "interruptedLabel", "displayName", "sourceLabel", "technicalName", "confidence", "summaryGroup"].sort();

let root: Root;
let container: HTMLDivElement;
let memory: Map<string, boolean>;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container); memory = new Map();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); await i18n.changeLanguage("en"); });
async function render(children: ReactNode) {
  await act(async () => root.render(<MemoryRouter><ThemeProvider><TaskChatExpansionState.Provider value={memory}>{children}</TaskChatExpansionState.Provider></ThemeProvider></MemoryRouter>));
}

it.each(Object.entries(toolActivityMessages))("covers every owned descriptor and preserves the complete canonical contract in %s", async (locale, messages) => {
  expect(validateLocaleMessages(messages, toolActivityMessages.en)).toEqual([]);
  expect(Object.keys(messages)).toHaveLength(193);
  const copy: Record<string, string> = messages;
  const english: Record<string, string> = toolActivityMessages.en;
  const cases: Array<{ input: ToolActivityPresentationInput; prefix: string; descriptor: ToolActivityCopyDescriptor; object?: string; name?: string }> =
    exactExamples.map(([name, prefix]) => ({ input: { name }, prefix, descriptor: { kind: "exact", key: name } }));
  for (const [action, verb] of actionExamples) {
    cases.push({ input: { name: verb }, prefix: `action_${action}_default`, descriptor: { kind: "action", action, object: undefined } });
    const ignoresObject = ["run", "wait", "finish", "block", "think"].includes(action);
    cases.push({ input: { name: `${verb}_vendor_records` }, prefix: `action_${action}_${ignoresObject ? "default" : "object"}`,
      descriptor: { kind: "action", action, object: "vendor records" }, object: "vendor records" });
  }
  cases.push(
    { input: { name: "VendorFuture_Ω" }, prefix: "named", descriptor: { kind: "named", name: "Vendor future" }, name: "Vendor future" },
    { input: { name: "tool (pending)" }, prefix: "unnamed", descriptor: { kind: "unnamed" } },
    { input: {}, prefix: "unnamed", descriptor: { kind: "unnamed" } },
    { input: { name: "Read file '/tmp/private.json'", operation: "read" }, prefix: "action_read_default", descriptor: { kind: "action", action: "read", object: undefined } },
    { input: { name: "read_vendor_records", operation: "search" }, prefix: "action_search_object", descriptor: { kind: "action", action: "search", object: "vendor records" }, object: "vendor records" },
  );
  const before = cases.map(({ input }) => toolActivityPresentation(input));
  await act(async () => { await i18n.changeLanguage(locale); });
  cases.forEach(({ input, prefix, descriptor, object, name }, index) => {
    const interpolate = (value: string) => value.replace("{{object}}", object ?? "").replace("{{name}}", name ?? "");
    expect(toolActivityCopyDescriptor(input)).toEqual(descriptor);
    expect(toolActivityPresentation(input)).toEqual(before[index]);
    expect(Object.keys(before[index]).sort()).toEqual(canonicalKeys);
    expect(before[index].runningLabel).toBe(interpolate(english[`${prefix}_running`]));
    expect(before[index].completedLabel).toBe(interpolate(english[`${prefix}_completed`]));
    const runningLabel = interpolate(copy[`${prefix}_running`]);
    const completedLabel = interpolate(copy[`${prefix}_completed`]);
    expect(toolActivityDisplayLabels(input)).toEqual({ runningLabel, completedLabel,
      failedLabel: copy.failed.replace("{{activity}}", completedLabel), interruptedLabel: copy.interrupted.replace("{{activity}}", runningLabel) });
  });
  expect(toolActivityPresentation({ name: "exec_command" })).toEqual({
    icon: Terminal, family: "terminal", runningLabel: "Running a command", completedLabel: "Ran a command",
    failedLabel: "Ran a command · failed", interruptedLabel: "Running a command · stopped", displayName: "Exec command",
    sourceLabel: undefined, technicalName: "exec_command", confidence: "exact", summaryGroup: { key: "command", singular: "command", plural: "commands" },
  });
  for (const name of ["SearchIssues", "search_issues", "search-issues", "search.issues", "mcp.linear.search_issues", "mcp__linear__search_issues"]) {
    expect(toolActivityCopyDescriptor({ name })).toEqual({ kind: "action", action: "search", object: "issues" });
    expect(toolActivityPresentation({ name }).runningLabel).toBe("Searching issues");
    expect(humanizeToolName(name)).toBe("Search issues");
    expect(toolTaxonomy(name).verbLabel).toBe("Searching issues");
  }
  expect(toolActivityPresentation({ name: "mcp.paperclip.set_task_title" }).summaryGroup.key).toBe("task_operation");
  expect(toolActivityPresentation({ name: "apply_patch" }).summaryGroup.key).toBe("file_change");
});

const rawTarget = "/workspace/用户/{{raw}}.json";
const samples = [
  ["exec_command", "action_run_default", undefined], ["NotebookEdit", "exact_notebook_edit", undefined],
  ["mcp__paperclip__set_task_title", "exact_set_task_title", undefined],
  ["search_vendor_records", "action_search_object", "vendor records"],
  ["vendorFuture_Ω", "named", "Vendor future"], ["tool", "unnamed", undefined],
] as const;
const states = ["running", "completed", "failed", "interrupted"] as const;
function expectedLabel(copy: Record<string, string>, prefix: string, state: typeof states[number], value?: string) {
  const phase = state === "failed" || state === "completed" ? "completed" : "running";
  const activity = copy[`${prefix}_${phase}`].replace("{{object}}", value ?? "").replace("{{name}}", value ?? "");
  return state === "failed" || state === "interrupted" ? copy[state].replace("{{activity}}", activity) : activity;
}

it.each(["grouped tools", "grouped protocol", "direct protocol"] as const)("hot-switches actual %s rows without closing details or changing wire data", async (host) => {
  const toolItems: TaskChatToolItem[] = samples.flatMap(([name]) => states.map(status => ({
    id: `${name}:${status}`, kind: "tool", name, rawName: name,
    status: status === "running" ? "in_progress" : status, target: rawTarget, detail: "Raw output · failed 用户",
  })));
  const protocolItems: TaskChatProviderActivityItem[] = toolItems.map((tool, index) => ({
    id: tool.id, kind: "protocol", surface: "provider_activity", family: "tool_execution", eventType: "tool.execution.updated",
    status: states[index % states.length], title: "Provider title 原文", summary: "Running a command",
    details: [{ label: "Name", value: tool.name }, { label: "Target", value: rawTarget }, { label: "Progress", value: "Raw progress 用户" }],
    steps: [], links: [], children: [], output: "Raw output · failed 用户", transcriptIndex: index,
  }));
  const before = JSON.stringify({ toolItems, protocolItems });
  const canonicalDetails = protocolItems.map(item => providerActivityPresentation(item).detail);
  await render(host === "direct protocol" ? protocolItems.map(item => <TaskChatProtocolActivityRow key={item.id} item={item} />)
    : (host === "grouped tools" ? toolItems : protocolItems).map(item => <TaskChatRunnerActivityGroup key={item.id}
      item={{ id: `group:${item.id}`, kind: "activity_phase", items: [item], summary: "", active: true }} />));
  const firstToggle = container.querySelector<HTMLButtonElement>(host === "direct protocol" ? '[data-testid="task-chat-protocol-activity-row"] > button' : '[data-testid="task-chat-activity-phase-toggle"]')!;
  await act(async () => firstToggle.click());
  const detailToggle = host === "direct protocol" ? firstToggle : container.querySelector<HTMLButtonElement>("li button")!;
  if (host !== "direct protocol") await act(async () => detailToggle.click());
  for (const locale of ["en", "zh-CN", "es", "ja", "en"] as const) {
    await act(async () => { await i18n.changeLanguage(locale); });
    expect(container.contains(firstToggle)).toBe(true); expect(container.contains(detailToggle)).toBe(true);
    expect(firstToggle.getAttribute("aria-expanded")).toBe("true"); expect(detailToggle.getAttribute("aria-expanded")).toBe("true");
    samples.forEach(([, prefix, value], sampleIndex) => states.forEach((status, stateIndex) => {
      const index = sampleIndex * states.length + stateIndex;
      const row = host === "direct protocol" ? container.querySelectorAll('[data-testid="task-chat-protocol-activity-row"]')[index]
        : container.querySelectorAll('[data-activity-row]')[index];
      expect(row.textContent).toContain(expectedLabel(toolActivityMessages[locale], prefix, status, value));
      if (host === "grouped tools") expect(row.querySelector("[title]")?.getAttribute("title")).toBe(rawTarget);
    }));
    expect(container.textContent).toContain("Raw output · failed 用户");
    expect(protocolItems.map(item => providerActivityPresentation(item).detail)).toEqual(canonicalDetails);
    expect(JSON.stringify({ toolItems, protocolItems })).toBe(before);
  }
});

it.each(Object.keys(toolActivityMessages))("keeps canonical source and identity deduplication in %s", async locale => {
  const provider = (name: string, summary: string): TaskChatProviderActivityItem => ({
    id: name, kind: "protocol", surface: "provider_activity", family: "tool_execution", eventType: "tool.execution.updated", status: "running",
    title: "Provider-owned title", summary, details: [{ label: "Name", value: name }, { label: "Namespace", value: "vendor_namespace" }],
    steps: [], links: [], children: [],
  });
  const items = [provider("custom_extension", "Custom extension"), provider("mcp__paperclip__search_tasks", "Raw query 用户")];
  const expected = items.map(item => providerActivityPresentation(item).detail);
  await act(async () => { await i18n.changeLanguage(locale); });
  expect(items.map(item => providerActivityPresentation(item).detail)).toEqual(expected);
  expect(expected).toEqual(["Vendor namespace · custom_extension", "Raw query 用户 · Vendor namespace · search_tasks"]);
});


it.each(Object.entries(toolActivityMessages))("localizes only the absent-name source fallback in actual rows in %s", async (locale, copy) => {
  const items: TaskChatProviderActivityItem[] = [false, true].map(hasName => ({
    id: String(hasName), kind: "protocol", surface: "provider_activity", family: "tool_execution", eventType: "tool.execution.updated",
    status: "running", title: "Raw title", summary: "Raw summary 用户", steps: [], links: [], children: [],
    details: [{ label: "Namespace", value: "vendor_namespace" }, ...(hasName ? [{ label: "Name", value: "Unnamed tool" }] : [])],
  }));
  const before = JSON.stringify(items);
  await render(items.map(item => <TaskChatProtocolActivityRow key={item.id} item={item} />));
  const rows = [...container.querySelectorAll('[data-testid="task-chat-protocol-activity-row"]')];
  await act(async () => { await i18n.changeLanguage(locale); });
  expect([...container.querySelectorAll('[data-testid="task-chat-protocol-activity-row"]')]).toEqual(rows);
  expect(rows[0].textContent).toContain(`Raw summary 用户 · Vendor namespace · ${copy.unnamedName}`);
  expect(rows[1].textContent).toContain("Raw summary 用户 · Vendor namespace · Unnamed tool");
  expect(toolActivityPresentation({ namespace: "vendor_namespace" }).displayName).toBe("Unnamed tool");
  expect(JSON.stringify(items)).toBe(before);
});
