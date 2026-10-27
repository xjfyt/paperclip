import { expect, it } from "vitest";
import { codingGoalDocument, codingGoalSchema, readCodingGoalDocument, saveCodingGoalSchema } from "./mimouse-coding-goal.js";
const goal = { schemaVersion: 1, problemValue: "Fix the reported regression", acceptanceScenarios: ["Regression test fails then passes"],
  allowedRepositories: [{ repoUrl: "https://git.example/team/repo.git", paths: ["src", "tests"] }], baseSha: "a".repeat(40),
  testCommands: ["pnpm test -- --name='case'; echo literal"], budget: { maxCostCents: 0 }, maxRepairRounds: 2,
  artifactRequirements: ["Local manifest"], humanReviewActions: ["Push, MR, merge, tag and release"] };
it("round-trips the nine goal fields without executing commands or inventing a duration", () => {
  const parsed = codingGoalSchema.parse(goal); expect(readCodingGoalDocument(codingGoalDocument(parsed))).toEqual(parsed);
  expect(parsed.testCommands).toEqual(goal.testCommands); expect(parsed.budget).toEqual({ maxCostCents: 0 });
});
it.each(Object.keys(goal).filter(key => key !== "schemaVersion"))("requires original field %s", key => {
  const input: Record<string, unknown> = { ...goal }; delete input[key]; expect(codingGoalSchema.safeParse(input).success).toBe(false);
});
it.each(["../secret", "src/../secret", "/tmp", "C:\\repo", "src//file", "src/*", "a\u0000b"])("rejects unsafe or ambiguous relative path %s", path => {
  expect(codingGoalSchema.safeParse({ ...goal, allowedRepositories: [{ ...goal.allowedRepositories[0], paths: [path] }] }).success).toBe(false);
});
it.each(["https://token@git.example/r", "https://git.example/r?token=x", "file:///tmp/repo", "javascript:alert(1)"])("does not persist credential-bearing/unsupported repository URLs: %s", repoUrl => {
  expect(codingGoalSchema.safeParse({ ...goal, allowedRepositories: [{ repoUrl, paths: ["."] }] }).success).toBe(false);
});
it.each([-1, 1.5, 3, Infinity])("rejects invalid repair count %s", maxRepairRounds => expect(codingGoalSchema.safeParse({ ...goal, maxRepairRounds }).success).toBe(false));
it("rejects injected authorization, extra budget fields and missing revision intent", () => {
  expect(codingGoalSchema.safeParse({ ...goal, authorized: true }).success).toBe(false);
  expect(codingGoalSchema.safeParse({ ...goal, budget: { maxCostCents: 1, enabled: true } }).success).toBe(false);
  expect(saveCodingGoalSchema.safeParse({ goal }).success).toBe(false);
  expect(saveCodingGoalSchema.safeParse({ goal, baseRevisionId: null }).success).toBe(true);
});
it("does not silently adopt arbitrary task documents", () => expect(() => readCodingGoalDocument("unstructured planning text")).toThrow());
