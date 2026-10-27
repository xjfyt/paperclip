import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const deps = vi.hoisted(() => ({ snapshot: vi.fn(), validate: vi.fn(), enabled: vi.fn(), authorize: vi.fn(), session: vi.fn(), clock: vi.fn() }));
vi.mock("../mimouse-private-prompt-tests/service.js", () => ({ authorizePrivatePrompt: deps.authorize }));
vi.mock("../mimouse-prompt-applications/target.js", async () => {
  const { privateConfigDigest } = await import("../mimouse-private-prompt-tests/profile.js"); return { applicationDigest: privateConfigDigest };
});
vi.mock("./candidates.js", () => ({ snapshotRuntimeRoutingPool: deps.snapshot, assertRuntimeRoutingSnapshots: vi.fn(), runtimeCostRoutingEnabled: () => false, requireRuntimeCostRoutingEnabled: deps.enabled }));
vi.mock("./execution.js", () => ({ assertRuntimeRoutingBindingCurrent: deps.validate }));
vi.mock("./clock.js", () => ({ runtimeRoutingClock: deps.clock, assertRuntimeRoutingSession: deps.session }));
vi.mock("../issues.js", () => ({ issueService: vi.fn() }));
vi.mock("../access.js", () => ({ accessService: () => ({ decide: async () => ({ allowed: true }) }) }));
import { runtimeCostRoutingService } from "./service.js";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { companyId: id(1), userId: "owner", sessionId: "live-session" }, now = new Date("2026-10-27T00:00:00Z"), hash = "a".repeat(64);
function fixture(responses: unknown[][], updateBase: unknown = bound) {
  const writes: any[] = [], locks: string[] = [];
  const tx: any = { execute: async () => [], select: () => {
    const result = responses.shift(); if (!result) throw Error("Missing fake query response");
    const q: any = { then: (resolve: any) => Promise.resolve(resolve(result)), for: (mode: string) => { locks.push(mode); return q; } }; for (const name of ["from", "where", "limit"]) q[name] = () => q; return q;
  }, insert: () => ({ values: (value: any) => { const row = { id: randomUUID(), createdAt: now, ...value }; writes.push(row);
    return { returning: async () => [row], onConflictDoNothing: async () => [] }; } }), update: () => ({ set: (value: any) => {
    writes.push(value); return { where: () => ({ returning: async () => [{ ...updateBase as object, ...value }] }) }; } }) };
  return { db: { transaction: (action: any) => action(tx) } as any, writes, locks };
}
const candidate = { agentId: id(2), promptId: id(3), applicationId: id(4), applicationGeneration: 1,
  comparison: { datasetId: id(5), baselineRevisionId: id(6), candidateRevisionId: id(7), testIds: [id(8), id(9)], maxCandidateCostCents: null } };
const preparation = { requestId: id(10), expectedGeneration: 0, policy: { datasetId: id(5), datasetHash: hash, minimumPassRate: 1, maxEvidenceAgeHours: 24, candidates: [candidate] } };
const bound = { id: id(11), requestId: id(12), companyId: actor.companyId, actorUserId: actor.userId, actorSessionId: actor.sessionId,
  issueId: id(13), policyId: id(14), generation: 1, selectedAgentId: candidate.agentId, selectedCandidateSnapshot: {},
  decisionDigest: hash, taskDigest: hash, requestDigest: hash, state: "bound", dispatchRequestId: null, dispatchRequestDigest: null,
  dispatchActorUserId: null, dispatchActorSessionId: null, wakeRequestedAt: null, runId: null, startRequestedAt: null, createdAt: now };
beforeEach(() => { for (const fn of Object.values(deps)) fn.mockReset(); deps.authorize.mockResolvedValue({ type: "board", userId: "owner" }); deps.session.mockResolvedValue(undefined); deps.clock.mockResolvedValue(now); });
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
const head = { companyId: actor.companyId, generation: 0, policyId: null };
const expired = { id: id(20), companyId: actor.companyId, requestId: id(21), actorUserId: actor.userId, actorSessionId: actor.sessionId,
  requestDigest: hash, approvalDigest: hash, expectedGeneration: 0, policy: preparation.policy, candidates: [], createdAt: new Date(now.getTime() - 7200000),
  approvalExpiresAt: new Date(now.getTime() - 3600000), approvalClosedAt: null };
