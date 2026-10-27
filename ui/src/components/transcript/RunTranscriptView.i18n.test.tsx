// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolRunDecision } from "@paperclipai/shared";
import type { TranscriptEntry } from "../../adapters";
import { i18n } from "../../i18n";
import { validateLocaleMessages } from "../../i18n/locale-validation";
import { runTranscriptMessages } from "./run-transcript-test-resources";
import { RunTranscriptView, keyTranscriptBlocks, normalizeTranscript } from "./RunTranscriptView";

vi.mock("../MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: ReactNode }) => <div data-markdown>{children}</div>,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ts = "2026-10-27T00:00:00.000Z";
const invocationId = "inv-1234-original";
const actionRequestId = "act-5678-original";
const interactionId = "card-901-original";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); await i18n.changeLanguage("en"); });
async function language(locale: string) { await act(async () => { await i18n.changeLanguage(locale); }); }
async function render(props: ComponentProps<typeof RunTranscriptView>) { await act(async () => root.render(<RunTranscriptView {...props} />)); }
function button(label: string) { return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!; }
const text = (key: string, values: Record<string, unknown> = {}) => i18n.t(`runTranscriptUi.${key}`, values);
function toolEntry(input: unknown = null): TranscriptEntry {
  return { kind: "tool_call", ts, name: "custom_lookup", toolUseId: "tool-original", invocationId, actionRequestId, input };
}
function decision(overrides: Partial<ToolRunDecision> = {}): ToolRunDecision {
  const createdAt = new Date(ts);
  return {
    invocation: {
      id: invocationId, companyId: "company-original", idempotencyKey: null,
      actorType: "agent", actorId: "agent-original", agentId: "agent-original",
      issueId: "issue-original", runId: "run-original", applicationId: null,
      connectionId: null, catalogEntryId: null, toolName: "custom_lookup",
      argumentsHash: "hash-original", argumentsSummary: null, policyDecision: "require_approval",
      matchedPolicyIds: [], approvalState: "pending", status: "awaiting_approval",
      upstreamRequestId: null, resultHash: null, resultSummary: null, resultSizeBytes: null,
      resultArtifactId: null, errorCode: null, errorMessage: null, startedAt: null,
      completedAt: null, createdAt, updatedAt: createdAt,
    },
    actionRequest: {
      id: actionRequestId, companyId: "company-original", invocationId, issueId: "issue-original",
      interactionId, approvalId: null, status: "pending", canonicalArgumentsHash: "hash-original",
      canonicalArgumentsSummary: { summary: "原始参数 Ω" }, signedArguments: null,
      previewMarkdown: "客户审批说明 Ω", requestedByAgentId: "agent-original", requestedByUserId: null,
      resolvedByAgentId: null, resolvedByUserId: null, expiresAt: null, resolvedAt: null,
      createdAt, updatedAt: createdAt,
    },
    auditEvents: [], latestAuditEvent: null, decision: "require_approval", outcome: "pending",
    reasonCode: "provider_reason_Ω", denialReason: null,
    pendingAction: { actionRequestId, issueId: "issue-original", interactionId, approvalId: null, status: "pending", previewMarkdown: "客户审批说明 Ω" },
    ...overrides,
  };
}
function result(textValue = "", isError = false): Extract<TranscriptEntry, { kind: "result" }> {
  return { kind: "result", ts, text: textValue, isError, errors: [], inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, subtype: isError ? "error" : "success" };
}

