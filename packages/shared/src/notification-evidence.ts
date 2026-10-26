import { z } from "zod";
import type { NotificationVerificationDto, NotificationVerificationScope } from "./notification-verification.js";
const alias = z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
  .refine(value => !/(?:bearer|password|secret|token|sk-|ghp_|github_pat_)/i.test(value), "Use a non-sensitive alias");
export const notificationEvidenceCategories = ["protocol_report", "live_connection", "recipient_observation", "approval_scenario"] as const;
export const notificationEvidenceReceiptInputSchema = z.object({
  category: z.enum(notificationEvidenceCategories), result: z.enum(["passed", "failed", "blocked"]),
  runtimeVersion: alias, environmentAlias: alias, accountAlias: alias, reportRef: alias,
  testedCommit: z.string().regex(/^[a-f0-9]{40}$/), testedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  deliveryId: z.string().uuid().optional(), reviewId: z.string().uuid().optional(),
  expectedState: z.enum(["accepted", "rejected", "indeterminate"]).optional(), expectedAttempt: z.number().int().min(0).optional(),
  confirmRealTarget: z.literal(true).optional(),
  approvalChecks: z.object({ received: z.literal(true), detailLink: z.literal(true), permissionChecked: z.literal(true), noGetAction: z.literal(true) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  const duration = Date.parse(value.expiresAt) - Date.parse(value.testedAt);
  if (duration <= 0 || duration > 30 * 24 * 60 * 60 * 1000) ctx.addIssue({ code: "custom", message: "Validity must be positive and at most 30 days" });
  const transport = [value.deliveryId, value.reviewId, value.expectedState, value.expectedAttempt];
  if (value.category === "protocol_report" ? transport.some(item => item !== undefined) || value.confirmRealTarget !== undefined : transport.some(item => item === undefined) || value.confirmRealTarget !== true)
    ctx.addIssue({ code: "custom", message: "Transport references and real target confirmation must match the declaration category" });
  if ((value.category === "approval_scenario") !== Boolean(value.approvalChecks)) ctx.addIssue({ code: "custom", message: "Approval scenario requires explicit business checks" });
});
export const appendNotificationEvidenceSchema = z.object({
  expectedRevision: z.number().int().min(0).max(2147483646), idempotencyKey: z.string().uuid(),
  expectedConfigVersion: z.number().int().positive(), expectedEpoch: z.number().int().positive(), confirm: z.literal(true),
  action: z.enum(["record", "revoke", "supersede"]), targetId: z.string().uuid().optional(), receipt: notificationEvidenceReceiptInputSchema.optional(),
  reason: z.enum(["verification", "incorrect", "expired", "environment_changed", "retested"]),
}).strict().superRefine((value, ctx) => {
  if ((value.action !== "revoke") !== Boolean(value.receipt) || (value.action !== "record") !== Boolean(value.targetId))
    ctx.addIssue({ code: "custom", message: "Receipt and target must match action" });
});
export type NotificationEvidenceReceiptInput = z.infer<typeof notificationEvidenceReceiptInputSchema>;
export type AppendNotificationEvidence = z.infer<typeof appendNotificationEvidenceSchema>;
export type NotificationEvidenceReceipt = NotificationEvidenceReceiptInput & {
  domain: "notification"; scope: NotificationVerificationScope; resourceId: string | null;
  manual: true; machineVerified: false;
};
export interface NotificationEvidenceEvent {
  id: string; companyId: string; revision: number; action: AppendNotificationEvidence["action"]; targetId: string | null;
  receipt: NotificationEvidenceReceipt | null; reason: AppendNotificationEvidence["reason"]; reviewerId: string; createdAt: string;
}
export interface NotificationEvidencePage { events: NotificationEvidenceEvent[]; nextRevision: number | null; headRevision: number }
export function isNotificationReceipt(receipt: unknown): receipt is NotificationEvidenceReceipt {
  return Boolean(receipt && typeof receipt === "object" && "domain" in receipt && receipt.domain === "notification");
}
export function sameNotificationScope(a: NotificationVerificationScope, b: NotificationVerificationScope) {
  return (["endpointId", "configVersion", "verificationEpoch", "kind", "secretRef", "secretVersion"] as const).every(key => a[key] === b[key]);
}
export function sameNotificationEvidenceContext(a: NotificationEvidenceReceipt, b: NotificationEvidenceReceipt) {
  return sameNotificationScope(a.scope, b.scope) && (["category", "runtimeVersion", "environmentAlias", "accountAlias", "testedCommit"] as const).every(key => a[key] === b[key]);
}
/** Display-only; callers must load a complete endpoint history. No dispatch rights. */
export function evaluateNotificationEvidence(companyId: string, view: NotificationVerificationDto, events: NotificationEvidenceEvent[], now = Date.now()) {
  const scoped = events.filter(event => event.companyId === companyId);
  const retired = new Set(scoped.flatMap(event => event.targetId ? [event.targetId] : []));
  return notificationEvidenceCategories.map(category => {
    const latest = scoped.filter(event => event.receipt?.category === category && event.receipt.scope.endpointId === view.scope.endpointId)
      .sort((a, b) => b.revision - a.revision)[0];
    const receipt = latest?.receipt;
    let status: "not_recorded" | "manual_passed" | "failed" | "blocked" | "stale" | "revoked" | "expired" = "not_recorded";
    if (latest && receipt) {
      const observation = category === "approval_scenario" ? view.latestApproval : view.latestTest;
      status = retired.has(latest.id) ? "revoked"
        : !sameNotificationScope(receipt.scope, view.scope) ? "stale"
        : Date.parse(receipt.testedAt) > now || Date.parse(receipt.expiresAt) <= now ? "expired"
        : view.credentialStatus !== "metadata_active" ? "blocked"
        : category !== "protocol_report" && (!observation || !observation.scopeMatches || observation.id !== receipt.deliveryId || observation.review?.id !== receipt.reviewId
          || observation.state !== receipt.expectedState || observation.attempt !== receipt.expectedAttempt) ? "stale"
        : receipt.result === "passed" ? "manual_passed" : receipt.result;
    }
    return { category, status, receiptId: latest?.id ?? null, manual: true as const, machineVerified: false as const };
  });
}
