import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { agents, heartbeatRuns, activityLog, companySecrets, mimouseNotificationEndpoints as endpoints, mimouseNotificationSubscriptions as subscriptions, mimouseNotificationDeliveries as deliveries, mimouseNotificationRateLimits as limits } from "../../packages/db/src/index.js";
import { createFixtureDb } from "./fixture-db.js";
import { freezeNotificationDigest } from "../../server/src/services/mimouse-notifications/digest.js";
import { enqueueNotification, notificationOutbox } from "../../server/src/services/mimouse-notifications/outbox.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { and, eq } = await import(require.resolve("drizzle-orm"));
const defaultPolicy = { minimumSeverity: "info" as const, mergeWindowSeconds: 300 };

// Run only with the disposable config. All workers below inject a sender and
// resolver: these tests must never contact a vendor or use real credentials.
async function fixture(request: APIRequestContext, eventType = "coding.artifact_ready") {
  const db = await createFixtureDb();
  try {
    await db.update(endpoints).set({ enabled: false });
    const response = await request.post("/api/companies", { data: { name: `policy fixture ${randomUUID()}` } }); expect(response.ok()).toBe(true);
    const company = await response.json();
    const [secret] = await db.insert(companySecrets).values({ companyId: company.id, name: "no-send fixture metadata", key: randomUUID() }).returning();
    const [endpoint] = await db.insert(endpoints).values({ companyId: company.id, name: "policy fixture", kind: "wecom_webhook", config: { target: "recipient-one" }, secretRef: secret.id, secretVersion: 1, targetKey: randomUUID(), enabled: true }).returning();
    const [subscription] = await db.insert(subscriptions).values({ companyId: company.id, endpointId: endpoint.id, eventType, policy: defaultPolicy }).returning();
    const base = `/api/companies/${company.id}/notifications`;
    const event = { companyId: company.id, type: eventType, resourceId: randomUUID() };
    const enqueue = (eventId = randomUUID(), override = {}) => db.transaction(tx => enqueueNotification(tx, { ...event, eventId, ...override }));
    const rows = () => db.select().from(deliveries).where(eq(deliveries.companyId, company.id));
    return { db, company, secret, endpoint, subscription, base, event, enqueue, rows,
      policyPath: `${base}/subscriptions/${subscription.id}/policy`,
      cleanup: async () => { await db.update(endpoints).set({ enabled: false }).where(eq(endpoints.companyId, company.id)); await db.$client.end({ timeout: 1 }); } };
  } catch (error) { await db.$client.end({ timeout: 1 }); throw error; }
}

test("concurrent independent producers share one durable fixed window and preserve every event", async ({ request }) => {
  const f = await fixture(request); const other = await createFixtureDb();
  try {
    await Promise.all([f.enqueue(), other.transaction(tx => enqueueNotification(tx, { ...f.event, eventId: randomUUID() }))]);
    const initial = await f.rows(); expect(initial).toHaveLength(2);
    const leader = initial.find(row => row.state === "pending")!; const follower = initial.find(row => row.state === "merged")!;
    expect(leader).toBeTruthy(); expect(follower.mergedInto).toBe(leader.id); expect(follower.mergeUntil).toEqual(leader.mergeUntil);
    expect(leader.nextAttemptAt).toEqual(leader.mergeUntil); expect(leader.mergeKey).toBe(follower.mergeKey);
    await f.enqueue(); const third = (await f.rows()).find(row => row.id !== leader.id && row.id !== follower.id)!;
    expect(third).toMatchObject({ state: "merged", mergedInto: leader.id }); expect(third.mergeUntil).toEqual(leader.mergeUntil);
    const [unchanged] = await other.select().from(deliveries).where(eq(deliveries.id, leader.id)); expect(unchanged).toEqual(leader);
    // Expire the persisted first-event cutoff, without sleeping or changing the snapshot.
    await f.db.update(deliveries).set({ mergeUntil: new Date(0), nextAttemptAt: new Date(0) }).where(eq(deliveries.id, leader.id));
    await f.enqueue(); const after = await f.rows(); expect(after.filter(row => row.state === "pending")).toHaveLength(2);
    expect(after.filter(row => row.state === "merged")).toHaveLength(2);
  } finally { await other.$client.end({ timeout: 1 }); await f.cleanup(); }
});

