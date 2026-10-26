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
export function privatePromptComparisonService(db: Db) {
  return { async compare(actor: PrivatePromptIdentity, promptId: string, raw: ComparePrivatePromptTests) {
    const input = comparePrivatePromptTestsSchema.parse(raw);
    const report = await db.transaction(async tx => {
      await authorize(tx, actor);
      const sizes = await tx.select({ bytes: sql<number>`octet_length(coalesce(${tests.privateResult}::text, ''))` }).from(tests).where(and(
        eq(tests.companyId, actor.companyId), eq(tests.actorUserId, actor.userId), eq(tests.promptId, promptId), inArray(tests.id, input.testIds)));
      if (sizes.length !== input.testIds.length) throw notFound("private_comparison_evidence_not_found");
      if (sizes.some(s => s.bytes > 128000) || sizes.reduce((n, s) => n + s.bytes, 0) > 2_000_000) throw unprocessable("private_comparison_result_size");
      const rows = await tx.select().from(tests).where(and(eq(tests.companyId, actor.companyId), eq(tests.actorUserId, actor.userId),
        eq(tests.promptId, promptId), inArray(tests.id, input.testIds)));
      // A foreign/private ID is indistinguishable from a nonexistent one.
      if (rows.length !== input.testIds.length) throw notFound("private_comparison_evidence_not_found");
      const [dataset] = await tx.select().from(mimouseEvaluationDatasets).where(and(eq(mimouseEvaluationDatasets.companyId, actor.companyId), eq(mimouseEvaluationDatasets.id, input.datasetId)));
      const revisions = await tx.select().from(mimousePromptRevisions).where(and(eq(mimousePromptRevisions.companyId, actor.companyId),
        eq(mimousePromptRevisions.promptId, promptId), inArray(mimousePromptRevisions.id, [input.baselineRevisionId, input.candidateRevisionId])));
      const [version] = await tx.select().from(companySkillVersions).where(and(eq(companySkillVersions.companyId, actor.companyId), eq(companySkillVersions.id, rows[0]!.skillVersionId)));
      if (!dataset || revisions.length !== 2 || !version) throw notFound("private_comparison_evidence_not_found");
      const issueIds = rows.flatMap(r => r.issueId ? [r.issueId] : []), runIds = rows.flatMap(r => r.heartbeatRunId ? [r.heartbeatRunId] : []);
      const harnesses = issueIds.length ? await tx.select().from(issues).where(and(eq(issues.companyId, actor.companyId), inArray(issues.id, issueIds))) : [];
      const runs = runIds.length ? await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, actor.companyId), inArray(heartbeatRuns.id, runIds))) : [];
      const ledger = issueIds.length ? await tx.select({ issueId: costEvents.issueId, agentId: costEvents.agentId, heartbeatRunId: costEvents.heartbeatRunId,
        costCents: costEvents.costCents, costStatus: costEvents.costStatus, billingType: costEvents.billingType }).from(costEvents)
        .where(and(eq(costEvents.companyId, actor.companyId), inArray(costEvents.issueId, issueIds))).limit(10001) : [];
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
    await db.transaction(tx => authorize(tx, actor), readOnly);
    return report;
  } };
}
