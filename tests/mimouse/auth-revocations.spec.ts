import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq } = await import(require.resolve("drizzle-orm"));
import { authSessions, authUsers, boardApiKeys, instanceUserRoles, mimouseAuthRevocations } from "../../packages/db/src/index.js";
import { mimouseAuthRevocationService } from "../../server/src/services/mimouse-auth-revocations.js";
import { createFixtureDb } from "./fixture-db.js";

async function fixture() {
  const db = await createFixtureDb(), admin = randomUUID(), target = randomUUID(), other = randomUUID();
  const before = new Date(Date.now() - 60_000), expiry = new Date(Date.now() + 3_600_000);
  await db.insert(authUsers).values([admin, target, other].map(id => ({ id, name: "Revocation fixture", email: `${id}@fixture.invalid`, createdAt: before, updatedAt: before })));
  await db.insert(instanceUserRoles).values({ userId: admin, role: "instance_admin" });
  await db.insert(authSessions).values([target, other].map(userId => ({ id: randomUUID(), token: `fake-${randomUUID()}`, userId, createdAt: before, updatedAt: before, expiresAt: expiry })));
  await db.insert(boardApiKeys).values([target, other].map(userId => ({ userId, name: "fake only", keyHash: randomUUID(), createdAt: before })));
  return { db, admin, target, other, service: mimouseAuthRevocationService(db) };
}
test("revokes only target sessions and Board keys and retains a secret-free durable receipt", async () => {
  const f = await fixture(); try {
    const receipt = await f.service.revoke(f.admin, f.target, { requestId: randomUUID(), confirmUserId: f.target, reason: "offboarding" });
    expect(receipt.sessionsRevoked).toBe(1); expect(receipt.boardKeysRevoked).toBe(1);
    const sessions = await f.db.select().from(authSessions).where(eq(authSessions.userId, f.target)); expect(sessions).toHaveLength(1); expect(sessions[0].expiresAt.toISOString()).toBe(receipt.cutoffAt);
    const [other] = await f.db.select().from(authSessions).where(eq(authSessions.userId, f.other)); expect(other.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const [key] = await f.db.select().from(boardApiKeys).where(eq(boardApiKeys.userId, f.other)); expect(key.revokedAt).toBeNull();
    const list = await f.service.list(f.admin, f.target); expect(list).toEqual([receipt]); expect(JSON.stringify(list)).not.toMatch(/token|keyHash|email|password/);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});
test("same request retry returns original evidence without revoking new sessions", async () => {
  const f = await fixture(); try {
    const input = { requestId: randomUUID(), confirmUserId: f.target, reason: "compromised" as const };
    const receipt = await f.service.revoke(f.admin, f.target, input);
    const id = randomUUID(); await f.db.insert(authSessions).values({ id, userId: f.target, token: `fake-${id}`, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) });
    expect(await f.service.revoke(f.admin, f.target, input)).toEqual(receipt);
    const [later] = await f.db.select().from(authSessions).where(eq(authSessions.id, id)); expect(later.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const next = await f.service.revoke(f.admin, f.target, { ...input, requestId: randomUUID() }); expect(next.sessionsRevoked).toBe(1); expect(next.boardKeysRevoked).toBe(0);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});
test("concurrent retries produce one receipt with original counts", async () => {
  const f = await fixture(); try {
    const input = { requestId: randomUUID(), confirmUserId: f.target, reason: "administrative" as const };
    const results = await Promise.all([f.service.revoke(f.admin, f.target, input), f.service.revoke(f.admin, f.target, input)]);
    expect(results[0]).toEqual(results[1]); expect(results[0].sessionsRevoked).toBe(1);
    expect(await f.db.select().from(mimouseAuthRevocations).where(eq(mimouseAuthRevocations.requestId, input.requestId))).toHaveLength(1);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});
test("rejects non-admins and mismatched confirmations before mutation", async () => {
  const f = await fixture(); try {
    const input = { requestId: randomUUID(), confirmUserId: f.target, reason: "offboarding" as const };
    await expect(f.service.revoke(f.other, f.target, input)).rejects.toThrow("Instance admin required");
    await expect(f.service.list(f.other, f.target)).rejects.toThrow("Instance admin required");
    await expect(f.service.revoke(f.admin, f.other, input)).rejects.toThrow("exact target");
    const [session] = await f.db.select().from(authSessions).where(eq(authSessions.userId, f.target)); expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await f.service.list(f.admin, f.target)).toHaveLength(0);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});
test("rejects changed replay input and missing users, preserving audit", async () => {
  const f = await fixture(); try {
    const input = { requestId: randomUUID(), confirmUserId: f.target, reason: "offboarding" as const };
    await f.service.revoke(f.admin, f.target, input);
    await expect(f.service.revoke(f.admin, f.target, { ...input, reason: "compromised" })).rejects.toThrow("different input");
    await expect(f.service.revoke(f.admin, f.other, { ...input, confirmUserId: f.other })).rejects.toThrow("different input");
    const missing = randomUUID(); await expect(f.service.revoke(f.admin, missing, { ...input, requestId: randomUUID(), confirmUserId: missing })).rejects.toThrow("User not found");
    expect(await f.service.list(f.admin, f.target)).toHaveLength(1);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});
