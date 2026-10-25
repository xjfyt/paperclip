import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mimouseNotificationEndpoints as endpoints, mimouseNotificationSubscriptions as subscriptions, mimouseNotificationDeliveries as deliveries } from "../../packages/db/src/index.js";
import { createFixtureDb } from "./fixture-db.js";
import { secretService } from "../../server/src/services/secrets.js";
import { enqueueNotification, notificationOutbox } from "../../server/src/services/mimouse-notifications/outbox.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq } = await import(require.resolve("drizzle-orm"));
async function fixture(request: APIRequestContext) {
  const db = await createFixtureDb();
  try {
    await db.update(endpoints).set({ enabled: false });
    const company = await (await request.post("/api/companies", { data: { name: `revision fixture ${randomUUID()}` } })).json();
    const secrets = secretService(db);
    const oldSecret = await secrets.create(company.id, { name: "old-target", provider: "local_encrypted", value: JSON.stringify({ url: `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=fixture-old-${company.id}` }) });
    const newSecret = await secrets.create(company.id, { name: "new-target", provider: "local_encrypted", value: JSON.stringify({ url: `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=fixture-new-${company.id}` }) });
    const input = { name: "Original target", kind: "wecom_webhook", config: {}, secretRef: oldSecret.id, secretVersion: 1 };
    const base = `/api/companies/${company.id}/notifications`;
    const created = await request.post(`${base}/endpoints`, { data: input }); expect(created.status(), await created.text()).toBe(201);
    const endpoint = await created.json();
    const path = `${base}/endpoints/${endpoint.id}`;
    return { db, company, input, oldSecret, newSecret, base, endpoint, path, revision: { ...input, name: "New target", secretRef: newSecret.id, expectedVersion: 1 }, cleanup: async () => { await db.update(endpoints).set({ enabled: false }).where(eq(endpoints.id, endpoint.id)); await db.$client.end({ timeout: 1 }); } };
  } catch (error) { await db.$client.end({ timeout: 1 }); throw error; }
}

test("configuration revisions retain immutable history and pause without sending", async ({ request }) => {
  const f = await fixture(request);
  try {
    expect(f.endpoint).toMatchObject({ configVersion: 1, enabled: false, liveVerified: false });
    expect((await request.patch(f.path, { data: { enabled: true } })).ok()).toBe(true);
    const changed = await request.post(`${f.path}/revisions`, { data: f.revision }); expect(changed.ok(), await changed.text()).toBe(true);
    expect(await changed.json()).toMatchObject({ configVersion: 2, enabled: false, liveVerified: false });
    const history = await (await request.get(`${f.path}/revisions`)).json(); expect(history.map((row: { configVersion: number }) => row.configVersion)).toEqual([2, 1]);
    expect(history[1].snapshot).toMatchObject({ name: "Original target", secretRef: f.oldSecret.id, configVersion: 1 });
    expect(history[0].snapshot.secretRef).toBe(f.newSecret.id); expect(history[0].actorId).toBeTruthy();
    expect(JSON.stringify(history)).not.toContain("fixture-old-"); expect(JSON.stringify(history)).not.toContain("fixture-new-");
    expect(await f.db.select().from(deliveries).where(eq(deliveries.companyId, f.company.id))).toHaveLength(0);
    expect((await request.patch(f.path, { data: { enabled: true } })).status()).toBe(409);
    expect((await request.patch(f.path, { data: { enabled: true, expectedVersion: 2 } })).ok()).toBe(true);
    expect((await request.post(`${f.path}/test`, { data: { requestId: randomUUID(), confirm: true, title: "stale preview", text: "not sent", expectedVersion: 1 } })).status()).toBe(409);
  } finally { await f.cleanup(); }
});

test("only one concurrent configuration editor wins the expected version", async ({ request }) => {
  const f = await fixture(request);
  try {
    const responses = await Promise.all([request.post(`${f.path}/revisions`, { data: f.revision }), request.post(`${f.path}/revisions`, { data: { ...f.revision, name: "Competing edit" } })]);
    expect(responses.map(r => r.status()).sort()).toEqual([200, 409]);
    expect(await (await request.get(`${f.path}/revisions`)).json()).toHaveLength(2);
  } finally { await f.cleanup(); }
});

test("old queued messages keep their original secret and target after a revision", async ({ request }) => {
  const f = await fixture(request);
  try {
    await request.patch(f.path, { data: { enabled: true } });
    await f.db.insert(subscriptions).values({ companyId: f.company.id, endpointId: f.endpoint.id, eventType: "approval.requested" });
    const eventId = randomUUID(); await f.db.transaction(tx => enqueueNotification(tx, { companyId: f.company.id, eventId, type: "approval.requested", resourceId: randomUUID() }));
    const [old] = await f.db.select().from(deliveries).where(eq(deliveries.eventId, eventId)); expect(old.snapshot.configVersion).toBe(1);
    await request.post(`${f.path}/revisions`, { data: f.revision });
    let sends = 0; const sender = notificationOutbox(f.db, { send: async (_snapshot, secret) => { sends++; expect(secret.url).toContain(`fixture-old-${f.company.id}`); return { state: "accepted", code: "fixture_only", receipt: "not-a-real-message" }; } });
    expect(await sender.tick()).toBe(false); expect(sends).toBe(0);
    await request.patch(f.path, { data: { enabled: true, expectedVersion: 2 } }); expect(await sender.tick()).toBe(true); expect(sends).toBe(1);
    const [saved] = await f.db.select().from(deliveries).where(eq(deliveries.id, old.id)); expect(saved.snapshot).toEqual(old.snapshot); expect(saved.state).toBe("accepted");
  } finally { await f.cleanup(); }
});

test("foreign-company revisions and invalid or wrong-kind configurations fail without history", async ({ request }) => {
  const f = await fixture(request);
  try {
    const other = await (await request.post("/api/companies", { data: { name: `unrelated revision ${randomUUID()}` } })).json();
    const foreign = `/api/companies/${other.id}/notifications/endpoints/${f.endpoint.id}/revisions`;
    expect((await request.get(foreign)).status()).toBe(404); expect((await request.post(foreign, { data: f.revision })).status()).toBe(404);
    expect((await request.post(`${f.path}/revisions`, { data: { ...f.revision, secretRef: randomUUID() } })).status()).toBe(422);
    expect((await request.post(`${f.path}/revisions`, { data: { ...f.revision, kind: "dingtalk_app" } })).status()).toBe(422);
    expect(await (await request.get(`${f.path}/revisions`)).json()).toHaveLength(1);
    const [row] = await f.db.select().from(endpoints).where(eq(endpoints.id, f.endpoint.id)); expect(row.configVersion).toBe(1);
  } finally { await f.cleanup(); }
});
