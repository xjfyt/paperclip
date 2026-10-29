import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { feedbackImportSchema } from "@paperclipai/shared";
import { feedbackRunLogSelectionSchema, feedbackRunLogImportSchema, feedbackRunLogReferenceSchema } from "@paperclipai/shared/mimouse-feedback-run-log";
import { runLogPreviewDigest } from "../services/mimouse-feedback-run-log.js";
const id = "11111111-1111-4111-8111-111111111111";
const reference = feedbackRunLogReferenceSchema.parse({ contractVersion: "feedback-run-log-reference-v1", companyId: id,
  runId: id, eventId: "9007199254740993", eventSeq: 1, runCreatedAt: "2026-10-29T00:00:00.000001Z", eventCreatedAt: "2026-10-29T00:00:00.000002Z",
  referenceDigest: "a".repeat(64), softwareVersion: "unknown", commitSha: null, reproduction: "not_performed", contentIncluded: false });
it("accepts only server-addressable positive safe sequence selections", () => {
  for (const eventSeq of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) expect(feedbackRunLogSelectionSchema.safeParse({ runId: id, eventSeq }).success).toBe(false);
  for (const extra of [{ message: "secret" }, { payload: {} }, { issueId: id }, { contextSnapshot: { issueId: id } }]) expect(feedbackRunLogSelectionSchema.safeParse({ runId: id, eventSeq: 1, ...extra }).success).toBe(false);
  expect(feedbackRunLogImportSchema.safeParse({ runId: id, eventSeq: 1, previewDigest: "a".repeat(64), confirm: false }).success).toBe(false);
});
it("binds actor, session, company, event identity and exact microsecond metadata", () => {
  const actor = { userId: "one", sessionId: "one", type: "board" as const };
  const original = runLogPreviewDigest(reference, actor);
  for (const change of [{ eventId: "9007199254740994" }, { eventSeq: 2 }, { eventCreatedAt: "2026-10-29T00:00:00.000003Z" }, { companyId: "22222222-2222-4222-8222-222222222222" }]) expect(runLogPreviewDigest({ ...reference, ...change }, actor)).not.toBe(original);
  expect(runLogPreviewDigest(reference, { ...actor, userId: "two" })).not.toBe(original);
  expect(runLogPreviewDigest(reference, { ...actor, sessionId: "two" })).not.toBe(original);
});
it("prevents ordinary imports from claiming server-owned source namespaces", () => {
  const input = { sourceKind: "application_log", externalId: "one", title: "one", text: "one", product: "one", occurredAt: "2026-10-29T00:00:00Z" };
  for (const sourceInstance of ["internal.run-log.v1", "INTERNAL.run-log.v1", "internal:future", "internal"]) expect(feedbackImportSchema.safeParse({ ...input, sourceInstance }).success).toBe(false);
  expect(feedbackImportSchema.safeParse({ ...input, sourceInstance: "local-operator" }).success).toBe(true);
});
it("uses explicit source projections and no provider/log content reads or network calls", () => {
  const source = readFileSync(new URL("../services/mimouse-feedback-run-log.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/\.select\(\)/);
  expect(source).not.toMatch(/(?:events|runs)\.(?:message|payload|eventType|source\w+|log\w+|contextSnapshot|stdoutExcerpt|stderrExcerpt|resultJson|usageJson)/);
  expect(source).not.toMatch(/\bfetch\(|publishActivity\(|publishLiveEvent\(|heartbeatService\(/);
});
