import { conflict, notFound, unprocessable } from "../../errors.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";

export const notificationPolicySchema = z.object({
  minimumSeverity: z.enum(["info", "warning", "critical"]),
  mergeWindowSeconds: z.number().int().min(0).max(300),
  mergeMode: z.enum(["exact", "digest"]).optional(),
}).strict();
export type NotificationPolicy = z.infer<typeof notificationPolicySchema>;
export const DEFAULT_NOTIFICATION_POLICY: NotificationPolicy = { minimumSeverity: "info", mergeWindowSeconds: 0 };
export type NotificationSeverity = "info" | "warning" | "critical";
const severity: Record<string, NotificationSeverity> = {
  "approval.requested": "critical", "budget.threshold_reached": "critical",
  "run.failed": "warning", "coding.ci_failed": "warning",
  "coding.mr_ready": "info", "coding.artifact_ready": "info",
};
const rank = { info: 0, warning: 1, critical: 2 };
/** Unknown/corrupt policy fails open for alerts, never silently drops work. */
export function evaluateNotificationPolicy(eventType: string, raw: unknown) {
  const parsed = notificationPolicySchema.safeParse(raw);
  const policy = parsed.success ? parsed.data : DEFAULT_NOTIFICATION_POLICY;
  const level = severity[eventType] ?? "critical";
  return { policy, severity: level, filtered: level !== "critical" && rank[level] < rank[policy.minimumSeverity],
    mergeWindowSeconds: level === "critical" ? 0 : policy.mergeWindowSeconds };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
/** Includes ALL frozen transport/render fields and the logical resource boundary. */
export function notificationMergeKey(companyId: string, subscriptionId: string, eventType: string, resourceId: string, snapshot: Record<string, unknown>) {
  return createHash("sha256").update(canonical({ companyId, subscriptionId, eventType, resourceId, snapshot })).digest("hex");
}
type Transaction = Pick<Parameters<Parameters<Db["transaction"]>[0]>[0], "execute">;
/** Must run in the business transaction, before insertion. No network calls.
 * The fixed first-event cutoff is never extended by later events. */
export async function notificationMergeWindow(tx: Transaction, companyId: string, key: string, seconds: number) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw Error("invalid_notification_merge_window");
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`notification-merge:${companyId}:${key}`},0))`);
  const rows = await tx.execute(sql`SELECT id, merge_until FROM mimouse_notification_deliveries
    WHERE company_id=${companyId} AND merge_key=${key} AND merged_into IS NULL
      AND state='pending' AND attempt=0 AND merge_until>clock_timestamp()
    ORDER BY created_at, id LIMIT 1`);
  const leader = (rows as unknown as { id: string; merge_until: Date | string }[])[0];
  if (leader) return { mergeKey: key, mergeUntil: new Date(leader.merge_until), mergedInto: leader.id, state: "merged", lastCode: "merged_exact_payload" };
  const clock = await tx.execute(sql`SELECT clock_timestamp()+${seconds}*interval '1 second' AS until`);
  const until = new Date((clock as unknown as { until: Date | string }[])[0].until);
  return { mergeKey: key, mergeUntil: until, nextAttemptAt: until };
}

export const notificationPolicyUpdateSchema = notificationPolicySchema.extend({ expectedVersion: z.number().int().positive() });
/** Compare-and-swap and audit use one transaction: audit failure must reject the change. */
export async function updateNotificationPolicy(db: Pick<Db, "transaction">, companyId: string, id: string,
  input: z.infer<typeof notificationPolicyUpdateSchema>,
  audit: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0], version: number) => Promise<unknown>) {
  const { expectedVersion, mergeMode, ...legacyPolicy } = notificationPolicyUpdateSchema.parse(input);
  // Keep the legacy two-field shape for the strict failed-run database trigger.
  const policy = { ...legacyPolicy, ...(mergeMode === "digest" ? { mergeMode } : {}) };
  return db.transaction(async tx => {
    if (mergeMode === "digest" || policy.mergeWindowSeconds > 0) {
      const scope = await tx.execute(sql`SELECT s.event_type, e.kind FROM mimouse_notification_subscriptions s
        JOIN mimouse_notification_endpoints e ON e.company_id=s.company_id AND e.id=s.endpoint_id
        WHERE s.company_id=${companyId} AND s.id=${id} FOR UPDATE OF s, e`);
      if (!scope.length) throw notFound("Notification subscription not found");
      const target = scope[0] as unknown as { event_type: string; kind: string };
      // Failed runs are enqueued individually by the database trigger. Never
      // accept a delay that this producer cannot honor; legacy values require
      // an explicit, audited correction rather than a read-time rewrite.
      if (target.event_type === "run.failed" && policy.mergeWindowSeconds > 0) throw unprocessable("Failed-run notifications are individual; mergeWindowSeconds must be 0");
      if (mergeMode === "digest" && !supportsNotificationDigest(target.event_type, target.kind)) throw unprocessable("Digest is supported only for coding events on text channels");
    }
    const rows = await tx.execute(sql`UPDATE mimouse_notification_subscriptions
      SET policy=${JSON.stringify(policy)}::jsonb, policy_version=policy_version+1
      WHERE company_id=${companyId} AND id=${id} AND policy_version=${expectedVersion}
      RETURNING id, policy, policy_version AS "policyVersion"`);
    const row = (rows as unknown as { id: string; policy: NotificationPolicy; policyVersion: number }[])[0];
    if (!row) {
      const current = await tx.execute(sql`SELECT policy_version AS "policyVersion" FROM mimouse_notification_subscriptions WHERE company_id=${companyId} AND id=${id}`);
      if (!current.length) throw notFound("Notification subscription not found");
      throw conflict("Notification policy changed; reload before saving", { currentVersion: (current[0] as unknown as { policyVersion: number }).policyVersion });
    }
    await audit(tx, row.policyVersion);
    return row;
  });
}

/** Critical approvals/budgets, failed-run trigger rows and official templates stay individual. */
export function supportsNotificationDigest(event: string, kind: string): boolean {
  return ["coding.mr_ready", "coding.ci_failed", "coding.artifact_ready"].includes(event)
    && ["wecom_webhook", "feishu_webhook", "dingtalk_webhook_legacy", "dingtalk_app"].includes(kind);
}