test("duplicate event identity stays unique and business rollback leaves no phantom merge leader", async ({ request }) => {
  const f = await fixture(request); const other = await createFixtureDb();
  try {
    const eventId = randomUUID();
    await expect(f.db.transaction(async tx => { await enqueueNotification(tx, { ...f.event, eventId }); throw Error("business rollback fixture"); })).rejects.toThrow("business rollback fixture");
    expect(await f.rows()).toHaveLength(0);
    await Promise.all([f.enqueue(eventId), other.transaction(tx => enqueueNotification(tx, { ...f.event, eventId }))]);
    await f.enqueue(eventId); const rows = await f.rows(); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ state: "pending", mergedInto: null });
    await f.enqueue(); expect((await f.rows()).find(row => row.state === "merged")?.mergedInto).toBe(rows[0].id);
  } finally { await other.$client.end({ timeout: 1 }); await f.cleanup(); }
});

test("resource, locale, recipient, configuration revision and pinned secret versions never share windows", async ({ request }) => {
  const f = await fixture(request);
  try {
    await f.enqueue(); const [original] = await f.rows();
    await f.enqueue(randomUUID(), { resourceId: randomUUID() });
    await f.db.update(subscriptions).set({ locale: "ja" }).where(eq(subscriptions.id, f.subscription.id)); await f.enqueue();
    await f.db.update(endpoints).set({ config: { target: "recipient-two" } }).where(eq(endpoints.id, f.endpoint.id)); await f.enqueue();
    await f.db.update(endpoints).set({ configVersion: 2 }).where(eq(endpoints.id, f.endpoint.id)); await f.enqueue();
    await f.db.update(endpoints).set({ secretVersion: 2 }).where(eq(endpoints.id, f.endpoint.id)); await f.enqueue();
    await f.db.update(subscriptions).set({ policyVersion: 2 }).where(eq(subscriptions.id, f.subscription.id)); await f.enqueue();
    const rows = await f.rows(); expect(rows).toHaveLength(7); expect(rows.every(row => row.state === "pending" && row.mergedInto === null)).toBe(true);
    expect(new Set(rows.map(row => row.mergeKey)).size).toBe(7); expect(rows.find(row => row.id === original.id)).toEqual(original);
    const [secondEndpoint] = await f.db.insert(endpoints).values({ companyId: f.company.id, name: "second endpoint", kind: f.endpoint.kind, config: f.endpoint.config, secretRef: f.secret.id, secretVersion: 1, targetKey: f.endpoint.targetKey, enabled: true }).returning();
    const [secondSub] = await f.db.insert(subscriptions).values({ companyId: f.company.id, endpointId: secondEndpoint.id, eventType: f.event.type, policy: defaultPolicy }).returning();
    await f.enqueue(); const separate = (await f.rows()).find(row => row.subscriptionId === secondSub.id)!; expect(separate.state).toBe("pending"); expect(separate.mergeKey).not.toBe(original.mergeKey);
  } finally { await f.cleanup(); }
});

test("company boundaries reject foreign policy edits and merge references", async ({ request }) => {
  const f = await fixture(request);
  try {
    await f.enqueue(); const [leader] = await f.rows();
    const other = await (await request.post("/api/companies", { data: { name: `other policy ${randomUUID()}` } })).json();
    const [secret] = await f.db.insert(companySecrets).values({ companyId: other.id, name: "other fixture", key: randomUUID() }).returning();
    const [endpoint] = await f.db.insert(endpoints).values({ companyId: other.id, name: "other fixture", kind: "wecom_webhook", config: {}, secretRef: secret.id, secretVersion: 1, targetKey: randomUUID(), enabled: true }).returning();
    const [subscription] = await f.db.insert(subscriptions).values({ companyId: other.id, endpointId: endpoint.id, eventType: f.event.type, policy: defaultPolicy }).returning();
    await f.db.transaction(tx => enqueueNotification(tx, { ...f.event, companyId: other.id, eventId: randomUUID() }));
    const [separate] = await f.db.select().from(deliveries).where(eq(deliveries.companyId, other.id)); expect(separate.state).toBe("pending"); expect(separate.mergeKey).not.toBe(leader.mergeKey);
    const response = await request.patch(`/api/companies/${other.id}/notifications/subscriptions/${f.subscription.id}/policy`, { data: { ...defaultPolicy, expectedVersion: 1 } }); expect(response.status()).toBe(404);
    await expect(f.db.insert(deliveries).values({ companyId: other.id, endpointId: endpoint.id, subscriptionId: subscription.id, eventId: randomUUID(), snapshot: {}, state: "merged", mergedInto: leader.id })).rejects.toThrow();
    await f.db.update(endpoints).set({ enabled: false }).where(eq(endpoints.id, endpoint.id));
  } finally { await f.cleanup(); }
});

