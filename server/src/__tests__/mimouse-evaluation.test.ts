import { test } from "vitest";
import assert from "node:assert/strict";
import { compareRecordedSkillRuns, type RecordedSkillRun } from "../services/mimouse-evaluation/compare.js";
const cases = [{ id: "one", input: "fixed input", expected: "correct" }];
const run = (versionId: string, patch = {}): RecordedSkillRun => ({ id: versionId+"-run", companyId: "company-a", skillId: "skill-a", versionId, caseId: "one", inputSnapshot: "fixed input", outputSnapshot: "correct", status: "succeeded", costCents: 2, executionContextHash: "same-context", ...patch });
const input = { companyId: "company-a", skillId: "skill-a", datasetId: "dataset-v1", baselineVersionId: "base", candidateVersionId: "next", cases, runs: [run("base", { outputSnapshot: "wrong" }), run("next")], maxCandidateCostCents: 10 };
test("uses the existing kernel for a fixed two-version matrix without executing or promoting", async () => { const report = await compareRecordedSkillRuns(input); assert.equal(report.passCountDelta, 1); assert.equal(report.eligibleForHumanReview, true); assert.equal(report.executionStarted, false); assert.equal(report.promoted, false); assert.equal(report.results.length, 2); assert.ok(!JSON.stringify(report).includes('fixed input')); });
test("missing and failed cases never reduce the denominator into a green report", async () => { for (const runs of [[run("base")], [run("base"), run("next", { status: "failed" })]]) { const report=await compareRecordedSkillRuns({...input,runs}); assert.equal(report.candidate.cases,1);assert.equal(report.eligibleForHumanReview,false);assert.ok(report.blockers.includes('incomplete_or_mismatched_evidence')); } });
test("edited input snapshots cannot be compared as the frozen dataset", async () => { const report=await compareRecordedSkillRuns({...input,runs:[run('base'),run('next',{inputSnapshot:'different input'})]}); assert.equal(report.results[1].blocked,'input_snapshot_mismatch'); });
test("unknown cost is not free and blocks a bounded-cost review", async () => { const report=await compareRecordedSkillRuns({...input,runs:[run('base'),run('next',{costCents:null})]}); assert.equal(report.candidate.totalCostCents,null);assert.equal(report.candidate.unknownCostCases,1);assert.ok(report.blockers.includes('candidate_cost_unknown')); });
test("foreign company, skill, version, duplicate runs and cases fail closed", async () => { for(const patch of [{companyId:'other'},{skillId:'other'},{versionId:'other'}]) await assert.rejects(compareRecordedSkillRuns({...input,runs:[run('base'),run('next',patch)]}),/foreign_eval_evidence/); await assert.rejects(compareRecordedSkillRuns({...input,cases:[...cases,...cases]}),/duplicate_eval_case/);await assert.rejects(compareRecordedSkillRuns({...input,runs:[run('base'),run('next'),run('next')]}),/duplicate_or_missing_run/); });
test("data order is canonical and expected-output edits change the bound dataset", async () => { const a=await compareRecordedSkillRuns(input),b=await compareRecordedSkillRuns({...input,runs:[...input.runs].reverse()});assert.equal(a.reportHash,b.reportHash); const c=await compareRecordedSkillRuns({...input,cases:[{...cases[0],expected:'different'}]});assert.notEqual(a.datasetHash,c.datasetHash);assert.equal(c.eligibleForHumanReview,false); });

test("version/case identifiers cannot alias through separator characters", async () => {
  const report = await compareRecordedSkillRuns({ ...input, baselineVersionId: "a:b", candidateVersionId: "a",
    cases: [{ id: "c", input: "fixed input", expected: "correct" }, { id: "b:c", input: "fixed input", expected: "correct" }],
    runs: [run("a:b", { caseId: "c" }), run("a", { caseId: "c" })] });
  assert.equal(report.results.filter(row => row.blocked === "missing_run").length, 2);
  assert.equal(report.eligibleForHumanReview, false);
});

