import { test } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonical } from "../services/mimouse-operations/preview.js";
import { reconcileOperation, type ProviderLookup } from "../services/mimouse-operations/reconciliation.js";
const values = { total: "123.40" }, op = { key: "stable-operation-key", targetId: "row-a", afterHash: createHash("sha256").update(canonical(values)).digest("hex"), action: "update" as const };
const receipt: ProviderLookup = { kind: "found", key: op.key, outcome: "accepted", requestDigest: "immutable-request", receiptId: "provider-receipt" };
test("requires both an exact receipt and matching target bytes", () => { assert.equal(reconcileOperation(op, "immutable-request", receipt, { targetId: op.targetId, values }).state, "reconciled"); });
test("a target match without an attributable operation receipt remains unknown", () => { for (const kind of ["unknown", "not_found"] as const) assert.equal(reconcileOperation(op, "immutable-request", { kind }, { targetId: op.targetId, values }).state, "indeterminate"); });
test("receipt for another key or request digest cannot confirm this operation", () => { for (const patch of [{ key: "other" }, { requestDigest: "other" }]) assert.equal(reconcileOperation(op, "immutable-request", { ...receipt, ...patch }, { targetId: op.targetId, values }).code, "receipt_identity_mismatch"); });
test("HTTP acceptance never substitutes for checking actual target data", () => { assert.equal(reconcileOperation(op, "immutable-request", receipt, null).state, "needs_review"); assert.equal(reconcileOperation(op, "immutable-request", receipt, { targetId: op.targetId, values: { total: "0.00" } }).code, "target_differs_from_approved_preview"); });
test("a verified rejection is not retried or upgraded even if the target coincidentally matches", () => { assert.equal(reconcileOperation(op, "immutable-request", { ...receipt, outcome: "rejected" }, { targetId: op.targetId, values }).state, "rejected"); });
test("noops never require or claim an external write", () => { assert.deepEqual(reconcileOperation({ ...op, action: "noop" }, "immutable-request", { kind: "unknown" }, null), { state: "no_write", code: "preview_unchanged" }); });

test("malformed provider claims never become successful reconciliation", () => {
  for (const patch of [{ outcome: "success-ish" }, { receiptId: "" }, { receiptId: "https://provider.test/?token=secret" }, { requestDigest: 1 }]) {
    const result = reconcileOperation(op, "immutable-request", { ...receipt, ...patch } as unknown as ProviderLookup, { targetId: op.targetId, values });
    assert.equal(result.code, "invalid_provider_receipt");
  }
});
test("malformed target fields fail closed instead of hashing unknown data as success", () => {
  const result = reconcileOperation(op, "immutable-request", receipt, { targetId: op.targetId, values: { password: "not-allowed" } });
  assert.equal(result.code, "invalid_observed_target");
});
