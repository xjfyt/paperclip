import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mimouseNotificationEndpoints as endpoints, mimouseNotificationSubscriptions as subscriptions, mimouseNotificationDeliveries as deliveries, mimouseNotificationReviews as reviews } from "../../packages/db/src/index.js";
import { createFixtureDb } from "./fixture-db.js";
import { secretService } from "../../server/src/services/secrets.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq } = await import(require.resolve("drizzle-orm"));
async function fixture(request: APIRequestContext, state = "indeterminate") {
  const db = await createFixtureDb();
  try {
    const company = await (await request.post("/api/companies", { data: { name: `review fixture ${randomUUID()}` } })).json();
    const secret = await secretService(db).create(company.id, { name: "not-for-sending", provider: "local_encrypted", value: JSON.stringify({ url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=fixture-no-send" }) });
    const [endpoint] = await db.insert(endpoints).values({ companyId: company.id, name: "review fixture", kind: "wecom_webhook", config: {}, secretRef: secret.id, secretVersion: 1, targetKey: randomUUID(), enabled: false }).returning();
    const [subscription] = await db.insert(subscriptions).values({ companyId: company.id, endpointId: endpoint.id, eventType: "manual.test", enabled: false }).returning();
    const [delivery] = await db.insert(deliveries).values({ companyId: company.id, endpointId: endpoint.id, subscriptionId: subscription.id, eventId: randomUUID(), snapshot: { title: "Frozen original", secretRef: secret.id, secretVersion: 1 }, state, attempt: 1, lastCode: "fixture_transport_unconfirmed" }).returning();
    return { db, company, delivery, path: `/api/companies/${company.id}/notifications/deliveries/${delivery.id}/reviews`, input: { requestId: randomUUID(), confirm: true, outcome: "accepted", evidence: "Checked fixture receipt in provider console; no real send", expectedState: state, expectedAttempt: 1 }, cleanup: () => db.$client.end({ timeout: 1 }) };
  } catch (error) { await db.$client.end({ timeout: 1 }); throw error; }
}

test("manual reconciliation persists an observation but never changes the original transport result", async ({ request }) => {
  const f = await fixture(request);
  try {
    const response = await request.post(f.path, { data: f.input }); expect(response.ok(), await response.text()).toBe(true);
    const review = await response.json(); expect(review).toMatchObject({ deliveryId: f.delivery.id, outcome: "accepted", observedState: "indeterminate", observedAttempt: 1 });
    const [saved] = await f.db.select().from(deliveries).where(eq(deliveries.id, f.delivery.id)); expect(saved).toEqual(f.delivery);
    const history = await (await request.get(f.path)).json(); expect(history).toHaveLength(1); expect(history[0].actorId).toBeTruthy();
    const another = await createFixtureDb(); try { expect(await another.select().from(reviews).where(eq(reviews.deliveryId, f.delivery.id))).toHaveLength(1); } finally { await another.$client.end({ timeout: 1 }); }
    expect(await f.db.select().from(deliveries).where(eq(deliveries.companyId, f.company.id))).toHaveLength(1);
  } finally { await f.cleanup(); }
});

test("concurrent duplicate observations are idempotent and conflicting evidence is rejected", async ({ request }) => {
  const f = await fixture(request);
  try {
    const responses = await Promise.all([request.post(f.path, { data: f.input }), request.post(f.path, { data: f.input })]);
    expect(responses.map(r => r.status())).toEqual([200, 200]); const bodies = await Promise.all(responses.map(r => r.json())); expect(bodies[0].id).toBe(bodies[1].id);
    expect((await request.post(f.path, { data: { ...f.input, outcome: "not_accepted" } })).status()).toBe(409);
    expect(await (await request.get(f.path)).json()).toHaveLength(1);
  } finally { await f.cleanup(); }
});

test("a changed delivery and an active dispatch cannot be adjudicated from a stale screen", async ({ request }) => {
  const f = await fixture(request);
  try {
    await f.db.update(deliveries).set({ attempt: 2 }).where(eq(deliveries.id, f.delivery.id));
    expect((await request.post(f.path, { data: f.input })).status()).toBe(409);
    await f.db.update(deliveries).set({ state: "sending" }).where(eq(deliveries.id, f.delivery.id));
    expect((await request.post(f.path, { data: { ...f.input, expectedAttempt: 2 } })).status()).toBe(422);
    expect(await (await request.get(f.path)).json()).toHaveLength(0);
  } finally { await f.cleanup(); }
});

test("reviews enforce company ownership in both HTTP access and the database foreign key", async ({ request }) => {
  const f = await fixture(request);
  try {
    const other = await (await request.post("/api/companies", { data: { name: `review stranger ${randomUUID()}` } })).json();
    const path = `/api/companies/${other.id}/notifications/deliveries/${f.delivery.id}/reviews`;
    expect((await request.get(path)).status()).toBe(404); expect((await request.post(path, { data: f.input })).status()).toBe(404);
    let failure: unknown;
    try { await f.db.insert(reviews).values({ companyId: other.id, deliveryId: f.delivery.id, requestId: randomUUID(), outcome: "unknown", evidence: "wrong company fixture", actorId: "fixture", observedState: "indeterminate", observedAttempt: 1 }); } catch (error) { failure = error; }
    expect((failure as { cause?: { code?: string } })?.cause?.code).toBe("23503");
    expect((await request.post(f.path, { data: { ...f.input, confirm: false } })).status()).toBe(400);
    expect((await request.post(f.path, { data: { ...f.input, evidence: " " } })).status()).toBe(400);
  } finally { await f.cleanup(); }
});