test("threshold filtering is ledgered but approvals and budgets bypass every merge window", async ({ request }) => {
  const f = await fixture(request);
  try {
    expect((await request.patch(f.policyPath, { data: { minimumSeverity: "critical", mergeWindowSeconds: 300, expectedVersion: 1 } })).status()).toBe(200);
    await f.enqueue(); expect((await f.rows())[0]).toMatchObject({ state: "filtered", lastCode: "severity_filtered", mergedInto: null, mergeUntil: null });
    for (const type of ["approval.requested", "budget.threshold_reached"]) {
      await f.db.insert(subscriptions).values({ companyId: f.company.id, endpointId: f.endpoint.id, eventType: type, policy: { minimumSeverity: "critical", mergeWindowSeconds: 300 } });
      await f.enqueue(randomUUID(), { type }); await f.enqueue(randomUUID(), { type });
    }
    const rows = await f.rows(); const critical = rows.filter(row => row.snapshot.severity === "critical"); expect(critical).toHaveLength(4);
    expect(critical.every(row => row.state === "pending" && row.mergeUntil === null && row.mergedInto === null)).toBe(true);
    const center = await (await request.get(f.base)).json(); expect(center.deliveries.some((row: { state: string }) => row.state === "filtered")).toBe(true);
    expect((await request.post(`${f.base}/deliveries/${rows.find(row => row.state === "filtered")!.id}/retry`, { data: { requestId: randomUUID(), confirmReviewedOutcome: true, acceptDuplicateRisk: true } })).status()).toBe(422);
  } finally { await f.cleanup(); }
});

test("an unknown leader never replays itself or merged followers after worker restart", async ({ request }) => {
  const f = await fixture(request);
  try {
    await f.enqueue(); await f.enqueue(); const leader = (await f.rows()).find(row => row.state === "pending")!;
    await f.db.update(deliveries).set({ nextAttemptAt: new Date(0), mergeUntil: new Date(0) }).where(eq(deliveries.id, leader.id));
    let sends = 0;
    const deps = { resolveSecret: async () => "{}", send: async () => { sends++; return { state: "indeterminate" as const, code: "fixture_unknown" }; } };
    expect(await notificationOutbox(f.db, deps).tick()).toBe(true); expect(sends).toBe(1);
    const restarted = notificationOutbox(f.db, deps); expect(await restarted.tick()).toBe(false); expect(sends).toBe(1);
    const rows = await f.rows(); expect(rows.find(row => row.id === leader.id)?.state).toBe("indeterminate"); expect(rows.find(row => row.state === "merged")?.mergedInto).toBe(leader.id);
  } finally { await f.cleanup(); }
});

test("two concurrent policy editors have one winner and one 409 with one atomic audit", async ({ request }) => {
  const f = await fixture(request);
  try {
    const responses = await Promise.all([10, 20].map(mergeWindowSeconds => request.patch(f.policyPath, { data: { minimumSeverity: "warning", mergeWindowSeconds, expectedVersion: 1 } })));
    expect(responses.map(response => response.status()).sort()).toEqual([200, 409]);
    const winner = await responses.find(response => response.status() === 200)!.json(); expect(winner.policyVersion).toBe(2);
    const [row] = await f.db.select().from(subscriptions).where(eq(subscriptions.id, f.subscription.id)); expect(row.policy).toEqual(winner.policy); expect(row.policyVersion).toBe(2);
    const audits = await f.db.select().from(activityLog).where(and(eq(activityLog.companyId, f.company.id), eq(activityLog.action, "notification.subscription.policy_updated")));
    expect(audits).toHaveLength(1); expect(audits[0].details).toMatchObject({ previousVersion: 1, policyVersion: 2 });
    expect((await request.patch(f.policyPath, { data: defaultPolicy })).status()).toBe(400);
    expect(await f.rows()).toHaveLength(0);
  } finally { await f.cleanup(); }
});

