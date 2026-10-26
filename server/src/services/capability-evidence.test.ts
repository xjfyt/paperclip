import { describe, expect, it, vi } from "vitest";
vi.mock("drizzle-orm", () => ({
  eq: (key: string, value: unknown) => (row: Record<string, unknown>) => row[key] === value,
  inArray: (key: string, values: unknown[]) => (row: Record<string, unknown>) => values.includes(row[key]),
  gt: (key: string, value: number) => (row: Record<string, number>) => row[key] > value,
  and: (...checks: Array<(row: unknown) => boolean>) => (row: unknown) => checks.every(check => check(row)),
  desc: (key: string) => ({ key, desc: true }),
}));
vi.mock("@paperclipai/db", () => ({
  companies: { name: "companies", id: "id" }, activityLog: { name: "audit" },
  capabilityEvidence: { name: "events", id: "id", companyId: "companyId", revision: "revision", idempotencyKey: "idempotencyKey", targetId: "targetId" },
}));
import { capabilityEvidenceService } from "./capability-evidence.js";
import type { Db } from "@paperclipai/db";

// Pure transactional double: no database process, SQL or external calls.
function fixture() {
  type Row = Record<string, any>;
  const state: Record<string, Row[]> = { companies: [{ id: "company-a" }, { id: "company-b" }], events: [], audit: [] };
  let failAudit = false;
  const db = {
    select: () => {
      let table = "", predicate = (_row: Row) => true, order: any, limit = Infinity;
      const chain = {
        from: (value: Row) => { table = value.name; return chain; },
        where: (value: typeof predicate) => { predicate = value; return chain; },
        orderBy: (value: any) => { order = value; return chain; },
        limit: (value: number) => { limit = value; return chain; },
        for: () => chain,
        then: (resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(state[table].filter(predicate).sort((a, b) => order?.desc ? b[order.key] - a[order.key] : a.revision - b.revision).slice(0, limit)).then(resolve, reject),
      };
      return chain;
    },
    insert: (table: Row) => ({ values: (value: Row) => {
      if (table.name === "audit" && failAudit) throw new Error("audit unavailable");
      const row = { id: `00000000-0000-4000-9000-${String(state.events.length + 1).padStart(12, "0")}`, createdAt: new Date(), ...value };
      state[table.name].push(row);
      return { returning: async () => [row] };
    } }),
    transaction: async (body: (tx: unknown) => Promise<unknown>) => {
      const before = structuredClone(state);
      try { return await body(db); } catch (error) { Object.assign(state, before); throw error; }
    },
  };
  return { service: capabilityEvidenceService(db as unknown as Db), state, failAudit: () => { failAudit = true; } };
}
const receipt = { adapterType: "qoder_cn", capability: "localExecution", runtime: "qoder", runtimeVersion: "1.0", environmentAlias: "staging", accountAlias: "test-account", testedCommit: "a".repeat(40), level: "C3", result: "passed", sourceResourceId: "resource-1", sourceRunId: "run-1", testedAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
const request = { expectedRevision: 0, idempotencyKey: "00000000-0000-4000-8000-000000000001", action: "record", reason: "verification", receipt };
describe("capability ledger transaction contract", () => {
  it("writes one audit and returns exact same retry before CAS", async () => {
    const { service, state } = fixture();
    const first = await service.append("company-a", "admin", request);
    expect(await service.append("company-a", "admin", request)).toEqual(first);
    expect(state.events).toHaveLength(1); expect(state.audit).toHaveLength(1);
    expect(state.audit[0].details).not.toHaveProperty("receipt");
  });
  it("rejects reused idempotency keys with a different actor or payload", async () => {
    const { service } = fixture();
    await service.append("company-a", "admin", request);
    await expect(service.append("company-a", "other", request)).rejects.toMatchObject({ status: 409 });
    await expect(service.append("company-a", "admin", { ...request, reason: "retested" })).rejects.toMatchObject({ status: 409 });
  });
  it("rejects stale revisions without another write", async () => {
    const { service, state } = fixture(); await service.append("company-a", "admin", request);
    await expect(service.append("company-a", "admin", { ...request, idempotencyKey: "00000000-0000-4000-8000-000000000002" })).rejects.toMatchObject({ status: 409 });
    expect(state.events).toHaveLength(1);
  });
  it("rolls back receipt when audit insertion fails", async () => {
    const { service, state, failAudit } = fixture(); failAudit();
    await expect(service.append("company-a", "admin", request)).rejects.toThrow("audit unavailable");
    expect(state.events).toHaveLength(0);
  });
  it("keeps company retries and lists isolated", async () => {
    const { service } = fixture(); await service.append("company-a", "admin", request);
    expect((await service.list("company-b")).events).toHaveLength(0);
    expect((await service.append("company-b", "admin", request)).revision).toBe(1);
  });
  it("rejects cross-company targets", async () => {
    const { service } = fixture(); const first = await service.append("company-a", "admin", request);
    await expect(service.append("company-b", "admin", { ...request, action: "revoke", receipt: undefined, targetId: first.id })).rejects.toMatchObject({ status: 404 });
  });
  it("appends revocation once and preserves original receipt", async () => {
    const { service, state } = fixture(); const first = await service.append("company-a", "admin", request);
    const revoke = { expectedRevision: 1, idempotencyKey: "00000000-0000-4000-8000-000000000002", action: "revoke", targetId: first.id, reason: "incorrect" };
    await service.append("company-a", "admin", revoke);
    expect(state.events[0].receipt).toEqual(receipt);
    await expect(service.append("company-a", "admin", { ...revoke, expectedRevision: 2, idempotencyKey: "00000000-0000-4000-8000-000000000003" })).rejects.toMatchObject({ status: 409 });
  });
  it("rejects supersession of another exact context", async () => {
    const { service } = fixture(); const first = await service.append("company-a", "admin", request);
    await expect(service.append("company-a", "admin", { ...request, expectedRevision: 1, idempotencyKey: "00000000-0000-4000-8000-000000000002", action: "supersede", targetId: first.id, receipt: { ...receipt, runtimeVersion: "2.0" } })).rejects.toMatchObject({ status: 422 });
  });
  it("rejects unsupported, future and expired claims", async () => {
    const { service } = fixture();
    for (const patch of [{ capability: "toolApproval" }, { testedAt: new Date(Date.now() + 10000).toISOString() }, { testedAt: new Date(Date.now() - 100000).toISOString(), expiresAt: new Date(Date.now() - 10000).toISOString() }]) {
      await expect(service.append("company-a", "admin", { ...request, receipt: { ...receipt, ...patch } })).rejects.toMatchObject({ status: 422 });
    }
  });
  it("hides notification receipts but exposes the shared revision for adapter CAS", async () => {
    const { service, state } = fixture(); await service.append("company-a", "admin", request);
    state.events.push({ id: "notification", companyId: "company-a", revision: 2, receipt: { domain: "notification", reportRef: "private-notification-report" }, createdAt: new Date() });
    state.events.push({ id: "notification-revoke", companyId: "company-a", revision: 3, receipt: null, targetId: "notification", createdAt: new Date() });
    const page = await service.list("company-a");
    expect(page.events).toHaveLength(1); expect(page.headRevision).toBe(3);
    expect(JSON.stringify(page)).not.toContain("private-notification-report");
  });
  it("cannot revoke a notification receipt through the adapter entrypoint", async () => {
    const { service, state } = fixture();
    state.events.push({ id: "00000000-0000-4000-8000-000000000003", companyId: "company-a", revision: 1, receipt: { domain: "notification" }, createdAt: new Date() });
    await expect(service.append("company-a", "admin", { ...request, expectedRevision: 1, action: "revoke", targetId: state.events[0].id, receipt: undefined })).rejects.toMatchObject({ status: 404 });
  });

});
