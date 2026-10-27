import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, authSessions, companyMemberships, type Db } from "@paperclipai/db";
import { runtimeRoutingPolicies as policies, runtimeRoutingReceipts as receipts } from "@paperclipai/db/schema/runtime_cost_routing";
import type { PrivatePromptIdentity, PrivatePromptTx } from "../mimouse-private-prompt-tests/service.js";
import { applicationDigest } from "../mimouse-prompt-applications/target.js";
import { runtimeCostRoutingService } from "./service.js";

/** Historical proposal metadata only: reuse a real prepared/verified pool and
 * seed its elapsed lease. No proof, receipt, run, cost or execution is invented. */
export async function verifyRuntimeRoutingExpiredClosure(db: Db, actor: PrivatePromptIdentity, preparedId: string) {
  const service = runtimeCostRoutingService(db), [original] = await db.select().from(policies).where(eq(policies.id, preparedId));
  const time = await db.execute(sql`select clock_timestamp() as routing_now`), now = new Date(String(time[0].routing_now));
  const id = randomUUID(), approvalExpiresAt = new Date(now.getTime() - 60000), createdAt = new Date(now.getTime() - 120000);
  const [expired] = await db.insert(policies).values({ ...original, id, requestId: randomUUID(), createdAt, approvalExpiresAt,
    approvalDigest: applicationDigest({ id, companyId: actor.companyId, actorUserId: actor.userId, policy: original.policy,
      candidates: original.candidates, expectedGeneration: original.expectedGeneration, approvalExpiresAt: approvalExpiresAt.toISOString() }) }).returning();
  const approval = { requestId: randomUUID(), expectedGeneration: expired.expectedGeneration, approvalDigest: expired.approvalDigest,
    confirmBareTextProxy: true, confirmHistoricalCostNotQuote: true, confirmNewTasksOnly: true, confirmNoAutomaticRun: true };
  const query = { action: "approve" as const, expectedGeneration: expired.expectedGeneration, policyId: expired.id };
  expect((await service.request(actor, approval.requestId, query)).closure).toBeNull();
  await expect(service.closeExpired(actor, original.id, { expectedGeneration: original.expectedGeneration })).rejects.toThrow("runtime_routing_approval_not_expired");
  const membership = and(eq(companyMemberships.companyId, actor.companyId), eq(companyMemberships.principalId, actor.userId));
  await db.update(companyMemberships).set({ status: "suspended" }).where(membership);
  try { await expect(service.closeExpired(actor, expired.id, { expectedGeneration: expired.expectedGeneration })).rejects.toThrow("private_prompt_active_session_administrator_required"); }
  finally { await db.update(companyMemberships).set({ status: "active" }).where(membership); }
  const [session] = await db.select().from(authSessions).where(eq(authSessions.id, actor.sessionId));
  await db.update(authSessions).set({ expiresAt: approvalExpiresAt }).where(eq(authSessions.id, actor.sessionId));
  try { await expect(service.closeExpired(actor, expired.id, { expectedGeneration: expired.expectedGeneration })).rejects.toThrow(); }
  finally { await db.update(authSessions).set({ expiresAt: session.expiresAt }).where(eq(authSessions.id, actor.sessionId)); }
  const results = await Promise.allSettled([
    service.approve(actor, expired.id, approval),
    service.closeExpired(actor, expired.id, { expectedGeneration: expired.expectedGeneration }),
    service.closeExpired(actor, expired.id, { expectedGeneration: expired.expectedGeneration }),
  ]);
  expect(results[0].status).toBe("rejected");
  expect(results.slice(1).every(result => result.status === "fulfilled")).toBe(true);
  const [closed] = await db.select().from(policies).where(eq(policies.id, expired.id)); expect(closed.approvalClosedAt).not.toBeNull();
  const audits = await db.select().from(activityLog).where(and(eq(activityLog.entityId, expired.id), eq(activityLog.action, "runtime_cost_routing.approval_closed_expired")));
  expect(audits).toHaveLength(1);
  expect((await service.closeExpired(actor, expired.id, { expectedGeneration: expired.expectedGeneration })).item.approvalClosedAt).toBe(closed.approvalClosedAt!.toISOString());
  // Simulate the close response being lost: a new controller uses the original
  // approval request ID for readback and can now prove it will never apply.
  const restarted = runtimeCostRoutingService(db);
  expect((await restarted.request(actor, approval.requestId, query)).closure?.reason).toBe("approval_expired");
  expect((await restarted.detail(actor, expired.id)).item.approvalClosedAt).toBe(closed.approvalClosedAt!.toISOString());
  expect((await restarted.current(actor)).generation).toBe(original.expectedGeneration);
  await expect(restarted.approve(actor, expired.id, { ...approval, requestId: randomUUID() })).rejects.toThrow("runtime_routing_approval_changed_or_expired");
  await verifyRuntimeRoutingSqlGuards(db, actor, original, closed);
}

