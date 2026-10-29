import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetRuntimeCommandInstalled,
  executeClaudeAcp,
  resolveAdapterExecutionTargetCommandForLogs,
  runAdapterExecutionTargetProcess,
} = vi.hoisted(() => ({
  ensureAdapterExecutionTargetCommandResolvable: vi.fn(async () => undefined),
  ensureAdapterExecutionTargetRuntimeCommandInstalled: vi.fn(async () => undefined),
  executeClaudeAcp: vi.fn(async () => {
    throw new Error('Transform failed with 1 error: execute.ts:818:0: ERROR: Unexpected "<<"');
  }),
  resolveAdapterExecutionTargetCommandForLogs: vi.fn(async () => "claude"),
  runAdapterExecutionTargetProcess: vi.fn(async (..._args: unknown[]) => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: [
      JSON.stringify({ type: "system", subtype: "init", session_id: "claude-session-1", model: "claude-sonnet" }),
      JSON.stringify({
        type: "assistant",
        session_id: "claude-session-1",
        message: { content: [{ type: "text", text: "hello" }] },
      }),
      JSON.stringify({
        type: "result",
        session_id: "claude-session-1",
        result: "hello",
        usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
      }),
    ].join("\n"),
    stderr: "",
    pid: 123,
    startedAt: new Date().toISOString(),
  })),
}));

vi.mock("./acp.js", () => ({
  createClaudeAcpExecutor: () => executeClaudeAcp,
  resolveClaudeExecutionEngineForRun: async (ctx: { config: Record<string, unknown> }) =>
    ctx.config.engine === "cli"
      ? { engine: "cli", explicit: true }
      : ctx.config.engine === "acp"
      ? { engine: "acp", explicit: true }
      : { engine: "acp", explicit: false },
}));

vi.mock("@paperclipai/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/execution-target")>(
    "@paperclipai/adapter-utils/execution-target",
  );
  return {
    ...actual,
    ensureAdapterExecutionTargetCommandResolvable,
    ensureAdapterExecutionTargetRuntimeCommandInstalled,
    resolveAdapterExecutionTargetCommandForLogs,
    runAdapterExecutionTargetProcess,
  };
});

import { execute } from "./execute.js";

function buildContext<Config extends Record<string, unknown>>(config: Config) {
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Claude Coder",
      adapterType: "claude_local",
      adapterConfig: {},
    },
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: null,
    },
    config,
    context: {},
    onLog: vi.fn(async () => {}),
  };
}

describe("private literal prompt execution", () => {
  let home: string;
  beforeEach(async () => {
    vi.clearAllMocks(); home = await mkdtemp(join(tmpdir(), "private-prompt-fixture-"));
    vi.stubEnv("PAPERCLIP_HOME", home); vi.stubEnv("HOME", home);
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }); });
  const literal = "  中文🧪\n{{agent.name}} <script>inert</script>\r\n  ";
  function privateContext() {
    return { ...buildContext({ engine: "cli", model: "claude-sonnet-4-5", cwd: home }), context: { forceFreshSession: true },
      privatePromptTest: { literalRevision: literal, fixedContext: "Pinned case and skill", apiKey: "fixture-not-a-real-key", prepare: vi.fn(async (_prompt: string) => {}) },
      onMeta: vi.fn(async () => {}) };
  }
  it("passes the same exact final prompt to durable preparation and process stdin without exposing meta/logs", async () => {
    const ctx = privateContext();
    await execute(ctx as never);
    expect(runAdapterExecutionTargetProcess).toHaveBeenCalledTimes(1);
    const options = runAdapterExecutionTargetProcess.mock.calls[0]![4] as { stdin: string; onLog: (stream: string, chunk: string) => Promise<void> };
    expect(options.stdin).toContain(`\n<private-prompt-revision>\n${literal}\n</private-prompt-revision>`);
    expect(ctx.privatePromptTest.prepare).toHaveBeenCalledExactlyOnceWith(options.stdin);
    expect(ctx.privatePromptTest.prepare.mock.invocationCallOrder[0]).toBeLessThan(runAdapterExecutionTargetProcess.mock.invocationCallOrder[0]!);
    await options.onLog("stdout", literal);
    await options.onLog("stderr", literal);
    expect(ctx.onLog).not.toHaveBeenCalled();
    expect(ctx.onMeta).not.toHaveBeenCalled();
    expect(executeClaudeAcp).not.toHaveBeenCalled();
  });
  it.each(["reported", "init_only", "mixed", "different"])("preserves spend and distinguishes %s model provenance", async kind => {
    const ctx = privateContext(), model = ctx.config.model;
    const modelUsage = kind === "init_only" ? undefined : kind === "mixed" ? { [model]: {}, "claude-other": {} }
      : { [kind === "different" ? "claude-other" : model]: {} };
    runAdapterExecutionTargetProcess.mockResolvedValueOnce({ exitCode: 0, signal: null, timedOut: false, pid: 123,
      startedAt: new Date().toISOString(), stderr: "", stdout: [JSON.stringify({ type: "system", subtype: "init", model }),
        JSON.stringify({ type: "result", subtype: "success", result: "ok", modelUsage, total_cost_usd: 0.0125,
          usage: { input_tokens: 1, output_tokens: 1 } })].join("\n") });
    const result = await execute(ctx as never);
    expect(result.model).toBe(kind === "reported" ? model : kind === "mixed" ? "mixed" : "unknown");
    expect(result.costUsd).toBe(0.0125); expect(result.usageBasis).toBe("per_run");
  });
  it("does not dispatch if preparation persistence fails", async () => {
    const ctx = privateContext();
    ctx.privatePromptTest.prepare.mockRejectedValueOnce(new Error("private_test_prepare_failed"));
    await expect(execute(ctx as never)).rejects.toThrow("private_prompt_test_execution_failed");
    expect(runAdapterExecutionTargetProcess).not.toHaveBeenCalled();
  });
  it.each(["acp", "default", "resume", "params", "remote", "not-fresh"])("rejects unsupported %s before any process call", async mode => {
    const ctx = privateContext() as Record<string, any>;
    if (mode === "acp") ctx.config.engine = "acp";
    if (mode === "default") delete ctx.config.engine;
    if (mode === "resume") ctx.runtime.sessionId = "old";
    if (mode === "params") ctx.runtime.sessionParams = { sessionId: "old" };
    if (mode === "remote") ctx.executionTarget = { kind: "remote" };
    if (mode === "not-fresh") ctx.context.forceFreshSession = false;
    await expect(execute(ctx as never)).rejects.toThrow("private_prompt_test_unsupported_execution");
    expect(runAdapterExecutionTargetProcess).not.toHaveBeenCalled();
    expect(executeClaudeAcp).not.toHaveBeenCalled();
    expect(ctx.privatePromptTest.prepare).not.toHaveBeenCalled();
  });
});
