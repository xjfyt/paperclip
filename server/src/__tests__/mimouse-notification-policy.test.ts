import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { notificationPolicyUpdateSchema, updateNotificationPolicy, DEFAULT_NOTIFICATION_POLICY, evaluateNotificationPolicy, notificationMergeKey, notificationMergeWindow, notificationPolicySchema } from "../services/mimouse-notifications/policy.js";

const policy = { minimumSeverity: "critical", mergeWindowSeconds: 300 };
const snapshot = { configVersion: 2, locale: "en", secretRef: "secret", secretVersion: 1, target: "recipient", title: "Ready", text: "Resource 1", templateData: { first: { value: "same" } } };
const key = (overrides = {}) => notificationMergeKey("company", "subscription", "coding.artifact_ready", "resource-1", { ...snapshot, ...overrides });
describe("frozen notification policies", () => {
  it.each(["approval.requested", "budget.threshold_reached", "future.event"])("never filters or delays critical/unknown %s", event => {
    expect(evaluateNotificationPolicy(event, policy)).toMatchObject({ severity: "critical", filtered: false, mergeWindowSeconds: 0 });
  });
  it("uses explicit severity and default-off dedup", () => {
    expect(evaluateNotificationPolicy("run.failed", policy)).toMatchObject({ severity: "warning", filtered: true });
    expect(evaluateNotificationPolicy("coding.mr_ready", { minimumSeverity: "warning", mergeWindowSeconds: 12 }).filtered).toBe(true);
    expect(evaluateNotificationPolicy("run.failed", { minimumSeverity: "warning", mergeWindowSeconds: 0 }).filtered).toBe(false);
    expect(evaluateNotificationPolicy("coding.artifact_ready", undefined)).toMatchObject({ policy: DEFAULT_NOTIFICATION_POLICY, filtered: false, mergeWindowSeconds: 0 });
  });
  it.each([-1, 301, 1.5, Infinity, "30"])("rejects invalid window %s", value => {
    expect(notificationPolicySchema.safeParse({ ...policy, mergeWindowSeconds: value }).success).toBe(false);
  });
  it("rejects unknown policy keys/severity and fails open for malformed stored policy", () => {
    expect(notificationPolicySchema.safeParse({ ...policy, suppressCritical: true }).success).toBe(false);
    expect(evaluateNotificationPolicy("run.failed", { ...policy, minimumSeverity: "typo" })).toMatchObject({ filtered: false, mergeWindowSeconds: 0 });
  });
  it.each([{ locale: "ja" }, { configVersion: 3 }, { secretVersion: 2 }, { secretRef: "other" }, { target: "other" }, { title: "Other" }, { text: "Other" }, { templateData: { first: { value: "different" } } }])("keeps frozen boundary %j separate", change => {
    expect(key(change)).not.toBe(key());
  });
  it("ignores object property order but not company, subscription, event or resource", () => {
    expect(key({ templateData: { first: { value: "same" } } })).toBe(key());
    expect(notificationMergeKey("company", "subscription", "coding.artifact_ready", "resource-1", Object.fromEntries(Object.entries(snapshot).reverse()))).toBe(key());
    for (const args of [["other", "subscription", "coding.artifact_ready", "resource-1"], ["company", "other", "coding.artifact_ready", "resource-1"], ["company", "subscription", "coding.mr_ready", "resource-1"], ["company", "subscription", "coding.artifact_ready", "resource-2"]]) {
      expect(notificationMergeKey(args[0], args[1], args[2], args[3], snapshot)).not.toBe(key());
    }
  });
  it("locks before lookup; uses database cutoff for first event", async () => {
    const until = new Date("2026-10-26T00:00:30Z");
    const execute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ until }]);
    const result = await notificationMergeWindow({ execute } as never, "company", key(), 30);
    expect(result).toEqual({ mergeKey: key(), mergeUntil: until, nextAttemptAt: until });
    const queries = execute.mock.calls.map(([query]) => new PgDialect().sqlToQuery(query).sql);
    expect(queries[0]).toContain("pg_advisory_xact_lock");
    expect(queries[1]).toContain("state='pending' AND attempt=0");
    expect(queries[1]).toContain("merge_until>clock_timestamp()");
    expect(queries[2]).toContain("clock_timestamp()");
  });
  it("links duplicates without extending cutoff or mutating the frozen leader", async () => {
    const until = new Date("2026-10-26T00:00:30Z");
    const execute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "leader", merge_until: until }]);
    expect(await notificationMergeWindow({ execute } as never, "company", key(), 30)).toEqual({ mergeKey: key(), mergeUntil: until, mergedInto: "leader", state: "merged", lastCode: "merged_exact_payload" });
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it("refuses unsafe windows before taking a lock", async () => {
    const execute = vi.fn();
    await expect(notificationMergeWindow({ execute } as never, "company", key(), 301)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});


describe("policy compare-and-swap transaction contract (mock transaction, not DB evidence)", () => {
  const input = { minimumSeverity: "warning" as const, mergeWindowSeconds: 30, expectedVersion: 1 };
  const scope = [{ event_type: "coding.artifact_ready", kind: "wecom_webhook" }];
  it("requires an explicit positive expected version", () => {
    expect(notificationPolicyUpdateSchema.safeParse({ minimumSeverity: "info", mergeWindowSeconds: 0 }).success).toBe(false);
    expect(notificationPolicyUpdateSchema.safeParse({ ...input, expectedVersion: 0 }).success).toBe(false);
  });
  it("updates within the audit transaction and scopes the CAS to company, id and version", async () => {
    const row = { id: "subscription", policyVersion: 2, policy: { minimumSeverity: "warning", mergeWindowSeconds: 30 } };
    const tx = { execute: vi.fn().mockResolvedValueOnce(scope).mockResolvedValueOnce([row]) }; const audit = vi.fn().mockResolvedValue(undefined);
    const transaction = vi.fn(async callback => callback(tx));
    expect(await updateNotificationPolicy({ transaction } as never, "company", "subscription", input, audit)).toEqual(row);
    expect(audit).toHaveBeenCalledWith(tx, 2);
    const query = new PgDialect().sqlToQuery(tx.execute.mock.calls[1][0]);
    expect(query.sql).toContain("policy_version=policy_version+1"); expect(query.sql).toContain("company_id="); expect(query.sql).toContain("AND id="); expect(query.sql).toContain("AND policy_version=");
    expect(query.params).toEqual([JSON.stringify(row.policy), "company", "subscription", 1]);
  });
  it("rejects a stale version with current version and never audits or overwrites", async () => {
    const execute = vi.fn().mockResolvedValueOnce(scope).mockResolvedValueOnce([]).mockResolvedValueOnce([{ policyVersion: 2 }]); const audit = vi.fn();
    const db = { transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ execute }) };
    await expect(updateNotificationPolicy(db as never, "company", "subscription", input, audit)).rejects.toMatchObject({ status: 409, details: { currentVersion: 2 } });
    expect(audit).not.toHaveBeenCalled(); expect(execute).toHaveBeenCalledTimes(3);
  });
  it("rejects foreign/missing subscriptions without exposing another company version", async () => {
    const execute = vi.fn().mockResolvedValue([]); const audit = vi.fn();
    const db = { transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ execute }) };
    await expect(updateNotificationPolicy(db as never, "other-company", "subscription", input, audit)).rejects.toMatchObject({ status: 404 }); expect(audit).not.toHaveBeenCalled();
  });
  it("propagates failed audit before transaction commit (rollback boundary fixture)", async () => {
    const tx = { execute: vi.fn().mockResolvedValueOnce(scope).mockResolvedValueOnce([{ id: "subscription", policyVersion: 2, policy: input }]) };
    let committed = false; let rolledBack = false;
    const db = { transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      try { const row = await callback(tx); committed = true; return row; } catch (error) { rolledBack = true; throw error; }
    } };
    await expect(updateNotificationPolicy(db as never, "company", "subscription", input, async () => { throw Error("audit failed"); })).rejects.toThrow("audit failed");
    expect(committed).toBe(false); expect(rolledBack).toBe(true);
  });
});


