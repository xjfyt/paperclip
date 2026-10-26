import { createHash } from "node:crypto";
import { canonical } from "./preview.js";
import { isSafeOperationField, type OperationScalar as Scalar } from "@paperclipai/shared";
export interface ApprovedOperation { key: string; targetId: string; afterHash: string; action: "insert" | "update" | "noop" }
export type ProviderLookup = { kind: "unknown" | "not_found" } | { kind: "found"; key: string; outcome: "accepted" | "rejected"; requestDigest: string; receiptId: string };
export interface ObservedTarget { targetId: string; values: Record<string, Scalar> }
/** A matching target alone does not prove our operation ran. Require the exact
 * durable idempotency receipt as well, never retry or perform a write here. */
export function reconcileOperation(operation: ApprovedOperation, requestDigest: string, lookup: ProviderLookup, observed: ObservedTarget | null) {
  if (!["insert", "update", "noop"].includes(operation.action)) return { state: "needs_review" as const, code: "invalid_operation" };
  if (operation.action === "noop") return { state: "no_write" as const, code: "preview_unchanged" };
  if (lookup.kind !== "found") return { state: "indeterminate" as const, code: lookup.kind === "not_found" ? "receipt_not_found_is_not_nonexecution" : "receipt_unconfirmed" };
  if (!["accepted", "rejected"].includes(lookup.outcome) || typeof lookup.receiptId !== "string" || !/^[A-Za-z0-9_.:-]{1,500}$/.test(lookup.receiptId)
    || typeof lookup.key !== "string" || typeof lookup.requestDigest !== "string") return { state: "needs_review" as const, code: "invalid_provider_receipt" };
  if (lookup.key !== operation.key || lookup.requestDigest !== requestDigest) return { state: "needs_review" as const, code: "receipt_identity_mismatch" };
  if (lookup.outcome === "rejected") return { state: "rejected" as const, code: "provider_rejected", receiptId: lookup.receiptId };
  if (!observed || observed.targetId !== operation.targetId) return { state: "needs_review" as const, code: "target_missing_or_mismatched", receiptId: lookup.receiptId };
  const values = observed.values;
  if (!values || typeof values !== "object" || Array.isArray(values) || ![Object.prototype, null].includes(Object.getPrototypeOf(values))
    || Object.keys(values).length > 50 || Object.entries(values).some(([key, value]) => !isSafeOperationField(key)
      || !(value === null || typeof value === "boolean" || (typeof value === "string" && value.length <= 4000) || (typeof value === "number" && Number.isSafeInteger(value))))) {
    return { state: "needs_review" as const, code: "invalid_observed_target", receiptId: lookup.receiptId };
  }
  const observedHash = createHash("sha256").update(canonical(observed.values)).digest("hex");
  if (observedHash !== operation.afterHash) return { state: "needs_review" as const, code: "target_differs_from_approved_preview", receiptId: lookup.receiptId, observedHash };
  return { state: "reconciled" as const, code: "receipt_and_target_match", receiptId: lookup.receiptId, observedHash };
}