test("actual audit INSERT failure rolls back the HTTP policy update and version", async ({ request }) => {
  const f = await fixture(request);
  // createFixtureDb already verified the actual server data_directory. All
  // identifiers/UUID literals here are locally generated, never user input.
  const name = `fixture_policy_audit_${randomUUID().replaceAll("-", "")}`;
  try {
    await f.db.$client.unsafe(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.company_id='${f.company.id}'::uuid AND NEW.action='notification.subscription.policy_updated' THEN RAISE EXCEPTION 'isolated policy audit failure'; END IF; RETURN NEW; END; $$`);
    await f.db.$client.unsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON public.activity_log FOR EACH ROW EXECUTE FUNCTION public.${name}()`);
    const response = await request.patch(f.policyPath, { data: { minimumSeverity: "warning", mergeWindowSeconds: 30, expectedVersion: 1 } }); expect(response.status()).toBe(500);
    const [after] = await f.db.select().from(subscriptions).where(eq(subscriptions.id, f.subscription.id)); expect(after.policy).toEqual(defaultPolicy); expect(after.policyVersion).toBe(1);
    const audit = await f.db.select().from(activityLog).where(and(eq(activityLog.companyId, f.company.id), eq(activityLog.action, "notification.subscription.policy_updated"))); expect(audit).toHaveLength(0);
  } finally {
    await f.db.$client.unsafe(`DROP TRIGGER IF EXISTS ${name} ON public.activity_log`);
    await f.db.$client.unsafe(`DROP FUNCTION IF EXISTS public.${name}()`); await f.cleanup();
  }
});

test("failed-run trigger freezes policy/version, filters warnings and preserves transaction rollback", async ({ request }) => {
  const f = await fixture(request, "run.failed");
  try {
    await request.patch(f.policyPath, { data: { minimumSeverity: "critical", mergeWindowSeconds: 300, expectedVersion: 1 } });
    const [agent] = await f.db.insert(agents).values({ companyId: f.company.id, name: "policy fixture", role: "engineer", status: "active", adapterType: "process" }).returning();
    await expect(f.db.transaction(async tx => { await tx.insert(heartbeatRuns).values({ companyId: f.company.id, agentId: agent.id, status: "failed" }); throw Error("run rollback fixture"); })).rejects.toThrow("run rollback fixture"); expect(await f.rows()).toHaveLength(0);
    const [run] = await f.db.insert(heartbeatRuns).values({ companyId: f.company.id, agentId: agent.id, status: "failed" }).returning();
    await f.db.update(heartbeatRuns).set({ status: "failed" }).where(eq(heartbeatRuns.id, run.id));
    const [filtered] = await f.rows(); expect(filtered).toMatchObject({ state: "filtered", mergeKey: null }); expect(filtered.snapshot).toMatchObject({ severity: "warning", policyVersion: 2, policy: { minimumSeverity: "critical", mergeWindowSeconds: 300 } });
    await request.patch(f.policyPath, { data: { minimumSeverity: "warning", mergeWindowSeconds: 300, expectedVersion: 2 } });
    await f.db.insert(heartbeatRuns).values({ companyId: f.company.id, agentId: agent.id, status: "timed_out" });
    const rows = await f.rows(); expect(rows).toHaveLength(2); expect(rows.find(row => row.id !== filtered.id)).toMatchObject({ state: "pending", mergeKey: null, mergedInto: null }); expect(rows.find(row => row.id === filtered.id)).toEqual(filtered);
  } finally { await f.cleanup(); }
});


const digestPolicy = { ...defaultPolicy, mergeMode: "digest" as const };
test("digest concurrent producers cap each frozen group at ten and retain the eleventh event", async ({ request }) => {
  const f = await fixture(request); const other = await createFixtureDb();
  try {
    expect((await request.patch(f.policyPath, { data: { ...digestPolicy, expectedVersion: 1 } })).status()).toBe(200);
    const events = Array.from({ length: 11 }, () => ({ ...f.event, eventId: randomUUID(), resourceId: randomUUID() }));
    await Promise.all(events.map((event, index) => (index % 2 ? other : f.db).transaction(tx => enqueueNotification(tx, event))));
    const rows = await f.rows(); expect(rows).toHaveLength(11);
    const leaders = rows.filter(row => row.state === "pending"); expect(leaders).toHaveLength(2);
    expect(rows.filter(row => row.state === "merged")).toHaveLength(9);
    expect(leaders.map(leader => 1 + rows.filter(row => row.mergedInto === leader.id).length).sort((a, b) => a - b)).toEqual([1, 10]);
    for (const member of rows.filter(row => row.state === "merged")) {
      const leader = leaders.find(row => row.id === member.mergedInto)!; expect(leader).toBeTruthy();
      expect(member.mergeUntil).toEqual(leader.mergeUntil); expect(member.lastCode).toBe("merged_digest");
    }
    await f.db.transaction(tx => enqueueNotification(tx, events[0])); expect(await f.rows()).toHaveLength(11);
  } finally { await other.$client.end({ timeout: 1 }); await f.cleanup(); }
});

