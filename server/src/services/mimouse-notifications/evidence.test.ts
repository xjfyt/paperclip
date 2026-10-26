import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: {} as Record<string, any[]>, locks: [] as string[], failAudit: false, view: {} as any }));
vi.mock("@paperclipai/db", () => Object.fromEntries(Object.entries({ companies: "companies", companySecrets: "secrets", companySecretVersions: "versions", companySecretProviderConfigs: "providers", capabilityEvidence: "events", activityLog: "audit", approvals: "approvals", mimouseNotificationEndpoints: "endpoints" }).map(([key, name]) => [key, new Proxy({ name }, { get: (target, field) => field === "name" ? target.name : String(field) })])));
vi.mock("drizzle-orm", () => ({ eq: (key: string, value: any) => (row: any) => row[key] === value, gt: (key: string, value: number) => (row: any) => row[key] > value, and: (...checks: any[]) => (row: any) => checks.every(fn => fn(row)), desc: (key: string) => ({ key, desc: true }), sql: () => () => true }));
vi.mock("./verification.js", () => ({ notificationScope: (row: any) => ({ endpointId: row.id, configVersion: row.configVersion, verificationEpoch: row.verificationEpoch, secretRef: row.secretRef, secretVersion: row.secretVersion, kind: row.kind }), notificationVerification: () => ({ read: async () => state.view }) }));
import type { Db } from "@paperclipai/db";
import { notificationEvidence } from "./evidence.js";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { endpointId: id(1), configVersion: 1, verificationEpoch: 1, kind: "wecom_webhook", secretRef: id(2), secretVersion: 1 };
const claim = () => ({ category: "live_connection", result: "passed", runtimeVersion: "v1", environmentAlias: "staging", accountAlias: "account", reportRef: "report", testedCommit: "a".repeat(40), testedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), deliveryId: id(3), reviewId: id(4), expectedState: "accepted", expectedAttempt: 1, confirmRealTarget: true });
const input = () => ({ expectedRevision: 0, idempotencyKey: id(5), expectedConfigVersion: 1, expectedEpoch: 1, confirm: true, action: "record", reason: "verification", receipt: claim() });
function dbFixture() {
  const db = { select: (_projection?: any) => {
    let table = "", predicate = (_row: any) => true, order: any, limit = Infinity;
    const chain: any = { from: (value: any) => { table = value.name; return chain; }, where: (value: any) => { predicate = value; return chain; }, orderBy: (value: any) => { order = value; return chain; }, limit: (value: number) => { limit = value; return chain; }, for: () => { state.locks.push(table); return chain; },
      then: (resolve: any, reject: any) => Promise.resolve(state.rows[table].filter(predicate).sort((a, b) => order?.desc ? b[order.key] - a[order.key] : a.revision - b.revision).slice(0, limit)).then(resolve, reject) }; return chain;
  }, insert: (table: any) => ({ values: (value: any) => {
    if (table.name === "audit" && state.failAudit) throw Error("audit unavailable");
    const row = { ...value, id: id(state.rows.events.length + 10), createdAt: new Date() }; state.rows[table.name].push(row); return { returning: async () => [row] };
  } }), transaction: async (fn: any) => { const before = structuredClone(state.rows); try { return await fn(db); } catch (error) { state.rows = before; throw error; } } };
  return db as unknown as Db;
}
beforeEach(() => {
  state.failAudit = false; state.locks = [];
  state.rows = { companies: [{ id: "company" }], endpoints: [{ id: id(1), companyId: "company", ...scope }], secrets: [{ id: id(2), companyId: "company", provider: "local_encrypted", providerConfigId: null }], versions: [{ id: id(6), secretId: id(2), version: 1 }], providers: [], events: [], audit: [], approvals: [{ id: id(7), companyId: "company" }] };
  state.view = { scope, credentialStatus: "metadata_active", latestTest: { id: id(3), state: "accepted", attempt: 1, scopeMatches: true, createdAt: new Date(Date.now() - 5000).toISOString(), review: { id: id(4), outcome: "accepted", observedState: "accepted", observedAttempt: 1 } } };
});
const append = (raw = input(), company = "company", endpoint = id(1), actor = "admin") => notificationEvidence(dbFixture()).append(company, endpoint, actor, raw);
describe("notification declaration transaction fixture (not real SQL locking)", () => {
  it("canonical retry is same receipt even after endpoint changes, no duplicate audit", async () => {
    const request = input(); const first = await append(request); state.rows.endpoints[0].verificationEpoch = 2;
    expect(await append(Object.fromEntries(Object.entries(request).reverse()) as typeof request)).toEqual(first);
    expect(state.rows.events).toHaveLength(1); expect(state.rows.audit).toHaveLength(1);
    expect(first.receipt).toMatchObject({ manual: true, machineVerified: false, scope });
  });
  it.each(["actor", "body", "endpoint"])("rejects duplicate idempotency key with changed %s", async change => {
    const request = input(); await append(request);
    await expect(append(change === "body" ? { ...request, reason: "retested" } : request, "company", change === "endpoint" ? id(9) : id(1), change === "actor" ? "other" : "admin")).rejects.toMatchObject({ status: 409 });
  });
  it("keeps credential lock order and leaves no record when audit fails", async () => {
    state.failAudit = true; await expect(append()).rejects.toThrow("audit unavailable");
    expect(state.locks).toEqual(["companies", "secrets", "versions", "endpoints"]);
    expect(state.rows.events).toHaveLength(0);
  });
  it.each(["company", "epoch", "version", "credential", "delivery", "review", "attempt", "old_time", "human_unknown"])("rejects stale or foreign %s", async change => {
    const request = input();
    if (change === "company") state.rows.endpoints[0].companyId = "other";
    if (change === "epoch") state.rows.endpoints[0].verificationEpoch = 2;
    if (change === "version") state.rows.endpoints[0].configVersion = 2;
    if (change === "credential") state.view.credentialStatus = "unavailable";
    if (change === "delivery") state.view.latestTest.id = id(8);
    if (change === "review") state.view.latestTest.review.id = id(8);
    if (change === "attempt") state.view.latestTest.attempt = 2;
    if (change === "old_time") request.receipt.testedAt = new Date(Date.now() - 10000).toISOString();
    if (change === "human_unknown") state.view.latestTest.review.outcome = "unknown";
    await expect(append(request)).rejects.toBeDefined(); expect(state.rows.events).toHaveLength(0);
  });
  it("requires an actual company approval resource, not a test or replay", async () => {
    const request = input(); Object.assign(request.receipt, { category: "approval_scenario", approvalChecks: { received: true, detailLink: true, permissionChecked: true, noGetAction: true } });
    state.view.latestApproval = { ...state.view.latestTest, resourceId: id(7), eventId: "manual-test:wrong" };
    await expect(append(request)).rejects.toMatchObject({ status: 422 });
    state.view.latestApproval.eventId = `approval:${id(7)}`; state.rows.approvals[0].companyId = "other";
    await expect(append(request)).rejects.toMatchObject({ status: 404 });
    state.rows.approvals[0].companyId = "company";
    expect((await append(request)).receipt).toMatchObject({ resourceId: id(7), category: "approval_scenario", machineVerified: false });
  });
  it("revoke preserves original declaration and cannot target another domain", async () => {
    const first = await append(); const revoke = { ...input(), expectedRevision: 1, idempotencyKey: id(8), action: "revoke", targetId: first.id, receipt: undefined };
    const saved = await notificationEvidence(dbFixture()).append("company", id(1), "admin", revoke);
    expect(saved.receipt).toBeNull(); expect(state.rows.events[0].receipt.manual).toBe(true);
    await expect(notificationEvidence(dbFixture()).append("company", id(1), "admin", { ...revoke, expectedRevision: 2, idempotencyKey: id(9) })).rejects.toMatchObject({ status: 409 });
  });
});