describe("failed-run window contract", () => {
  it.each([undefined, "exact", "digest"] as const)("rejects positive windows in %s mode before mutation/audit", async mergeMode => {
    const execute = vi.fn().mockResolvedValue([{ event_type: "run.failed", kind: "wecom_webhook" }]); const audit = vi.fn();
    const db = { transaction: async (callback: (tx: unknown) => unknown) => callback({ execute }) };
    await expect(updateNotificationPolicy(db as never, "company", "subscription", { minimumSeverity: "warning", mergeWindowSeconds: 30, mergeMode, expectedVersion: 1 }, audit)).rejects.toMatchObject({ status: 422, message: expect.stringContaining("must be 0") });
    expect(execute).toHaveBeenCalledTimes(1); expect(audit).not.toHaveBeenCalled();
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain("FOR UPDATE OF s, e"); expect(query.params).toEqual(["company", "subscription"]);
  });
  it("allows an explicit zero correction with unchanged severity and normal CAS audit", async () => {
    const row = { id: "subscription", policyVersion: 8, policy: { minimumSeverity: "critical", mergeWindowSeconds: 0 } };
    const execute = vi.fn().mockResolvedValue([row]); const audit = vi.fn();
    const db = { transaction: async (callback: (tx: unknown) => unknown) => callback({ execute }) };
    expect(await updateNotificationPolicy(db as never, "company", "subscription", { minimumSeverity: "critical", mergeWindowSeconds: 0, expectedVersion: 7 }, audit)).toEqual(row);
    expect(new PgDialect().sqlToQuery(execute.mock.calls[0][0]).params).toEqual([JSON.stringify(row.policy), "company", "subscription", 7]);
    expect(audit).toHaveBeenCalledWith(expect.anything(), 8);
  });
});
