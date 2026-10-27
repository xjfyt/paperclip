import { z } from "zod";

const line = z.string().trim().min(1).max(2000).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const lines = z.array(line).min(1).max(30);
const repoUrl = z.string().trim().min(1).max(1000).refine(value => {
  if (/[\x00-\x20\x7f]/.test(value)) return false;
  if (/^git@[A-Za-z0-9.-]+:[A-Za-z0-9_./-]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    return ["https:", "http:", "ssh:"].includes(url.protocol) && !url.password &&
      (!url.username || (url.protocol === "ssh:" && url.username === "git")) && !url.search && !url.hash;
  } catch { return false; }
});
const relativePath = line.refine(value => value === "." || (
  !value.startsWith("/") && !/[\\:*?<>|]/.test(value) &&
  value.split("/").every(part => part !== ".." && part !== "." && part.length > 0)
));
/** Planning only: none of these fields grants execution, budget or publication authority. */
export const codingGoalSchema = z.object({
  schemaVersion: z.literal(1),
  problemValue: z.string().trim().min(1).max(8000),
  acceptanceScenarios: lines,
  allowedRepositories: z.array(z.object({ repoUrl, paths: z.array(relativePath).min(1).max(30) }).strict()).min(1).max(10),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/),
  testCommands: lines,
  budget: z.object({ maxCostCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict(),
  maxRepairRounds: z.number().int().min(0).max(2),
  artifactRequirements: lines,
  humanReviewActions: lines,
}).strict();
export type CodingGoal = z.infer<typeof codingGoalSchema>;
export const saveCodingGoalSchema = z.object({ goal: codingGoalSchema, baseRevisionId: z.string().uuid().nullable() }).strict();
export const codingGoalReceiptSchema = z.object({
  issueId: z.string().uuid(), revisionId: z.string().uuid().nullable(), goal: codingGoalSchema.nullable(), planningOnly: z.literal(true),
}).strict();
export type CodingGoalReceipt = z.infer<typeof codingGoalReceiptSchema>;
export const CODING_GOAL_DOCUMENT_KEY = "coding-goal";
const prefix = "# Coding goal (planning only)\n\n```json\n";
export function codingGoalDocument(goal: CodingGoal) {
  return `${prefix}${JSON.stringify(codingGoalSchema.parse(goal), null, 2)}\n\`\`\`\n`;
}
export function readCodingGoalDocument(body: string): CodingGoal {
  if (!body.startsWith(prefix) || !body.endsWith("\n```\n")) throw new Error("coding_goal_document_invalid");
  return codingGoalSchema.parse(JSON.parse(body.slice(prefix.length, -5)));
}