test("digest admission row lock fences claim; frozen pre-dispatch recovery cannot accept a late member", async ({ request }) => {
  const f = await fixture(request); const other = await createFixtureDb();
  let release = () => {}; let admitted: Promise<void> | undefined;
  try {
    await request.patch(f.policyPath, { data: { ...digestPolicy, expectedVersion: 1 } }); await f.enqueue();
    const [leader] = await f.rows();
    // Make claim due while the fixed admission window remains open, to force the race without sleeping.
    await f.db.update(deliveries).set({ nextAttemptAt: new Date(0) }).where(eq(deliveries.id, leader.id));
    const barrier = new Promise<void>(resolve => { release = resolve; }); let ready!: () => void;
    const reached = new Promise<void>(resolve => { ready = resolve; });
    admitted = f.db.transaction(async tx => { await enqueueNotification(tx, { ...f.event, eventId: randomUUID(), resourceId: randomUUID() }); ready(); await barrier; });
    await Promise.race([reached, admitted]);
    const worker = notificationOutbox(other, { resolveSecret: async () => { throw Error("must not resolve"); }, send: async () => { throw Error("must not send"); } });
    expect(await worker.claim()).toBeNull(); // SKIP LOCKED cannot pass admission's leader row lock.
    release(); await admitted;
    const claim = await worker.claim(); expect(claim?.id).toBe(leader.id);
    const frozen = await freezeNotificationDigest(other, claim as unknown as Parameters<typeof freezeNotificationDigest>[1]);
    expect((frozen?.digestEnvelope as { members: string[] }).members).toHaveLength(2);
    // A recovered pre-dispatch claim retains the already frozen envelope even at attempt zero.
    await f.db.update(deliveries).set({ state: "pending", lease: null, leaseExpiresAt: null }).where(eq(deliveries.id, leader.id));
    await f.enqueue(randomUUID(), { resourceId: randomUUID() });
    const rows = await f.rows(); expect(rows.filter(row => row.state === "pending")).toHaveLength(2);
    expect(rows.filter(row => row.mergedInto === leader.id)).toHaveLength(1);
    expect(rows.find(row => row.id === leader.id)?.snapshot).toEqual(frozen);
  } finally { release(); if (admitted) await admitted; await other.$client.end({ timeout: 1 }); await f.cleanup(); }
});

test("digest unknown results never replay children; preview and explicit retry retain the exact envelope", async ({ request }) => {
  const f = await fixture(request);
  try {
    await request.patch(f.policyPath, { data: { ...digestPolicy, expectedVersion: 1 } });
    const second = randomUUID(); await f.enqueue(); await f.enqueue(randomUUID(), { resourceId: second, title: "PRIVATE SOURCE BODY", text: "do not forward logs" });
    const leader = (await f.rows()).find(row => row.state === "pending")!;
    await f.db.update(deliveries).set({ nextAttemptAt: new Date(0), mergeUntil: new Date(0) }).where(eq(deliveries.id, leader.id));
    const sent: Array<{ title: string; text: string }> = [];
    const deps = { resolveSecret: async () => "{}", send: async (snapshot: { title: string; text: string }) => { sent.push(snapshot); return { state: "indeterminate" as const, code: "fixture_unknown" }; } };
    expect(await notificationOutbox(f.db, deps).tick()).toBe(true); expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(f.event.resourceId); expect(sent[0].text).toContain(second); expect(sent[0].text).not.toContain("PRIVATE"); expect(sent[0].text).not.toContain("forward logs");
    expect(await notificationOutbox(f.db, deps).tick()).toBe(false); expect(sent).toHaveLength(1);
    const rows = await f.rows(); expect(rows.find(row => row.id === leader.id)?.state).toBe("indeterminate"); expect(rows.find(row => row.state === "merged")?.mergedInto).toBe(leader.id);
    // Deliberately perturb live metadata: review must describe the frozen transport, not this row.
    await f.db.update(endpoints).set({ kind: "feishu_webhook" }).where(eq(endpoints.id, f.endpoint.id));
    const preview = await (await request.get(`${f.base}/deliveries/${leader.id}/preview`)).json(); expect(preview.kind).toBe("wecom_webhook"); expect(preview.title).toBe(sent[0].title); expect(preview.text).toBe(sent[0].text);
    const response = await request.post(`${f.base}/deliveries/${leader.id}/retry`, { data: { requestId: randomUUID(), confirmReviewedOutcome: true, acceptDuplicateRisk: true } }); expect(response.status()).toBe(202);
    const retried = await response.json(); const after = await f.rows();
    expect(after.find(row => row.id === retried.id)?.snapshot).toEqual(rows.find(row => row.id === leader.id)?.snapshot);
    expect(after.find(row => row.id === leader.id)?.state).toBe("indeterminate"); expect(sent).toHaveLength(1);
    await f.db.update(limits).set({ nextAllowedAt: new Date(0) }).where(eq(limits.targetKey, f.endpoint.targetKey));
    expect(await notificationOutbox(f.db, deps).tick()).toBe(true); expect(sent).toHaveLength(2);
    expect(sent[1].title).toBe(sent[0].title); expect(sent[1].text).toBe(sent[0].text);
    expect((await f.rows()).find(row => row.id === leader.id)?.state).toBe("indeterminate");
  } finally { await f.cleanup(); }
});

