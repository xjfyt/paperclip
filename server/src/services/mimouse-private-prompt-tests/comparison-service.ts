import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { authSessions, authUsers, companies, companyMemberships, companySkillVersions, costEvents, heartbeatRuns, issues,
  mimouseEvaluationDatasets, mimousePromptRevisions, type Db } from "@paperclipai/db";
import { mimousePrivatePromptTests as tests } from "@paperclipai/db/schema/mimouse_private_prompt_tests";
import { comparePrivatePromptTestsSchema, type ComparePrivatePromptTests } from "@paperclipai/shared/mimouse-private-prompt-comparison";
import { forbidden, notFound, unprocessable } from "../../errors.js";
import { recordedEvaluationCost } from "../mimouse-evaluation/cost.js";
import { comparePrivatePromptEvidence } from "./compare.js";
import type { PrivatePromptIdentity, PrivatePromptTx } from "./service.js";
/** No FOR SHARE: this authorization is usable inside an actual READ ONLY transaction. */
async function authorize(tx: PrivatePromptTx, actor: PrivatePromptIdentity) {
  const [session] = await tx.select({ id: authSessions.id }).from(authSessions).innerJoin(authUsers, eq(authUsers.id, authSessions.userId))
    .where(and(eq(authSessions.id, actor.sessionId), eq(authSessions.userId, actor.userId), gt(authSessions.expiresAt, new Date())));
  const [member] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).where(and(
    eq(companyMemberships.companyId, actor.companyId), eq(companyMemberships.principalType, "user"),
    eq(companyMemberships.principalId, actor.userId), eq(companyMemberships.status, "active"), inArray(companyMemberships.membershipRole, ["owner", "admin"])));
  const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, actor.companyId));
  if (!session || !member) throw forbidden("private_prompt_active_session_administrator_required");
  if (!company || company.status !== "active") throw unprocessable("private_prompt_active_company_required");
}
const readOnly = { isolationLevel: "repeatable read", accessMode: "read only" } as const;
/** A bounded historical snapshot, not a complete execution-context reproduction.
 * This service has no write, reconciliation, wake, logging or report-store dependency. */
/** Optional server-owned reauthorization is used for an already approved binding;
 * routes always use the session-bound default. It never accepts client policy. */
