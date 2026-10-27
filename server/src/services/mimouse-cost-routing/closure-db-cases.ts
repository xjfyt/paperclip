import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, authSessions, companyMemberships, type Db } from "@paperclipai/db";
import { runtimeRoutingPolicies as policies } from "@paperclipai/db/schema/runtime_cost_routing";
import type { PrivatePromptIdentity } from "../mimouse-private-prompt-tests/service.js";
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
}
