import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createDb, companySecrets, mimouseNotificationEndpoints as endpoints, mimouseNotificationSubscriptions as subscriptions, mimouseNotificationDeliveries as deliveries } from "../../packages/db/src/index.js";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq, sql } = await import(require.resolve("drizzle-orm"));
import { enqueueNotification, notificationOutbox } from "../../server/src/services/mimouse-notifications/outbox.js";

// This suite only targets the isolated local database booted by this config.
// The injected sender never contacts any vendor.
test("durable outbox: atomic enqueue, identity, leases and restart recovery", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `outbox fixture ${Date.now()}` } })).json();
  const db = createDb("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip");
  try {
    const [secret] = await db.insert(companySecrets).values({ companyId: company.id, name: "fixture", key: `fixture-${randomUUID()}` }).returning();
    const [endpoint] = await db.insert(endpoints).values({ companyId: company.id, name: "fixture", kind: "wecom_webhook", config: {}, secretRef: secret.id, secretVersion: 1, targetKey: randomUUID(), enabled: true }).returning();
    const [subscription] = await db.insert(subscriptions).values({ companyId: company.id, endpointId: endpoint.id, eventType: "approval.requested" }).returning();
    const event = { companyId: company.id, eventId: `event-${randomUUID()}`, type: "approval.requested", resourceId: randomUUID(), title: "Approval", text: "Fixture" };
    await expect(db.transaction(async tx => { await enqueueNotification(tx, event); throw Error("rollback"); })).rejects.toThrow("rollback");
    expect(await db.select().from(deliveries).where(eq(deliveries.eventId, event.eventId))).toHaveLength(0);
    await db.transaction(async tx => { await enqueueNotification(tx, event); await enqueueNotification(tx, event); });
    const saved = await db.select().from(deliveries).where(eq(deliveries.eventId, event.eventId)); expect(saved).toHaveLength(1);
    let sends = 0;
    const deps = { send: async () => { sends++; return { state: "accepted" as const, code: "accepted", receipt: "fixture" }; }, resolveSecret: async () => JSON.stringify({ url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=fixture" }) };
    const firstWorker = notificationOutbox(db, deps), secondWorker = notificationOutbox(db, deps);
    const claims = await Promise.all([firstWorker.claim(), secondWorker.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1); const claim = claims.find(Boolean)!;
    expect(claim.snapshot.secretVersion).toBe(1);
    await db.update(endpoints).set({ config: { target: "changed-target" }, secretVersion: 2 }).where(eq(endpoints.id, endpoint.id));
    expect(claim.snapshot.secretVersion).toBe(1); expect(claim.snapshot.target).toBeUndefined();
    expect(await firstWorker.enterSending(claim)).toBe(true);
    // Crash after entering sending is deliberately unknown, not pending.
    await db.execute(sql`UPDATE mimouse_notification_deliveries SET lease_expires_at=now()-interval '1 second' WHERE id=${claim.id}`);
    await secondWorker.recover();
    expect((await db.select().from(deliveries).where(eq(deliveries.id, claim.id)))[0].state).toBe("indeterminate");
    await firstWorker.settle(claim, { state: "accepted", code: "late" });
    expect((await db.select().from(deliveries).where(eq(deliveries.id, claim.id)))[0].state).toBe("indeterminate");
    expect(await secondWorker.tick()).toBe(false); expect(sends).toBe(0);
    // Cross-company references fail at the database boundary too.
    const other = await (await request.post("/api/companies", { data: { name: `other ${Date.now()}` } })).json();
    await expect(db.insert(subscriptions).values({ companyId: other.id, endpointId: endpoint.id, eventType: "approval.requested" })).rejects.toThrow();
    const center = await request.get(`/api/companies/${company.id}/notifications`); expect(center.ok(), await center.text()).toBeTruthy();
    const body = await center.json(); expect(body.deliveries[0].state).toBe("indeterminate");
    expect(JSON.stringify(body)).not.toContain("key=fixture"); expect(body.connectedEvents).toEqual(["approval.requested"]);
  } finally { await db.$client.end({ timeout: 1 }); }
});

test("worker delivers once, honors pauses and recovers pre-send claims", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `worker fixture ${Date.now()}` } })).json();
  const db = createDb("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip");
  try {
    const [secret] = await db.insert(companySecrets).values({ companyId: company.id, name: "fixture", key: `fixture-${randomUUID()}` }).returning();
    const [endpoint] = await db.insert(endpoints).values({ companyId: company.id, name: "fixture", kind: "wecom_webhook", config: {}, secretRef: secret.id, secretVersion: 1, targetKey: randomUUID(), enabled: true }).returning();
    await db.insert(subscriptions).values({ companyId: company.id, endpointId: endpoint.id, eventType: "approval.requested" });
    const event = { companyId: company.id, eventId: `event-${randomUUID()}`, type: "approval.requested", resourceId: randomUUID(), title: "Approval", text: "Fixture" };
    await db.transaction(tx => enqueueNotification(tx, event));
    let calls = 0;
    const outbox = notificationOutbox(db, { resolveSecret: async (_company, _id, version) => { expect(version).toBe(1); return "{}"; }, send: async () => { calls++; return { state: "accepted", code: "accepted" }; } });
    const claim = await outbox.claim(); expect(claim).toBeTruthy();
    await db.execute(sql`UPDATE mimouse_notification_deliveries SET lease_expires_at=now()-interval '1 second' WHERE id=${claim!.id}`);
    await outbox.recover();
    await db.update(endpoints).set({ enabled: false }).where(eq(endpoints.id, endpoint.id));
    expect(await outbox.tick()).toBe(false); expect(calls).toBe(0);
    await db.update(endpoints).set({ enabled: true }).where(eq(endpoints.id, endpoint.id));
    expect(await outbox.tick()).toBe(true); expect(calls).toBe(1);
    expect((await db.select().from(deliveries).where(eq(deliveries.eventId, event.eventId)))[0].state).toBe("accepted");
    expect(await outbox.tick()).toBe(false); expect(calls).toBe(1);
  } finally { await db.$client.end({ timeout: 1 }); }
});
