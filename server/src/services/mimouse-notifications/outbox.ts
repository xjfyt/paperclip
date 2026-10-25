import { renderNotification, type NotificationEventType } from "./render.js";
import { logger } from "../../middleware/logger.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { companies, mimouseNotificationDeliveries as deliveries, mimouseNotificationEndpoints as endpoints, mimouseNotificationSubscriptions as subscriptions, signalDatabaseWork, subscribeDatabaseWork, type Db } from "@paperclipai/db";
import { secretService } from "../secrets.js";
import { sendNotification, type NotificationSnapshot, type ChannelSecret, type DeliveryResult } from "./drivers.js";

export const NOTIFICATION_TOPIC = "mimouse-notifications";
export const CONNECTED_NOTIFICATION_EVENTS = ["approval.requested", "coding.mr_ready", "coding.ci_failed", "coding.artifact_ready", "budget.threshold_reached"] as const;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
interface EventInput { companyId: string; eventId: string; type: string; resourceId: string; title?: string; text?: string }
interface Snapshot extends NotificationSnapshot { secretRef: string; secretVersion: number; targetKey: string; locale: string; renderVersion: number }
interface DeliveryRow { id: string; company_id: string; endpoint_id: string; subscription_id: string; snapshot: Snapshot; lease: string; attempt: number; created_at: Date }

/** Called inside the exact business transaction. Never run a provider request here. */
export async function enqueueNotification(tx: Transaction, event: EventInput): Promise<void> {
  if (!(CONNECTED_NOTIFICATION_EVENTS as readonly string[]).includes(event.type)) throw Error("notification_event_not_connected");
  const targets = await tx.select({ subscription: subscriptions, endpoint: endpoints }).from(subscriptions)
    .innerJoin(endpoints, and(eq(endpoints.id, subscriptions.endpointId), eq(endpoints.companyId, subscriptions.companyId)))
    .where(and(eq(subscriptions.companyId, event.companyId), eq(subscriptions.eventType, event.type), eq(subscriptions.enabled, true), eq(endpoints.enabled, true)));
  if (!targets.length) return;
  const [company] = await tx.select({ prefix: companies.issuePrefix }).from(companies).where(eq(companies.id, event.companyId));
  if (!company) throw Error("notification_company_missing");
  await signalDatabaseWork(tx, NOTIFICATION_TOPIC);
  for (const { subscription, endpoint } of targets) {
    const rendered = renderNotification(event.type as NotificationEventType, event.resourceId, subscription.locale, company.prefix, process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL);
    const snapshot: Snapshot = {
      ...endpoint.config,
      kind: endpoint.kind as NotificationSnapshot["kind"], ...rendered,
      secretRef: endpoint.secretRef, secretVersion: endpoint.secretVersion,
      targetKey: endpoint.targetKey, locale: subscription.locale, renderVersion: 2,
    };
    await tx.insert(deliveries).values({ companyId: event.companyId, eventId: event.eventId, subscriptionId: subscription.id, endpointId: endpoint.id, snapshot: snapshot as unknown as Record<string, unknown> }).onConflictDoNothing();
  }
}
export function retryDelay(attempt: number, retryAfterMs = 0, random = Math.random()): number {
  return Math.min(1800000, Math.max(retryAfterMs, 1000 * 2 ** Math.min(attempt, 10) + Math.floor(random * 1000)));
}
export function canAutomaticallyRetry(attempt: number, createdAt: Date, now = Date.now()): boolean {
  return attempt < 5 && now - createdAt.getTime() < 1800000;
}

