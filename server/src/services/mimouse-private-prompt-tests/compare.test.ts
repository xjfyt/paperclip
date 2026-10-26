import { privatePromptComparisonSchema } from "@paperclipai/shared/mimouse-private-prompt-comparison";
import { expect, it } from "vitest";
import { comparePrivatePromptEvidence } from "./compare.js";
import { comparisonFixture, comparisonId as id } from "./comparison-fixture.js";
import { privateConfigDigest } from "./profile.js";
it("compares exact raw result text, preserves fractions, and exposes no private contents", async () => {
  const report = await comparePrivatePromptEvidence(comparisonFixture());
  expect(report).toMatchObject({ readOnly: true, executionStarted: false, promoted: false, runtimeApplied: false, completeContextCaptured: false,
    eligibleForHumanReview: true, baseline: { passed: 1, totalCostCents: 0.125 }, candidate: { passed: 1, totalCostCents: 0.125 } });
  expect(JSON.stringify(report)).not.toMatch(/SENTINEL|WRONG_TRIMMED|exact|fixed-fixture|secretValueHash/);
});
it("same evidence order has the same deterministic report hash", async () => {
  const a = comparisonFixture(), b = comparisonFixture(); b.tests.reverse(); b.revisions.reverse(); b.input.testIds.reverse();
  expect((await comparePrivatePromptEvidence(a)).reportHash).toBe((await comparePrivatePromptEvidence(b)).reportHash);
});
it("does not trim whitespace, use summaries or stringify structured-only outputs", async () => {
  const e = comparisonFixture(); e.tests[1].privateResult!.resultJson!.result = "exact\r\nanswer";
  expect((await comparePrivatePromptEvidence(e)).candidate.passed).toBe(0);
  delete e.tests[1].privateResult!.resultJson!.result;
  e.tests[1].privateResult!.resultJson!.structured_output = { result: e.dataset.cases[0].expected };
  e.tests[1].privateResult!.summary = e.dataset.cases[0].expected;
  const report = await comparePrivatePromptEvidence(e);
  expect(report.candidate).toMatchObject({ passed: 0, blocked: 1 });
  expect(report.results.find(r => r.revisionId === e.input.candidateRevisionId)?.blocked).toBe("unsupported_output_format");
});
it("keeps the full dataset denominator and blocks both missing sides without auto-selection", async () => {
  const e = comparisonFixture(); e.dataset.cases.push({ id: id(90), input: "another", expected: "answer" });
  e.dataset.datasetHash = privateConfigDigest(e.dataset.cases); e.tests.forEach(t => { t.datasetHash = e.dataset.datasetHash; });
  const report = await comparePrivatePromptEvidence(e);
  expect(report.baseline).toMatchObject({ cases: 2, passed: 1, blocked: 1 });
  expect(report.candidate).toMatchObject({ cases: 2, passed: 1, blocked: 1 });
  expect(report.eligibleForHumanReview).toBe(false);
  expect(report.results.filter(r => r.blocked === "missing_run")).toHaveLength(2);
});
it("unknown costs remain unknown and block review without requiring a cost limit", async () => {
  const e = comparisonFixture(); e.costs.clear(); const report = await comparePrivatePromptEvidence(e);
  expect(report.baseline.totalCostCents).toBe(null); expect(report.candidate.totalCostCents).toBe(null);
  expect(report.blockers).toEqual(["baseline_cost_unknown", "candidate_cost_unknown"]);
  expect(report.candidate.passed).toBe(1); expect(report.eligibleForHumanReview).toBe(false);
});
it("known costs over the explicit limit block review", async () => {
  const e = comparisonFixture(); e.input.maxCandidateCostCents = 0;
  expect((await comparePrivatePromptEvidence(e)).blockers).toContain("candidate_cost_exceeds_limit");
});
it.each(["queued", "prepared", "spawned", "failed", "unknown", "cancelled"] as const)("%s history cannot score as complete", async status => {
  const e = comparisonFixture(); e.tests[1].status = status;
  const report = await comparePrivatePromptEvidence(e); expect(report.candidate.blocked).toBe(1); expect(report.eligibleForHumanReview).toBe(false);
});
it.each(["companyId", "actorUserId", "promptId", "datasetId", "caseId", "skillVersionId", "revisionHash", "datasetHash", "skillVersionHash"] as const)("rejects altered %s evidence", async field => {
  const e = comparisonFixture(); e.tests[1][field] = id(99); await expect(comparePrivatePromptEvidence(e)).rejects.toThrow();
});
it.each(["configDigest", "secretValueHash", "agentId"] as const)("rejects unequal historical %s", async field => {
  const e = comparisonFixture(); e.tests[1][field] = privateConfigDigest("changed"); await expect(comparePrivatePromptEvidence(e)).rejects.toThrow();
});
it.each(["attemptId", "heartbeatRunId", "testId", "promptHash", "runtimeConfigHash", "revisionHash", "implementation"] as const)("rejects mismatched prepared %s", async field => {
  const e = comparisonFixture(); (e.tests[1].prepared as unknown as Record<string, unknown>)[field] = privateConfigDigest("changed");
  await expect(comparePrivatePromptEvidence(e)).rejects.toThrow();
});
it("rejects tampered fixed revision, skill, dataset, approval snapshot and run/harness bindings", async () => {
  const mutations = [
    (e: ReturnType<typeof comparisonFixture>) => { e.revisions[0].content += "changed"; },
    (e: ReturnType<typeof comparisonFixture>) => { e.version.fileInventory[0].content += "changed"; },
    (e: ReturnType<typeof comparisonFixture>) => { e.dataset.cases[0].expected += "changed"; },
    (e: ReturnType<typeof comparisonFixture>) => { e.tests[0].approvalSnapshot = null; },
    (e: ReturnType<typeof comparisonFixture>) => { e.tests[0].approvalSnapshot!.configuredCwd = "/changed"; },
    (e: ReturnType<typeof comparisonFixture>) => { e.runs[0].wakeupRequestId = id(99); },
    (e: ReturnType<typeof comparisonFixture>) => { e.issues[0].responsibleUserId = "other"; },
  ];
  for (const mutate of mutations) { const e = comparisonFixture();
    // Snapshot objects deliberately copied independently for each historical test.
    e.tests = structuredClone(e.tests); e.tests[0].approvalSnapshot = structuredClone(e.tests[0].approvalSnapshot);
    mutate(e); await expect(comparePrivatePromptEvidence(e)).rejects.toThrow(); }
});
it("rejects duplicate/extra evidence, same revision, and oversized outputs", async () => {
  for (const mode of ["duplicate", "extra", "same", "size"]) {
    const e = comparisonFixture();
    if (mode === "duplicate") { e.tests.push({ ...e.tests[0], id: id(99) }); e.input.testIds.push(id(99)); }
    if (mode === "extra") e.tests.push(e.tests[0]);
    if (mode === "same") e.input.candidateRevisionId = e.input.baselineRevisionId;
    if (mode === "size") e.tests[1].privateResult!.resultJson!.result = "x".repeat(2_000_001);
    await expect(comparePrivatePromptEvidence(e)).rejects.toThrow();
  }
});

