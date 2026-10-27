import { accessService } from "../access.js";
import { and, eq, or, sql } from "drizzle-orm";
import { activityLog, companies, issues, type Db } from "@paperclipai/db";
import { runtimeRoutingBindings as bindings, runtimeRoutingHeads as heads, runtimeRoutingPolicies as policies, runtimeRoutingReceipts as receipts } from "@paperclipai/db/schema/runtime_cost_routing";
import type { RuntimeRoutingBinding, RuntimeRoutingPolicyRecord, RuntimeRoutingReceipt } from "@paperclipai/shared/runtime-cost-routing";
import { conflict, notFound, forbidden } from "../../errors.js";
import { authorizePrivatePrompt, type PrivatePromptIdentity, type PrivatePromptTx } from "../mimouse-private-prompt-tests/service.js";
import { runtimeCostRoutingEnabled } from "./candidates.js";
export type RuntimeRoutingBindingRow = typeof bindings.$inferSelect;
export type RuntimeRoutingPolicyRow = typeof policies.$inferSelect;
export async function routingMetadata(tx: PrivatePromptTx, actor: PrivatePromptIdentity) {
  await authorizePrivatePrompt(tx, actor, { allowPausedCompany: true });
  const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, actor.companyId));
  return { enabled: runtimeCostRoutingEnabled(), companyPaused: company?.status === "paused" };
}
export const policyRecord = (row: RuntimeRoutingPolicyRow): RuntimeRoutingPolicyRecord => ({ id: row.id, requestId: row.requestId,
  companyId: row.companyId, actorUserId: row.actorUserId, expectedGeneration: row.expectedGeneration, policy: row.policy,
  candidates: row.candidates, approvalDigest: row.approvalDigest, approvalExpiresAt: row.approvalExpiresAt.toISOString(), approvalClosedAt: row.approvalClosedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(), executionStarted: false });
export const bindingRecord = (row: RuntimeRoutingBindingRow): RuntimeRoutingBinding => ({ id: row.id, requestId: row.requestId,
  companyId: row.companyId, issueId: row.issueId, policyId: row.policyId, generation: row.generation, selectedAgentId: row.selectedAgentId,
  decisionDigest: row.decisionDigest, taskDigest: row.taskDigest, state: row.state, dispatchRequestId: row.dispatchRequestId, runId: row.runId,
  createdAt: row.createdAt.toISOString(), wakeRequestedAt: row.wakeRequestedAt?.toISOString() ?? null,
  startRequestedAt: row.startRequestedAt?.toISOString() ?? null, providerConsumed: false, futureCostQuoted: false });
export const receiptRecord = (row: typeof receipts.$inferSelect): RuntimeRoutingReceipt => ({ id: row.id, requestId: row.requestId,
  policyId: row.policyId, action: row.action, generation: row.generation, createdAt: row.createdAt.toISOString(), executionStarted: false });
export async function lockRuntimeRoutingRequest(tx: PrivatePromptTx, companyId: string, requestId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${companyId}:runtime-cost-routing:${requestId}`}, 0))`);
}
export async function lockRuntimeRoutingHead(tx: PrivatePromptTx, companyId: string) {
  await tx.insert(heads).values({ companyId }).onConflictDoNothing();
  const [head] = await tx.select().from(heads).where(eq(heads.companyId, companyId)).for("update");
  if (!head) throw conflict("runtime_routing_head_missing"); return head;
}
/** Cross-action request identity is immutable, including after a timeout/restart. */
export async function routingRequest(tx: PrivatePromptTx, actor: PrivatePromptIdentity, requestId: string) {
  const [policy] = await tx.select().from(policies).where(and(eq(policies.companyId, actor.companyId), eq(policies.requestId, requestId)));
  const [receipt] = await tx.select().from(receipts).where(and(eq(receipts.companyId, actor.companyId), eq(receipts.requestId, requestId)));
  const [binding] = await tx.select().from(bindings).where(and(eq(bindings.companyId, actor.companyId), or(eq(bindings.requestId, requestId), eq(bindings.dispatchRequestId, requestId))));
  return { policy, receipt, binding };
}
export function assertRequestAvailable(prior: Awaited<ReturnType<typeof routingRequest>>) {
  if (prior.policy || prior.receipt || prior.binding) throw conflict("runtime_routing_request_conflict");
}
export function assertRequestDigest(row: { requestDigest: string; actorUserId: string }, actor: PrivatePromptIdentity, digest: string) {
  if (row.requestDigest !== digest || row.actorUserId !== actor.userId) throw conflict("runtime_routing_request_conflict");
}
export async function getRuntimeRoutingPolicy(tx: PrivatePromptTx, actor: PrivatePromptIdentity, id: string, lock = false) {
  const query = tx.select().from(policies).where(and(eq(policies.companyId, actor.companyId), eq(policies.id, id), eq(policies.actorUserId, actor.userId)));
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw notFound("runtime_routing_policy_not_found"); return row;
}
export async function assertRuntimeRoutingBindingRead(tx: PrivatePromptTx, actor: PrivatePromptIdentity, row: RuntimeRoutingBindingRow) {
  const [issue] = await tx.select({ id: issues.id }).from(issues).where(and(eq(issues.companyId, actor.companyId), eq(issues.id, row.issueId))).for("share");
  const decision = issue && await accessService(tx as unknown as Db).decide({ actor: { type: "board", source: "session", userId: actor.userId, sessionId: actor.sessionId },
    action: "issue:read", resource: { type: "issue", companyId: actor.companyId, issueId: row.issueId } });
  if (!decision?.allowed) throw forbidden("runtime_routing_task_access_denied");
}
export async function getRuntimeRoutingBinding(tx: PrivatePromptTx, actor: PrivatePromptIdentity, id: string) {
  const scope = and(eq(bindings.companyId, actor.companyId), eq(bindings.id, id), eq(bindings.actorUserId, actor.userId));
  const [initial] = await tx.select().from(bindings).where(scope);
  if (!initial) throw notFound("runtime_routing_binding_not_found");
  await assertRuntimeRoutingBindingRead(tx, actor, initial); // issue → binding, as core enqueue
  const [row] = await tx.select().from(bindings).where(scope).for("update");
  if (!row) throw notFound("runtime_routing_binding_not_found"); return row;
}
export async function routingAudit(tx: PrivatePromptTx, actor: PrivatePromptIdentity, action: string, id: string, details: Record<string, unknown>) {
  await tx.insert(activityLog).values({ companyId: actor.companyId, actorType: "user", actorId: actor.userId,
    action: `runtime_cost_routing.${action}`, entityType: "runtime_cost_routing", entityId: id, details });
}
