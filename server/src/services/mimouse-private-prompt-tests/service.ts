import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { activityLog, agents, authSessions, authUsers, companies, companyMemberships, companySecrets, companySecretVersions,
  companySkills, companySkillVersions, heartbeatRuns, agentWakeupRequests, environments, instanceSettings, projects, issues, mimouseEvaluationDatasets, mimousePromptRevisions, mimousePrompts, type Db } from "@paperclipai/db";
import { mimousePrivatePromptTests as tests } from "@paperclipai/db/schema/mimouse_private_prompt_tests";
import { createPrivatePromptTestSchema, type CreatePrivatePromptTest, type PrivatePromptTestRecord } from "@paperclipai/shared/mimouse-private-prompt-tests";
import { conflict, forbidden, notFound, unprocessable } from "../../errors.js";
import { issueService } from "../issues.js";
import { accessService } from "../access.js";
import { companySkillPolicyService, normalizeSkillPolicySourceType } from "../company-skill-policy.js";
import { getServerAdapter, privatePromptTestImplementation } from "../../adapters/registry.js";
import { privatePromptExecutionPolicy, privatePromptFixedContext, assertPrivatePromptLocalEnvironment, assertPrivatePromptTextInventory, assertPrivatePromptHarness, assertPrivatePromptRuntimeConfig, assertPrivatePromptProfile, privateConfigDigest, privatePromptHash, privatePromptTestsEnabled } from "./profile.js";
import { privatePromptWakeOptions } from "./wake-authority.js";
import type { WakeupOptions } from "../heartbeat/run-preparation.js";
export type PrivatePromptTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type PrivatePromptIdentity = { companyId: string; userId: string; sessionId: string };
export type PrivatePromptRow = typeof tests.$inferSelect;
export async function authorizePrivatePrompt(tx: PrivatePromptTx, actor: PrivatePromptIdentity) {
  const [session] = await tx.select({ id: authSessions.id }).from(authSessions).innerJoin(authUsers, eq(authUsers.id, authSessions.userId)).where(and(
    eq(authSessions.id, actor.sessionId), eq(authSessions.userId, actor.userId), gt(authSessions.expiresAt, new Date()))).for("share");
  const [member] = await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, actor.companyId),
    eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actor.userId), eq(companyMemberships.status, "active"),
    inArray(companyMemberships.membershipRole, ["owner", "admin"]))).for("share");
  const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, actor.companyId)).for("share");
  if (!session || !member) throw forbidden("private_prompt_active_session_administrator_required");
  if (!company || company.status !== "active") throw unprocessable("private_prompt_active_company_required");
  return { type: "board" as const, source: "session" as const, userId: actor.userId, sessionId: actor.sessionId,
    companyIds: [actor.companyId], memberships: [{ companyId: actor.companyId, status: "active" as const, membershipRole: member.membershipRole }] };
}
export async function validatePrivatePromptResources(tx: PrivatePromptTx, actor: PrivatePromptIdentity, input: CreatePrivatePromptTest, promptId: string, replay = false, allowRunning = false) {
  const principal = await authorizePrivatePrompt(tx, actor);
  if (!privatePromptTestsEnabled()) throw unprocessable("private_prompt_execution_disabled");
  const [agent] = await tx.select().from(agents).where(and(eq(agents.id, input.agentId), eq(agents.companyId, actor.companyId))).for("share");
  if (!agent || !(allowRunning ? ["active", "idle", "running"] : ["active", "idle"]).includes(agent.status)) throw unprocessable("private_prompt_agent_unavailable");
  assertPrivatePromptRuntimeConfig(agent.runtimeConfig, agent.defaultEnvironmentId);
  const [settings] = await tx.select().from(instanceSettings).where(eq(instanceSettings.singletonKey, "default")).for("share");
  const executionPolicy = privatePromptExecutionPolicy(settings?.general, settings?.experimental, process.env.PAPERCLIP_EXECUTION_MODE);
  const source = agent.defaultEnvironmentId ? "agent" : settings?.defaultEnvironmentId ? "instance" : "implicit";
  const requestedEnvironmentId = agent.defaultEnvironmentId ?? settings?.defaultEnvironmentId ?? null;
  // Implicit selection resolves the same unique local row used by core selection;
  // absence is unsupported, never represented as a wildcard/null target.
  const [environment] = await tx.select().from(environments).where(requestedEnvironmentId
    ? eq(environments.id, requestedEnvironmentId) : eq(environments.driver, "local")).for("share");
  const effectiveEnvironment = { source, ...assertPrivatePromptLocalEnvironment(environment) };
  const profile = { ...assertPrivatePromptProfile(agent.adapterType, agent.adapterConfig), effectiveEnvironment,
    configDigest: privateConfigDigest({ adapterConfig: agent.adapterConfig, effectiveEnvironment, executionPolicy }) };
  if (!privatePromptTestImplementation(getServerAdapter(agent.adapterType))) throw unprocessable("private_prompt_adapter_unsupported");
  const [secret] = await tx.select({ id: companySecrets.id, valueHash: companySecretVersions.valueSha256 }).from(companySecrets).innerJoin(companySecretVersions, eq(companySecretVersions.secretId, companySecrets.id)).where(and(
    eq(companySecrets.companyId, actor.companyId), eq(companySecrets.id, profile.secretId), eq(companySecrets.provider, "local_encrypted"),
    eq(companySecrets.scope, "company"), isNull(companySecrets.deletedAt), eq(companySecretVersions.version, profile.secretVersion), isNull(companySecretVersions.revokedAt))).for("share");
  if (!secret) throw unprocessable("private_prompt_pinned_local_secret_required");
  const [revision] = await tx.select().from(mimousePromptRevisions).where(and(eq(mimousePromptRevisions.companyId, actor.companyId),
    eq(mimousePromptRevisions.promptId, promptId), eq(mimousePromptRevisions.id, input.revisionId)));
  const [head] = await tx.select().from(mimousePrompts).where(and(eq(mimousePrompts.companyId, actor.companyId), eq(mimousePrompts.id, promptId))).for("share");
  if (!revision || !head) throw notFound("private_prompt_revision_not_found");
  if (!replay && head.headReceiptId !== input.expectedHeadReceiptId) throw conflict("private_prompt_head_changed");
  if (privatePromptHash(revision.content) !== revision.contentHash) throw conflict("private_prompt_revision_integrity_failed");
  const [dataset] = await tx.select().from(mimouseEvaluationDatasets).where(and(eq(mimouseEvaluationDatasets.companyId, actor.companyId), eq(mimouseEvaluationDatasets.id, input.datasetId)));
  if (dataset && privateConfigDigest(dataset.cases) !== dataset.datasetHash) throw conflict("private_prompt_dataset_integrity_failed");
  const testCase = dataset?.cases.find(item => item.id === input.caseId);
  const [skill] = dataset ? await tx.select().from(companySkills).where(and(eq(companySkills.companyId, actor.companyId), eq(companySkills.id, dataset.skillId))) : [];
  const [version] = dataset ? await tx.select().from(companySkillVersions).where(and(eq(companySkillVersions.companyId, actor.companyId),
    eq(companySkillVersions.companySkillId, dataset.skillId), eq(companySkillVersions.id, input.skillVersionId))) : [];
  if (!dataset || !testCase || !skill || !version) throw notFound("private_prompt_fixed_resource_not_found");
  const textInventory = assertPrivatePromptTextInventory(version.fileInventory);
  privatePromptFixedContext(testCase.input, version.id, textInventory, revision.content);
  const policy = await companySkillPolicyService(tx as unknown as Db).evaluate({ companyId: actor.companyId,
    principal: { type: "board", id: actor.userId, role: "board" }, action: "skills.test",
    resource: { skillId: skill.id, skillKey: skill.key, sourceType: normalizeSkillPolicySourceType(skill.sourceType), sourceLocator: skill.sourceLocator ?? undefined } });
  if (!policy.allowed) throw forbidden("private_prompt_skill_test_denied");
  const assignment = await accessService(tx as unknown as Db).decide({ actor: principal, action: "tasks:assign",
    resource: { type: "issue", companyId: actor.companyId, assigneeAgentId: agent.id } });
  if (!assignment.allowed) throw forbidden("private_prompt_assignment_denied");
  return { agent, profile, revision, dataset, testCase, version, secret, textInventory };
}
/** Called before heartbeat provider/runtime/MCP preparation, then again at dispatch. */
export async function assertPrivatePromptEarlyBinding(db: Db, run: typeof heartbeatRuns.$inferSelect, issueId: string | null) {
  if (!issueId) return null;
  return db.transaction(async tx => {
    const [row] = await tx.select().from(tests).where(and(eq(tests.companyId, run.companyId), eq(tests.issueId, issueId))).for("share");
    const [issue] = await tx.select().from(issues).where(and(eq(issues.companyId, run.companyId), eq(issues.id, issueId))).for("share");
    if (!row) {
      if (issue?.originKind === "private_prompt_test") throw conflict("private_prompt_missing_binding");
      return null;
    }
    if (row.heartbeatRunId !== run.id || row.wakeupRequestId !== run.wakeupRequestId || row.agentId !== run.agentId ||
        row.status !== "queued" || row.attemptId || run.runtimeMode !== "legacy" ||
        !issue || issue.visibility !== "private" || issue.assigneeAgentId !== row.agentId ||
        issue.responsibleUserId !== row.actorUserId || issue.originKind !== "private_prompt_test" || issue.originId !== row.id ||
        (issue.assigneeAdapterOverrides && Object.keys(issue.assigneeAdapterOverrides).length > 0) ||
        (issue.executionWorkspaceSettings && Object.keys(issue.executionWorkspaceSettings).length > 0) ||
        run.contextSnapshot?.aiRouterSelection || run.contextSnapshot?.aiConnection || run.retryOfRunId) {
      throw conflict("private_prompt_early_binding_denied");
    }
    if (issue.projectId) {
      const [project] = await tx.select().from(projects).where(and(eq(projects.companyId, row.companyId), eq(projects.id, issue.projectId))).for("share");
      if (!project || project.visibility !== "private" || project.personalOwnerUserId !== row.actorUserId ||
          project.env && Object.keys(project.env).length > 0 || project.executionWorkspacePolicy && Object.keys(project.executionWorkspacePolicy).length > 0) {
        throw conflict("private_prompt_project_overlay_unsupported");
      }
    }
    const bound = await validatePrivatePromptResources(tx,
      { companyId: row.companyId, userId: row.actorUserId, sessionId: row.actorSessionId }, privatePromptInput(row), row.promptId, true, true);
    if (bound.profile.configDigest !== row.configDigest || bound.dataset.datasetHash !== row.datasetHash ||
        bound.revision.contentHash !== row.revisionHash || privateConfigDigest(bound.version.fileInventory) !== row.skillVersionHash ||
        bound.secret.valueHash !== row.secretValueHash) throw conflict("private_prompt_execution_snapshot_changed");
    return { ...row, effectiveEnvironmentId: bound.profile.effectiveEnvironment.id };
  });
}
export function privatePromptRecord(row: PrivatePromptRow): PrivatePromptTestRecord {
  return { id: row.id, promptId: row.promptId, revisionId: row.revisionId, agentId: row.agentId, datasetId: row.datasetId,
    caseId: row.caseId, skillVersionId: row.skillVersionId, status: row.status, issueId: row.issueId,
    heartbeatRunId: row.heartbeatRunId, prepared: row.prepared, spawnedAt: row.spawnedAt?.toISOString() ?? null,
    errorCode: row.errorCode, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), runtimeApplied: false };
}
export function privatePromptInput(row: PrivatePromptRow): CreatePrivatePromptTest {
  return { requestId: row.requestId, revisionId: row.revisionId, expectedHeadReceiptId: row.headReceiptId, agentId: row.agentId,
    datasetId: row.datasetId, caseId: row.caseId, skillVersionId: row.skillVersionId, executionProfile: "claude_cli_bare_api_key_v1",
    confirmExecution: true, confirmPossibleCharges: true, confirmRestrictedProfile: true };
}
async function reconcilePrivatePromptState(tx: PrivatePromptTx, row: PrivatePromptRow): Promise<PrivatePromptRow> {
      // Reconcile observable terminal state, never replay a wake or attempt.
      // In particular, a skipped/failed wake owns its unique fence forever.
      if (row.status === "pending_wake") {
        const [wake] = await tx.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, row.companyId),
          eq(agentWakeupRequests.idempotencyKey, `private-prompt-test:${row.id}`)));
        if (wake && !wake.runId) {
          const [settled] = await tx.update(tests).set({ status: "failed", wakeupRequestId: wake.id,
            errorCode: "private_prompt_wake_not_admitted", updatedAt: new Date() }).where(and(eq(tests.id, row.id), eq(tests.status, "pending_wake"))).returning();
          return settled ?? row;
        }
      }
      if (row.heartbeatRunId && ["queued", "prepared", "spawned"].includes(row.status)) {
        const [run] = await tx.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, row.heartbeatRunId));
        if (!run || ["succeeded", "failed", "cancelled", "timed_out"].includes(run.status)) {
          const [settled] = await tx.update(tests).set({ status: row.attemptId ? "unknown" : run?.status === "cancelled" ? "cancelled" : "failed",
            errorCode: row.attemptId ? "private_prompt_execution_unconfirmed" : "private_prompt_not_dispatched", updatedAt: new Date() })
            .where(and(eq(tests.id, row.id), eq(tests.status, row.status))).returning();
          return settled ?? row;
        }
      }
      return row;
}
export function privatePromptTestService(db: Db, wake?: (agentId: string, opts: WakeupOptions) => Promise<unknown>) {
  async function get(actor: PrivatePromptIdentity, promptId: string, id: string) {
    return db.transaction(async tx => {
      await authorizePrivatePrompt(tx, actor);
      const [row] = await tx.select().from(tests).where(and(eq(tests.companyId, actor.companyId), eq(tests.promptId, promptId), eq(tests.id, id), eq(tests.actorUserId, actor.userId)));
      if (!row) throw notFound("private_prompt_test_not_found");
      return reconcilePrivatePromptState(tx, row);
    });
  }
  return {
    async list(actor: PrivatePromptIdentity, promptId: string, beforeId?: string) {
      return db.transaction(async tx => {
        await authorizePrivatePrompt(tx, actor);
        const rows = await tx.select().from(tests).where(and(eq(tests.companyId, actor.companyId), eq(tests.promptId, promptId), eq(tests.actorUserId, actor.userId),
          beforeId ? lt(tests.id, beforeId) : undefined)).orderBy(desc(tests.id)).limit(51);
        return { items: await Promise.all(rows.slice(0, 50).map(async row => privatePromptRecord(await reconcilePrivatePromptState(tx, row)))), nextBeforeId: rows.length > 50 ? rows[49]!.id : null };
      });
    },
    async detail(actor: PrivatePromptIdentity, promptId: string, id: string) {
      const row = await get(actor, promptId, id);
      return { item: privatePromptRecord(row), privateResult: row.privateResult, contentDisposition: "untrusted_inert_text" as const };
    },
    async create(actor: PrivatePromptIdentity, promptId: string, raw: CreatePrivatePromptTest) {
      const input = createPrivatePromptTestSchema.parse(raw);
      const digest = privateConfigDigest({ ...input, promptId });
      const created = await db.transaction(async tx => {
        await authorizePrivatePrompt(tx, actor);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${actor.companyId}:private-prompt:${input.requestId}`}, 0))`);
        const [prior] = await tx.select().from(tests).where(and(eq(tests.companyId, actor.companyId), eq(tests.requestId, input.requestId)));
        if (prior) {
          if (prior.actorUserId !== actor.userId || prior.requestDigest !== digest) throw conflict("private_prompt_request_conflict");
          // A fresh valid session may recover the same user intent; execution
          // still revalidates the original approval session before dispatch.
          return { row: prior, duplicate: true };
        }
        const bound = await validatePrivatePromptResources(tx, actor, input, promptId);
        const [row] = await tx.insert(tests).values({ companyId: actor.companyId, promptId, revisionId: input.revisionId,
          headReceiptId: input.expectedHeadReceiptId, revisionHash: bound.revision.contentHash, requestId: input.requestId,
          requestDigest: digest, actorUserId: actor.userId, actorSessionId: actor.sessionId, agentId: input.agentId,
          datasetId: input.datasetId, datasetHash: bound.dataset.datasetHash, caseId: input.caseId,
          skillVersionId: input.skillVersionId, skillVersionHash: privateConfigDigest(bound.version.fileInventory), secretValueHash: bound.secret.valueHash, configDigest: bound.profile.configDigest }).returning();
        await tx.insert(activityLog).values({ companyId: actor.companyId, actorType: "user", actorId: actor.userId,
          action: "prompt_registry.private_test_authorized", entityType: "private_prompt_test", entityId: row!.id,
          details: { executionProfile: input.executionProfile, runtimeApplied: false } });
        return { row: row!, duplicate: false };
      });
      if (["pending_harness", "pending_wake"].includes(created.row.status)) {
        await db.transaction(async tx => {
          const [row] = await tx.select().from(tests).where(eq(tests.id, created.row.id)).for("update");
          if (row.status !== "pending_harness") return;
          await validatePrivatePromptResources(tx, { ...actor, sessionId: row.actorSessionId }, privatePromptInput(row), promptId, true);
          const assertHarness = async (issue: typeof issues.$inferSelect) => { assertPrivatePromptHarness(issue, row); };
          const issue = await issueService(db).create(actor.companyId, { id: randomUUID(), title: "Private prompt test",
            description: "Private prompt test. Results are available only through the private prompt test API.",
            visibility: "private", status: "todo", assigneeAgentId: row.agentId, workMode: "skill_test", harnessKind: "skill_test",
            originKind: "private_prompt_test", originId: row.id, createdByUserId: actor.userId,
            actorResponsibleUserId: actor.userId, responsibleUserId: actor.userId, trustExplicitResponsibleUserId: true,
            idempotencyKey: `private-prompt-test:${row.id}`, assertCanReuseIssue: assertHarness }, tx);
          await assertHarness(issue);
          await tx.update(tests).set({ issueId: issue.id, status: "pending_wake", updatedAt: new Date() }).where(eq(tests.id, row.id));
        });
        const row = await get(actor, promptId, created.row.id);
        if (row.status === "pending_wake") {
          if (!wake || !row.issueId) throw unprocessable("private_prompt_wake_unavailable");
          await wake(row.agentId, privatePromptWakeOptions(row));
        }
      }
      return { item: privatePromptRecord(await get(actor, promptId, created.row.id)), duplicate: created.duplicate };
    },
  };
}
