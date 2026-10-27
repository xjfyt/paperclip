import { expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import { isRuntimeRoutingAutomaticDispositionRepair, isRuntimeRoutingRun, suppressRuntimeRoutingAutomaticRecovery } from "./recovery.js";
const id = "00000000-0000-4000-8000-000000000001";
const action = { id, companyId: id, sourceIssueId: id, fingerprint: "fixed", status: "active", kind: "deliberate_wait_without_target",
  cause: "deliberate_wait_without_target", ownerType: "agent", ownerAgentId: "agent", ownerUserId: null, recoveryIssueId: null, wakePolicy: { type: "bounded_owner_disposition_repair", retryAgentId: "agent" } };
function fake(responses: unknown[][]) {
  const locks: string[] = [], writes: object[] = [], audits: object[] = [], transactions: number[] = [];
  const tx: any = { select: () => { const rows = responses.shift(); if (!rows) throw Error("Unexpected query");
    const q: any = { then: (accept: (rows: unknown[]) => unknown) => Promise.resolve(accept(rows)),
      for: (mode: string) => { locks.push(mode); return q; } }; for (const method of ["from", "where", "limit"]) q[method] = () => q; return q;
  }, update: () => ({ set: (value: object) => { writes.push(value); return { where: () => ({ returning: async () => [{ id }] }) }; } }),
  insert: () => ({ values: async (value: object) => { audits.push(value); } }) };
  return { db: { ...tx, transaction: (work: (tx: unknown) => unknown) => { transactions.push(1); return work(tx); } } as Db, locks, writes, audits, transactions };
}
it.each(["active", "escalated"])("recognizes only an automatic unlinked %s repair", status => {
  expect(isRuntimeRoutingAutomaticDispositionRepair({ ...action, status }, "agent")).toBe(true);
});
it.each([{ ownerType: "board" }, { ownerUserId: "user" }, { ownerUserId: "" }, { recoveryIssueId: id }, { status: "cancelled" },
  { kind: "other" }, { cause: "manual" }, { wakePolicy: { type: "manual" } }, { wakePolicy: null }])("preserves manual/linked/closed action %j", patch => {
  expect(isRuntimeRoutingAutomaticDispositionRepair({ ...action, ...patch }, "agent")).toBe(false);
});
it.each(["succeeded", "failed", "cancelled", "timed_out", "interrupted"])("recognizes durable routing identity independent of terminal outcome %s", async status => {
  const f = fake([[{ id }]]);
  expect(await isRuntimeRoutingRun(f.db, { id, companyId: id, issueId: null, nativeIssueId: null, contextSnapshot: { status } })).toBe(true);
});
it("keeps origin-only controlled runs fail-closed and ignores ordinary/malformed contexts", async () => {
  expect(await isRuntimeRoutingRun(fake([[], [{ id }]]).db, { id, companyId: id, issueId: id, nativeIssueId: null, contextSnapshot: {} })).toBe(true);
  expect(await isRuntimeRoutingRun(fake([[]]).db, { id, companyId: id, issueId: null, nativeIssueId: null, contextSnapshot: { issueId: "ABC-1" } })).toBe(false);
});
it("cancels only a locked matching old automatic action, with one audit and no task/run mutations", async () => {
  const f = fake([[{ origin: "runtime_cost_routing" }], [{ id }], [{ origin: "runtime_cost_routing" }], [{ id, selectedAgentId: "agent" }], [action]]);
  expect(await suppressRuntimeRoutingAutomaticRecovery(f.db, id, id)).toBe(true);
  expect(f.locks).toEqual(["share", "share", "update"]); expect(f.writes).toEqual([expect.objectContaining({ status: "cancelled", outcome: "cancelled", resolutionNote: "runtime_routing_explicit_dispatch_required" })]);
  expect(f.audits).toHaveLength(1);
});
it.each([{ ownerType: "board" }, { recoveryIssueId: id }, { ownerUserId: "operator" }])("does not overwrite a locked nonautomatic action %j", async patch => {
  const f = fake([[{ origin: "runtime_cost_routing" }], [{ id }], [{ origin: "runtime_cost_routing" }], [{ id, selectedAgentId: "agent" }], [{ ...action, ...patch }]]);
  expect(await suppressRuntimeRoutingAutomaticRecovery(f.db, id, id)).toBe(true); expect(f.writes).toEqual([]); expect(f.audits).toEqual([]);
});
it("repeated suppression without active action is a no-op, ordinary/private issues remain unchanged", async () => {
  const routed = fake([[{ origin: "runtime_cost_routing" }], [], [{ origin: "runtime_cost_routing" }], []]);
  expect(await suppressRuntimeRoutingAutomaticRecovery(routed.db, id, id)).toBe(true); expect(routed.writes).toEqual([]); expect(routed.audits).toEqual([]);
  const ordinary = fake([[{ origin: "private_prompt_test" }], []]);
  expect(await suppressRuntimeRoutingAutomaticRecovery(ordinary.db, id, id)).toBe(false); expect(ordinary.writes).toEqual([]);
});

it.each([null, "private_prompt_test", "board"])("does not enter a transaction or lock an ordinary issue with origin %s", async origin => {
  // Only the two nonlocking preflight reads exist. Any extra query would throw;
  // any empty transaction/lock is independently rejected by these assertions.
  const f = fake([[{ origin }], []]);
  expect(await suppressRuntimeRoutingAutomaticRecovery(f.db, id, id)).toBe(false);
  expect(f.transactions).toEqual([]); expect(f.locks).toEqual([]);
  expect(f.writes).toEqual([]); expect(f.audits).toEqual([]);
});
it("keeps a vanished positive preflight suppressed without cancellation after locked revalidation", async () => {
  const f = fake([[{ origin: "runtime_cost_routing" }], [{ id }], [{ origin: null }], []]);
  expect(await suppressRuntimeRoutingAutomaticRecovery(f.db, id, id)).toBe(true);
  expect(f.transactions).toHaveLength(1); expect(f.locks).toEqual(["share", "share"]);
  expect(f.writes).toEqual([]); expect(f.audits).toEqual([]);
});
it("keeps binding-only routing identity on the locked positive path", async () => {
  const f = fake([[{ origin: null }], [{ id }], [{ origin: null }], [{ id, selectedAgentId: "agent" }], []]);
  expect(await suppressRuntimeRoutingAutomaticRecovery(f.db, id, id)).toBe(true);
  expect(f.transactions).toHaveLength(1); expect(f.locks).toEqual(["share", "share", "update"]);
  expect(f.writes).toEqual([]); expect(f.audits).toEqual([]);
});