const locales = Object.entries(runTranscriptMessages);
describe.each(locales)("run transcript in %s", (locale, strings) => {
  it("validates four-language contributions and renders default/custom empty states", async () => {
    expect(validateLocaleMessages(strings, runTranscriptMessages.en)).toEqual([]);
    for (const [key, value] of Object.entries(strings)) {
      expect(i18n.getResource(locale, "translation", `runTranscriptUi.${key}`)).toBe(value);
      expect(value).not.toMatch(/<\/?[A-Za-z]|javascript\s*:|data\s*:/i);
    }
    await language(locale);
    await render({ entries: [] });
    expect(host.textContent).toBe(strings.empty);
    await language(locale === "ja" ? "zh-CN" : "ja");
    expect(host.textContent).toBe(text("empty"));
    const custom = "Waiting for transcript... 客户自定义 <raw> Ω";
    await render({ entries: [], emptyMessage: custom });
    await language(locale);
    expect(host.textContent).toBe(custom);
    await render({ entries: [], mode: "raw", emptyMessage: "" });
    expect(host.textContent).toBe("");
    await render({ entries: [], mode: "raw" });
    expect(host.textContent).toBe(strings.empty);
  });

  it("localizes user, pending approval and decision details without translating IDs or input", async () => {
    await language(locale);
    const entries: TranscriptEntry[] = [{ kind: "user", ts, text: "用户原文 User Ω" }, toolEntry()];
    const pending = decision();
    const snapshot = JSON.stringify({ entries, pending });
    await render({ entries, toolDecisions: [pending] });
    expect(host.textContent).toContain(strings.user);
    expect(host.textContent).toContain("用户原文 User Ω");
    expect(host.textContent).toContain(strings.needsApproval);
    expect(host.textContent).toContain(text("actionRequest", { id: actionRequestId.slice(0, 8) }));
    expect(host.textContent).toContain(text("inspectInput", { name: "Custom Lookup" }));
    await act(async () => button(strings.expandTool).click());
    expect(host.textContent).toContain(strings.decision);
    expect(host.textContent).toContain(strings.emptyInput);
    expect(host.textContent).toContain(strings.running);
    expect(host.textContent).toContain(text("invocation", { id: invocationId.slice(0, 8) }));
    expect(host.textContent).toContain(text("action", { status: "pending", id: actionRequestId.slice(0, 8) }));
    expect(host.textContent).toContain(text("card", { id: interactionId.slice(0, 8) }));
    expect(host.textContent).toContain("provider_reason_Ω");
    expect(host.textContent).toContain("客户审批说明 Ω");
    expect(host.textContent).not.toContain("runTranscriptUi.");
    expect(JSON.stringify({ entries, pending })).toBe(snapshot);
  });

  it("renders denied, timeout, failed, approved, executed and allowed decisions with raw diagnostics", async () => {
    await language(locale);
    const base = decision({ pendingAction: null });
    const cases: Array<[keyof typeof strings, ToolRunDecision]> = [
      ["denied", { ...base, denialReason: "Provider denied: 私有原因 Ω" }],
      ["denied", { ...base, invocation: { ...base.invocation, status: "denied" } }],
      ["denied", { ...base, outcome: "denied" }],
      ["timedOut", { ...base, invocation: { ...base.invocation, status: "timed_out" } }],
      ["timedOut", { ...base, outcome: "timeout" }],
      ["failed", { ...base, outcome: "failure" }],
      ["approved", { ...base, actionRequest: { ...base.actionRequest!, status: "approved" } }],
      ["executed", { ...base, actionRequest: { ...base.actionRequest!, status: "executed" } }],
      ["allowed", { ...base, decision: "allow" }],
    ];
    for (const [key, value] of cases) {
      await render({ entries: [toolEntry({ query: "原始查询 Ω" })], toolDecisions: [value] });
      expect(host.textContent).toContain(strings[key]);
      expect(host.textContent).toContain("原始查询 Ω");
      if (value.denialReason) expect(host.textContent).toContain(value.denialReason);
      expect(value.invocation.id).toBe(invocationId);
    }
  });

  it("localizes empty run-result fallbacks but preserves matching provider text", async () => {
    await language(locale);
    await render({ entries: [result()] });
    expect(host.textContent).toBe(strings.completed);
    await render({ entries: [result("", true)] });
    expect(host.textContent).toContain(strings.runFailed);
    await render({ entries: [result("Completed")] });
    expect(host.querySelector("[data-markdown]")?.textContent).toBe("Completed");
    await render({ entries: [{ ...result("", true), errors: ["Provider failure: Timed out Ω"] }] });
    expect(host.textContent).toContain("Provider failure: Timed out Ω");
  });

  it("updates labels while retaining normalized identity, expanded state and streaming nodes", async () => {
    await language(locale);
    let kindReads = 0;
    const tool = toolEntry();
    Object.defineProperty(tool, "kind", { get: () => { kindReads += 1; return "tool_call"; } });
    const entries: TranscriptEntry[] = [
      tool, result("", true), { kind: "assistant", ts: `${ts}-tail`, text: "持续输出 Ω", delta: true },
    ];
    const normalized = normalizeTranscript(entries, true);
    const keys = keyTranscriptBlocks(normalized).map(({ key }) => key);
    await render({ entries, toolDecisions: [decision()], streaming: true });
    await act(async () => button(strings.expandTool).click());
    const toggle = button(strings.collapseTool);
    const inputNode = host.querySelector("pre");
    const streamingNode = host.querySelector(".tc-stream-block-enter");
    const readsBeforeSwitch = kindReads;
    await language(locale === "ja" ? "zh-CN" : "ja");
    expect(kindReads).toBe(readsBeforeSwitch);
    expect(button(text("collapseTool"))).toBe(toggle);
    expect(host.querySelector("pre")).toBe(inputNode);
    expect(host.querySelector(".tc-stream-block-enter")).toBe(streamingNode);
    expect(host.textContent).toContain(text("needsApproval"));
    expect(host.textContent).toContain(text("decision"));
    expect(host.textContent).toContain(text("emptyInput"));
    expect(host.textContent).toContain(text("runFailed"));
    expect(host.textContent).toContain("持续输出 Ω");
    expect(normalizeTranscript(entries, true)).toEqual(normalized);
    expect(keyTranscriptBlocks(normalizeTranscript(entries, true)).map(({ key }) => key)).toEqual(keys);
  });

  it("localizes group counts and tool state while preserving expanded log and output text", async () => {
    await language(locale);
    const entries: TranscriptEntry[] = [
      { kind: "stderr", ts, text: "stderr raw: Failed Ω" },
      { kind: "stderr", ts: `${ts}-2`, text: "stderr second Ω" },
      { kind: "system", ts: `${ts}-3`, text: "Unknown provider event Ω" },
      toolEntry(),
      { kind: "tool_result", ts: `${ts}-4`, toolUseId: "tool-original", content: "Tool output: Denied Ω", isError: true },
    ];
    await render({ entries });
    expect(host.textContent).toContain(text("logLines", { count: 2 }));
    expect(host.textContent).toContain(text("systemMessages", { count: 1 }));
    const groups = [...host.querySelectorAll<HTMLElement>('[role="button"]')];
    await act(async () => { for (const group of groups) group.click(); });
    expect(host.textContent).toContain("stderr raw: Failed Ω");
    expect(host.textContent).toContain("stderr second Ω");
    expect(host.textContent).toContain("Unknown provider event Ω");
    expect(host.textContent).toContain("Tool output: Denied Ω");
    expect(host.textContent).toContain(strings.errored);
    expect(host.textContent).toContain(strings.emptyInput);
    await language(locale === "en" ? "es" : "en");
    expect(host.textContent).toContain(text("logLines", { count: 2 }));
    expect(host.textContent).toContain(text("systemMessages", { count: 1 }));
    expect(host.textContent).toContain("Tool output: Denied Ω");
    expect(host.textContent).toContain("Unknown provider event Ω");
  });

  it("localizes running/completed command controls without changing command text", async () => {
    await language(locale);
    const command = "echo 'Original Ω'";
    const call: TranscriptEntry = { kind: "tool_call", ts, name: "command_execution", toolUseId: "cmd-1", input: { command } };
    await render({ entries: [call] });
    expect(host.textContent).toContain(strings.executingCommand);
    expect(host.textContent).toContain(command);
    await act(async () => button(strings.expandCommand).click());
    const toggle = button(strings.collapseCommand);
    const completed: TranscriptEntry[] = [call, { kind: "tool_result", ts: `${ts}-1`, toolUseId: "cmd-1", content: "command output Ω", isError: false }];
    await render({ entries: completed });
    expect(host.textContent).toContain(text("executedCommands", { count: 1 }));
    expect(host.textContent).toContain("command output Ω");
    await render({ entries: [...completed, { ...call, toolUseId: "cmd-2", ts: `${ts}-2` }, { kind: "tool_result", ts: `${ts}-3`, toolUseId: "cmd-2", content: "second output Ω", isError: false }] });
    expect(host.textContent).toContain(text("executedCommands", { count: 2 }));
    await language(locale === "en" ? "es" : "en");
    expect(host.textContent).toContain(text("executedCommands", { count: 2 }));
    expect(button(text("collapseCommand"))).toBe(toggle);
    expect(host.textContent).toContain(command);
    expect(host.textContent).toContain("second output Ω");
  });

  it("leaves raw transcript and provider-supplied diagnostics unchanged across languages", async () => {
    await language(locale);
    const entries: TranscriptEntry[] = [
      { kind: "user", ts, text: "User: 原文 Ω" },
      { kind: "stdout", ts, text: "stdout unchanged Ω" },
      { kind: "stderr", ts, text: "stderr unchanged Ω" },
      toolEntry({ opaque: "原始输入 Ω" }),
      { kind: "tool_result", ts, toolUseId: "tool-original", content: "status: completed\n\n原始结果 Ω", isError: false },
      { kind: "init", ts, model: "model-Ω", sessionId: "session-original" },
      { kind: "provider_activity", ts, family: "provider_notice", eventType: "provider.unknown", status: "running", title: "Provider raw title Ω", summary: "Provider raw summary Ω", payload: { details: [{ name: "diagnostic_Ω", value: "Provider denied Ω" }] } },
    ];
    await render({ entries, mode: "raw" });
    const raw = host.innerHTML;
    for (const expected of ["User: 原文 Ω", "stdout unchanged Ω", "stderr unchanged Ω", "原始输入 Ω", "原始结果 Ω", "model-Ω", "session-original", "provider.unknown"]) expect(host.textContent).toContain(expected);
    await language(locale === "ja" ? "zh-CN" : "ja");
    expect(host.innerHTML).toBe(raw);
    await render({ entries: entries.slice(-1) });
    for (const expected of ["Provider raw title Ω", "Provider raw summary Ω", "diagnostic_Ω", "Provider denied Ω"]) expect(host.textContent).toContain(expected);
  });
});