it("the shared response contract rejects inconsistent matrices, costs and false green", async () => {
  const good = await comparePrivatePromptEvidence(comparisonFixture());
  const changes = [
    (r: typeof good) => { r.results.pop(); },
    (r: typeof good) => { r.baseline.passed = 0; },
    (r: typeof good) => { r.results[0].caseId = id(99); },
    (r: typeof good) => { r.results[0].testId = null; },
    (r: typeof good) => { r.results[0].outputHash = null; },
    (r: typeof good) => { r.candidate.totalCostCents = null; },
    (r: typeof good) => { r.candidate.unknownCostCases = 1; },
    (r: typeof good) => { r.blockers.push("candidate_cost_unknown"); },
    (r: typeof good) => { r.eligibleForHumanReview = false; },
  ];
  for (const change of changes) { const report = structuredClone(good); change(report); expect(privatePromptComparisonSchema.safeParse(report).success).toBe(false); }
});

it("accepts uppercase explicit UUIDs against canonical historical evidence", async () => {
  const e = comparisonFixture(), original = await comparePrivatePromptEvidence(e);
  e.input = { ...e.input, datasetId: e.input.datasetId.toUpperCase(), baselineRevisionId: e.input.baselineRevisionId.toUpperCase(),
    candidateRevisionId: e.input.candidateRevisionId.toUpperCase(), testIds: e.input.testIds.map(id => id.toUpperCase()) };
  expect((await comparePrivatePromptEvidence(e)).reportHash).toBe(original.reportHash);
});
