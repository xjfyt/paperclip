import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const deps = vi.hoisted(() => ({ snapshot: vi.fn(), validate: vi.fn(), enabled: vi.fn(), authorize: vi.fn(async () => ({ type: "board", userId: "owner" })) }));
vi.mock("../mimouse-private-prompt-tests/service.js", () => ({ authorizePrivatePrompt: deps.authorize }));
vi.mock("../mimouse-prompt-applications/target.js", async () => {
  const { privateConfigDigest } = await import("../mimouse-private-prompt-tests/profile.js"); return { applicationDigest: privateConfigDigest };
});
vi.mock("./candidates.js", () => ({ snapshotRuntimeRoutingPool: deps.snapshot, assertRuntimeRoutingSnapshots: vi.fn(), runtimeCostRoutingEnabled: () => false, requireRuntimeCostRoutingEnabled: deps.enabled }));
vi.mock("./execution.js", () => ({ assertRuntimeRoutingBindingCurrent: deps.validate }));
vi.mock("./clock.js", () => ({ runtimeRoutingClock: async () => new Date("2026-10-27T00:00:00Z"), assertRuntimeRoutingSession: async () => {} }));
vi.mock("../issues.js", () => ({ issueService: vi.fn() }));
vi.mock("../access.js", () => ({ accessService: () => ({ decide: async () => ({ allowed: true }) }) }));
import { runtimeCostRoutingService } from "./service.js";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { companyId: id(1), userId: "owner", sessionId: "live-session" }, now = new Date("2026-10-27T00:00:00Z"), hash = "a".repeat(64);
function fixture(responses: unknown[][]) {
  const writes: any[] = [];
  const tx: any = { execute: async () => [], select: () => {
    const result = responses.shift(); if (!result) throw Error("Missing fake query response");
    const q: any = { then: (resolve: any) => Promise.resolve(resolve(result)) }; for (const name of ["from", "where", "for", "limit"]) q[name] = () => q; return q;
  }, insert: () => ({ values: (value: any) => { const row = { id: randomUUID(), createdAt: now, ...value }; writes.push(row);
    return { returning: async () => [row], onConflictDoNothing: async () => [] }; } }), update: () => ({ set: (value: any) => {
    writes.push(value); return { where: () => ({ returning: async () => [{ ...bound, ...value }] }) }; } }) };
  return { db: { transaction: (action: any) => action(tx) } as any, writes };
}
const candidate = { agentId: id(2), promptId: id(3), applicationId: id(4), applicationGeneration: 1,
  comparison: { datasetId: id(5), baselineRevisionId: id(6), candidateRevisionId: id(7), testIds: [id(8), id(9)], maxCandidateCostCents: null } };
const preparation = { requestId: id(10), expectedGeneration: 0, policy: { datasetId: id(5), datasetHash: hash, minimumPassRate: 1, maxEvidenceAgeHours: 24, candidates: [candidate] } };
const bound = { id: id(11), requestId: id(12), companyId: actor.companyId, actorUserId: actor.userId, actorSessionId: actor.sessionId,
  issueId: id(13), policyId: id(14), generation: 1, selectedAgentId: candidate.agentId, selectedCandidateSnapshot: {},
  decisionDigest: hash, taskDigest: hash, requestDigest: hash, state: "bound", dispatchRequestId: null, dispatchRequestDigest: null,
  dispatchActorUserId: null, dispatchActorSessionId: null, wakeRequestedAt: null, runId: null, startRequestedAt: null, createdAt: now };
it("real prepare stores immutable metadata without calling the execution callback", async () => {
  deps.enabled.mockReset(); deps.snapshot.mockResolvedValue([{ candidate, target: {}, evidence: { observedCostCents: "1.0000000", passedCases: 1, totalCases: 1 } }]);
  const fake = fixture([[], [], [], [{ companyId: actor.companyId, generation: 0, policyId: null }]]), wake = vi.fn();
  const result = await runtimeCostRoutingService(fake.db, wake).prepare(actor, preparation);
  expect(result.item.executionStarted).toBe(false); expect(result.item.expectedGeneration).toBe(0); expect(result.item.approvalExpiresAt).toBe("2026-10-27T01:00:00.000Z");
  expect(fake.writes.find(row => row.requestId === preparation.requestId)?.requestDigest).toMatch(/^[a-f0-9]{64}$/); expect(wake).not.toHaveBeenCalled();
});
it("OFF rejects new preparation before evidence work or policy writes", async () => {
  deps.enabled.mockImplementationOnce(() => { throw Error("runtime_routing_disabled"); }); deps.snapshot.mockClear();
  const fake = fixture([[], [], []]), wake = vi.fn();
  await expect(runtimeCostRoutingService(fake.db, wake).prepare(actor, preparation)).rejects.toThrow("runtime_routing_disabled");
  expect(fake.writes).toHaveLength(0); expect(deps.snapshot).not.toHaveBeenCalled(); expect(wake).not.toHaveBeenCalled();
});
it("preflight failure leaves run authority unpersisted and never asks core to wake", async () => {
  deps.validate.mockRejectedValueOnce(Error("evidence revoked"));
  const fake = fixture([[bound], [{ id: bound.issueId }], [bound], [], [], []]), wake = vi.fn();
  await expect(runtimeCostRoutingService(fake.db, wake).run(actor, bound.id, { requestId: id(15), confirmExecution: true, confirmPossibleCharges: true })).rejects.toThrow("evidence revoked");
  expect(fake.writes).toHaveLength(0); expect(wake).not.toHaveBeenCalled();
});
it("explicit run persists fixed identity/session before handing authority to existing core wake", async () => {
  deps.validate.mockResolvedValueOnce({}); const requestId = id(15);
  const updated = { ...bound, state: "wake_pending", dispatchRequestId: requestId, wakeRequestedAt: now };
  const fake = fixture([[bound], [{ id: bound.issueId }], [bound], [], [], [], [{ status: "active" }], [updated], [{ id: bound.issueId }], [updated]]);
  const wake = vi.fn(async () => { expect(fake.writes.find(row => row.dispatchRequestId === requestId)).toMatchObject({
    state: "wake_pending", dispatchActorUserId: actor.userId, dispatchActorSessionId: actor.sessionId }); });
  const result = await runtimeCostRoutingService(fake.db, wake).run(actor, bound.id, { requestId, confirmExecution: true, confirmPossibleCharges: true });
  expect(result.binding.dispatchRequestId).toBe(requestId); expect(wake).toHaveBeenCalledTimes(1);
});
