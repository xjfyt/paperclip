import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { runAdapterExecutionTargetProcess } from "@paperclipai/adapter-utils/execution-target";
import { isPaperclipRecoveryWakePayload } from "@paperclipai/adapter-utils/server-utils";
import { parseClaudeStreamJson } from "./parse.js";

/** This is not a second scheduler: the audited builtin adapter's restricted lane.
 * Flags: https://code.claude.com/docs/en/headless and /docs/en/cli-reference.
 * No ordinary runtime config builder, inherited credentials, hooks, or fallback. */
export async function executePrivatePromptTest(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const test = ctx.privatePromptTest;
  if (!test || Object.keys(ctx.config).some(key => !["engine", "model", "cwd"].includes(key)) || ctx.config.engine !== "cli" || ctx.runtime.sessionId || ctx.runtime.sessionParams ||
      ctx.executionTarget?.kind === "remote" || ctx.executionTransport?.remoteExecution ||
      ctx.context.forceFreshSession !== true || isPaperclipRecoveryWakePayload(ctx.context.paperclipWake) ||
      ctx.authToken || ctx.runtimeTools || ctx.runtimeMcp ||
      typeof test.literalRevision !== "string" || typeof test.fixedContext !== "string" ||
      typeof test.apiKey !== "string" || !test.apiKey || typeof test.prepare !== "function" ||
      typeof ctx.config.model !== "string" || !/^claude-[a-zA-Z0-9.-]+$/.test(ctx.config.model) ||
      typeof ctx.config.cwd !== "string" || !path.isAbsolute(ctx.config.cwd)) {
    throw new Error("private_prompt_test_unsupported_execution");
  }
  const home = await mkdtemp(path.join(tmpdir(), "paperclip-private-prompt-"));
  try {
    // Literal is concatenated, never template-rendered, trimmed, or serialized.
    const prompt = `${test.fixedContext}\n\n<private-prompt-revision>\n${test.literalRevision}\n</private-prompt-revision>`;
    if (Buffer.byteLength(prompt, "utf8") > 256000) throw new Error("private_prompt_text_context_too_large");
    await ctx.onCancellationReady?.();
    if (ctx.signal?.aborted) throw new Error("private_prompt_test_cancelled");
    await test.prepare(prompt);
    if (ctx.signal?.aborted) throw new Error("private_prompt_test_cancelled");
    let spawnUnconfirmed = false;
    const proc = await runAdapterExecutionTargetProcess(ctx.runId, null, "claude", [
      "--bare", "--print", "--output-format", "stream-json", "--verbose",
      "--tools", "", "--disallowedTools", "*", "mcp__*", "--disable-slash-commands",
      "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      "--no-chrome", "--no-session-persistence", "--max-turns", "1",
      "--model", ctx.config.model,
    ], {
      cwd: ctx.config.cwd,
      // No process/config env inheritance, even PATH is deliberately fixed by
      // the process helper's platform default. Dedicated HOME contains no login.
      env: { HOME: home, CLAUDE_CONFIG_DIR: path.join(home, ".claude"), ANTHROPIC_API_KEY: test.apiKey },
      inheritEnv: false, stdin: prompt,
      timeoutSec: 120, graceSec: 5,
      onLog: async () => {},
      onSpawn: async meta => {
        if (!ctx.onSpawn) { spawnUnconfirmed = true; return; }
        try { await ctx.onSpawn(meta); } catch { spawnUnconfirmed = true; }
      },
    });
    const parsed = parseClaudeStreamJson(proc.stdout);
    const modelUsage = parsed.resultJson?.modelUsage;
    const models = modelUsage && typeof modelUsage === "object" && !Array.isArray(modelUsage) ? Object.keys(modelUsage) : [];
    // Configuration/init events are requests, not proof of the model billed.
    // Never publish arbitrary provider text as a model; an unexpected identity
    // remains unknown while its reported total still reaches accounting.
    const reportedModel = models.length > 1 ? "mixed" : models.length === 1 && models[0] === ctx.config.model ? ctx.config.model : "unknown";
    return {
      exitCode: proc.exitCode, signal: proc.signal, timedOut: proc.timedOut,
      resultJson: parsed.resultJson, summary: parsed.summary,
      provider: "anthropic", biller: "anthropic", billingType: "api", model: reportedModel, usageBasis: "per_run",
      usage: parsed.usage ?? undefined, costUsd: parsed.costUsd, usageComplete: parsed.resultJson !== null,
      clearSession: true,
      ...(spawnUnconfirmed ? { errorCode: "private_prompt_spawn_unconfirmed" } : {}),
    };
  } catch {
    // Never forward spawn errors or their cause; they may contain prompt/env.
    throw new Error("private_prompt_test_execution_failed");
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
}