export function notificationOutbox(db: Db, deps: {
  send?: typeof sendNotification;
  resolveSecret?: (company: string, id: string, version: number) => Promise<string>;
} = {}) {
  const send = deps.send ?? sendNotification;
  const resolveSecret = deps.resolveSecret ?? ((company, id, version) => secretService(db).resolveSecretValue(company, id, version));
  async function recover() {
    // Only pre-dispatch claims may be retried. Sending means outcome unknown.
    await db.execute(sql`UPDATE mimouse_notification_deliveries SET state = CASE WHEN state='sending' THEN 'indeterminate' ELSE 'pending' END,
      last_code = CASE WHEN state='sending' THEN 'worker_lost_after_dispatch' ELSE 'claim_expired' END,
      lease=NULL, lease_expires_at=NULL, updated_at=now() WHERE state IN ('claimed','sending') AND lease_expires_at < now()`);
  }
  async function claim(): Promise<DeliveryRow | null> {
    const lease = randomUUID();
    const rows = await db.execute(sql`WITH candidate AS (
      SELECT d.id FROM mimouse_notification_deliveries d
      JOIN mimouse_notification_endpoints e ON e.id=d.endpoint_id AND e.company_id=d.company_id
      JOIN mimouse_notification_subscriptions s ON s.id=d.subscription_id AND s.company_id=d.company_id
      WHERE d.state IN ('pending','retryable') AND d.next_attempt_at <= now() AND e.enabled AND s.enabled
      ORDER BY d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT 1
    ) UPDATE mimouse_notification_deliveries d SET state='claimed', lease=${lease}, lease_expires_at=now()+interval '30 seconds', updated_at=now()
      FROM candidate WHERE d.id=candidate.id RETURNING d.*`);
    return (rows as unknown as DeliveryRow[])[0] ?? null;
  }
  async function enterSending(row: DeliveryRow): Promise<boolean> {
    return db.transaction(async tx => {
      const live = await tx.execute(sql`SELECT d.id FROM mimouse_notification_deliveries d
        JOIN mimouse_notification_endpoints e ON e.id=d.endpoint_id AND e.company_id=d.company_id
        JOIN mimouse_notification_subscriptions s ON s.id=d.subscription_id AND s.company_id=d.company_id
        WHERE d.id=${row.id} AND d.lease=${row.lease} AND d.state='claimed' AND d.lease_expires_at>now() AND e.enabled AND s.enabled FOR UPDATE OF d, e, s`);
      if (!live.length) return false;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${row.snapshot.targetKey},0))`);
      const spacingMs = row.snapshot.kind === "feishu_webhook" ? 1000 : 3000;
      const quota = await tx.execute(sql`INSERT INTO mimouse_notification_rate_limits(target_key,next_allowed_at)
        VALUES(${row.snapshot.targetKey},now()+${spacingMs}*interval '1 millisecond')
        ON CONFLICT(target_key) DO UPDATE SET next_allowed_at=now()+${spacingMs}*interval '1 millisecond'
        WHERE mimouse_notification_rate_limits.next_allowed_at <= now() RETURNING target_key`);
      if (!quota.length) {
        await tx.execute(sql`UPDATE mimouse_notification_deliveries SET state='pending',lease=NULL,lease_expires_at=NULL,next_attempt_at=now()+interval '3 seconds' WHERE id=${row.id} AND lease=${row.lease}`);
        return false;
      }
      await tx.execute(sql`UPDATE mimouse_notification_deliveries SET state='sending',attempt=attempt+1,updated_at=now(),lease_expires_at=now()+interval '30 seconds' WHERE id=${row.id} AND lease=${row.lease}`);
      return true;
    });
  }
  async function settle(row: DeliveryRow, result: DeliveryResult) {
    const attempt = row.attempt + 1;
    const retry = result.state === "retryable" && canAutomaticallyRetry(attempt, new Date(row.created_at));
    const state = result.state === "retryable" ? retry ? "retryable" : "rejected" : result.state;
    await db.execute(sql`UPDATE mimouse_notification_deliveries SET state=${state},last_code=${result.code},receipt=${result.receipt ?? null},
      next_attempt_at=now()+${retry ? retryDelay(attempt, result.retryAfterMs) : 0}*interval '1 millisecond',lease=NULL,lease_expires_at=NULL,updated_at=now()
      WHERE id=${row.id} AND lease=${row.lease} AND state='sending'`);
  }
  async function tick(): Promise<boolean> {
    await recover(); const row = await claim(); if (!row) return false;
    let secret: ChannelSecret;
    try { secret = JSON.parse(await resolveSecret(row.company_id, row.snapshot.secretRef, row.snapshot.secretVersion)); }
    catch {
      await db.execute(sql`UPDATE mimouse_notification_deliveries SET state='rejected',last_code='secret_unavailable',lease=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=${row.id} AND lease=${row.lease} AND state='claimed'`);
      return true;
    }
    if (!await enterSending(row)) return true;
    let result: DeliveryResult;
    try { result = await send(row.snapshot, secret); } catch { result = { state: "indeterminate", code: "worker_transport_exception" }; }
    await settle(row, result);
    return true;
  }
  return { tick, recover, claim, enterSending, settle };
}

export function startNotificationWorker(db: Db) {
  if (process.env.PAPERCLIP_NOTIFICATIONS_ENABLED !== "true" || process.env.PAPERCLIP_NOTIFICATIONS_WORKER_ENABLED === "false") return { stop: async () => {} };
  const outbox = notificationOutbox(db); let running: Promise<unknown> | null = null; let stopped = false;
  const wake = () => { if (!stopped && !running) running = outbox.tick().catch(() => { logger.warn({ code: "notification_worker_tick_failed" }, "Notification worker will reconcile durable state"); }).finally(() => { running = null; }); };
  const unsubscribe = subscribeDatabaseWork(db, NOTIFICATION_TOPIC, event => { if (event === "settled") wake(); });
  const interval = setInterval(wake, 5000); interval.unref(); wake();
  return { stop: async () => { stopped = true; clearInterval(interval); unsubscribe(); await running; } };
}
