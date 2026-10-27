import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { agents, companySecrets, companySecretVersions, companySkillVersions, costEvents, heartbeatRuns, issues,
  mimouseEvaluationDatasets, mimousePromptRevisions, runUsageReceipts, agentWakeupRequests, environments, instanceSettings } from "@paperclipai/db";
import { mimousePrivatePromptTests as tests } from "@paperclipai/db/schema/mimouse_private_prompt_tests";
import { runtimeRoutingCandidateSchema, type RuntimeRoutingCandidateInput } from "@paperclipai/shared/runtime-cost-routing";
import { privatePromptApprovalSnapshotSchema } from "@paperclipai/shared/mimouse-private-prompt-tests";
import { notFound, unprocessable } from "../../errors.js";
import { recordedEvaluationCost } from "../mimouse-evaluation/cost.js";
import { comparePrivatePromptEvidence, type PrivateComparisonEvidence } from "../mimouse-private-prompt-tests/compare.js";
import { assertPrivatePromptLocalEnvironment, assertPrivatePromptProfile, assertPrivatePromptRuntimeConfig, privateConfigDigest,
  privatePromptExecutionPolicy } from "../mimouse-private-prompt-tests/profile.js";
import type { PrivatePromptIdentity, PrivatePromptTx } from "../mimouse-private-prompt-tests/service.js";
import { qualifyRuntimeRoutingCandidate, runtimeRoutingProfileHash, type RuntimeRoutingEvidenceConstraints } from "./evidence.js";

/** Current pinned profile only: the caller additionally pins the broader
 * ordinary-runtime application target. No secret value is resolved/copied. */
async function currentProfileHash(tx: PrivatePromptTx, companyId: string, agentId: string) {
  const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).for("share");
  if (!agent || !["active", "idle", "running"].includes(agent.status)) throw unprocessable("runtime_routing_agent_unavailable");
  assertPrivatePromptRuntimeConfig(agent.runtimeConfig, agent.defaultEnvironmentId);
  const profile = assertPrivatePromptProfile(agent.adapterType, agent.adapterConfig);
  const [settings] = await tx.select().from(instanceSettings).where(eq(instanceSettings.singletonKey, "default")).for("share");
  const source = agent.defaultEnvironmentId ? "agent" : settings?.defaultEnvironmentId ? "instance" : "implicit";
  const requestedId = agent.defaultEnvironmentId ?? settings?.defaultEnvironmentId;
  const [environment] = await tx.select().from(environments).where(requestedId ? eq(environments.id, requestedId) : eq(environments.driver, "local")).for("share");
  const effectiveEnvironment = { source, ...assertPrivatePromptLocalEnvironment(environment) };
  const executionPolicy = privatePromptExecutionPolicy(settings?.general, settings?.experimental, process.env.PAPERCLIP_EXECUTION_MODE);
  const configDigest = privateConfigDigest({ adapterConfig: agent.adapterConfig, effectiveEnvironment, executionPolicy });
  const [secret] = await tx.select({ hash: companySecretVersions.valueSha256 }).from(companySecrets)
    .innerJoin(companySecretVersions, eq(companySecretVersions.secretId, companySecrets.id)).where(and(eq(companySecrets.companyId, companyId),
      eq(companySecrets.id, profile.secretId), eq(companySecrets.provider, "local_encrypted"), eq(companySecrets.scope, "company"),
      isNull(companySecrets.deletedAt), eq(companySecretVersions.version, profile.secretVersion), isNull(companySecretVersions.revokedAt))).for("share");
  if (!secret) throw unprocessable("runtime_routing_pinned_secret_unavailable");
  const snapshot = privatePromptApprovalSnapshotSchema.parse({ schemaVersion: 1, executionProfile: "claude_cli_bare_api_key_v1",
    adapterType: "claude_local", engine: "cli", model: profile.model, configuredCwd: agent.adapterConfig.cwd ?? null,
    environment: { source, id: effectiveEnvironment.id, driver: "local" },
    credential: { kind: "pinned_company_secret", secretId: profile.secretId, version: profile.secretVersion }, configDigest,
    freshSession: true, toolsEnabled: false, paperclipCredentialsEnabled: false, completeContextCaptured: false });
  return runtimeRoutingProfileHash(snapshot, secret.hash);
}
/** Read-only loader inside the caller's transaction. Caller owns authorization,
 * application/head locks and fresh principal rechecks. There is no reconciliation,
 * model execution, wake, report write or independent accounting writer here. */
