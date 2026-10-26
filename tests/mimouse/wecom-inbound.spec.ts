import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createFixtureDb } from "./fixture-db.js";
import { activityLog, authUsers, companies, instanceUserRoles, companySecrets, companySecretVersions, mimouseFeedbackInbox as inbox } from "../../packages/db/src/index.js";
import { mimouseWecomConnections as connections } from "../../packages/db/src/schema/mimouse_wecom.js";
import { wecomFeedbackService } from "../../server/src/services/mimouse-wecom.js";
import { projectWecomMessage, type WecomConfig } from "../../server/src/services/mimouse-wecom/protocol.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq, and } = await import(require.resolve("drizzle-orm"));

// Requires the reviewed WeCom schema proposal to have been applied to the verified
// disposable DB. Never applies migrations, resolves secrets, starts a worker or
// opens a vendor connection. Provider callbacks below are in-memory objects only.
async function fixture(request: APIRequestContext) {
  const db = await createFixtureDb();
  try {
    const response = await request.post("/api/companies", { data: { name: `WeCom fixture ${randomUUID()}` } });
    expect(response.ok()).toBe(true);
    const company = await response.json(), actorId = randomUUID();
    await db.insert(authUsers).values({ id: actorId, name: "WeCom fixture registrar", email: `${actorId}@fixture.invalid`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(instanceUserRoles).values({ userId: actorId, role: "instance_admin" });
    const actor = { actorType: "user" as const, actorId };
    const [secret] = await db.insert(companySecrets).values({ companyId: company.id, name: "wecom-fixture", key: "wecom-fixture", provider: "local_encrypted" }).returning();
    await db.insert(companySecretVersions).values({ secretId: secret.id, version: 1, material: {}, valueSha256: "a".repeat(64), fingerprintSha256: "a".repeat(64) });
    const config: WecomConfig = { transport: "long_connection", botId: `fixture-${randomUUID()}`, product: "Fixture product",
      allowedGroupIds: ["fixture-group"], allowedDirectSenderIds: ["fixture-sender"], secret: { secretId: secret.id, version: 1 } };
    const service = wecomFeedbackService(db);
    const create = () => service.create(company.id, config, actor);
    const start = async () => {
      const row = await create(); await service.setEnabled(company.id, row.id, true, actor);
      const lease = await service.acquire(company.id, row.id); if (!lease) throw Error("Fixture lease was not acquired");
      return { row, lease };
    };
    const state = async (id: string) => (await db.select().from(connections).where(eq(connections.id, id)))[0];
    const rows = () => db.select().from(inbox).where(eq(inbox.companyId, company.id));
    const message = (changes: Record<string, unknown> = {}) => ({ msgid: "fixture-event-1", aibotid: config.botId, chattype: "group", chatid: "fixture-group",
      from: { userid: "fixture-sender" }, create_time: 1790812800, msgtype: "text", text: { content: "original fixture feedback" }, ...changes });
    const item = (changes: Record<string, unknown> = {}) => {
      const projected = projectWecomMessage(config, message(changes), new Date("2026-10-01T00:00:00Z"), "fixture-credential");
      if (!projected) throw Error("Fixture callback was unexpectedly rejected"); return projected;
    };
    return { db, actor, companyId: company.id as string, config, service, create, start, state, rows, message, item,
      cleanup: () => db.$client.end({ timeout: 1 }) };
  } catch (error) { await db.$client.end({ timeout: 1 }); throw error; }
}

test("registration requires a durable instance-admin role and globally reserves the bot", async ({ request }) => {
  const f = await fixture(request), other = await fixture(request);
  try {
    await expect(f.service.create(f.companyId, f.config, { actorType: "system", actorId: "not-an-admin" })).rejects.toMatchObject({ status: 403 });
    await f.db.delete(instanceUserRoles).where(eq(instanceUserRoles.userId, f.actor.actorId));
    await expect(f.create()).rejects.toMatchObject({ status: 403 });
    expect(await f.service.list(f.companyId)).toHaveLength(0);
    await f.db.insert(instanceUserRoles).values({ userId: f.actor.actorId, role: "instance_admin" });
    await expect(f.service.create(f.companyId, { ...f.config, secret: { ...f.config.secret, version: 999 } }, f.actor)).rejects.toMatchObject({ status: 422 });
    await expect(f.service.create(f.companyId, { ...f.config, secret: other.config.secret }, f.actor)).rejects.toMatchObject({ status: 422 });
    const row = await f.create(); expect(row).toMatchObject({ enabled: false, state: "disabled", imported: 0 });
    await expect(other.service.create(other.companyId, { ...other.config, botId: f.config.botId }, other.actor)).rejects.toMatchObject({ status: 409 });
    expect(await other.service.list(other.companyId)).toHaveLength(0);
    expect(await f.db.select().from(activityLog).where(and(eq(activityLog.entityId, row.id), eq(activityLog.action, "feedback.wecom.created")))).toHaveLength(1);
  } finally { await other.cleanup(); await f.cleanup(); }
});

test("concurrent acquisitions have one owner; stale token and wrong-company persistence are fenced", async ({ request }) => {
  const f = await fixture(request), other = await fixture(request);
  try {
    const row = await f.create(); await f.service.setEnabled(f.companyId, row.id, true, f.actor);
    const claims = await Promise.all([f.service.acquire(f.companyId, row.id), wecomFeedbackService(f.db).acquire(f.companyId, row.id)]);
    expect(claims.filter(Boolean)).toHaveLength(1); const lease = claims.find(value => value !== null)!;
    await expect(f.service.persist({ ...lease, companyId: other.companyId }, f.item())).rejects.toMatchObject({ status: 409 });
    await f.db.update(connections).set({ leaseExpiresAt: new Date(0) }).where(eq(connections.id, row.id));
    expect(await f.service.acquire(f.companyId, row.id)).toBeNull();
    expect(await f.state(row.id)).toMatchObject({ enabled: false, state: "interrupted", leaseToken: null, gapDetected: true });
    // A crashed owner's expiry cannot silently restart collection under the old activation.
    expect(await f.service.acquire(f.companyId, row.id)).toBeNull();
    await expect(f.service.persist(lease, f.item())).rejects.toMatchObject({ status: 409 });
    await f.service.setEnabled(f.companyId, row.id, false, f.actor);
    await f.service.setEnabled(f.companyId, row.id, true, f.actor);
    const successor = await f.service.acquire(f.companyId, row.id); expect(successor).not.toBeNull();
    expect(successor!.token).not.toBe(lease.token); expect(successor!.activationToken).not.toBe(lease.activationToken);
    await expect(f.service.persist({ ...successor!, activationToken: lease.activationToken }, f.item())).rejects.toMatchObject({ status: 409 });
    await f.service.release(lease, "cancelled");
    expect(await f.state(row.id)).toMatchObject({ leaseToken: successor!.token, activationToken: successor!.activationToken, enabled: true, gapDetected: true });
    expect(await f.rows()).toHaveLength(0); expect(await other.rows()).toHaveLength(0);
  } finally { await other.cleanup(); await f.cleanup(); }
});

for (const status of ["paused", "archived"]) {
  test(`company ${status} fences persistence and commits the lifecycle stop`, async ({ request }) => {
    const f = await fixture(request);
    try {
      const { row, lease } = await f.start();
      await f.db.update(companies).set({ status }).where(eq(companies.id, f.companyId));
      await expect(f.service.persist(lease, f.item())).rejects.toMatchObject({ status: 409 });
      expect(await f.state(row.id)).toMatchObject({ enabled: false, state: "company_inactive", leaseToken: null, gapDetected: true, imported: 0 });
      expect(await f.service.renew(lease)).toBe(false); expect(await f.rows()).toHaveLength(0);
      await expect(f.service.setEnabled(f.companyId, row.id, true, f.actor)).rejects.toMatchObject({ status: 409 });
      expect(await f.db.select().from(activityLog).where(and(eq(activityLog.entityId, row.id), eq(activityLog.action, "feedback.wecom.stopped")))).toHaveLength(1);
    } finally { await f.cleanup(); }
  });
}

test("revoked pinned versions block acquire and active persistence without inbox effects", async ({ request }) => {
  const f = await fixture(request);
  try {
    const row = await f.create(); await f.service.setEnabled(f.companyId, row.id, true, f.actor);
    await f.db.update(companySecretVersions).set({ revokedAt: new Date() }).where(eq(companySecretVersions.secretId, f.config.secret.secretId));
    expect(await f.service.acquire(f.companyId, row.id)).toBeNull();
    expect(await f.state(row.id)).toMatchObject({ enabled: false, state: "revoked", leaseToken: null, gapDetected: true });
    await f.db.update(companySecretVersions).set({ revokedAt: null }).where(eq(companySecretVersions.secretId, f.config.secret.secretId));
    await f.service.setEnabled(f.companyId, row.id, true, f.actor); const lease = await f.service.acquire(f.companyId, row.id); expect(lease).not.toBeNull();
    await f.db.update(companySecretVersions).set({ revokedAt: new Date() }).where(eq(companySecretVersions.secretId, f.config.secret.secretId));
    await expect(f.service.persist(lease!, f.item())).rejects.toMatchObject({ status: 422 });
    await expect(f.service.renew(lease!)).rejects.toMatchObject({ status: 422 });
    await f.service.release(lease!, "revoked");
    expect(await f.state(row.id)).toMatchObject({ enabled: false, state: "revoked", imported: 0 }); expect(await f.rows()).toHaveLength(0);
  } finally { await f.cleanup(); }
});

test("projection rejects foreign bot and scope; persisted first snapshot and attribution remain immutable", async ({ request }) => {
  const f = await fixture(request);
  try {
    const { row, lease } = await f.start();
    for (const change of [{ aibotid: "foreign-bot" }, { chatid: "foreign-group" }, { chattype: "single", from: { userid: "foreign-sender" } }, { msgtype: "image", image: { url: "https://never-fetch.invalid/media", aeskey: "never-persist-key" } }]) {
      expect(projectWecomMessage(f.config, f.message(change), new Date(), "fixture-credential")).toBeNull();
    }
    const item = f.item({ companyId: "foreign-company", product: "foreign-product", quote: { text: { content: "never-persist-quote" } }, response_url: "https://never-fetch.invalid/reply", text: { content: "feedback fixture-credential" } });
    expect(await f.service.persist(lease, { ...item, product: "forged-product", sourceInstance: "forged-instance" }, undefined, "fixture-credential")).toBe(true);
    expect(await wecomFeedbackService(f.db).persist(lease, { ...item, text: "changed replay must not overwrite" })).toBe(false);
    const rows = await f.rows(); expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ companyId: f.companyId, product: f.config.product, ingestionMode: "provider_push", body: "feedback [REDACTED]", status: "candidate" });
    expect(rows[0].sourceInstance).toMatch(/^wecom:[a-f0-9]{64}$/);
    expect(JSON.stringify(rows)).not.toMatch(/forged-|never-persist|never-fetch|fixture-credential|changed replay/);
    expect((await f.state(row.id)).imported).toBe(1);
    expect(await f.db.select().from(activityLog).where(and(eq(activityLog.entityId, row.id), eq(activityLog.action, "feedback.wecom.received")))).toHaveLength(1);
  } finally { await f.cleanup(); }
});

test("receive audit failure atomically rolls back inbox and counters; retry recovers", async ({ request }) => {
  const f = await fixture(request), constraint = `wecom_fixture_${randomUUID().replaceAll("-", "")}`;
  try {
    const { row, lease } = await f.start();
    // UUID-derived identifiers and company scope only, on verified disposable DB.
    await f.db.$client.unsafe(`ALTER TABLE activity_log ADD CONSTRAINT ${constraint} CHECK (company_id <> '${f.companyId}'::uuid OR action <> 'feedback.wecom.received')`);
    try {
      await expect(f.service.persist(lease, f.item())).rejects.toThrow();
      expect(await f.rows()).toHaveLength(0); expect((await f.state(row.id)).imported).toBe(0);
      expect(await f.db.select().from(activityLog).where(and(eq(activityLog.entityId, row.id), eq(activityLog.action, "feedback.wecom.received")))).toHaveLength(0);
    } finally { await f.db.$client.unsafe(`ALTER TABLE activity_log DROP CONSTRAINT ${constraint}`); }
    expect(await f.service.persist(lease, f.item())).toBe(true); expect((await f.state(row.id)).imported).toBe(1);
  } finally { await f.cleanup(); }
});
