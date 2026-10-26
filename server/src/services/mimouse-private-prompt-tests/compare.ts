import { z } from "zod";
import type { companySkillVersions, heartbeatRuns, issues, mimouseEvaluationDatasets, mimousePromptRevisions } from "@paperclipai/db";
import { privatePromptApprovalSnapshotSchema } from "@paperclipai/shared/mimouse-private-prompt-tests";
import { comparePrivatePromptTestsSchema, privatePromptComparisonSchema, type ComparePrivatePromptTests } from "@paperclipai/shared/mimouse-private-prompt-comparison";
import { compareRecordedSkillRuns, type RecordedSkillRun } from "../mimouse-evaluation/compare.js";
import { assertPrivatePromptHarness, assertPrivatePromptTextInventory, privateConfigDigest, privatePromptFixedContext, privatePromptHash, PRIVATE_PROMPT_IMPLEMENTATION } from "./profile.js";
import type { PrivatePromptIdentity, PrivatePromptRow } from "./service.js";
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const witnessSchema = z.object({ schemaVersion: z.literal(1), testId: uuid, attemptId: uuid, companyId: uuid, issueId: uuid,
  heartbeatRunId: uuid, agentId: uuid, revisionId: uuid, headReceiptId: uuid.nullable(), revisionHash: hash,
  promptHash: hash, promptBytes: z.number().int().positive().max(256000), runtimeConfigHash: hash,
  implementation: z.literal(PRIVATE_PROMPT_IMPLEMENTATION), providerConsumed: z.literal(false), stdinWritten: z.literal(false) }).strict();
