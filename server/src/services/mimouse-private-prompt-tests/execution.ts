import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { heartbeatRuns, issues, type Db } from "@paperclipai/db";
import { mimousePrivatePromptTests as tests } from "@paperclipai/db/schema/mimouse_private_prompt_tests";
import type { AdapterExecutionResult } from "@paperclipai/adapter-utils";
import type { HeartbeatRuntimeExecutionInput } from "../heartbeat/runtime-execution.js";
import { privatePromptTestImplementation } from "../../adapters/registry.js";
import { secretService } from "../secrets.js";
import { conflict } from "../../errors.js";
import { privatePromptInput, validatePrivatePromptResources, type PrivatePromptRow, type PrivatePromptTx } from "./service.js";
import { privateConfigDigest, privatePromptHash, PRIVATE_PROMPT_IMPLEMENTATION } from "./profile.js";
import { sealPrivatePromptResult } from "./result.js";

export async function findPrivatePromptExecution(db: Db, companyId: string, issueId: string | null) {
  if (!issueId) return null;
  return (await db.select().from(tests).where(and(eq(tests.companyId, companyId), eq(tests.issueId, issueId))))[0] ?? null;
}
async function validate(tx: PrivatePromptTx, row: PrivatePromptRow, input: HeartbeatRuntimeExecutionInput) {
  const { run, agent } = input;
  const [current] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.companyId, row.companyId))).for("share");
  const [issue] = await tx.select().from(issues).where(and(eq(issues.id, row.issueId!), eq(issues.companyId, row.companyId))).for("share");
  if (!current || current.status !== "running" || current.agentId !== row.agentId || current.wakeupRequestId !== row.wakeupRequestId ||
      row.heartbeatRunId !== run.id || agent.id !== row.agentId || agent.companyId !== row.companyId ||
      !issue || issue.assigneeAgentId !== row.agentId || issue.visibility !== "private" || issue.responsibleUserId !== row.actorUserId ||
      issue.originKind !== "private_prompt_test" || issue.originId !== row.id || ["done", "cancelled"].includes(issue.status) ||
      input.runtime.nativeRuntimeResolution.kind !== "legacy" || run.runtimeMode !== "legacy" ||
      input.workspace.executionTarget?.kind === "remote" || input.workspace.remoteExecution ||
      input.runtime.runtimeForAdapter.sessionId || input.runtime.runtimeForAdapter.sessionParams ||
      !privatePromptTestImplementation(input.runtime.adapter)) throw conflict("private_prompt_execution_binding_denied");
  const bound = await validatePrivatePromptResources(tx,
    { companyId: row.companyId, userId: row.actorUserId, sessionId: row.actorSessionId }, privatePromptInput(row), row.promptId, true, true);
  if (bound.profile.configDigest !== row.configDigest || bound.dataset.datasetHash !== row.datasetHash ||
      bound.revision.contentHash !== row.revisionHash || privateConfigDigest(bound.version.fileInventory) !== row.skillVersionHash ||
      bound.secret.valueHash !== row.secretValueHash) throw conflict("private_prompt_execution_snapshot_changed");
  return bound;
}
export async function executePrivatePromptHeartbeat(db: Db, input: HeartbeatRuntimeExecutionInput, binding: PrivatePromptRow): Promise<AdapterExecutionResult> {
  let attemptId: string | null = null;
  let spawned = false;
  try {
    const bound = await db.transaction(async tx => {
      const [row] = await tx.select().from(tests).where(eq(tests.id, binding.id)).for("update");
      if (row.status !== "queued" || row.attemptId) throw conflict("private_prompt_attempt_already_claimed");
      const bound = await validate(tx, row, input);
      attemptId = randomUUID();
      await tx.update(tests).set({ attemptId, updatedAt: new Date() }).where(eq(tests.id, row.id));
      return bound;
    });
    const apiKey = await secretService(db).resolveSecretValue(binding.companyId, bound.profile.secretId, bound.profile.secretVersion, {
      consumerType: "agent", consumerId: binding.agentId, configPath: "env.ANTHROPIC_API_KEY", responsibleUserId: binding.actorUserId,
      actorType: "user", actorId: binding.actorUserId, actorSource: "session", issueId: binding.issueId, heartbeatRunId: input.run.id,
    });
    if (privatePromptHash(apiKey) !== binding.secretValueHash) throw conflict("private_prompt_secret_changed");
    const restrictedConfig = { engine: "cli", model: bound.profile.model, cwd: input.workspace.executionWorkspace.cwd };
    const fixedContext = ["Private prompt test. Return the answer as text. No tools are available.",
      `Fixed test case:\n${bound.testCase.input}`,
      `Pinned skill version ${bound.version.id}:\n${JSON.stringify(bound.version.fileInventory)}`].join("\n\n");
    if (Buffer.byteLength(fixedContext, "utf8") > 256000) throw conflict("private_prompt_fixed_context_too_large");
    const guarded = await input.control.dispatchResolvedInteractionContinuationWithAtomicGate(markDispatchStarted => {
      input.effects.onLegacyAdapterEntered();
      return input.runtime.adapter.execute({
        runId: input.run.id, agent: input.agent, runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
        config: restrictedConfig, context: { forceFreshSession: true }, executionTarget: input.workspace.executionTarget,
        signal: input.control.executionControl.controller.signal,
        onLog: async () => {}, onMeta: async () => {}, onEvent: async () => {},
        onCancellationReady: async () => {
          const run = await input.services.getRun(input.run.id);
          if (!run || run.status !== "running") throw new Error("private_prompt_run_stopped");
        },
        onSpawn: async meta => {
          markDispatchStarted();
          await input.services.persistRunProcessMetadata(input.run.id, meta);
          const changed = await db.update(tests).set({ status: "spawned", spawnedAt: new Date(meta.startedAt), updatedAt: new Date() }).where(and(
            eq(tests.id, binding.id), eq(tests.attemptId, attemptId!), eq(tests.status, "prepared"))).returning({ id: tests.id });
          if (changed.length !== 1) throw new Error("private_prompt_spawn_receipt_failed");
          spawned = true;
        },
        privatePromptTest: { literalRevision: bound.revision.content, fixedContext, apiKey,
          prepare: async prompt => {
            await db.transaction(async tx => {
              const [row] = await tx.select().from(tests).where(eq(tests.id, binding.id)).for("update");
              if (row.status !== "queued" || row.attemptId !== attemptId) throw conflict("private_prompt_prepare_conflict");
              await validate(tx, row, input);
              if (input.control.executionControl.controller.signal.aborted) throw conflict("private_prompt_cancelled");
              await tx.update(tests).set({ status: "prepared", updatedAt: new Date(), prepared: {
                schemaVersion: 1, testId: row.id, attemptId: attemptId!, companyId: row.companyId, issueId: row.issueId!,
                heartbeatRunId: input.run.id, agentId: row.agentId, revisionId: row.revisionId, headReceiptId: row.headReceiptId,
                revisionHash: row.revisionHash, promptHash: privatePromptHash(prompt), promptBytes: Buffer.byteLength(prompt, "utf8"),
                runtimeConfigHash: privateConfigDigest({ ...restrictedConfig, profile: "claude_cli_bare_api_key_v1", secretValueHash: row.secretValueHash }),
                implementation: PRIVATE_PROMPT_IMPLEMENTATION, providerConsumed: false, stdinWritten: false,
              } }).where(eq(tests.id, row.id));
            });
          },
        },
      });
    });
    if (!guarded.dispatched) throw new Error("private_prompt_dispatch_denied");
    const result = await guarded.resultPromise;
    const sealed = sealPrivatePromptResult(result, spawned);
    await db.update(tests).set({ status: sealed.status, errorCode: sealed.errorCode, privateResult: sealed.privateResult, updatedAt: new Date() })
      .where(and(eq(tests.id, binding.id), eq(tests.attemptId, attemptId!)));
    // Numeric accounting is retained; arbitrary provider/model fields are not.
    return { ...sealed.publicResult, provider: "anthropic", biller: "anthropic", billingType: "api", model: bound.profile.model,
      costUsd: typeof result.costUsd === "number" && Number.isFinite(result.costUsd) && result.costUsd >= 0 ? result.costUsd : undefined,
      usage: result.usage, usageComplete: result.usageComplete === true };
  } catch {
    // Unknown persistence/spawn outcomes never authorize a new attempt. No raw
    // exception, SQL params, cause, credentials, prompt or output leaves here.
    if (attemptId) await db.update(tests).set({ status: "unknown", errorCode: "private_prompt_execution_unconfirmed", updatedAt: new Date() })
      .where(and(eq(tests.id, binding.id), eq(tests.attemptId, attemptId))).catch(() => {});
    return { exitCode: 1, signal: null, timedOut: false, clearSession: true,
      errorCode: "private_prompt_execution_unconfirmed", errorMessage: "private_prompt_execution_unconfirmed",
      resultJson: { privatePromptTest: true }, summary: "Private prompt test did not produce a confirmed result." };
  }
}
