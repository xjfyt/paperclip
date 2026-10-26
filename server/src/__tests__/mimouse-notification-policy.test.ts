import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { DEFAULT_NOTIFICATION_POLICY, evaluateNotificationPolicy, notificationMergeKey, notificationMergeWindow, notificationPolicySchema } from "../services/mimouse-notifications/policy.js";

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