const approval = { requestId: id(22), expectedGeneration: 0, approvalDigest: hash, confirmBareTextProxy: true,
  confirmHistoricalCostNotQuote: true, confirmNewTasksOnly: true, confirmNoAutomaticRun: true };
it("close-expired at generation zero persists only the marker and one audit, never head or wake", async () => {
  const fake = fixture([[{ status: "paused" }], [head], [expired], []], expired), wake = vi.fn();
  const result = await runtimeCostRoutingService(fake.db, wake).closeExpired(actor, expired.id, { expectedGeneration: 0 });
  expect(result.item.approvalClosedAt).toBe(now.toISOString()); expect(result.duplicate).toBe(false); expect(fake.locks).toEqual(["update", "update"]);
  expect(fake.writes).toEqual([{ companyId: actor.companyId, id: expect.any(String), createdAt: now }, { approvalClosedAt: now }, expect.objectContaining({ action: "runtime_cost_routing.approval_closed_expired" })]);
  expect(deps.enabled).not.toHaveBeenCalled(); expect(deps.snapshot).not.toHaveBeenCalled(); expect(wake).not.toHaveBeenCalled();
});
it("same policy closure replay preserves its timestamp after head advance without another audit", async () => {
  const closed = { ...expired, approvalClosedAt: now }, fake = fixture([[{ status: "active" }], [{ ...head, generation: 3 }], [closed]]);
  const result = await runtimeCostRoutingService(fake.db).closeExpired(actor, expired.id, { expectedGeneration: 0 });
  expect(result.duplicate).toBe(true); expect(result.item.approvalClosedAt).toBe(now.toISOString()); expect(fake.writes.filter(row => row.action)).toHaveLength(0);
});
it.each([
  ["not expired", { ...expired, approvalExpiresAt: new Date(now.getTime() + 1) }, head, [], "runtime_routing_approval_not_expired"],
  ["approved then disabled", expired, { ...head, generation: 2 }, [{ id: id(23) }], "runtime_routing_approved_policy_cannot_close"],
  ["generation changed", expired, { ...head, generation: 1 }, [], "runtime_routing_generation_changed"],
] as const)("cannot close %s", async (_label, row, current, receipts, error) => {
  const fake = fixture([[{ status: "active" }], [current], [row], [...receipts]], row);
  await expect(runtimeCostRoutingService(fake.db).closeExpired(actor, row.id, { expectedGeneration: 0 })).rejects.toThrow(error);
  expect(fake.writes.filter(row => row.approvalClosedAt || row.action)).toHaveLength(0);
});
it.each(["role revoked", "session revoked"])("closure rejects %s with no marker", async kind => {
  if (kind === "role revoked") deps.authorize.mockRejectedValueOnce(Error(kind)); else deps.session.mockRejectedValueOnce(Error(kind));
  const fake = fixture([[{ status: "active" }], [head], [expired]]);
  await expect(runtimeCostRoutingService(fake.db).closeExpired(actor, expired.id, { expectedGeneration: 0 })).rejects.toThrow(kind);
  expect(fake.writes.filter(row => row.approvalClosedAt || row.action)).toHaveLength(0);
});
it("an explicit closure fences late approval even after authority clock rollback", async () => {
  deps.clock.mockResolvedValue(new Date(expired.createdAt.getTime()));
  const fake = fixture([[], [], [], [head], [{ ...expired, approvalClosedAt: now }]]);
  await expect(runtimeCostRoutingService(fake.db).approve(actor, expired.id, approval)).rejects.toThrow("runtime_routing_approval_changed_or_expired");
  expect(fake.locks).toEqual(["update", "update"]); expect(deps.snapshot).not.toHaveBeenCalled();
  expect(fake.writes.filter(row => row.action)).toHaveLength(0);
});
it.each([null, now])("gen0 lost approval readback is read-only and closes only with durable marker %s", async approvalClosedAt => {
  const fake = fixture([[{ status: "active" }], [], [], [], [head], [{ ...expired, approvalClosedAt }]]), wake = vi.fn();
  const result = await runtimeCostRoutingService(fake.db, wake).request(actor, approval.requestId, { action: "approve", expectedGeneration: 0, policyId: expired.id });
  expect(result.closure?.reason ?? null).toBe(approvalClosedAt ? "approval_expired" : null); expect(fake.writes).toEqual([]); expect(wake).not.toHaveBeenCalled();
});
