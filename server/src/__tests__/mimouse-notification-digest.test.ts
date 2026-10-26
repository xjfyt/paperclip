import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { evaluateNotificationPolicy, updateNotificationPolicy } from "../services/mimouse-notifications/policy.js";
import { notificationDigestKey, notificationDigestEnabled, notificationDigestWindow, buildNotificationDigest, freezeNotificationDigest, notificationDispatchContent } from "../services/mimouse-notifications/digest.js";

const snapshot = { kind: "wecom_webhook", secretRef: "secret", secretVersion: 1, configVersion: 2, verificationEpoch: 1, targetKey: "target", target: "recipient", locale: "en", renderVersion: 2, digestVersion: 1,
  policyEvent: "coding.artifact_ready", policyResourceId: "resource-1", title: "Artifact manifest ready", text: "Original body", detailUrl: "https://paperclip.example/CO/coding",
  policy: { minimumSeverity: "info", mergeWindowSeconds: 30, mergeMode: "digest" }, policyVersion: 1, severity: "info" };
const key = (patch = {}) => notificationDigestKey("company", "subscription", { ...snapshot, ...patch });
const row = () => ({ id: "leader", company_id: "company", endpoint_id: "endpoint", subscription_id: "subscription", lease: "lease", merge_key: key(), snapshot: { ...snapshot } });
const child = (n = 2, patch = {}) => ({ id: `child-${n}`, snapshot: { ...snapshot, policyResourceId: `resource-${n}`, text: `body ${n}`, ...patch } });
const query = (value: Parameters<PgDialect["sqlToQuery"]>[0]) => new PgDialect().sqlToQuery(value);

