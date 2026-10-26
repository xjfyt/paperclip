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