export interface PrivateComparisonEvidence {
  actor: PrivatePromptIdentity; promptId: string; input: ComparePrivatePromptTests;
  dataset: Pick<typeof mimouseEvaluationDatasets.$inferSelect, "id" | "companyId" | "skillId" | "cases" | "datasetHash">;
  revisions: Array<Pick<typeof mimousePromptRevisions.$inferSelect, "id" | "companyId" | "promptId" | "content" | "contentHash">>;
  version: Pick<typeof companySkillVersions.$inferSelect, "id" | "companyId" | "companySkillId" | "fileInventory">;
  tests: PrivatePromptRow[];
  runs: Array<Pick<typeof heartbeatRuns.$inferSelect, "id" | "companyId" | "agentId" | "issueId" | "scopeKind" | "wakeupRequestId" | "status" | "runtimeMode" | "retryOfRunId">>;
  issues: Array<Pick<typeof issues.$inferSelect, "id" | "companyId" | "visibility" | "assigneeAgentId" | "responsibleUserId" | "originKind" | "originId" | "workMode" | "harnessKind">>;
  costs: Map<string, number | null>;
}
function requireEvidence(condition: unknown, code: string): asserts condition { if (!condition) throw Error(code); }
/** Pure historical verification. Never reads current agent config or a trimmed summary. */
export async function comparePrivatePromptEvidence(e: PrivateComparisonEvidence) {
  const input = comparePrivatePromptTestsSchema.parse(e.input), { actor, dataset, version } = e;
  requireEvidence(dataset.companyId === actor.companyId && dataset.id === input.datasetId &&
    version.companyId === actor.companyId && version.companySkillId === dataset.skillId, "private_comparison_resource_scope");
  requireEvidence(dataset.cases.length > 0 && dataset.cases.length <= 1000 && Buffer.byteLength(JSON.stringify(dataset.cases)) <= 1_000_000, "private_comparison_dataset_size");
  requireEvidence(Buffer.byteLength(JSON.stringify(version.fileInventory)) <= 256000 && e.revisions.every(r => Buffer.byteLength(r.content) <= 128000), "private_comparison_resource_size");
  requireEvidence(privateConfigDigest(dataset.cases) === dataset.datasetHash, "private_comparison_dataset_integrity");
  const caseMap = new Map(dataset.cases.map(c => [c.id, c]));
  requireEvidence(caseMap.size === dataset.cases.length, "private_comparison_duplicate_case");
  const revisionIds = [input.baselineRevisionId, input.candidateRevisionId];
  requireEvidence(e.revisions.length === 2 && new Set(e.revisions.map(r => r.id)).size === 2, "private_comparison_revisions_required");
  for (const r of e.revisions) requireEvidence(r.companyId === actor.companyId && r.promptId === e.promptId &&
    revisionIds.includes(r.id) && privatePromptHash(r.content) === r.contentHash, "private_comparison_revision_integrity");
  requireEvidence(e.tests.length === input.testIds.length && new Set(e.tests.map(t => t.id)).size === e.tests.length &&
    e.tests.every(t => input.testIds.includes(t.id)), "private_comparison_test_ids_mismatch");
  requireEvidence(Buffer.byteLength(JSON.stringify(e.tests.map(t => t.privateResult))) <= 2_000_000, "private_comparison_result_size");
  const inventory = assertPrivatePromptTextInventory(version.fileInventory), skillVersionHash = privateConfigDigest(version.fileInventory);
  let contextHash: string | null = null;
  const runs: RecordedSkillRun[] = [], unsupported = new Set<string>(), pairs = new Set<string>();
  for (const row of e.tests) {
    requireEvidence(Buffer.byteLength(JSON.stringify(row.privateResult)) <= 128000, "private_comparison_result_size");
    const revision = e.revisions.find(r => r.id === row.revisionId), scenario = caseMap.get(row.caseId);
    requireEvidence(row.companyId === actor.companyId && row.actorUserId === actor.userId && row.promptId === e.promptId &&
      revision && scenario && row.datasetId === dataset.id && row.datasetHash === dataset.datasetHash &&
      row.skillVersionId === version.id && row.skillVersionHash === skillVersionHash && row.revisionHash === revision.contentHash,
    "private_comparison_foreign_or_changed_evidence");
    const pair = JSON.stringify([row.revisionId, row.caseId]);
    requireEvidence(!pairs.has(pair), "private_comparison_ambiguous_case"); pairs.add(pair);
    const snapshot = privatePromptApprovalSnapshotSchema.safeParse(row.approvalSnapshot);
    requireEvidence(snapshot.success && snapshot.data.configDigest === row.configDigest && hash.safeParse(row.secretValueHash).success,
      "private_comparison_approval_snapshot_invalid");
    const prepared = witnessSchema.safeParse(row.prepared);
    // An unfinished test can contribute a blocked case, but never invent context.
    requireEvidence(prepared.success, "private_comparison_prepared_witness_required");
    const p = prepared.data;
    requireEvidence(p.testId === row.id && p.attemptId === row.attemptId && p.companyId === row.companyId && p.issueId === row.issueId &&
      p.heartbeatRunId === row.heartbeatRunId && p.agentId === row.agentId && p.revisionId === row.revisionId &&
      p.headReceiptId === row.headReceiptId && p.revisionHash === row.revisionHash, "private_comparison_witness_mismatch");
    const context = privatePromptFixedContext(scenario.input, version.id, inventory, revision.content);
    const literal = `${context}\n\n<private-prompt-revision>\n${revision.content}\n</private-prompt-revision>`;
    requireEvidence(p.promptHash === privatePromptHash(literal) && p.promptBytes === Buffer.byteLength(literal, "utf8"), "private_comparison_prompt_integrity");
    const currentContext = privateConfigDigest({ agentId: row.agentId, executionProfile: snapshot.data.executionProfile,
      snapshot: snapshot.data, secretValueHash: row.secretValueHash, implementation: p.implementation, runtimeConfigHash: p.runtimeConfigHash });
    requireEvidence(contextHash === null || contextHash === currentContext, "private_comparison_historical_context_mismatch"); contextHash = currentContext;
    const run = e.runs.find(r => r.id === row.heartbeatRunId), issue = e.issues.find(i => i.id === row.issueId);
    requireEvidence(run && issue && run.companyId === actor.companyId && run.agentId === row.agentId && run.wakeupRequestId === row.wakeupRequestId &&
      row.wakeupRequestId && run.issueId === row.issueId && run.scopeKind === "issue" && run.runtimeMode === "legacy" && !run.retryOfRunId, "private_comparison_run_binding_mismatch");
    assertPrivatePromptHarness(issue, row);
    const result = row.privateResult?.resultJson;
    const completed = row.status === "completed" && row.spawnedAt !== null && row.errorCode === null && run.status === "succeeded" &&
      result?.type === "result" && result.subtype === "success" && result.is_error !== true;
    const output = result?.result;
    if (completed && (typeof output !== "string" || output.length === 0)) unsupported.add(row.id);
    runs.push({ id: row.id, companyId: actor.companyId, skillId: dataset.skillId, versionId: row.revisionId, caseId: row.caseId,
      inputSnapshot: scenario.input, outputSnapshot: typeof output === "string" ? output : "", status: completed ? "succeeded" : "failed",
      costCents: e.costs.get(row.id) ?? null, executionContextHash: currentContext });
  }
  requireEvidence(contextHash, "private_comparison_context_required");
  const scored = await compareRecordedSkillRuns({ companyId: actor.companyId, skillId: dataset.skillId, datasetId: dataset.id,
    baselineVersionId: input.baselineRevisionId, candidateVersionId: input.candidateRevisionId, cases: dataset.cases, runs,
    maxCandidateCostCents: input.maxCandidateCostCents });
  const blockers = [...scored.blockers];
  if (scored.baseline.totalCostCents === null) blockers.push("baseline_cost_unknown");
  if (scored.candidate.totalCostCents === null && !blockers.includes("candidate_cost_unknown")) blockers.push("candidate_cost_unknown");
  const summary = (s: typeof scored.baseline) => ({ revisionId: s.versionId, revisionHash: e.revisions.find(r => r.id === s.versionId)!.contentHash,
    cases: s.cases, passed: s.passed, blocked: s.blocked, knownCostCents: s.knownCostCents, unknownCostCases: s.unknownCostCases, totalCostCents: s.totalCostCents });
  const report = { schemaVersion: 1, companyId: actor.companyId, actorUserId: actor.userId, promptId: e.promptId,
    datasetId: dataset.id, datasetHash: dataset.datasetHash, skillVersionId: version.id, skillVersionHash, agentId: e.tests[0]!.agentId, contextHash,
    baseline: summary(scored.baseline), candidate: summary(scored.candidate),
    results: scored.results.map(r => ({ caseId: r.caseId, revisionId: r.versionId, testId: r.runId, outputHash: r.outputHash,
      passed: r.passed, blocked: r.runId && unsupported.has(r.runId) ? "unsupported_output_format" : r.blocked })),
    blockers, eligibleForHumanReview: blockers.length === 0, readOnly: true, executionStarted: false, promoted: false,
    runtimeApplied: false, completeContextCaptured: false, costBasis: "recorded_issue_ledger_snapshot" };
  return privatePromptComparisonSchema.parse({ ...report, reportHash: privateConfigDigest(report) });
}
