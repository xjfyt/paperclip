import { createFixtureDb } from "./fixture-db.js";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { agents, heartbeatRuns, companySecrets, mimouseNotificationEndpoints as endpoints, mimouseNotificationSubscriptions as subscriptions, mimouseNotificationDeliveries as deliveries } from "../../packages/db/src/index.js";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq, sql } = await import(require.resolve("drizzle-orm"));
import { enqueueNotification, notificationOutbox } from "../../server/src/services/mimouse-notifications/outbox.js";

test.beforeEach(async () => {
  // This suite intentionally exercises the global queue; pause leftovers from
  // earlier runs in this isolated fixture database before creating fresh rows.
  const db = await createFixtureDb();
  try { await db.update(endpoints).set({ enabled: false }); } finally { await db.$client.end({ timeout: 1 }); }
});

// This suite only targets the isolated local database booted by this config.
// The injected sender never contacts any vendor.
test("durable outbox: atomic enqueue, identity, leases and restart recovery", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `outbox fixture ${Date.now()}` } })).json();
  const db = await createFixtureDb();
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
    expect(JSON.stringify(body)).not.toContain("key=fixture"); expect(body.connectedEvents).toEqual(["approval.requested", "run.failed", "coding.mr_ready", "coding.ci_failed", "coding.artifact_ready", "budget.threshold_reached"]);
    expect(saved[0].snapshot.renderVersion).toBe(2);
    const toggle = await request.patch(`/api/companies/${company.id}/notifications/subscriptions/${subscription.id}`, { data: { enabled: false } });
    expect(toggle.ok()).toBe(true);
    expect((await toggle.json()).enabled).toBe(false);
  } finally { await db.$client.end({ timeout: 1 }); }
});

test("worker delivers once, honors pauses and recovers pre-send claims", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `worker fixture ${Date.now()}` } })).json();
  const db = await createFixtureDb();
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

test("all persisted failed runs enqueue atomically without duplicate terminal notifications", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `failed-run fixture ${Date.now()}` } })).json();
  const db = await createFixtureDb();
  try {
    const [agent] = await db.insert(agents).values({ companyId: company.id, name: "PRIVATE_AGENT_NAME", role: "engineer", status: "active", adapterType: "process" }).returning();
    const [secret] = await db.insert(companySecrets).values({ companyId: company.id, name: "fixture", key: randomUUID() }).returning();
    const [endpoint] = await db.insert(endpoints).values({ companyId: company.id, name: "run fixture", kind: "wecom_webhook", config: {}, secretRef: secret.id, secretVersion: 1, targetKey: randomUUID(), enabled: true }).returning();
    const [subscription] = await db.insert(subscriptions).values({ companyId: company.id, endpointId: endpoint.id, eventType: "run.failed", locale: "zh-CN" }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: company.id, agentId: agent.id, invocationSource: "assignment", status: "running", runtimeMode: "legacy" }).returning();
    await expect(db.transaction(async tx => { await tx.update(heartbeatRuns).set({ status: "failed", error: "PRIVATE_ERROR" }).where(eq(heartbeatRuns.id, run.id)); throw Error("rollback"); })).rejects.toThrow("rollback");
    expect(await db.select().from(deliveries).where(eq(deliveries.companyId, company.id))).toHaveLength(0);
    await db.update(heartbeatRuns).set({ status: "failed", error: "PRIVATE_ERROR" }).where(eq(heartbeatRuns.id, run.id));
    await db.update(heartbeatRuns).set({ status: "failed" }).where(eq(heartbeatRuns.id, run.id));
    const rows = await db.select().from(deliveries).where(eq(deliveries.companyId, company.id)); expect(rows).toHaveLength(1);
    expect(rows[0].snapshot.secretVersion).toBe(1); expect(rows[0].snapshot.rendered).toBe(false); expect(JSON.stringify(rows)).not.toContain("PRIVATE_ERROR");
    let sent = 0;
    const worker = notificationOutbox(db, { resolveSecret: async () => "{}", send: async snapshot => { sent++; expect(snapshot.title).toBe("Agent 运行失败"); expect(snapshot.text).toContain(run.id); return { state: "accepted", code: "accepted" }; } });
    expect(await worker.tick()).toBe(true); expect(sent).toBe(1);
    const [stored] = await db.select().from(deliveries).where(eq(deliveries.id, rows[0].id)); expect(stored.snapshot.rendered).toBe(true); expect(stored.state).toBe("accepted");
    // Native failures use the same database boundary, not a separate callback.
    await db.insert(heartbeatRuns).values({ companyId: company.id, agentId: agent.id, invocationSource: "assignment", status: "timed_out", runtimeMode: "native" });
    expect(await db.select().from(deliveries).where(eq(deliveries.companyId, company.id))).toHaveLength(2);
    await db.update(subscriptions).set({ enabled: false }).where(eq(subscriptions.id, subscription.id));
    await db.insert(heartbeatRuns).values({ companyId: company.id, agentId: agent.id, invocationSource: "assignment", status: "failed", runtimeMode: "legacy" });
    expect(await db.select().from(deliveries).where(eq(deliveries.companyId, company.id))).toHaveLength(2);
  } finally { await db.update(endpoints).set({ enabled: false }).where(eq(endpoints.companyId, company.id)); await db.$client.end({ timeout: 1 }); }
});