export async function buildRuntimeRoutingCandidate(tx: PrivatePromptTx, actor: PrivatePromptIdentity,
  raw: RuntimeRoutingCandidateInput, constraints: RuntimeRoutingEvidenceConstraints) {
  const candidate = runtimeRoutingCandidateSchema.parse(raw), input = candidate.comparison;
  if (input.testIds.length > 200) throw unprocessable("runtime_routing_evidence_limit");
  const scope = and(eq(tests.companyId, actor.companyId), eq(tests.actorUserId, actor.userId),
    eq(tests.agentId, candidate.agentId), eq(tests.promptId, candidate.promptId), inArray(tests.id, input.testIds));
  const sizes = await tx.select({ skillVersionId: tests.skillVersionId, bytes: sql<number>`octet_length(to_jsonb(${tests})::text)` }).from(tests).where(scope).for("share");
  if (sizes.length !== input.testIds.length) throw notFound("runtime_routing_evidence_not_found");
  if (sizes.some(r => r.bytes > 192000) || sizes.reduce((n, r) => n + r.bytes, 0) > 2_000_000
    || new Set(sizes.map(r => r.skillVersionId)).size !== 1) throw unprocessable("runtime_routing_evidence_limit");
  const [datasetSize] = await tx.select({ bytes: sql<number>`octet_length(${mimouseEvaluationDatasets.cases}::text)` }).from(mimouseEvaluationDatasets)
    .where(and(eq(mimouseEvaluationDatasets.companyId, actor.companyId), eq(mimouseEvaluationDatasets.id, input.datasetId))).for("share");
  const [versionSize] = await tx.select({ bytes: sql<number>`octet_length(${companySkillVersions.fileInventory}::text)` }).from(companySkillVersions)
    .where(and(eq(companySkillVersions.companyId, actor.companyId), eq(companySkillVersions.id, sizes[0]!.skillVersionId))).for("share");
  const revisionScope = and(eq(mimousePromptRevisions.companyId, actor.companyId), eq(mimousePromptRevisions.promptId, candidate.promptId),
    inArray(mimousePromptRevisions.id, [input.baselineRevisionId, input.candidateRevisionId]));
  const revisionSizes = await tx.select({ bytes: sql<number>`octet_length(${mimousePromptRevisions.content})` }).from(mimousePromptRevisions).where(revisionScope).for("share");
  if (!datasetSize || !versionSize || revisionSizes.length !== 2) throw notFound("runtime_routing_evidence_not_found");
  if (datasetSize.bytes > 1_000_000 || versionSize.bytes > 256000 || revisionSizes.some(r => r.bytes > 128000)
    || sizes.reduce((n, r) => n + r.bytes, 0) + datasetSize.bytes + versionSize.bytes + revisionSizes.reduce((n, r) => n + r.bytes, 0) > 3_000_000) {
    throw unprocessable("runtime_routing_evidence_limit");
  }
  const rows = await tx.select().from(tests).where(scope).orderBy(tests.id).for("share");
  const [dataset] = await tx.select({ id: mimouseEvaluationDatasets.id, companyId: mimouseEvaluationDatasets.companyId,
    skillId: mimouseEvaluationDatasets.skillId, cases: mimouseEvaluationDatasets.cases, datasetHash: mimouseEvaluationDatasets.datasetHash })
    .from(mimouseEvaluationDatasets).where(and(eq(mimouseEvaluationDatasets.companyId, actor.companyId), eq(mimouseEvaluationDatasets.id, input.datasetId))).for("share");
  const [version] = await tx.select({ id: companySkillVersions.id, companyId: companySkillVersions.companyId,
    companySkillId: companySkillVersions.companySkillId, fileInventory: companySkillVersions.fileInventory })
    .from(companySkillVersions).where(and(eq(companySkillVersions.companyId, actor.companyId), eq(companySkillVersions.id, sizes[0]!.skillVersionId))).for("share");
  const revisions = await tx.select({ id: mimousePromptRevisions.id, companyId: mimousePromptRevisions.companyId,
    promptId: mimousePromptRevisions.promptId, content: mimousePromptRevisions.content, contentHash: mimousePromptRevisions.contentHash })
    .from(mimousePromptRevisions).where(revisionScope).for("share");
  if (!dataset || !version || revisions.length !== 2 || rows.length !== input.testIds.length) throw notFound("runtime_routing_evidence_not_found");
  const issueIds = rows.flatMap(r => r.issueId ? [r.issueId] : []), wakeIds = rows.flatMap(r => r.wakeupRequestId ? [r.wakeupRequestId] : []);
  const runIds = rows.flatMap(r => r.heartbeatRunId ? [r.heartbeatRunId] : []);
  if (issueIds.length !== rows.length || wakeIds.length !== rows.length || runIds.length !== rows.length) throw unprocessable("runtime_routing_binding_incomplete");
  const harnesses = await tx.select({ id: issues.id, companyId: issues.companyId, visibility: issues.visibility,
    assigneeAgentId: issues.assigneeAgentId, responsibleUserId: issues.responsibleUserId, originKind: issues.originKind,
    originId: issues.originId, workMode: issues.workMode, harnessKind: issues.harnessKind })
    .from(issues).where(and(eq(issues.companyId, actor.companyId), inArray(issues.id, issueIds))).for("share");
  const runs = await tx.select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId, agentId: heartbeatRuns.agentId,
    issueId: heartbeatRuns.issueId, scopeKind: heartbeatRuns.scopeKind, wakeupRequestId: heartbeatRuns.wakeupRequestId,
    status: heartbeatRuns.status, runtimeMode: heartbeatRuns.runtimeMode, retryOfRunId: heartbeatRuns.retryOfRunId,
    dispatchedAdapterType: sql<string | null>`${heartbeatRuns.runnerProfileJson}->'adapterDispatch'->>'adapterType'`,
    costAccountingPending: heartbeatRuns.costAccountingPending, costAccountedAt: heartbeatRuns.costAccountedAt,
    accountingProjectionVersion: heartbeatRuns.accountingProjectionVersion, startedAt: heartbeatRuns.startedAt,
    finishedAt: heartbeatRuns.finishedAt, usageJson: heartbeatRuns.usageJson })
    .from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, actor.companyId), or(inArray(heartbeatRuns.issueId, issueIds), inArray(heartbeatRuns.id, runIds)))).limit(201).for("share");
  const costs = await tx.select({ id: costEvents.id, issueId: costEvents.issueId, companyId: costEvents.companyId,
    agentId: costEvents.agentId, heartbeatRunId: costEvents.heartbeatRunId, model: costEvents.model, provider: costEvents.provider,
    biller: costEvents.biller, billingType: costEvents.billingType, costStatus: costEvents.costStatus,
    costCents: sql<string>`${costEvents.costCents}::text`, reportedCostCents: sql<string | null>`${costEvents.reportedCostCents}::text`,
    pricingProvenance: costEvents.pricingProvenance, idempotencyKey: costEvents.idempotencyKey, inputTokens: costEvents.inputTokens,
    cachedInputTokens: costEvents.cachedInputTokens, outputTokens: costEvents.outputTokens, occurredAt: costEvents.occurredAt })
    .from(costEvents).where(and(eq(costEvents.companyId, actor.companyId), or(inArray(costEvents.issueId, issueIds), inArray(costEvents.heartbeatRunId, runIds)))).orderBy(costEvents.id).limit(201).for("share");
  if (runs.length > 200 || costs.length > 200) throw unprocessable("runtime_routing_evidence_limit");
  const candidateRows = rows.filter(r => r.revisionId === input.candidateRevisionId), candidateRunIds = candidateRows.flatMap(r => r.heartbeatRunId ? [r.heartbeatRunId] : []);
  if (!candidateRunIds.length || candidateRunIds.length > 100) throw unprocessable("runtime_routing_evidence_limit");
  const receiptScope = and(eq(runUsageReceipts.companyId, actor.companyId), inArray(runUsageReceipts.runId, candidateRunIds));
  const receiptSizes = await tx.select({ bytes: sql<number>`octet_length(${runUsageReceipts.receiptJson}::text)` }).from(runUsageReceipts).where(receiptScope).limit(101).for("share");
  if (receiptSizes.length > 100 || receiptSizes.some(r => r.bytes > 64000) || receiptSizes.reduce((n, r) => n + r.bytes, 0) > 1_000_000) throw unprocessable("runtime_routing_evidence_limit");
  const receipts = await tx.select().from(runUsageReceipts).where(receiptScope).limit(101).for("share");
  const wakes = await tx.select({ id: agentWakeupRequests.id, companyId: agentWakeupRequests.companyId, agentId: agentWakeupRequests.agentId,
    runId: agentWakeupRequests.runId, status: agentWakeupRequests.status, source: agentWakeupRequests.source, reason: agentWakeupRequests.reason,
    requestedByActorType: agentWakeupRequests.requestedByActorType, requestedByActorId: agentWakeupRequests.requestedByActorId,
    idempotencyKey: agentWakeupRequests.idempotencyKey }).from(agentWakeupRequests)
    .where(and(eq(agentWakeupRequests.companyId, actor.companyId), inArray(agentWakeupRequests.id, wakeIds))).for("share");
  const comparison: PrivateComparisonEvidence = { actor, promptId: candidate.promptId, input, dataset, version, revisions, tests: rows,
    runs, issues: harnesses, costs: new Map(rows.map(row => {
      const entries = costs.filter(cost => cost.issueId === row.issueId);
      return [row.id, entries.some(cost => cost.agentId !== row.agentId || cost.heartbeatRunId !== row.heartbeatRunId)
        ? null : recordedEvaluationCost(entries.map(cost => ({ ...cost, costCents: Number(cost.costCents) })))];
    })) };
  try {
    const profileHash = await currentProfileHash(tx, actor.companyId, candidate.agentId);
    const report = await comparePrivatePromptEvidence(comparison);
    return await qualifyRuntimeRoutingCandidate({ comparison, candidate, currentProfileHash: profileHash, wakes,
      accounting: candidateRows.map(row => ({ caseId: row.caseId, skillRunId: row.id, companyId: row.companyId, agentId: row.agentId,
        adapterType: "claude_local", issueId: row.issueId!, configHash: row.configDigest, executionContextHash: report.contextHash,
        costs: costs.filter(cost => cost.issueId === row.issueId || cost.heartbeatRunId === row.heartbeatRunId), heartbeats: runs.filter(run => run.issueId === row.issueId), receipts })) }, constraints);
  } catch { throw unprocessable("runtime_routing_evidence_invalid"); }
}