import { recordedEvaluationCost } from "../services/mimouse-evaluation/cost.js";
import { createEvaluationDatasetSchema, createEvaluationComparisonSchema } from "@paperclipai/shared/mimouse-evaluation";
import { getTableConfig } from "drizzle-orm/pg-core";
import { companySkillTestRuns } from "../../../packages/db/src/schema/company_skills.js";
const uid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
test("harness issue cost cannot be shared between two stored test runs", () => {
  const index = getTableConfig(companySkillTestRuns).indexes.find(item => item.config.name === "company_skill_test_runs_company_issue_idx");
  assert.equal(index?.config.unique, true);
  assert.deepEqual(index?.config.columns.map(column => "name" in column ? column.name : null), ["company_id", "issue_id"]);
});
test("recorded costs preserve fractional cents and fail closed on absent, unpriced and invalid evidence", () => {
  const priced = { costCents: 0.125, costStatus: "reported", billingType: "metered" };
  assert.equal(recordedEvaluationCost([]), null);
  assert.equal(recordedEvaluationCost([priced, priced]), 0.25);
  assert.equal(recordedEvaluationCost([priced, { ...priced, costStatus: "unpriced" }]), null);
  assert.equal(recordedEvaluationCost([{ ...priced, costCents: -1 }]), null);
  assert.equal(recordedEvaluationCost([{ ...priced, costCents: NaN }]), null);
  assert.equal(recordedEvaluationCost([{ ...priced, costCents: 0, billingType: "subscription_included", costStatus: "unpriced" }]), 0);
});
test("request schemas reject client-supplied output, score, input text and duplicate identities", () => {
  const dataset = { requestId: uid(1), skillId: uid(2), name: "frozen", cases: [{ inputId: uid(3), expected: "answer" }] };
  assert.equal(createEvaluationDatasetSchema.safeParse(dataset).success, true);
  assert.equal(createEvaluationDatasetSchema.safeParse({ ...dataset, cases: [{ ...dataset.cases[0], input: "forged" }] }).success, false);
  assert.equal(createEvaluationDatasetSchema.safeParse({ ...dataset, cases: [...dataset.cases, ...dataset.cases] }).success, false);
  const comparison = { requestId: uid(1), datasetId: uid(2), baselineVersionId: uid(3), candidateVersionId: uid(4), runIds: [uid(5)], maxCandidateCostCents: null };
  assert.equal(createEvaluationComparisonSchema.safeParse(comparison).success, true);
  for (const forged of [{ score: 1 }, { outputSnapshot: "pass" }, { companyId: uid(9) }, { runs: [] }]) assert.equal(createEvaluationComparisonSchema.safeParse({ ...comparison, ...forged }).success, false);
  assert.equal(createEvaluationComparisonSchema.safeParse({ ...comparison, candidateVersionId: uid(3) }).success, false);
  assert.equal(createEvaluationComparisonSchema.safeParse({ ...comparison, runIds: [uid(5), uid(5)] }).success, false);
});

test("different or absent execution context cannot claim an isolated skill improvement", async () => {
  for (const executionContextHash of [null, "different-context"]) {
    const report = await compareRecordedSkillRuns({ ...input, runs: [run("base"), run("next", { executionContextHash })] });
    assert.equal(report.eligibleForHumanReview, false);
    assert.ok(report.results.some(row => row.blocked?.startsWith("execution_context_")));
  }
});

test("completed superseded snapshots remain comparable and cancelled history remains blocked", async () => {
  const supersededAt = "2026-10-26T00:00:00.000Z";
  const report = await compareRecordedSkillRuns({ ...input, runs: [run("base", { supersededAt }), run("next")] });
  assert.equal(report.eligibleForHumanReview, true); assert.equal(report.results[0].supersededAt, supersededAt);
  for (const status of ["queued", "running", "cancelled", "failed"]) {
    const blocked = await compareRecordedSkillRuns({ ...input, runs: [run("base", { supersededAt, status }), run("next")] });
    assert.equal(blocked.eligibleForHumanReview, false); assert.equal(blocked.results[0].blocked, "run_not_succeeded");
  }
});
