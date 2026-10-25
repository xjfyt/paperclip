import { createHash } from "node:crypto";
import { Router, type Request } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { mimouseNotificationDeliveries as deliveries, mimouseNotificationEndpoints as endpoints, mimouseNotificationSubscriptions as subscriptions, signalDatabaseWork, type Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { forbidden, notFound, unprocessable } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { secretService } from "../services/secrets.js";
import { logActivity } from "../services/activity-log.js";
import { buildNotificationRequest, type ChannelSecret, type NotificationSnapshot } from "../services/mimouse-notifications/drivers.js";
import { CONNECTED_NOTIFICATION_EVENTS, NOTIFICATION_TOPIC } from "../services/mimouse-notifications/outbox.js";
const kinds = ["wecom_webhook", "feishu_webhook", "dingtalk_webhook_legacy", "dingtalk_app", "wechat_official_account"] as const;
const configSchema = z.object({ brand: z.enum(["feishu", "lark"]).optional(), target: z.string().max(500).optional(), robotCode: z.string().max(200).optional(), templateId: z.string().max(200).optional(), templateData: z.record(z.string(), z.object({ value: z.string().max(1000) }).strict()).optional() }).strict();
const endpointSchema = z.object({ name: z.string().min(1).max(120), kind: z.enum(kinds), config: configSchema, secretRef: z.string().uuid(), secretVersion: z.number().int().positive() }).strict();
const subscriptionSchema = z.object({ endpointId: z.string().uuid(), eventType: z.enum(CONNECTED_NOTIFICATION_EVENTS), locale: z.enum(["en", "zh-CN", "es", "ja"]) }).strict();
const enabledSchema = z.object({ enabled: z.boolean() }).strict();
const testSchema = z.object({ requestId: z.string().uuid(), confirm: z.literal(true), title: z.string().min(1).max(120), text: z.string().min(1).max(1000) }).strict();
function companyAdmin(req: Request, companyId: string) {
  assertBoard(req); assertCompanyAccess(req, companyId);
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
  const membership = req.actor.memberships?.find(item => item.companyId === companyId);
  if (membership?.status !== "active" || !["owner", "admin"].includes(String(membership.membershipRole))) throw forbidden("Company administrator required");
}
export function mimouseNotificationRoutes(db: Db) {
  const router = Router();
  const path = "/companies/:companyId/notifications";
  const loadEndpoint = async (companyId: string, id: string) => {
    const [endpoint] = await db.select().from(endpoints).where(and(eq(endpoints.id, id), eq(endpoints.companyId, companyId)));
    if (!endpoint) throw notFound("Notification endpoint not found"); return endpoint;
  };
  router.get(path, async (req, res) => {
    const companyId = String(req.params.companyId); companyAdmin(req, companyId);
    const channelRows = await db.select().from(endpoints).where(eq(endpoints.companyId, companyId));
    const subscriptionRows = await db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId));
    const deliveryRows = await db.select({ id: deliveries.id, eventId: deliveries.eventId, endpointId: deliveries.endpointId, state: deliveries.state, attempt: deliveries.attempt, lastCode: deliveries.lastCode, createdAt: deliveries.createdAt }).from(deliveries).where(eq(deliveries.companyId, companyId)).orderBy(desc(deliveries.createdAt)).limit(100);
    res.json({ enabled: process.env.PAPERCLIP_NOTIFICATIONS_ENABLED === "true", dispatchEnabled: process.env.PAPERCLIP_NOTIFICATIONS_ENABLED === "true" && process.env.PAPERCLIP_NOTIFICATIONS_WORKER_ENABLED !== "false", connectedEvents: CONNECTED_NOTIFICATION_EVENTS,
      unconnectedEvents: [],
      verification: { implemented: true, contractTested: false, liveVerified: false, scenarioVerified: false },
      endpoints: channelRows.map(({ targetKey: _targetKey, ...row }) => row), subscriptions: subscriptionRows, deliveries: deliveryRows });
  });
  router.post(`${path}/endpoints`, validate(endpointSchema), async (req, res) => {
    const companyId = String(req.params.companyId); companyAdmin(req, companyId); const input = endpointSchema.parse(req.body);
    let secret: ChannelSecret;
    try { secret = JSON.parse(await secretService(db).resolveSecretValue(companyId, input.secretRef, input.secretVersion)); }
    catch { throw unprocessable("Secret unavailable or invalid JSON for this company"); }
    let request: ReturnType<typeof buildNotificationRequest>;
    try { request = buildNotificationRequest({ ...input.config, kind: input.kind, title: "Configuration validation", text: "No message is sent when saving." }, secret); }
    catch { throw unprocessable("Channel configuration is incomplete or invalid"); }
    // Credentials and signatures are excluded from target identity for app APIs;
    // complete Webhook URLs identify destinations but only the digest persists.
    const identity = input.kind.endsWith("webhook") || input.kind === "dingtalk_webhook_legacy" ? secret.url : [input.kind, input.config.target, input.config.robotCode].join(":");
    const targetKey = createHash("sha256").update(String(identity)).digest("hex");
    const [endpoint] = await db.insert(endpoints).values({ ...input, companyId, targetKey, enabled: false }).returning();
    const actor = getActorInfo(req);
    await logActivity(db, { companyId, actorType: actor.actorType, actorId: actor.actorId, action: "notification.endpoint.created", entityType: "notification_endpoint", entityId: endpoint.id, details: { kind: input.kind } });
    res.status(201).json({ id: endpoint.id, enabled: false, configurationValid: Boolean(request), liveVerified: false });
  });
  router.patch(`${path}/endpoints/:id`, validate(enabledSchema), async (req, res) => {
    const companyId = String(req.params.companyId); companyAdmin(req, companyId); await loadEndpoint(companyId, String(req.params.id));
    const [endpoint] = await db.update(endpoints).set(enabledSchema.parse(req.body)).where(and(eq(endpoints.companyId, companyId), eq(endpoints.id, String(req.params.id)))).returning();
    const actor = getActorInfo(req); await logActivity(db, { companyId, actorType: actor.actorType, actorId: actor.actorId, action: "notification.endpoint.toggled", entityType: "notification_endpoint", entityId: endpoint.id, details: { enabled: endpoint.enabled } });
    res.json({ id: endpoint.id, enabled: endpoint.enabled });
  });
  router.post(`${path}/subscriptions`, validate(subscriptionSchema), async (req, res) => {
    const companyId = String(req.params.companyId); companyAdmin(req, companyId); const input = subscriptionSchema.parse(req.body); await loadEndpoint(companyId, input.endpointId);
    const [subscription] = await db.insert(subscriptions).values({ ...input, companyId }).onConflictDoUpdate({ target: [subscriptions.companyId, subscriptions.endpointId, subscriptions.eventType], set: { locale: input.locale, enabled: true } }).returning();
    const actor = getActorInfo(req); await logActivity(db, { companyId, actorType: actor.actorType, actorId: actor.actorId, action: "notification.subscribed", entityType: "notification_subscription", entityId: subscription.id, details: { eventType: input.eventType } });
    res.status(201).json(subscription);
  });
  router.patch(`${path}/subscriptions/:id`, validate(enabledSchema), async (req, res) => {
    const companyId = String(req.params.companyId); companyAdmin(req, companyId);
    const [subscription] = await db.update(subscriptions).set(enabledSchema.parse(req.body)).where(and(eq(subscriptions.companyId, companyId), eq(subscriptions.id, String(req.params.id)))).returning();
    if (!subscription) throw notFound("Notification subscription not found");
    const actor = getActorInfo(req); await logActivity(db, { companyId, actorType: actor.actorType, actorId: actor.actorId, action: "notification.subscription.toggled", entityType: "notification_subscription", entityId: subscription.id, details: { enabled: subscription.enabled } });
    res.json({ id: subscription.id, enabled: subscription.enabled });
  });
  router.post(`${path}/deliveries/:id/retry`, validate(z.object({ requestId: z.string().uuid(), confirmReviewedOutcome: z.literal(true), acceptDuplicateRisk: z.literal(true) }).strict()), async (req, res) => {
    const companyId = String(req.params.companyId); companyAdmin(req, companyId);
    const [original] = await db.select().from(deliveries).where(and(eq(deliveries.companyId, companyId), eq(deliveries.id, String(req.params.id))));
    if (!original) throw notFound("Delivery not found");
    if (!["indeterminate", "rejected"].includes(original.state)) throw unprocessable("Only reviewed unknown or rejected deliveries may be explicitly retried");
    const endpoint = await loadEndpoint(companyId, original.endpointId);
    const [subscription] = await db.select().from(subscriptions).where(and(eq(subscriptions.companyId, companyId), eq(subscriptions.id, original.subscriptionId)));
    if (!endpoint.enabled || !subscription?.enabled) throw unprocessable("Endpoint and subscription must both be enabled");
    const eventId = `manual-retry:${original.id}:${req.body.requestId}`;
    const retried = await db.transaction(async tx => {
      await signalDatabaseWork(tx, NOTIFICATION_TOPIC);
      const [created] = await tx.insert(deliveries).values({ companyId, eventId, subscriptionId: original.subscriptionId, endpointId: original.endpointId, snapshot: original.snapshot }).onConflictDoNothing().returning();
      if (created) return created;
      const [existing] = await tx.select().from(deliveries).where(and(eq(deliveries.companyId, companyId), eq(deliveries.subscriptionId, original.subscriptionId), eq(deliveries.eventId, eventId))); return existing;
    });
    const actor = getActorInfo(req); await logActivity(db, { companyId, actorType: actor.actorType, actorId: actor.actorId, action: "notification.delivery.explicit_retry", entityType: "notification_delivery", entityId: retried.id, details: { originalDeliveryId: original.id, duplicateRiskAccepted: true } });
    res.status(202).json({ id: retried.id, state: retried.state, originalDeliveryId: original.id, originalStateUnchanged: true });
  });
  router.post(`${path}/endpoints/:id/test`, validate(testSchema), async (req, res) => {
    const companyId = String(req.params.companyId); companyAdmin(req, companyId); const input = testSchema.parse(req.body); const endpoint = await loadEndpoint(companyId, String(req.params.id));
    if (!endpoint.enabled) throw unprocessable("Enable this endpoint before explicitly sending a test");
    const delivery = await db.transaction(async tx => {
      const [subscription] = await tx.insert(subscriptions).values({ companyId, endpointId: endpoint.id, eventType: "manual.test", locale: "en" }).onConflictDoUpdate({ target: [subscriptions.companyId, subscriptions.endpointId, subscriptions.eventType], set: { enabled: true } }).returning();
      await signalDatabaseWork(tx, NOTIFICATION_TOPIC);
      const [row] = await tx.insert(deliveries).values({ companyId, eventId: `manual-test:${input.requestId}`, subscriptionId: subscription.id, endpointId: endpoint.id,
        snapshot: { ...endpoint.config, kind: endpoint.kind, title: input.title, text: input.text, secretRef: endpoint.secretRef, secretVersion: endpoint.secretVersion, targetKey: endpoint.targetKey, renderVersion: 1, locale: "en" } }).onConflictDoNothing().returning();
      if (row) return row;
      const [existing] = await tx.select().from(deliveries).where(and(eq(deliveries.companyId, companyId), eq(deliveries.eventId, `manual-test:${input.requestId}`), eq(deliveries.subscriptionId, subscription.id)));
      return existing;
    });
    const actor = getActorInfo(req); await logActivity(db, { companyId, actorType: actor.actorType, actorId: actor.actorId, action: "notification.test.queued", entityType: "notification_delivery", entityId: delivery.id, details: { endpointId: endpoint.id } });
    res.status(202).json({ id: delivery.id, state: delivery.state });
  });
  return router;
}
