import { assertRuntimeRoutingSession, runtimeRoutingClock } from "./clock.js";
import { runtimeRoutingIssueMatches, runtimeRoutingRunMatches, runtimeRoutingPreflightError } from "./contract.js";
import { and, eq, isNull, ne } from "drizzle-orm";
import { agentWakeupRequests, heartbeatRuns, issues, issueComments, issueDocuments, issueAttachments, type Db } from "@paperclipai/db";
import { runtimeRoutingBindings as bindings, runtimeRoutingHeads as heads, runtimeRoutingPolicies as policies } from "@paperclipai/db/schema/runtime_cost_routing";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import { applicationExecutionConflict as blocked } from "../mimouse-prompt-applications/contract.js";
import { applicationDigest } from "../mimouse-prompt-applications/target.js";
import { authorizePrivatePrompt, type PrivatePromptIdentity, type PrivatePromptTx } from "../mimouse-private-prompt-tests/service.js";
import { appendHeartbeatRunEvent } from "../heartbeat-run-events.js";
import { accessService } from "../access.js";
import type { HeartbeatRuntimeExecutionInput } from "../heartbeat/runtime-execution.js";
import type { WakeupOptions } from "../heartbeat/run-preparation.js";
import { assertRuntimeRoutingSnapshots, requireRuntimeCostRoutingEnabled, snapshotRuntimeRoutingPool } from "./candidates.js";
import { type RuntimeRoutingBindingRow } from "./store.js";
import { runtimeRoutingWakeAuthority } from "./wake-authority.js";
export async function assertRuntimeRoutingBindingCurrent(tx: PrivatePromptTx, row: RuntimeRoutingBindingRow, actor: PrivatePromptIdentity) {
  requireRuntimeCostRoutingEnabled(); const principal = await authorizePrivatePrompt(tx, actor);
  const [head] = await tx.select().from(heads).where(eq(heads.companyId, row.companyId)).for("share");
  const [policy] = await tx.select().from(policies).where(and(eq(policies.companyId, row.companyId), eq(policies.id, row.policyId)));
  const [issue] = await tx.select().from(issues).where(and(eq(issues.companyId, row.companyId), eq(issues.id, row.issueId))).for("share");
  if (!head || head.generation !== row.generation || head.policyId !== row.policyId || !policy || policy.actorUserId !== actor.userId || row.actorUserId !== actor.userId ||
    !issue || !runtimeRoutingIssueMatches(issue, row)) throw blocked("runtime_routing_binding_or_task_changed");
  // This lane authorizes the initial task text only. Added context needs a new decision.
  const addedContext = await Promise.all([
    tx.select({ id: issueComments.id }).from(issueComments).where(eq(issueComments.issueId, issue.id)).limit(1),
    tx.select({ id: issueDocuments.id }).from(issueDocuments).where(eq(issueDocuments.issueId, issue.id)).limit(1),
    tx.select({ id: issueAttachments.id }).from(issueAttachments).where(eq(issueAttachments.issueId, issue.id)).limit(1),
  ]);
  if (addedContext.some(rows => rows.length)) throw blocked("runtime_routing_task_context_changed");
  const permission = await accessService(tx as unknown as Db).decide({ actor: principal, action: "tasks:assign",
    resource: { type: "issue", companyId: actor.companyId, issueId: issue.id, assigneeAgentId: row.selectedAgentId } });
  if (!permission.allowed) throw blocked("runtime_routing_assignment_revoked");
  const current = await snapshotRuntimeRoutingPool(tx, actor, policy.policy);
  assertRuntimeRoutingSnapshots(policy.candidates, current);
  const selected = current.find(item => item.candidate.agentId === row.selectedAgentId);
  if (!selected || applicationDigest(selected) !== applicationDigest(row.selectedCandidateSnapshot) ||
    applicationDigest({ companyId: row.companyId, policyId: row.policyId, generation: row.generation, selected,
      taskDigest: row.taskDigest, rule: "cost_ascending_quality_descending_identity_v2" }) !== row.decisionDigest) throw blocked("runtime_routing_decision_changed");
  await assertRuntimeRoutingSession(tx, actor);
  return { issue, policy };
}
/** All generic issue wakes are denied, including reassignment, native and retries. */
export function assertRuntimeRoutingReservedWake(opts: WakeupOptions) {
  const authority = runtimeRoutingWakeAuthority(opts);
  if (!authority && (opts.reason === "runtime_cost_routing" || opts.idempotencyKey?.startsWith("runtime-cost-routing:"))) throw blocked("runtime_routing_wake_authority_required");
  return authority;
}
export async function assertRuntimeRoutingWake(db: Db, agentId: string, issueId: string | null, opts: WakeupOptions) {
  const authority = assertRuntimeRoutingReservedWake(opts);
  // Core also accepts human identifiers. Unresolved identifiers must never be
  // sent to a PostgreSQL UUID column; canonicalization belongs to core queue.
  if (issueId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(issueId)) {
    if (authority) throw blocked("runtime_routing_wake_binding_denied"); return null;
  }
  const [row] = issueId ? await db.select().from(bindings).where(eq(bindings.issueId, issueId)) : [];
  const [issue] = issueId ? await db.select({ origin: issues.originKind }).from(issues).where(eq(issues.id, issueId)) : [];
  if (!row) { if (authority || issue?.origin === "runtime_cost_routing") throw blocked("runtime_routing_binding_missing"); return null; }
  if (row.id !== authority || row.selectedAgentId !== agentId || opts.requestedByActorType !== "user" || opts.requestedByActorId !== row.actorUserId ||
    opts.idempotencyKey !== `runtime-cost-routing:${row.id}` || opts.failedRunId) throw blocked("runtime_routing_generic_wake_denied");
  return row.id;
}
/** Under the core issue lock; the new heartbeat and binding.runId commit together. */
export async function admitRuntimeRoutingWake(tx: PrivatePromptTx, id: string, agentId: string, issueId: string) {
  const [row] = await tx.select().from(bindings).where(eq(bindings.id, id)).for("update");
  if (!row || row.issueId !== issueId || row.selectedAgentId !== agentId || !row.dispatchActorSessionId || !row.dispatchActorUserId) throw blocked("runtime_routing_wake_binding_denied");
  if (row.runId) {
    const [run] = await tx.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, row.companyId), eq(heartbeatRuns.id, row.runId)));
    if (!run) throw blocked("runtime_routing_run_missing"); return { replay: true as const, run };
  }
  const [wake] = await tx.select({ id: agentWakeupRequests.id }).from(agentWakeupRequests).where(and(eq(agentWakeupRequests.companyId, row.companyId), eq(agentWakeupRequests.idempotencyKey, `runtime-cost-routing:${id}`)));
  if (wake || row.state !== "wake_pending") throw blocked("runtime_routing_prior_wake_not_admitted");
  await assertRuntimeRoutingBindingCurrent(tx, row, { companyId: row.companyId, userId: row.dispatchActorUserId, sessionId: row.dispatchActorSessionId });
  const [prior] = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, row.companyId), eq(heartbeatRuns.issueId, issueId))).limit(1);
  if (prior) throw blocked("runtime_routing_first_attempt_required");
  return { replay: false as const };
}
export async function claimRuntimeRoutingRun(tx: PrivatePromptTx, bindingId: string, runId: string) {
  const changed = await tx.update(bindings).set({ runId, state: "run_claimed" }).where(and(eq(bindings.id, bindingId), eq(bindings.state, "wake_pending"), isNull(bindings.runId))).returning({ id: bindings.id });
  if (changed.length !== 1) throw blocked("runtime_routing_claim_conflict");
}
export async function assertRuntimeRoutingEarlyBinding(db: Db, run: typeof heartbeatRuns.$inferSelect, issueId: string | null) {
  const possibleIds = [...new Set([issueId, run.issueId, run.nativeIssueId].filter((id): id is string => !!id))];
  let bindingIdentified = false;
  return db.transaction(async tx => {
    let found: RuntimeRoutingBindingRow | null = null;
    for (const id of possibleIds) {
      // Same issue→binding order as core enqueue; a repeated wake cannot
      // deadlock the final launch check while it holds the issue execution lock.
      await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, id)).for("share");
      const [row] = await tx.select().from(bindings).where(eq(bindings.issueId, id)).for("share");
      if (!row) { const [issue] = await tx.select({ origin: issues.originKind }).from(issues).where(eq(issues.id, id));
        if (issue?.origin === "runtime_cost_routing") throw blocked("runtime_routing_binding_missing"); continue; }
      bindingIdentified = true;
      if (found && found.id !== row.id) throw blocked("runtime_routing_issue_identity_mismatch"); found = row;
    }
    if (!found) return null;
    if (!runtimeRoutingRunMatches(found, run, issueId)) throw blocked("runtime_routing_run_binding_denied");
    const [wake] = await tx.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.id, run.wakeupRequestId ?? "00000000-0000-0000-0000-000000000000"), eq(agentWakeupRequests.companyId, run.companyId)));
    if (!wake || wake.idempotencyKey !== `runtime-cost-routing:${found.id}` || wake.runId !== run.id || wake.requestedByActorId !== found.dispatchActorUserId || wake.requestedByActorType !== "user") throw blocked("runtime_routing_wake_receipt_denied");
    const [prior] = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, run.companyId), eq(heartbeatRuns.issueId, found.issueId), ne(heartbeatRuns.id, run.id))).limit(1);
    if (prior) throw blocked("runtime_routing_first_attempt_required");
    await assertRuntimeRoutingBindingCurrent(tx, found, { companyId: found.companyId, userId: found.dispatchActorUserId, sessionId: found.dispatchActorSessionId });
    return found;
  }).catch(error => { throw runtimeRoutingPreflightError(error, bindingIdentified); });
}
/** Reuses the application adapter hook, budget admission and final core ownership gate. */
export async function guardRuntimeRoutingExecution(db: Db, input: HeartbeatRuntimeExecutionInput, application: AdapterExecutionContext["controlledPromptApplication"]): Promise<AdapterExecutionContext["controlledPromptApplication"]> {
  const row = await assertRuntimeRoutingEarlyBinding(db, input.run, input.task.issueId);
  if (!row) return application;
  if (!application || application.applicationId !== row.selectedCandidateSnapshot.candidate.applicationId || application.generation !== row.selectedCandidateSnapshot.candidate.applicationGeneration) throw blocked("runtime_routing_application_required");
  return { ...application,
    prepare: async (...args) => { await assertRuntimeRoutingEarlyBinding(db, input.run, input.task.issueId); await application.prepare(...args); },
    beforeStart: async () => {
      await application.beforeStart();
      await assertRuntimeRoutingEarlyBinding(db, input.run, input.task.issueId);
      await db.transaction(async tx => {
        await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, row.issueId)).for("share");
        const [current] = await tx.select().from(bindings).where(eq(bindings.id, row.id)).for("update");
        if (!current || current.state !== "run_claimed" || current.runId !== input.run.id || input.control.executionControl.controller.signal.aborted) throw blocked("runtime_routing_start_denied");
        await assertRuntimeRoutingBindingCurrent(tx, current, { companyId: row.companyId, userId: row.dispatchActorUserId!, sessionId: row.dispatchActorSessionId! });
        await tx.update(bindings).set({ state: "start_requested", startRequestedAt: await runtimeRoutingClock(tx) }).where(eq(bindings.id, row.id));
        await appendHeartbeatRunEvent(tx as unknown as Db, { companyId: row.companyId, agentId: row.selectedAgentId, runId: input.run.id,
          eventType: "runtime_cost_routing.start_requested", stream: "system", level: "info", message: "Controlled routing start requested; provider consumption is unconfirmed.",
          payload: { bindingId: row.id, decisionDigest: row.decisionDigest, providerConsumed: false, futureCostQuoted: false } });
      });
    },
  };
}
/** A generic unscoped run cannot adopt an assigned controlled task through checkout. */
export async function assertRuntimeRoutingCheckout(db: Db, issueId: string, agentId: string, runId: string | null) {
  const [row] = await db.select().from(bindings).where(eq(bindings.issueId, issueId));
  const [issue] = await db.select({ origin: issues.originKind }).from(issues).where(eq(issues.id, issueId));
  if (!row && issue?.origin === "runtime_cost_routing") throw blocked("runtime_routing_binding_missing");
  if (row && (!runId || row.runId !== runId || row.selectedAgentId !== agentId || row.state !== "start_requested")) throw blocked("runtime_routing_checkout_denied");
}
