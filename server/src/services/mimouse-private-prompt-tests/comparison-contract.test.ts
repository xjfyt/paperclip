import { describe, expect, it } from "vitest";
import { comparePrivatePromptTestsSchema } from "@paperclipai/shared/mimouse-private-prompt-comparison";
const id = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const input = { datasetId: id(1), baselineRevisionId: id(2), candidateRevisionId: id(3), testIds: [id(4)], maxCandidateCostCents: null };
describe("private historical comparison request", () => {
  it("accepts only explicit IDs and a nonnegative optional cost bound", () => {
    expect(comparePrivatePromptTestsSchema.parse(input)).toEqual(input);
    for (const patch of [{ output: "private" }, { score: 1 }, { companyId: id(8) }, { testIds: [] },
      { testIds: [id(4), id(4)] }, { candidateRevisionId: id(2) }, { maxCandidateCostCents: -1 }, { maxCandidateCostCents: Infinity }]) {
      expect(comparePrivatePromptTestsSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    }
  });
});

it("normalizes only UUIDs before rejecting semantic duplicates and same revisions", () => {
  const letterId = "abcdef12-abcd-4abc-8abc-abcdef123456";
  const parsed = comparePrivatePromptTestsSchema.parse({ ...input, datasetId: letterId.toUpperCase(), testIds: [letterId.toUpperCase()] });
  expect(parsed.datasetId).toBe(letterId); expect(parsed.testIds).toEqual([letterId]);
  expect(comparePrivatePromptTestsSchema.safeParse({ ...input, testIds: [letterId, letterId.toUpperCase()] }).success).toBe(false);
  expect(comparePrivatePromptTestsSchema.safeParse({ ...input, baselineRevisionId: letterId, candidateRevisionId: letterId.toUpperCase() }).success).toBe(false);
});
