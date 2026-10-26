import { describe, expect, it } from "vitest";
import { appendNotificationEvidenceSchema, evaluateNotificationEvidence, type NotificationEvidenceEvent } from "./notification-evidence.js";
import type { NotificationVerificationDto } from "./notification-verification.js";
const id = "00000000-0000-4000-8000-000000000001";
const now = Date.parse("2026-01-01T12:00:00Z");
const scope = { endpointId: id, configVersion: 1, verificationEpoch: 1, kind: "wecom_webhook", secretRef: id, secretVersion: 1 };
const claim = { category: "live_connection" as const, result: "passed" as const, runtimeVersion: "v1", environmentAlias: "staging", accountAlias: "account", reportRef: "report", testedCommit: "a".repeat(40), testedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 1000).toISOString(), deliveryId: id, reviewId: id, expectedState: "accepted" as const, expectedAttempt: 1, confirmRealTarget: true as const };
const request = { expectedRevision: 0, idempotencyKey: id, expectedConfigVersion: 1, expectedEpoch: 1, confirm: true, action: "record", reason: "verification", receipt: claim };
const view = { scope, credentialStatus: "metadata_active", endpointEnabled: false, dispatchEnabled: false,
  latestTest: { id, scopeMatches: true, state: "accepted", attempt: 1, review: { id } } } as NotificationVerificationDto;
const event: NotificationEvidenceEvent = { id, companyId: "company", revision: 1, action: "record", targetId: null, reason: "verification", reviewerId: "operator", createdAt: new Date(now).toISOString(), receipt: { ...claim, domain: "notification", scope, resourceId: null, manual: true, machineVerified: false } };
const evaluate = (events: NotificationEvidenceEvent[], current = view) => evaluateNotificationEvidence("company", current, events, now).find(item => item.category === "live_connection");
describe("strict manual notification evidence", () => {
  it("canonicalizes input key order without granting machine verification", () => {
    expect(JSON.stringify(appendNotificationEvidenceSchema.parse(request))).toBe(JSON.stringify(appendNotificationEvidenceSchema.parse(Object.fromEntries(Object.entries(request).reverse()))));
    expect(evaluate([event])).toMatchObject({ status: "manual_passed", manual: true, machineVerified: false });
  });
  it("accepted delivery and old review alone never upgrade", () => expect(evaluate([])?.status).toBe("not_recorded"));
  it.each(["company", "endpoint", "config", "epoch", "credential", "new_test", "new_review", "expired", "revoked", "new_failure"])("fails closed for %s", change => {
    let current = structuredClone(view), events = [structuredClone(event)];
    if (change === "company") events[0].companyId = "another";
    if (change === "endpoint") current.scope.endpointId = "other";
    if (change === "config") current.scope.configVersion++;
    if (change === "epoch") current.scope.verificationEpoch++;
    if (change === "credential") current.credentialStatus = "unavailable";
    if (change === "new_test") current.latestTest!.id = "new";
    if (change === "new_review") current.latestTest!.review!.id = "new";
    if (change === "expired") events[0].receipt!.expiresAt = new Date(now).toISOString();
    if (change === "revoked") events.push({ ...event, id: "revoke", receipt: null, revision: 2, action: "revoke", targetId: id });
    if (change === "new_failure") events.push({ ...event, id: "failed", revision: 2, receipt: { ...event.receipt!, result: "failed" } });
    expect(evaluate(events, current)?.status).not.toBe("manual_passed");
  });
  it.each([{ confirmRealTarget: undefined }, { reviewId: undefined }, { category: "approval_scenario" }, { category: "protocol_report" }, { machineVerified: true }, { expiresAt: new Date(now + 31 * 86400000).toISOString() }])("rejects malformed category or forged fields %j", patch => {
    expect(appendNotificationEvidenceSchema.safeParse({ ...request, receipt: { ...claim, ...patch } }).success).toBe(false);
  });
  it("protocol reports have no live target/transport semantics", () => {
    const { deliveryId: _d, reviewId: _r, expectedState: _s, expectedAttempt: _a, confirmRealTarget: _c, ...report } = claim;
    expect(appendNotificationEvidenceSchema.safeParse({ ...request, receipt: { ...report, category: "protocol_report" } }).success).toBe(true);
  });
});