export function privatePromptComparisonService(db: Db, reauthorize: typeof authorize = authorize) {
  return { async compare(actor: PrivatePromptIdentity, promptId: string, raw: ComparePrivatePromptTests) {
    const input = comparePrivatePromptTestsSchema.parse(raw);
    const report = await db.transaction(async tx => {
      await reauthorize(tx, actor);
      const sizes = await tx.select({ skillVersionId: tests.skillVersionId, bytes: sql<number>`octet_length(coalesce(${tests.privateResult}::text, ''))`, allBytes: sql<number>`octet_length(to_jsonb(${tests})::text)` }).from(tests).where(and(
        eq(tests.companyId, actor.companyId), eq(tests.actorUserId, actor.userId), eq(tests.promptId, promptId), inArray(tests.id, input.testIds)));
      if (sizes.length !== input.testIds.length) throw notFound("private_comparison_evidence_not_found");
      if (sizes.some(s => s.bytes > 160000 || s.allBytes > 192000) || sizes.reduce((n, s) => n + s.allBytes, 0) > 2_000_000) throw unprocessable("private_comparison_result_size");
      const [datasetSize] = await tx.select({ bytes: sql<number>`octet_length(${mimouseEvaluationDatasets.cases}::text)` }).from(mimouseEvaluationDatasets)
        .where(and(eq(mimouseEvaluationDatasets.companyId, actor.companyId), eq(mimouseEvaluationDatasets.id, input.datasetId)));
      const [versionSize] = await tx.select({ bytes: sql<number>`octet_length(${companySkillVersions.fileInventory}::text)` }).from(companySkillVersions)
        .where(and(eq(companySkillVersions.companyId, actor.companyId), eq(companySkillVersions.id, sizes[0]!.skillVersionId)));
      const revisionSizes = await tx.select({ bytes: sql<number>`octet_length(${mimousePromptRevisions.content})` }).from(mimousePromptRevisions)
        .where(and(eq(mimousePromptRevisions.companyId, actor.companyId), eq(mimousePromptRevisions.promptId, promptId), inArray(mimousePromptRevisions.id, [input.baselineRevisionId, input.candidateRevisionId])));
      if (!datasetSize || !versionSize || revisionSizes.length !== 2) throw notFound("private_comparison_evidence_not_found");
      if (datasetSize.bytes > 1_000_000 || versionSize.bytes > 256000 || revisionSizes.some(r => r.bytes > 128000)) throw unprocessable("private_comparison_resource_size");
      // SQL JSONB text is a conservative loading budget, not the sealed-result
      // format. Leave formatting headroom; the pure verifier enforces 128k JSON.
      const totalBytes = sizes.reduce((sum, row) => sum + row.allBytes, 0) + datasetSize.bytes + versionSize.bytes + revisionSizes.reduce((sum, row) => sum + row.bytes, 0);
      if (totalBytes > 3_000_000) throw unprocessable("private_comparison_resource_size");
      const rows = await tx.select().from(tests).where(and(eq(tests.companyId, actor.companyId), eq(tests.actorUserId, actor.userId),
        eq(tests.promptId, promptId), inArray(tests.id, input.testIds)));
      // A foreign/private ID is indistinguishable from a nonexistent one.
      if (rows.length !== input.testIds.length) throw notFound("private_comparison_evidence_not_found");
      const [dataset] = await tx.select({ id: mimouseEvaluationDatasets.id, companyId: mimouseEvaluationDatasets.companyId, skillId: mimouseEvaluationDatasets.skillId,
        cases: mimouseEvaluationDatasets.cases, datasetHash: mimouseEvaluationDatasets.datasetHash }).from(mimouseEvaluationDatasets).where(and(eq(mimouseEvaluationDatasets.companyId, actor.companyId), eq(mimouseEvaluationDatasets.id, input.datasetId)));
      const revisions = await tx.select({ id: mimousePromptRevisions.id, companyId: mimousePromptRevisions.companyId, promptId: mimousePromptRevisions.promptId, content: mimousePromptRevisions.content, contentHash: mimousePromptRevisions.contentHash }).from(mimousePromptRevisions).where(and(eq(mimousePromptRevisions.companyId, actor.companyId),
        eq(mimousePromptRevisions.promptId, promptId), inArray(mimousePromptRevisions.id, [input.baselineRevisionId, input.candidateRevisionId])));
      const [version] = await tx.select({ id: companySkillVersions.id, companyId: companySkillVersions.companyId, companySkillId: companySkillVersions.companySkillId, fileInventory: companySkillVersions.fileInventory }).from(companySkillVersions).where(and(eq(companySkillVersions.companyId, actor.companyId), eq(companySkillVersions.id, sizes[0]!.skillVersionId)));
      if (!dataset || revisions.length !== 2 || !version) throw notFound("private_comparison_evidence_not_found");
      const issueIds = rows.flatMap(r => r.issueId ? [r.issueId] : []), runIds = rows.flatMap(r => r.heartbeatRunId ? [r.heartbeatRunId] : []);
      const harnesses = issueIds.length ? await tx.select({ id: issues.id, companyId: issues.companyId, visibility: issues.visibility, assigneeAgentId: issues.assigneeAgentId, responsibleUserId: issues.responsibleUserId, originKind: issues.originKind, originId: issues.originId, workMode: issues.workMode, harnessKind: issues.harnessKind }).from(issues).where(and(eq(issues.companyId, actor.companyId), inArray(issues.id, issueIds))) : [];
      const runs = runIds.length ? await tx.select({ id: heartbeatRuns.id, companyId: heartbeatRuns.companyId, agentId: heartbeatRuns.agentId, issueId: heartbeatRuns.issueId, scopeKind: heartbeatRuns.scopeKind, wakeupRequestId: heartbeatRuns.wakeupRequestId, status: heartbeatRuns.status, runtimeMode: heartbeatRuns.runtimeMode, retryOfRunId: heartbeatRuns.retryOfRunId }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, actor.companyId), inArray(heartbeatRuns.id, runIds))) : [];
      const ledger = issueIds.length ? await tx.select({ issueId: costEvents.issueId, agentId: costEvents.agentId, heartbeatRunId: costEvents.heartbeatRunId,
        costCents: costEvents.costCents, costStatus: sql<string>`case when ${costEvents.costStatus} = 'reported' then 'reported' else 'unpriced' end`,
        billingType: sql<string>`case when ${costEvents.billingType} = 'subscription_included' then 'subscription_included' else 'other' end` }).from(costEvents)
        .where(and(eq(costEvents.companyId, actor.companyId), inArray(costEvents.issueId, issueIds))).orderBy(costEvents.id).limit(10001) : [];
      if (ledger.length > 10000) throw unprocessable("private_comparison_cost_evidence_limit");
      const costs = new Map(rows.map(row => {
        const entries = ledger.filter(c => c.issueId === row.issueId);
        // Wrong or absent run attribution is not proof of this test's cost.
        return [row.id, entries.some(c => c.agentId !== row.agentId || c.heartbeatRunId !== row.heartbeatRunId) ? null : recordedEvaluationCost(entries)] as const;
      }));
      try { return await comparePrivatePromptEvidence({ actor, promptId, input, dataset, revisions, version, tests: rows, runs, issues: harnesses, costs }); }
      catch { throw unprocessable("private_comparison_evidence_invalid"); }
    }, readOnly);
    // Fresh snapshot catches revocation committed while scoring. This is not a
    // claim that authorization can be locked through network delivery.
    await db.transaction(tx => reauthorize(tx, actor), readOnly);
    return report;
  } };
}
