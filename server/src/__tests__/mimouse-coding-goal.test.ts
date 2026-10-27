import { beforeEach, expect, it, vi } from "vitest";
import { codingGoalDocument } from "@paperclipai/shared";
import { companyMemberships, issues } from "@paperclipai/db";
import { codingGoalService } from "../services/mimouse-coding/goal-template.js";
const calls = vi.hoisted(() => ({ get: vi.fn(), upsert: vi.fn(), audit: vi.fn(), publish: vi.fn(), privacy: vi.fn() }));
vi.mock("../services/documents.js", () => ({ documentService: () => ({ getIssueDocumentByKey: calls.get, upsertIssueDocument: calls.upsert }) }));
vi.mock("../services/activity-log.js", () => ({ logActivity: calls.audit, publishActivity: calls.publish }));
vi.mock("../services/authorization.js", () => ({ canActorReadIssuePrivacy: calls.privacy }));
const goal = { schemaVersion: 1 as const, problemValue: "Fix", acceptanceScenarios: ["pass"], allowedRepositories: [{ repoUrl: "https://git.example/r", paths: ["src"] }], baseSha: "a".repeat(40), testCommands: ["pnpm test"], budget: { maxCostCents: 0 }, maxRepairRounds: 2, artifactRequirements: ["manifest"], humanReviewActions: ["push"] };
const actor = { actorType: "user" as const, actorId: "owner" }; const privacyActor = { type: "board" as const, userId: "owner" };
const input = { goal, baseRevisionId: null };
let db: any;
beforeEach(() => {
  vi.clearAllMocks(); calls.get.mockResolvedValue(null); calls.privacy.mockResolvedValue(true);
  calls.upsert.mockResolvedValue({ document: { id: "document", latestRevisionId: "revision" } }); calls.audit.mockResolvedValue(undefined);
  db = { select: () => ({ from: (table: unknown) => { const chain: any = { innerJoin: () => chain, where: () => chain, for: async () => table === issues ? [{ id: "issue", companyId: "company" }] : table === companyMemberships ? [{ status: "active", membershipRole: "admin" }] : [] }; return chain; } }), transaction: async (fn: any) => fn(db) };
});
it("reads an absent or versioned template without any mutation", async () => {
  const service = codingGoalService(db); expect(await service.read("issue")).toEqual({ issueId: "issue", goal: null, revisionId: null, planningOnly: true });
  calls.get.mockResolvedValue({ body: codingGoalDocument(goal), latestRevisionId: "r1" }); expect((await service.read("issue")).goal).toEqual(goal); expect(calls.upsert).not.toHaveBeenCalled();
});
it("rejects a malformed existing document instead of silently replacing it", async () => {
  calls.get.mockResolvedValue({ body: "ordinary notes" }); await expect(codingGoalService(db).read("issue")).rejects.toMatchObject({ status: 422 });
});
it("persists literal planning text and audit metadata in the same transaction", async () => {
  const result = await codingGoalService(db).save("company", "issue", input, actor, privacyActor);
  expect(result.planningOnly).toBe(true); expect(calls.upsert.mock.calls[0][0]).toMatchObject({ issueId: "issue", key: "coding-goal", baseRevisionId: null, lockedDocumentStrategy: "conflict", body: codingGoalDocument(goal) });
  expect(calls.audit.mock.calls[0][0]).toBe(db); expect(calls.audit.mock.calls[0][1].details).toEqual({ documentId: "document", revisionId: "revision", planningOnly: true });
  expect(JSON.stringify(calls.audit.mock.calls)).not.toContain("pnpm test");
});
it("identical content is a no-op receipt, not another revision or wake", async () => {
  calls.get.mockResolvedValue({ body: codingGoalDocument(goal), latestRevisionId: "current" });
  expect((await codingGoalService(db).save("company", "issue", input, actor, privacyActor)).revisionId).toBe("current"); expect(calls.upsert).not.toHaveBeenCalled(); expect(calls.audit).not.toHaveBeenCalled();
});
it("rechecks private task access under the issue lock before document lookup", async () => {
  calls.privacy.mockResolvedValue(false); await expect(codingGoalService(db).save("company", "issue", input, actor, privacyActor)).rejects.toMatchObject({ status: 404 }); expect(calls.get).not.toHaveBeenCalled();
});
it("preserves document lock and revision conflict failures", async () => {
  calls.upsert.mockRejectedValue(Object.assign(Error("revision conflict"), { status: 409 }));
  await expect(codingGoalService(db).save("company", "issue", input, actor, privacyActor)).rejects.toMatchObject({ status: 409 }); expect(calls.audit).not.toHaveBeenCalled();
});
it("audit failure rejects the transaction and publishes no success event", async () => {
  calls.audit.mockRejectedValue(Error("audit unavailable")); await expect(codingGoalService(db).save("company", "issue", input, actor, privacyActor)).rejects.toThrow("audit unavailable"); expect(calls.publish).not.toHaveBeenCalled();
});
it("forwards the exact base revision rather than silently overwriting a newer goal", async () => {
  const revision = "20000000-0000-4000-8000-000000000001";
  await codingGoalService(db).save("company", "issue", { goal, baseRevisionId: revision }, actor, privacyActor);
  expect(calls.upsert.mock.calls[0][0].baseRevisionId).toBe(revision);
});
