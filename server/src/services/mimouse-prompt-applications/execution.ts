import { assertPromptApplicationWorkspace } from "./workspace.js";
import { applicationTaskIsNew, applicationExecutionConflict as conflict } from "./contract.js";
import { applicationAttemptStopped } from "./recovery.js";
import { and, eq, ne, isNull } from "drizzle-orm";
import { agents, companySecretVersions, heartbeatRuns, heartbeatRunEvents, issues, mimousePromptRevisions, type Db } from "@paperclipai/db";
import { mimousePromptApplications as applications, mimousePromptApplicationHeads as heads,
  mimousePromptApplicationDispatches as dispatches } from "@paperclipai/db/schema/mimouse_prompt_applications";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import type { HeartbeatRuntimeExecutionInput } from "../heartbeat/runtime-execution.js";
import type { PrivatePromptTx } from "../mimouse-private-prompt-tests/service.js";
import { privatePromptComparisonService } from "../mimouse-private-prompt-tests/comparison-service.js";
import { privatePromptHash } from "../mimouse-private-prompt-tests/profile.js";
import { privatePromptTestImplementation } from "../../adapters/registry.js";
import { appendHeartbeatRunEvent } from "../heartbeat-run-events.js";
import { applicationDigest, assertApplicationAuthEnvironment, assertApplicationPrincipal, assertApplicationTarget, resolvePromptApplicationTarget } from "./target.js";
import { promptApplicationsEnabled } from "./service.js";
export type PromptApplicationCandidate = { id: string; generation: number };
export { applicationTaskIsNew } from "./contract.js";
async function candidate(tx: PrivatePromptTx, run: typeof heartbeatRuns.$inferSelect, issueId: string | null) {
  if (!issueId) return null;
  await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, run.companyId), eq(agents.id, run.agentId))).for("share");
  const [head] = await tx.select().from(heads).where(and(eq(heads.companyId, run.companyId), eq(heads.agentId, run.agentId))).for("share");
  const [pending] = await tx.select().from(dispatches).where(and(eq(dispatches.companyId, run.companyId), eq(dispatches.issueId, issueId), eq(dispatches.state, "prepared")));
  if (pending && pending.runId !== run.id && !await applicationAttemptStopped(tx, run.companyId, pending.runId, false)) {
    throw conflict("prompt_application_previous_attempt_unresolved");
  }
  // Durable server events survive head withdrawal and controller restart. A
  // failed controlled first attempt must not turn into an unbound ordinary retry.
  const [blockedPrior] = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).innerJoin(heartbeatRunEvents,
    and(eq(heartbeatRunEvents.runId, heartbeatRuns.id), eq(heartbeatRunEvents.companyId, heartbeatRuns.companyId))).where(and(
    eq(heartbeatRuns.companyId, run.companyId), eq(heartbeatRuns.issueId, issueId), ne(heartbeatRuns.id, run.id), ne(heartbeatRuns.status, "succeeded"),
    eq(heartbeatRunEvents.eventType, "prompt_application.candidate"), isNull(heartbeatRunEvents.sourceEventId))).limit(1);
  if (blockedPrior) throw conflict("prompt_application_failed_attempt_requires_new_task");
  const [identified] = await tx.select({ payload: heartbeatRunEvents.payload }).from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.companyId, run.companyId),
    eq(heartbeatRunEvents.runId, run.id), eq(heartbeatRunEvents.eventType, "prompt_application.candidate"), isNull(heartbeatRunEvents.sourceEventId))).limit(1);
  if (identified && (!head?.applicationId || identified.payload?.applicationId !== head.applicationId || identified.payload?.generation !== head.generation)) {
    throw conflict("prompt_application_identified_generation_changed");
  }
  if (!head?.applicationId || !head.configuredAt) return null;
  const [issue] = await tx.select().from(issues).where(and(eq(issues.companyId, run.companyId), eq(issues.id, issueId))).for("share");
  if (!issue) throw conflict("prompt_application_issue_not_found");
  const [prior] = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, run.companyId), eq(heartbeatRuns.issueId, issueId), ne(heartbeatRuns.id, run.id))).limit(1);
  if (!applicationTaskIsNew({ configuredAt: head.configuredAt, issueCreatedAt: issue.createdAt, runCreatedAt: run.createdAt, priorRun: Boolean(prior), retryOfRunId: run.retryOfRunId })) return null;
  return { id: head.applicationId, generation: head.generation, configuredAt: head.configuredAt, issue };
}
function assertCandidateScope(run: typeof heartbeatRuns.$inferSelect, issue: typeof issues.$inferSelect) {
  if (!promptApplicationsEnabled()) throw conflict("prompt_application_disabled");
  if (run.runtimeMode !== "legacy" || issue.projectId || issue.conversationAgentId || issue.conversationUserId || issue.workMode !== "standard" || issue.harnessKind ||
    issue.assigneeAgentId !== run.agentId || run.issueId !== issue.id ||
    Object.keys(issue.assigneeAdapterOverrides ?? {}).length || Object.keys(issue.executionWorkspaceSettings ?? {}).length ||
    run.contextSnapshot?.aiRouterSelection || run.contextSnapshot?.aiConnection || run.contextSnapshot?.routineId || run.scheduledRetryReason) {
    throw conflict("prompt_application_task_or_runtime_overlay_unsupported");
  }
}
export async function findPromptApplicationCandidate(db: Db, run: typeof heartbeatRuns.$inferSelect, issueId: string | null): Promise<PromptApplicationCandidate | null> {
  const found = await db.transaction(async tx => {
    const found = await candidate(tx, run, issueId);
    if (found) {
      const [existing] = await tx.select({ id: heartbeatRunEvents.id }).from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.runId, run.id),
        eq(heartbeatRunEvents.eventType, "prompt_application.candidate"), isNull(heartbeatRunEvents.sourceEventId))).limit(1);
      if (!existing) await appendHeartbeatRunEvent(tx as unknown as Db, { companyId: run.companyId, agentId: run.agentId, runId: run.id,
        eventType: "prompt_application.candidate", stream: "system", level: "info", message: "Controlled first-task candidate identified; automatic retries are not authorized.",
        payload: { applicationId: found.id, generation: found.generation, issueId, scope: "new_projectless_tasks_first_fresh_dispatch" } });
    }
    return found;
  });
  // Commit the marker even when a later scope check rejects this attempt.
  if (found) assertCandidateScope(run, found.issue);
  return found ? { id: found.id, generation: found.generation } : null;
}
async function currentApplication(tx: PrivatePromptTx, input: HeartbeatRuntimeExecutionInput, expected: PromptApplicationCandidate) {
  // Lock order matches configure/rollback/queue admission: agent before head.
  const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, input.run.companyId), eq(agents.id, input.agent.id))).for("share");
  const found = await candidate(tx, input.run, input.task.issueId);
  if (!agent || !found || found.id !== expected.id || found.generation !== expected.generation) throw conflict("prompt_application_dispatch_generation_changed");
  assertCandidateScope(input.run, found.issue);
  const [row] = await tx.select().from(applications).where(and(eq(applications.companyId, input.run.companyId), eq(applications.id, found.id)));
  if (!row || row.agentId !== input.agent.id) throw conflict("prompt_application_dispatch_binding_missing");
  const shape = (value: typeof agents.$inferSelect) => ({ config: value.adapterConfig, runtime: value.runtimeConfig, permissions: value.permissions, environmentId: value.defaultEnvironmentId });
  if (applicationDigest(shape(agent)) !== applicationDigest(shape(input.agent))) throw conflict("prompt_application_execution_agent_drift");
  await assertApplicationPrincipal(tx, row.companyId, row.actorUserId);
  assertApplicationTarget(row.snapshot, await resolvePromptApplicationTarget(tx, row.companyId, row.agentId, row.actorUserId));
  const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, row.companyId), eq(heartbeatRuns.id, input.run.id))).for("share");
  if (!run || run.status !== "running" || run.agentId !== row.agentId || run.issueId !== found.issue.id ||
    run.resultJson?.cancellation || run.resultJson?.startupCancellation ||
    run.controllerBootId !== input.run.controllerBootId || !run.controllerLeaseExpiresAt || run.controllerLeaseExpiresAt <= new Date() ||
    found.issue.executionRunId !== run.id || !["backlog", "todo", "in_progress"].includes(found.issue.status)) throw conflict("prompt_application_run_not_current");
  return { row, found, agent };
}
async function assertEnvironment(tx: PrivatePromptTx, agent: typeof agents.$inferSelect, env: Record<string, unknown>) {
  assertApplicationAuthEnvironment({ ...process.env, ...env });
  for (const [key, value] of Object.entries((agent.adapterConfig.env ?? {}) as Record<string, unknown>)) {
    if (typeof value === "string") { if (env[key] !== value) throw conflict("prompt_application_effective_environment_drift"); continue; }
    const ref = value as { secretId: string; version: number };
    const [secret] = await tx.select({ hash: companySecretVersions.valueSha256 }).from(companySecretVersions).where(and(eq(companySecretVersions.secretId, ref.secretId), eq(companySecretVersions.version, ref.version)));
    if (!secret || typeof env[key] !== "string" || privatePromptHash(env[key]) !== secret.hash) throw conflict("prompt_application_effective_secret_drift");
  }
}
/** Runs after budget admission and before the final synchronous ownership handoff. */
export async function preparePromptApplicationExecution(db: Db, input: HeartbeatRuntimeExecutionInput): Promise<AdapterExecutionContext["controlledPromptApplication"]> {
  const expected = input.control.promptApplicationCandidate;
  if (!expected) return undefined;
  if (input.runtime.nativeRuntimeResolution.kind !== "legacy" || input.workspace.executionTarget?.kind !== "local" || input.workspace.remoteExecution ||
    input.runtime.runtimeForAdapter.sessionId || input.runtime.runtimeForAdapter.sessionParams || input.runtime.runtimeForAdapter.sessionDisplayId ||
    input.task.executionContinuation?.resumeDelta || input.config.managedAiRuntime || input.task.context.aiRouterSelection || input.task.context.aiConnection ||
    !privatePromptTestImplementation(input.runtime.adapter) || input.config.runtimeConfig.engine !== "cli" || input.config.resolvedConfig.engine !== "cli" ||
    ["filesystemScope", "networkScope", "filesystemSandboxCommand", "filesystemExtraPaths", "networkAllowlist"].some(k => input.config.runtimeConfig[k] != null || input.config.resolvedConfig[k] != null)) {
    throw conflict("prompt_application_effective_runtime_unsupported");
  }
  const { row } = await db.transaction(tx => currentApplication(tx, input, expected));
  const report = await privatePromptComparisonService(db, (tx, actor) => assertApplicationPrincipal(tx, actor.companyId, actor.userId, false))
    .compare({ companyId: row.companyId, userId: row.actorUserId, sessionId: row.actorSessionId }, row.promptId, row.comparison);
  if (!report.eligibleForHumanReview || report.reportHash !== row.reportHash) throw conflict("prompt_application_comparison_changed");
  const prepared = await db.transaction(async tx => {
    const { row, found, agent } = await currentApplication(tx, input, expected);
    if (input.workspace.executionTarget?.kind !== "local" || input.workspace.executionTarget.environmentId !== row.snapshot.environmentId) throw conflict("prompt_application_effective_workspace_drift");
    const workspace = await assertPromptApplicationWorkspace(agent.id, String(agent.adapterConfig.cwd), input.workspace.executionWorkspace);
    await assertEnvironment(tx, agent, input.config.configuredTaskEnvironment);
    const [revision] = await tx.select().from(mimousePromptRevisions).where(and(eq(mimousePromptRevisions.companyId, row.companyId), eq(mimousePromptRevisions.promptId, row.promptId), eq(mimousePromptRevisions.id, row.revisionId)));
    if (!revision || revision.contentHash !== row.revisionHash || privatePromptHash(revision.content) !== row.revisionHash) throw conflict("prompt_application_revision_changed");
    const [prior] = await tx.select({ id: dispatches.id }).from(dispatches).where(eq(dispatches.issueId, found.issue.id));
    if (prior) throw conflict("prompt_application_dispatch_already_prepared");
    const [receipt] = await tx.insert(dispatches).values({ companyId: row.companyId, agentId: row.agentId, applicationId: row.id,
      runId: input.run.id, issueId: found.issue.id, generation: expected.generation, configuredAt: found.configuredAt,
      effectiveContextHash: applicationDigest({ target: row.snapshot.targetDigest, workspace, session: input.session.sessionConfigMetadata,
        config: input.config.runtimeConfig, environment: input.config.configuredTaskEnvironment, context: input.task.context }) }).returning();
    return { receipt, literal: revision.content };
  });
  let promptPrepared = false, dispatched = false;
  return {
    literalRevision: prepared.literal, applicationId: row.id, generation: expected.generation,
    prepare: async (prompt, effectiveEnv, effectiveCwd) => {
      if (promptPrepared || input.control.executionControl.controller.signal.aborted) throw conflict("prompt_application_attempt_not_fresh");
      await db.transaction(async tx => {
        const { agent } = await currentApplication(tx, input, expected); await assertEnvironment(tx, agent, effectiveEnv);
        await assertPromptApplicationWorkspace(agent.id, String(agent.adapterConfig.cwd), input.workspace.executionWorkspace, effectiveCwd);
        const changed = await tx.update(dispatches).set({ promptHash: privatePromptHash(prompt) }).where(and(eq(dispatches.id, prepared.receipt.id), eq(dispatches.state, "prepared"))).returning({ id: dispatches.id });
        if (changed.length !== 1) throw conflict("prompt_application_prepared_witness_failed");
      });
      promptPrepared = true;
    },
    beforeStart: async () => {
      if (!promptPrepared || dispatched || input.control.executionControl.controller.signal.aborted) throw conflict("prompt_application_start_denied");
      await db.transaction(async tx => {
        await currentApplication(tx, input, expected);
        await appendHeartbeatRunEvent(tx as unknown as Db, { companyId: row.companyId, agentId: row.agentId, runId: input.run.id,
          eventType: "prompt_application.start_requested", stream: "system", level: "info", message: "Controlled local process start requested; provider consumption is unconfirmed.",
          payload: { applicationId: row.id, generation: expected.generation } });
      });
    },
    dispatched: async () => {
      if (!promptPrepared || dispatched) throw conflict("prompt_application_spawn_witness_invalid");
      await db.transaction(async tx => {
        await currentApplication(tx, input, expected);
        const changed = await tx.update(dispatches).set({ state: "dispatched", dispatchedAt: new Date() }).where(and(eq(dispatches.id, prepared.receipt.id), eq(dispatches.state, "prepared"))).returning({ id: dispatches.id });
        if (changed.length !== 1) throw conflict("prompt_application_spawn_witness_failed");
      });
      dispatched = true;
    },
    stopped: async () => { await appendHeartbeatRunEvent(db, { companyId: row.companyId, agentId: row.agentId, runId: input.run.id,
      eventType: "prompt_application.provider_stopped", stream: "system", level: "info", message: "Controlled prompt local process stop observed.",
      payload: { applicationId: row.id, generation: expected.generation } }); },
  };
}