describe("bounded notification digests (no provider/network)", () => {
  it("is opt-in, disabled at zero and never admits filtered, critical, failed-run or template events", () => {
    const enabled = (event = "coding.artifact_ready", kind = "wecom_webhook", policy: unknown = snapshot.policy) => notificationDigestEnabled(event, kind, evaluateNotificationPolicy(event, policy));
    expect(enabled()).toBe(true);
    for (const policy of [null, { ...snapshot.policy, mergeMode: "exact" }, { ...snapshot.policy, mergeWindowSeconds: 0 }, { ...snapshot.policy, minimumSeverity: "warning" }]) expect(enabled(undefined, undefined, policy)).toBe(false);
    for (const event of ["approval.requested", "budget.threshold_reached", "run.failed", "unknown"]) expect(enabled(event)).toBe(false);
    expect(enabled(undefined, "wechat_official_account")).toBe(false);
  });
  it("shares resource IDs but freezes every routing/render/policy boundary", () => {
    expect(key({ policyResourceId: "other-resource", text: "other generated text" })).toBe(key());
    for (const change of [{ kind: "feishu_webhook" }, { secretRef: "different" }, { secretVersion: 2 }, { configVersion: 3 }, { verificationEpoch: 2 }, { target: "different" }, { targetKey: "different" }, { locale: "ja" }, { renderVersion: 3 }, { title: "Other" }, { severity: "warning" }, { policyEvent: "coding.ci_failed" }, { policyVersion: 2 }, { detailUrl: "https://other.example" }, { templateData: {} }]) expect(key(change)).not.toBe(key());
    expect(notificationDigestKey("other", "subscription", snapshot)).not.toBe(key()); expect(notificationDigestKey("company", "other", snapshot)).not.toBe(key());
  });
  it("keeps the admitted key stable after JSON persistence when the security epoch is frozen up front", () => {
    const admitted = row(); const persisted = JSON.parse(JSON.stringify(admitted.snapshot));
    expect(notificationDigestKey(admitted.company_id, admitted.subscription_id, persisted)).toBe(admitted.merge_key);
    expect(buildNotificationDigest({ ...admitted, snapshot: persisted }, [child()]).members).toHaveLength(2);
    // A newer epoch is a different security boundary, never ignored to hide a persistence mismatch.
    expect(() => buildNotificationDigest({ ...admitted, snapshot: { ...persisted, verificationEpoch: 2 } }, [])).toThrow("invalid_digest_boundary");
  });
  it("locks admission against claim, caps children and never extends the cutoff", async () => {
    const until = new Date("2026-10-26T00:01:00Z"); const execute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "leader", merge_until: until }]);
    expect(await notificationDigestWindow({ execute } as never, "company", key(), 30)).toEqual({ mergeKey: key(), mergeUntil: until, mergedInto: "leader", state: "merged", lastCode: "merged_digest" });
    const queries = execute.mock.calls.map(([value]) => query(value)); expect(queries[0].sql).toContain("pg_advisory_xact_lock");
    for (const clause of ["FOR UPDATE OF d", "d.state='pending'", "d.attempt=0", "digestEnvelope", "clock_timestamp()", "child.merged_into=d.id"]) expect(queries[1].sql).toContain(clause);
    expect(queries[1].params.slice(-2)).toEqual([9, 9]); expect(execute).toHaveBeenCalledTimes(2);
  });
  it("creates a new fixed leader when prior windows are full, claimed, frozen or expired", async () => {
    const until = new Date("2026-10-26T00:01:00Z"); const execute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ until }]);
    expect(await notificationDigestWindow({ execute } as never, "company", key(), 30)).toEqual({ mergeKey: key(), mergeUntil: until, nextAttemptAt: until }); expect(query(execute.mock.calls[2][0]).sql).toContain("clock_timestamp()");
  });
  it.each([0, -1, 301, 0.5])("refuses invalid admission window %s before DB access", async seconds => {
    const execute = vi.fn(); await expect(notificationDigestWindow({ execute } as never, "company", key(), seconds)).rejects.toThrow(); expect(execute).not.toHaveBeenCalled();
  });
  it("renders one to ten safe resource IDs, not task text or approval actions", () => {
    const source = row(); const envelope = buildNotificationDigest(source, Array.from({ length: 9 }, (_, index) => child(index + 2)));
    expect(envelope.members).toHaveLength(10); expect(envelope.title).toContain("× 10"); expect(envelope.text).toContain("resource-10"); expect(envelope.text).not.toContain("Original body"); expect(envelope.text).not.toContain("body 2");
    expect(source.snapshot).toEqual(snapshot); expect(buildNotificationDigest(source, []).title).toContain("× 1");
    expect(() => buildNotificationDigest(source, Array.from({ length: 10 }, (_, index) => child(index + 2)))).toThrow("invalid_digest_members");
    expect(() => buildNotificationDigest(source, [child(), child()])).toThrow("invalid_digest_members"); expect(() => buildNotificationDigest(source, [child(2, { policyResourceId: "bad\n@all" })])).toThrow();
    expect(() => buildNotificationDigest(source, [child(2, { secretVersion: 2 })])).toThrow("invalid_digest_boundary"); expect(() => buildNotificationDigest({ ...source, merge_key: "bad" }, [])).toThrow("invalid_digest_boundary");
  });
  it("atomically freezes after claim without rewriting source content", async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ snapshot }]).mockResolvedValueOnce([child()]).mockResolvedValueOnce([]);
    const frozen = await freezeNotificationDigest({ transaction: async (callback: (tx: unknown) => unknown) => callback({ execute }) } as never, row());
    expect(frozen).toMatchObject({ ...snapshot, digestEnvelope: { version: 1, members: ["leader", "child-2"] } });
    const queries = execute.mock.calls.map(([value]) => query(value)); expect(queries[0].sql).toContain("state='claimed' AND lease_expires_at>now() FOR UPDATE");
    expect(queries[1].sql).toContain("subscription_id="); expect(queries[1].sql).toContain("endpoint_id="); expect(queries[1].params.at(-1)).toBe(10); expect(queries[2].params.slice(1)).toEqual(["company", "leader", "lease"]); expect(notificationDispatchContent(frozen!).text).toContain("resource-2");
  });
  it("reuses frozen content on recovery/retry without collecting again", async () => {
    const frozen = { ...snapshot, digestEnvelope: buildNotificationDigest(row(), [child()]) }; const execute = vi.fn().mockResolvedValue([{ snapshot: frozen }]);
    const db = { transaction: async (callback: (tx: unknown) => unknown) => callback({ execute }) };
    expect(await freezeNotificationDigest(db as never, { ...row(), id: "manual-retry", merge_key: null })).toEqual(frozen); expect(execute).toHaveBeenCalledTimes(1); expect(notificationDispatchContent(frozen)).toEqual({ title: frozen.digestEnvelope.title, text: frozen.digestEnvelope.text });
  });
  it("does no mutation for stale leases and rejects missing/corrupt envelopes before sending", async () => {
    const execute = vi.fn().mockResolvedValue([]); expect(await freezeNotificationDigest({ transaction: async (callback: (tx: unknown) => unknown) => callback({ execute }) } as never, row())).toBeNull(); expect(execute).toHaveBeenCalledTimes(1);
    expect(() => notificationDispatchContent(snapshot)).toThrow("invalid_digest_envelope"); expect(() => notificationDispatchContent({ ...snapshot, digestEnvelope: { version: 1, title: "x", text: "x", members: [] } })).toThrow(); expect(notificationDispatchContent({ title: "legacy", text: "unchanged" })).toEqual({ title: "legacy", text: "unchanged" });
  });
  it.each(["run.failed", "approval.requested", "budget.threshold_reached"])("rejects API digest policy for %s before mutation/audit", async event_type => {
    const execute = vi.fn().mockResolvedValue([{ event_type, kind: "wecom_webhook" }]); const audit = vi.fn(); const db = { transaction: async (callback: (tx: unknown) => unknown) => callback({ execute }) };
    await expect(updateNotificationPolicy(db as never, "company", "subscription", { ...snapshot.policy, minimumSeverity: "info", mergeMode: "digest", expectedVersion: 1 }, audit)).rejects.toMatchObject({ status: 422 }); expect(execute).toHaveBeenCalledTimes(1); expect(audit).not.toHaveBeenCalled();
  });
  it("normalizes exact back to trigger-compatible policy JSON", async () => {
    const execute = vi.fn().mockResolvedValue([{ id: "subscription", policyVersion: 2, policy: {} }]); const db = { transaction: async (callback: (tx: unknown) => unknown) => callback({ execute }) };
    await updateNotificationPolicy(db as never, "company", "subscription", { minimumSeverity: "warning", mergeWindowSeconds: 30, mergeMode: "exact", expectedVersion: 1 }, vi.fn()); expect(JSON.parse(query(execute.mock.calls[0][0]).params[0] as string)).toEqual({ minimumSeverity: "warning", mergeWindowSeconds: 30 });
  });
});