test("digest zero window sends one ordinary event and unsupported failed-run policy is rejected", async ({ request }) => {
  const f = await fixture(request);
  try {
    expect((await request.patch(f.policyPath, { data: { ...digestPolicy, mergeWindowSeconds: 0, expectedVersion: 1 } })).status()).toBe(200); await f.enqueue();
    const [row] = await f.rows(); expect(row.mergeKey).toBeNull(); expect(row.snapshot.digestVersion).toBeUndefined();
    let sends = 0; expect(await notificationOutbox(f.db, { resolveSecret: async () => "{}", send: async () => { sends++; return { state: "accepted" as const, code: "accepted" }; } }).tick()).toBe(true); expect(sends).toBe(1);
    const [runSub] = await f.db.insert(subscriptions).values({ companyId: f.company.id, endpointId: f.endpoint.id, eventType: "run.failed", policy: defaultPolicy }).returning();
    expect((await request.patch(`${f.base}/subscriptions/${runSub.id}/policy`, { data: { ...digestPolicy, expectedVersion: 1 } })).status()).toBe(422);
    const [unchanged] = await f.db.select().from(subscriptions).where(eq(subscriptions.id, runSub.id)); expect(unchanged.policy).toEqual(defaultPolicy);
  } finally { await f.cleanup(); }
});


test("digest retryable transport keeps its envelope and does not collect newer events", async ({ request }) => {
  const f = await fixture(request);
  try {
    await request.patch(f.policyPath, { data: { ...digestPolicy, expectedVersion: 1 } });
    await f.enqueue(); await f.enqueue(randomUUID(), { resourceId: randomUUID() });
    const leader = (await f.rows()).find(row => row.state === "pending")!;
    await f.db.update(deliveries).set({ nextAttemptAt: new Date(0), mergeUntil: new Date(0) }).where(eq(deliveries.id, leader.id));
    const sent: unknown[] = [];
    const deps = { resolveSecret: async () => "{}", send: async (snapshot: unknown) => { sent.push(snapshot); return sent.length === 1 ? { state: "retryable" as const, code: "fixture_rate_limit" } : { state: "accepted" as const, code: "accepted" }; } };
    await notificationOutbox(f.db, deps).tick(); expect((await f.rows()).find(row => row.id === leader.id)?.state).toBe("retryable");
    await f.enqueue(randomUUID(), { resourceId: randomUUID() });
    await f.db.update(deliveries).set({ nextAttemptAt: new Date(0) }).where(eq(deliveries.id, leader.id));
    await f.db.update(limits).set({ nextAllowedAt: new Date(0) }).where(eq(limits.targetKey, f.endpoint.targetKey));
    await notificationOutbox(f.db, deps).tick(); expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]);
    const rows = await f.rows(); expect(rows.find(row => row.id === leader.id)?.state).toBe("accepted");
    expect(rows.filter(row => row.mergedInto === leader.id)).toHaveLength(1); expect(rows.filter(row => row.state === "pending")).toHaveLength(1);
  } finally { await f.cleanup(); }
});