test("explicit duplicate-risk retry preserves the unknown original and is idempotent", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `manual-retry fixture ${Date.now()}` } })).json();
  const db = await createFixtureDb();
  try {
    const [secret] = await db.insert(companySecrets).values({ companyId: company.id, name: "fixture", key: randomUUID() }).returning();
    const [endpoint] = await db.insert(endpoints).values({ companyId: company.id, name: "fixture", kind: "wecom_webhook", config: {}, secretRef: secret.id, secretVersion: 1, targetKey: randomUUID(), enabled: true }).returning();
    const [subscription] = await db.insert(subscriptions).values({ companyId: company.id, endpointId: endpoint.id, eventType: "approval.requested" }).returning();
    const [original] = await db.insert(deliveries).values({ companyId: company.id, endpointId: endpoint.id, subscriptionId: subscription.id, eventId: randomUUID(), state: "indeterminate", snapshot: { kind: "wecom_webhook", title: "Fixture", text: "Fixture", secretRef: secret.id, secretVersion: 1, targetKey: endpoint.targetKey, renderVersion: 2 } }).returning();
    const preview = await request.get(`/api/companies/${company.id}/notifications/deliveries/${original.id}/preview`);
    expect(preview.ok()).toBe(true); const visible = await preview.json(); expect(visible.title).toBe("Fixture"); expect(visible.secretVersion).toBe(1); expect(JSON.stringify(visible)).not.toContain(secret.id);
    const url = `/api/companies/${company.id}/notifications/deliveries/${original.id}/retry`; const requestId = randomUUID();
    expect((await request.post(url, { data: { requestId, confirmReviewedOutcome: true } })).status()).toBe(400);
    const data = { requestId, confirmReviewedOutcome: true, acceptDuplicateRisk: true };
    const first = await request.post(url, { data }); expect(first.status()).toBe(202); const queued = await first.json();
    const second = await request.post(url, { data }); expect((await second.json()).id).toBe(queued.id);
    const rows = await db.select().from(deliveries).where(eq(deliveries.companyId, company.id)); expect(rows).toHaveLength(2);
    expect(rows.find(row => row.id === original.id)?.state).toBe("indeterminate"); expect(rows.find(row => row.id === queued.id)?.snapshot).toEqual(original.snapshot);
  } finally { await db.update(endpoints).set({ enabled: false }).where(eq(endpoints.companyId, company.id)); await db.$client.end({ timeout: 1 }); }
});