async function rejectsGuard(action: PromiseLike<unknown>, message: string) {
  let failure: unknown;
  try { await action; } catch (error) { failure = (error as { cause?: unknown }).cause ?? error; }
  expect(failure).toMatchObject({ code: "23514", message });
}

/** Exercise the real 0359 triggers, not service checks. These detached rows are
 * lifecycle-only SQL fixtures: no head/binding, executable authority, new proof,
 * heartbeat or accounting row is created. Every DELETE is exact and owned. */
async function verifyRuntimeRoutingSqlGuards(db: Db, actor: PrivatePromptIdentity,
  live: typeof policies.$inferSelect, closed: typeof policies.$inferSelect) {
  const scope = (id: string) => and(eq(policies.companyId, actor.companyId), eq(policies.id, id));
  const immutable = "runtime_routing_policy_immutable";
  await rejectsGuard(db.update(policies).set({ policy: { ...live.policy, minimumPassRate: live.policy.minimumPassRate === 1 ? 0 : 1 } }).where(scope(live.id)), immutable);
  await rejectsGuard(db.update(policies).set({ approvalClosedAt: null }).where(scope(live.id)), immutable); // even no-op UPDATE
  await rejectsGuard(db.update(policies).set({ approvalClosedAt: sql`clock_timestamp()` }).where(scope(live.id)), immutable); // pre-expiry
  await rejectsGuard(db.update(policies).set({ approvalClosedAt: null }).where(scope(closed.id)), immutable); // reopen
  await rejectsGuard(db.update(policies).set({ approvalClosedAt: closed.approvalClosedAt }).where(scope(closed.id)), immutable); // reclose/no-op
  await rejectsGuard(db.update(policies).set({ approvalClosedAt: sql`clock_timestamp()` }).where(scope(closed.id)), immutable); // replace marker
  const receipt = (policyId: string) => ({ id: randomUUID(), companyId: actor.companyId, policyId,
    requestId: randomUUID(), requestDigest: applicationDigest({ fixture: "routing_sql_guard", policyId }), action: "approve" as const,
    generation: live.expectedGeneration + 1, actorUserId: actor.userId, actorSessionId: actor.sessionId });
  await rejectsGuard(db.insert(receipts).values(receipt(closed.id)), "runtime_routing_approval_changed_or_expired");
  const seed = async (secondsFromNow: number) => {
    const clock = await db.execute(sql`select clock_timestamp() as routing_now`), value = clock[0].routing_now;
    const now = value instanceof Date ? value : new Date(String(value));
    const id = randomUUID(), approvalExpiresAt = new Date(now.getTime() + secondsFromNow * 1000);
    const [row] = await db.insert(policies).values({ ...live, id, requestId: randomUUID(), approvalClosedAt: null,
      createdAt: new Date(now.getTime() - 120000), approvalExpiresAt,
      approvalDigest: applicationDigest({ id, companyId: actor.companyId, actorUserId: actor.userId, policy: live.policy,
        candidates: live.candidates, expectedGeneration: live.expectedGeneration, approvalExpiresAt: approvalExpiresAt.toISOString() }) }).returning();
    return row;
  };
  const ownedIds: string[] = [];
  try {
    const elapsed = await seed(-60); ownedIds.push(elapsed.id);
    await rejectsGuard(db.update(policies).set({ approvalClosedAt: sql`clock_timestamp() + interval '1 hour'` }).where(scope(elapsed.id)), immutable);
    await rejectsGuard(db.update(policies).set({ approvalExpiresAt: sql`clock_timestamp() + interval '1 hour'` }).where(scope(elapsed.id)), immutable);
    await rejectsGuard(db.insert(receipts).values(receipt(elapsed.id)), "runtime_routing_approval_changed_or_expired");
    // Hold the non-key policy UPDATE open while a raw approve INSERT competes.
    // The trigger's FOR UPDATE must serialize it; FK KEY SHARE alone would not.
    let release!: () => void, locked!: (holder: { pid: number; tx: PrivatePromptTx }) => void;
    const mayCommit = new Promise<void>(resolve => { release = resolve; });
    const hasLock = new Promise<{ pid: number; tx: PrivatePromptTx }>(resolve => { locked = resolve; });
    const closing = db.transaction(async tx => {
      await tx.execute(sql`set local statement_timeout = '8s'`);
      const [backend] = await tx.execute(sql`select pg_backend_pid() as pid`);
      await tx.update(policies).set({ approvalClosedAt: sql`clock_timestamp()` }).where(scope(elapsed.id));
      locked({ pid: Number(backend.pid), tx }); await mayCommit;
    });
    let insertion: Promise<void> | undefined;
    try {
      const holder = await Promise.race([hasLock, closing.then(() => { throw Error("Owned closing transaction ended before acquiring its row lock"); })]);
      let started!: (pid: number) => void, insertionSettled = false;
      const hasInsertionPid = new Promise<number>(resolve => { started = resolve; });
      insertion = rejectsGuard(db.transaction(async tx => {
        await tx.execute(sql`set local lock_timeout = '8s'`);
        await tx.execute(sql`set local statement_timeout = '8s'`);
        const [backend] = await tx.execute(sql`select pg_backend_pid() as pid`);
        started(Number(backend.pid));
        await tx.insert(receipts).values(receipt(elapsed.id));
      }), "runtime_routing_approval_changed_or_expired");
      // Handle both outcomes immediately, but retain the original assertion
      // promise for finally. Expiry rejection alone is not evidence of locking.
      void insertion.then(() => { insertionSettled = true; }, () => { insertionSettled = true; });
      const insertionPid = await Promise.race([hasInsertionPid, insertion.then(() => { throw Error("Approve INSERT finished before its backend could be observed"); })]);
      expect(insertionPid).not.toBe(holder.pid);
      let observedOwnedWait = false;
      const waitDeadline = performance.now() + 5000;
      while (performance.now() < waitDeadline && !insertionSettled) {
        // Observe from the still-open closer, so this probe needs only its two
        // owned connections. Refresh statistics inside that transaction.
        await holder.tx.execute(sql`select pg_stat_clear_snapshot()`);
        const [activity] = await holder.tx.execute(sql`select wait_event_type,
          ${holder.pid}::integer = any(pg_blocking_pids(pid)) as blocked_by_owned_closer
          from pg_stat_activity where pid = ${insertionPid}::integer and datname = current_database()`);
        if (activity?.wait_event_type === "Lock" && activity.blocked_by_owned_closer === true) {
          observedOwnedWait = true; break;
        }
        await new Promise<void>(resolve => setTimeout(resolve, 25));
      }
      expect(observedOwnedWait, "Approve INSERT must wait on the owned closing backend before release; expiry rejection alone is insufficient").toBe(true);
    } finally {
      release();
      // Release even on an observation/assertion failure, and settle both
      // owned transactions before the exact fixture DELETE cleanup below.
      const settled = await Promise.allSettled([closing, ...(insertion ? [insertion] : [])]);
      for (const result of settled) if (result.status === "rejected") throw result.reason;
    }
    expect(await db.select().from(receipts).where(and(eq(receipts.companyId, actor.companyId), eq(receipts.policyId, elapsed.id)))).toHaveLength(0);

    // A lifecycle receipt INSERT is accepted only during its lease. Once that
    // lease expires, even this unheaded historical receipt permanently bars close.
    const historical = await seed(2); ownedIds.push(historical.id);
    const [approved] = await db.insert(receipts).values(receipt(historical.id)).returning();
    await rejectsGuard(db.update(receipts).set({ requestDigest: approved.requestDigest }).where(and(eq(receipts.companyId, actor.companyId), eq(receipts.id, approved.id))), "runtime_routing_receipt_immutable");
    await rejectsGuard(db.update(receipts).set({ action: "disable" }).where(and(eq(receipts.companyId, actor.companyId), eq(receipts.id, approved.id))), "runtime_routing_receipt_immutable");
    const leaseDeadline = performance.now() + 10000;
    for (;;) {
      const clock = await db.execute(sql`select clock_timestamp() >= ${historical.approvalExpiresAt.toISOString()}::timestamptz as expired`);
      if (clock[0].expired === true) break;
      if (performance.now() >= leaseDeadline) throw Error("Owned lifecycle fixture lease did not expire within 10 seconds");
      await new Promise<void>(resolve => setTimeout(resolve, 25));
    }
    await rejectsGuard(db.update(policies).set({ approvalClosedAt: sql`clock_timestamp()` }).where(scope(historical.id)), immutable);
    expect((await db.select().from(policies).where(scope(historical.id)))[0].approvalClosedAt).toBeNull();
  } finally {
    // No head/binding references these detached fixtures. Preserve normal FK
    // order and demonstrate immutability guards do not trap authorized DELETE.
    for (const id of ownedIds) {
      await db.delete(receipts).where(and(eq(receipts.companyId, actor.companyId), eq(receipts.policyId, id)));
      await db.delete(policies).where(scope(id));
      expect(await db.select({ id: policies.id }).from(policies).where(scope(id))).toHaveLength(0);
    }
  }
  expect((await db.select().from(policies).where(scope(live.id)))[0]).toEqual(live);
  expect((await db.select().from(policies).where(scope(closed.id)))[0]).toEqual(closed);
}
