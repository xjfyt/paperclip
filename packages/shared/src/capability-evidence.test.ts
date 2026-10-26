import { describe, expect, it } from "vitest";
import { appendCapabilityEvidenceSchema, capabilityReceiptSchema, capabilityBaseline, evaluateCapabilityEvidence, type CapabilityEvidenceEvent, type CapabilityReceipt } from "./capability-evidence";
const now = Date.parse("2026-10-26T10:00:00Z");
const receipt: CapabilityReceipt = {
  adapterType: "qoder_cn", capability: "localExecution", runtime: "qoder", runtimeVersion: "1.0.0",
  environmentAlias: "staging", accountAlias: "test-account", testedCommit: "a".repeat(40),
  level: "C3", result: "passed", sourceResourceId: "resource-1", sourceRunId: "run-1",
  testedAt: "2026-10-26T09:00:00Z", expiresAt: "2026-10-27T09:00:00Z",
};
function event(overrides: Partial<CapabilityEvidenceEvent> = {}): CapabilityEvidenceEvent {
  return { id: "00000000-0000-4000-8000-000000000001", companyId: "company-a", revision: 1,
    action: "record", receipt, targetId: null, reason: "verification", reviewerId: "admin", createdAt: receipt.testedAt, ...overrides };
}
const evaluate = (events: CapabilityEvidenceEvent[]) => evaluateCapabilityEvidence("company-a", receipt, events, now);
describe("display-only capability receipts", () => {
  it("keeps C2 separate from manually asserted C3", () => {
    expect(evaluate([event()])).toMatchObject({ baseline: "C2", manualAttestation: "C3", machineVerified: false });
  });
  it("never promotes missing or cross-company evidence", () => {
    expect(evaluate([]).manualAttestation).toBeNull();
    expect(evaluate([event({ companyId: "company-b" })]).manualAttestation).toBeNull();
  });
  for (const field of ["runtime", "runtimeVersion", "environmentAlias", "accountAlias", "testedCommit"] as const) {
    it(`requires exact ${field}`, () => {
      expect(evaluate([event({ receipt: { ...receipt, [field]: "different" } })]).manualAttestation).toBeNull();
    });
  }
  for (const result of ["failed", "blocked"] as const) it(`fails closed for ${result}`, () => {
    expect(evaluate([event(), event({ id: "new", revision: 2, receipt: { ...receipt, result } })]).manualAttestation).toBeNull();
  });
  it("rejects expired and future evidence", () => {
    expect(evaluate([event({ receipt: { ...receipt, expiresAt: new Date(now).toISOString() } })]).manualAttestation).toBeNull();
    expect(evaluate([event({ receipt: { ...receipt, testedAt: new Date(now + 1).toISOString() } })]).manualAttestation).toBeNull();
  });
  it("revocation never revives older passing evidence", () => {
    const latest = event({ id: "new", revision: 2 });
    expect(evaluate([event(), latest, event({ id: "revocation", revision: 3, action: "revoke", receipt: null, targetId: latest.id })]).manualAttestation).toBeNull();
  });
  it("supersession retains history and uses latest manual claim", () => {
    expect(evaluate([event(), event({ id: "new", revision: 2, action: "supersede", targetId: event().id, receipt: { ...receipt, level: "C4" } })]).manualAttestation).toBe("C4");
  });
  it("ignores another company's revocation", () => {
    expect(evaluate([event(), event({ companyId: "company-b", receipt: null, targetId: event().id })]).manualAttestation).toBe("C3");
  });
  it("does not implement unsupported capabilities by attestation", () => {
    const context = { ...receipt, capability: "toolApproval" as const };
    expect(evaluateCapabilityEvidence("company-a", context, [event({ receipt: context })], now)).toMatchObject({ baseline: "unsupported", manualAttestation: null });
    expect(capabilityBaseline("workbuddy", "usageReporting")).toBe("unknown");
  });
});
describe("bounded receipt input", () => {
  it("accepts valid metadata", () => expect(capabilityReceiptSchema.safeParse(receipt).success).toBe(true));
  for (const value of ["https://host/path?token=value", "Bearer-secret", "password", "a".repeat(81), "line\nbreak", "../file", "a@b.com"]) {
    it(`rejects non-alias metadata ${value.slice(0, 20)}`, () => expect(capabilityReceiptSchema.safeParse({ ...receipt, sourceResourceId: value }).success).toBe(false));
  }
  it("rejects unbounded validity and unknown payload keys", () => {
    expect(capabilityReceiptSchema.safeParse({ ...receipt, expiresAt: "2027-10-27T09:00:00Z" }).success).toBe(false);
    expect(capabilityReceiptSchema.safeParse({ ...receipt, secret: "hidden" }).success).toBe(false);
  });
  it("rejects malformed action shapes", () => {
    const base = { expectedRevision: 0, idempotencyKey: event().id, reason: "verification" };
    expect(appendCapabilityEvidenceSchema.safeParse({ ...base, action: "record", receipt }).success).toBe(true);
    expect(appendCapabilityEvidenceSchema.safeParse({ ...base, action: "record", targetId: event().id, receipt }).success).toBe(false);
    expect(appendCapabilityEvidenceSchema.safeParse({ ...base, action: "revoke", targetId: event().id }).success).toBe(true);
    expect(appendCapabilityEvidenceSchema.safeParse({ ...base, action: "revoke", receipt }).success).toBe(false);
    expect(appendCapabilityEvidenceSchema.safeParse({ ...base, action: "supersede", receipt }).success).toBe(false);
  });
});