test("unknown rendering contracts fail closed before any provider call", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `render-version fixture ${Date.now()}` } })).json();
  const db = await createFixtureDb();
  try {
    const [secret] = await db.insert(companySecrets).values({ companyId: company.id, name: "fixture", key: randomUUID() }).returning();
    const [endpoint] = await db.insert(endpoints).values({ companyId: company.id, name: "fixture", kind: "wecom_webhook", config: {}, secretRef: secret.id, secretVersion: 1, targetKey: randomUUID(), enabled: true }).returning();
    const [subscription] = await db.insert(subscriptions).values({ companyId: company.id, endpointId: endpoint.id, eventType: "approval.requested" }).returning();
    const [row] = await db.insert(deliveries).values({ companyId: company.id, endpointId: endpoint.id, subscriptionId: subscription.id, eventId: randomUUID(), snapshot: { renderVersion: 999 } }).returning();
    let sideEffects = 0;
    const worker = notificationOutbox(db, { resolveSecret: async () => { sideEffects++; return "{}"; }, send: async () => { sideEffects++; return { state: "accepted", code: "must_not_send" }; } });
    expect(await worker.tick()).toBe(true); expect(sideEffects).toBe(0);
    const [saved] = await db.select().from(deliveries).where(eq(deliveries.id, row.id)); expect(saved.state).toBe("rejected"); expect(saved.lastCode).toBe("unsupported_render_version");
  } finally { await db.update(endpoints).set({ enabled: false }).where(eq(endpoints.companyId, company.id)); await db.$client.end({ timeout: 1 }); }
});

test("official-account template fields use event locale; bad templates do not roll back business work", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `template fixture ${Date.now()}` } })).json();
  const db = await createFixtureDb();
  try {
    const [secret] = await db.insert(companySecrets).values({ companyId: company.id, name: "fixture", key: randomUUID() }).returning();
    const [endpoint] = await db.insert(endpoints).values({ companyId: company.id, name: "fixture", kind: "wechat_official_account", config: { target: "test-openid", templateId: "test-template", templateData: { first: { value: "{{title}}" }, keyword1: { value: "{{resourceId}}" } } }, secretRef: secret.id, secretVersion: 1, targetKey: randomUUID(), enabled: true }).returning();
    await db.insert(subscriptions).values({ companyId: company.id, endpointId: endpoint.id, eventType: "approval.requested", locale: "ja" });
    const resourceId = randomUUID();
    await db.transaction(tx => enqueueNotification(tx, { companyId: company.id, eventId: "template-one", type: "approval.requested", resourceId }));
    const [saved] = await db.select().from(deliveries).where(eq(deliveries.companyId, company.id));
    expect(saved.snapshot.templateData).toEqual({ first: { value: "承認待ちの項目があります" }, keyword1: { value: resourceId } });
    await db.update(endpoints).set({ config: { templateData: { first: { value: "{{secret}}" } } } }).where(eq(endpoints.id, endpoint.id));
    await db.transaction(tx => enqueueNotification(tx, { companyId: company.id, eventId: "template-two", type: "approval.requested", resourceId }));
    const rows = await db.select().from(deliveries).where(eq(deliveries.companyId, company.id)); expect(rows).toHaveLength(2);
    expect(rows.find(row => row.eventId === "template-two")).toMatchObject({ state: "rejected", lastCode: "snapshot_render_failed" });
    const failed = rows.find(row => row.eventId === "template-two")!;
    expect((await request.post(`/api/companies/${company.id}/notifications/deliveries/${failed.id}/retry`, { data: { requestId: randomUUID(), confirmReviewedOutcome: true, acceptDuplicateRisk: true } })).status()).toBe(422);
  } finally { await db.update(endpoints).set({ enabled: false }).where(eq(endpoints.companyId, company.id)); await db.$client.end({ timeout: 1 }); }
});
