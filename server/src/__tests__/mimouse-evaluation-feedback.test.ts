import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { createEvaluationDatasetSchema } from "@paperclipai/shared/mimouse-evaluation";
import { evaluationService } from "../services/mimouse-evaluation/service.js";
import { compareRecordedSkillRuns } from "../services/mimouse-evaluation/compare.js";
import { canonical } from "../services/mimouse-operations/preview.js";
const uid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const companyId = uid(1), skillId = uid(2), inputId = uid(3), feedbackId = uid(4), actor = "reviewer";
const source = { id: feedbackId, companyId, sourceKind: "manual", ingestionMode: "manual_import", sourceInstance: "fixture", externalId: "event-1", product: "Editor", softwareVersion: "1", commitSha: null, traceId: null, contentDigest: "a".repeat(64), redactionVersion: 1, status: "candidate", occurredAt: new Date("2026-01-01"), redacted: false, body: "NEVER_COPY_RAW_BODY", title: "NEVER_COPY_TITLE", sourceUrl: "https://private.invalid/?secret=1" };
const testInput = { id: inputId, content: "  safe example  " };
function database(selects: unknown[][]) {
  const inserts: unknown[] = [];
  const tx = { execute: vi.fn(async () => undefined), select: vi.fn(() => {
    const result = selects.shift(); if (!result) throw Error("Unexpected select");
    const chain = { from: () => chain, where: () => chain, for: () => Promise.resolve(result), then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result).then(resolve) }; return chain;
  }), insert: vi.fn(() => ({ values: (value: Record<string, unknown>) => { inserts.push(value); return { returning: async () => [{ ...value, id: uid(8), createdAt: new Date("2026-01-01") }], then: (resolve: (value: undefined) => unknown) => Promise.resolve(undefined).then(resolve) }; } })) };
  return { db: { transaction: async (cb: (value: typeof tx) => unknown) => cb(tx) } as unknown as Db, inserts, tx };
}
const authority = () => [[{ status: "active" }], [{ status: "active", membershipRole: "admin" }]];
async function preview(patch = {}) {
  const fake = database([...authority(), [{ ...source, ...patch }], [testInput]]);
  return evaluationService(fake.db).previewFeedback(companyId, { skillId, inputId, feedbackId, expected: "answer" }, actor);
}
it("previews precise human-authored input and minimal quarantined references without raw feedback or execution", async () => {
  const result = await preview();
  expect(result).toMatchObject({ input: "safe example", sourceInputSnapshot: "  safe example  ", expected: "answer", executionStarted: false, source: { commitSha: null, sourceTrust: "quarantined", reproductionStatus: "not_reproduced" } });
  for (const hidden of ["NEVER_COPY", "secret=1", "sourceUrl", '"body"']) expect(JSON.stringify(result)).not.toContain(hidden);
});
it("digest binds actor, exact input including whitespace, expected value, company and source metadata", async () => {
  const { feedbackPreviewDigest } = await import("../services/mimouse-evaluation/feedback-lineage.js");
  const { previewDigest, executionStarted: _, ...snapshot } = await preview();
  expect(feedbackPreviewDigest(snapshot, actor)).toBe(previewDigest);
  for (const patch of [{ companyId: uid(9) }, { sourceInputSnapshot: "safe example" }, { input: "changed" }, { expected: "changed" }, { source: { ...snapshot.source, contentDigest: "b".repeat(64) } }]) expect(feedbackPreviewDigest({ ...snapshot, ...patch }, actor)).not.toBe(previewDigest);
  expect(feedbackPreviewDigest(snapshot, "another-person")).not.toBe(previewDigest);
  expect((await preview({ body: "different sanitized text" })).previewDigest).not.toBe(previewDigest);
});
it("requires explicit review and rejects forged provenance objects", async () => {
  const p = await preview(), base = { requestId: uid(5), skillId, name: "Regression", cases: [{ inputId, expected: "answer", feedback: { feedbackId, previewDigest: p.previewDigest, reviewed: true } }] };
  expect(createEvaluationDatasetSchema.safeParse(base).success).toBe(true);
  for (const patch of [{ reviewed: false }, { reviewed: undefined }, { sourceTrust: "trusted" }, { previewDigest: "bad" }]) expect(createEvaluationDatasetSchema.safeParse({ ...base, cases: [{ ...base.cases[0], feedback: { ...base.cases[0]!.feedback, ...patch } }] }).success).toBe(false);
});
it("freezes server provenance into existing cases JSON and rejects stale review before any insert", async () => {
  const p = await preview(), request = { requestId: uid(5), skillId, name: "Regression", cases: [{ inputId, expected: "answer", feedback: { feedbackId, previewDigest: p.previewDigest, reviewed: true as const } }] };
  const fake = database([...authority(), [], [{ status: "active" }], [testInput], [source], [testInput]]);
  const result = await evaluationService(fake.db).createDataset(companyId, request, actor);
  expect(result.item.cases[0]).toMatchObject({ input: "safe example", feedbackSource: { feedbackId, reviewedBy: actor, sourceTrust: "quarantined", reproductionStatus: "not_reproduced" } });
  expect(fake.inserts).toHaveLength(2); expect(JSON.stringify(fake.inserts)).not.toContain("NEVER_COPY");
  const changed = database([...authority(), [], [{ status: "active" }], [{ ...testInput, content: "new input" }], [source], [{ ...testInput, content: "new input" }]]);
  await expect(evaluationService(changed.db).createDataset(companyId, request, actor)).rejects.toThrow("stale"); expect(changed.inserts).toHaveLength(0);
  const changedSource = database([...authority(), [], [{ status: "active" }], [testInput], [{ ...source, body: "new redacted body" }], [testInput]]);
  await expect(evaluationService(changedSource.db).createDataset(companyId, request, actor)).rejects.toThrow("stale"); expect(changedSource.inserts).toHaveLength(0);
});
it("rechecks current membership, missing/deleted records and redaction protocol", async () => {
  for (const member of [[], [{ status: "suspended", membershipRole: "admin" }], [{ status: "active", membershipRole: "member" }]]) {
    const fake = database([[{ status: "active" }], member]);
    await expect(evaluationService(fake.db).previewFeedback(companyId, { skillId, inputId, feedbackId, expected: "answer" }, actor)).rejects.toThrow("active company owner");
  }
  for (const rows of [[[], [testInput]], [[source], []]]) {
    const fake = database([...authority(), ...rows]);
    await expect(evaluationService(fake.db).previewFeedback(companyId, { skillId, inputId, feedbackId, expected: "answer" }, actor)).rejects.toThrow("not found");
  }
  await expect(preview({ redactionVersion: 2 })).rejects.toThrow("Unsupported");
});
it("old cases retain exact hash; provenance participates in new hashes without inventing test results", async () => {
  const cases = [{ id: inputId, input: "safe example", sourceInputSnapshot: " safe example ", expected: "answer" }];
  const input = { companyId, skillId, datasetId: uid(6), baselineVersionId: uid(7), candidateVersionId: uid(8), cases, runs: [], maxCandidateCostCents: null };
  const report = await compareRecordedSkillRuns(input);
  expect(report.datasetHash).toBe(createHash("sha256").update(canonical(cases)).digest("hex"));
  const p = await preview();
  const linked = await compareRecordedSkillRuns({ ...input, cases: [{ ...cases[0]!, feedbackSource: { ...p.source, previewDigest: p.previewDigest, reviewedBy: actor } }] });
  expect(linked.datasetHash).not.toBe(report.datasetHash); expect(linked.eligibleForHumanReview).toBe(false); expect(linked.executionStarted).toBe(false); expect(linked.candidate.passed).toBe(0);
});
