import { assertRuntimeRoutingSession, runtimeRoutingClock } from "./clock.js";
import { runtimeRoutingTaskDigest } from "./contract.js";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { companies, type Db } from "@paperclipai/db";
import { runtimeRoutingBindings as bindings, runtimeRoutingHeads as heads, runtimeRoutingPolicies as policies, runtimeRoutingReceipts as receipts } from "@paperclipai/db/schema/runtime_cost_routing";
import { approveRuntimeRoutingPolicySchema, prepareRuntimeRoutingPolicySchema, disableRuntimeRoutingPolicySchema, closeExpiredRuntimeRoutingPolicySchema,
  createRuntimeRoutingTaskSchema, runRuntimeRoutingTaskSchema, type RuntimeRoutingRequestQuery, type RuntimeRoutingRequestResult } from "@paperclipai/shared/runtime-cost-routing";
import { conflict, forbidden } from "../../errors.js";
import { applicationDigest } from "../mimouse-prompt-applications/target.js";
import { authorizePrivatePrompt, type PrivatePromptIdentity } from "../mimouse-private-prompt-tests/service.js";
import { accessService } from "../access.js";
import { issueService } from "../issues.js";
import type { WakeupOptions } from "../heartbeat/run-preparation.js";
import { assertRuntimeRoutingSnapshots, requireRuntimeCostRoutingEnabled, snapshotRuntimeRoutingPool } from "./candidates.js";
import { selectRuntimeRoutingCandidate } from "./selection.js";
import { runtimeRoutingWakeOptions } from "./wake-authority.js";
import { assertRuntimeRoutingBindingCurrent } from "./execution.js";
import { assertRuntimeRoutingBindingRead, assertRequestAvailable, assertRequestDigest, bindingRecord, getRuntimeRoutingBinding, getRuntimeRoutingPolicy,
  lockRuntimeRoutingHead, lockRuntimeRoutingRequest, policyRecord, receiptRecord, routingAudit, routingMetadata, routingRequest } from "./store.js";
export function runtimeCostRoutingService(db: Db, wake?: (agentId: string, options: WakeupOptions) => Promise<unknown>) {
  return {
    async current(actor: PrivatePromptIdentity) {
      return db.transaction(async tx => { const metadata = await routingMetadata(tx, actor);
        const [head] = await tx.select().from(heads).where(eq(heads.companyId, actor.companyId));
        const [policy] = head?.policyId ? await tx.select().from(policies).where(and(eq(policies.id, head.policyId), eq(policies.actorUserId, actor.userId))) : [];
        return { ...metadata, generation: head?.generation ?? 0, policyId: head?.policyId ?? null,
          configuredAt: head?.configuredAt?.toISOString() ?? null, policy: policy ? policyRecord(policy) : null }; });
    },
    async binding(actor: PrivatePromptIdentity, id: string) {
      return db.transaction(async tx => { await routingMetadata(tx, actor); return { binding: bindingRecord(await getRuntimeRoutingBinding(tx, actor, id)) }; });
    },
    async detail(actor: PrivatePromptIdentity, id: string) {
      return db.transaction(async tx => ({ ...await routingMetadata(tx, actor), item: policyRecord(await getRuntimeRoutingPolicy(tx, actor, id)) }));
    },
    async request(actor: PrivatePromptIdentity, requestId: string, query: RuntimeRoutingRequestQuery): Promise<RuntimeRoutingRequestResult> {
      return db.transaction(async tx => {
        const metadata = await routingMetadata(tx, actor); await lockRuntimeRoutingRequest(tx, actor.companyId, requestId);
        const prior = await routingRequest(tx, actor, requestId);
        const result: RuntimeRoutingRequestResult = { ...metadata, policy: null, receipt: null, binding: null, closure: null };
        if (prior.policy || prior.receipt || prior.binding) {
          if (query.action === "prepare" && prior.policy?.actorUserId === actor.userId && prior.policy.expectedGeneration === query.expectedGeneration) result.policy = policyRecord(prior.policy);
          else if (prior.receipt?.actorUserId === actor.userId && prior.receipt.action === query.action && prior.receipt.generation === query.expectedGeneration! + 1 &&
            (query.action !== "approve" || prior.receipt.policyId === query.policyId)) result.receipt = receiptRecord(prior.receipt);
          else if (prior.binding?.actorUserId === actor.userId && ((query.action === "create_task" && prior.binding.requestId === requestId && prior.binding.generation === query.expectedGeneration) ||
            (query.action === "run" && prior.binding.id === query.bindingId && prior.binding.dispatchRequestId === requestId))) result.binding = bindingRecord(prior.binding);
          else throw conflict("runtime_routing_request_conflict");
          if (result.binding && prior.binding) await assertRuntimeRoutingBindingRead(tx, actor, prior.binding);
          return result;
        }
        const [head] = await tx.select().from(heads).where(eq(heads.companyId, actor.companyId));
        const generation = head?.generation ?? 0;
        let reason: NonNullable<RuntimeRoutingRequestResult["closure"]>["reason"] | null = null;
        if (query.action === "run") {
          const bound = await getRuntimeRoutingBinding(tx, actor, query.bindingId!);
          if (bound.dispatchRequestId) reason = "binding_already_claimed";
        } else if (generation > query.expectedGeneration!) reason = "generation_advanced";
        else if (query.action === "approve") {
          const policy = await getRuntimeRoutingPolicy(tx, actor, query.policyId!);
          if (policy.expectedGeneration === query.expectedGeneration && policy.approvalClosedAt) reason = "approval_expired";
        }
        // Wall-clock expiry alone remains UNKNOWN. Only the monotone marker
        // written by explicit closeExpired proves this approval can never apply.
        if (reason) result.closure = { outcome: "not_applied_closed", requestId, action: query.action, reason, currentGeneration: generation };
        return result;
      });
    },
    async prepare(actor: PrivatePromptIdentity, raw: unknown) {
      const input = prepareRuntimeRoutingPolicySchema.parse(raw), digest = applicationDigest({ action: "prepare", ...input });
      return db.transaction(async tx => {
        await authorizePrivatePrompt(tx, actor); await lockRuntimeRoutingRequest(tx, actor.companyId, input.requestId);
        const prior = await routingRequest(tx, actor, input.requestId);
        if (prior.policy) { assertRequestDigest(prior.policy, actor, digest); return { item: policyRecord(prior.policy), duplicate: true }; }
        assertRequestAvailable(prior); requireRuntimeCostRoutingEnabled();
        const head = await lockRuntimeRoutingHead(tx, actor.companyId);
        if (head.generation !== input.expectedGeneration) throw conflict("runtime_routing_generation_changed");
        const candidates = await snapshotRuntimeRoutingPool(tx, actor, input.policy);
        selectRuntimeRoutingCandidate(candidates, input.policy.minimumPassRate);
        await assertRuntimeRoutingSession(tx, actor);
        const id = randomUUID(), createdAt = await runtimeRoutingClock(tx), approvalExpiresAt = new Date(createdAt.getTime() + input.approvalValidForMinutes * 60000);
        const approvalDigest = applicationDigest({ id, companyId: actor.companyId, actorUserId: actor.userId,
          policy: input.policy, candidates, expectedGeneration: head.generation, approvalExpiresAt: approvalExpiresAt.toISOString() });
        const [row] = await tx.insert(policies).values({ id, companyId: actor.companyId, requestId: input.requestId, requestDigest: digest,
          actorUserId: actor.userId, actorSessionId: actor.sessionId, expectedGeneration: head.generation, policy: input.policy, candidates, approvalDigest, approvalExpiresAt, createdAt }).returning();
        await routingAudit(tx, actor, "prepared", row.id, { candidateCount: candidates.length, approvalDigest, executionStarted: false });
        return { item: policyRecord(row), duplicate: false };
      });
    },
    async approve(actor: PrivatePromptIdentity, id: string, raw: unknown) {
      const input = approveRuntimeRoutingPolicySchema.parse(raw), digest = applicationDigest({ action: "approve", id, ...input });
      return db.transaction(async tx => {
        await authorizePrivatePrompt(tx, actor); await lockRuntimeRoutingRequest(tx, actor.companyId, input.requestId);
        const prior = await routingRequest(tx, actor, input.requestId);
        if (prior.receipt) { assertRequestDigest(prior.receipt, actor, digest); return { receipt: receiptRecord(prior.receipt), duplicate: true }; }
        assertRequestAvailable(prior); requireRuntimeCostRoutingEnabled(); const head = await lockRuntimeRoutingHead(tx, actor.companyId), row = await getRuntimeRoutingPolicy(tx, actor, id, true);
        if (head.generation !== input.expectedGeneration || row.expectedGeneration !== input.expectedGeneration || row.approvalDigest !== input.approvalDigest || row.approvalClosedAt || row.approvalExpiresAt <= await runtimeRoutingClock(tx)) throw conflict("runtime_routing_approval_changed_or_expired");
        assertRuntimeRoutingSnapshots(row.candidates, await snapshotRuntimeRoutingPool(tx, actor, row.policy));
        await assertRuntimeRoutingSession(tx, actor);
        const createdAt = await runtimeRoutingClock(tx);
        if (row.approvalExpiresAt <= createdAt) throw conflict("runtime_routing_approval_changed_or_expired");
        const [receipt] = await tx.insert(receipts).values({ companyId: actor.companyId, policyId: row.id, action: "approve", generation: head.generation + 1, createdAt,
          requestId: input.requestId, requestDigest: digest, actorUserId: actor.userId, actorSessionId: actor.sessionId }).returning();
        await tx.update(heads).set({ policyId: row.id, generation: receipt.generation, configuredAt: createdAt }).where(eq(heads.companyId, actor.companyId));
        await routingAudit(tx, actor, "approved", row.id, { generation: receipt.generation, executionStarted: false, ordinaryToolsQualityProven: false, futureCostQuoted: false });
        return { receipt: receiptRecord(receipt), duplicate: false };
      });
    },
    async closeExpired(actor: PrivatePromptIdentity, id: string, raw: unknown) {
      const input = closeExpiredRuntimeRoutingPolicySchema.parse(raw);
      return db.transaction(async tx => {
        // Like disable, cleanup is available while paused or feature-OFF. It
        // grants no run authority, changes no head, and requires fresh live auth.
        await routingMetadata(tx, actor);
        const head = await lockRuntimeRoutingHead(tx, actor.companyId), row = await getRuntimeRoutingPolicy(tx, actor, id, true);
        if (row.expectedGeneration !== input.expectedGeneration) throw conflict("runtime_routing_generation_changed");
        await assertRuntimeRoutingSession(tx, actor);
        if (row.approvalClosedAt) return { item: policyRecord(row), duplicate: true };
        const [approved] = await tx.select({ id: receipts.id }).from(receipts).where(and(eq(receipts.companyId, actor.companyId), eq(receipts.policyId, row.id), eq(receipts.action, "approve")));
        if (approved || head.policyId === row.id) throw conflict("runtime_routing_approved_policy_cannot_close");
        if (head.generation !== input.expectedGeneration) throw conflict("runtime_routing_generation_changed");
        await assertRuntimeRoutingSession(tx, actor);
        const approvalClosedAt = await runtimeRoutingClock(tx);
        if (row.approvalExpiresAt > approvalClosedAt) throw conflict("runtime_routing_approval_not_expired");
        const [closed] = await tx.update(policies).set({ approvalClosedAt }).where(eq(policies.id, row.id)).returning();
        await routingAudit(tx, actor, "approval_closed_expired", row.id, { expectedGeneration: row.expectedGeneration,
          approvalClosedAt: approvalClosedAt.toISOString(), executionStarted: false, pastEffectsReverted: false, providerStopConfirmed: false });
        return { item: policyRecord(closed), duplicate: false };
      });
    },
    async disable(actor: PrivatePromptIdentity, raw: unknown) {
      const input = disableRuntimeRoutingPolicySchema.parse(raw), digest = applicationDigest({ action: "disable", ...input });
      return db.transaction(async tx => {
        await routingMetadata(tx, actor); await lockRuntimeRoutingRequest(tx, actor.companyId, input.requestId);
        const prior = await routingRequest(tx, actor, input.requestId);
        if (prior.receipt) { assertRequestDigest(prior.receipt, actor, digest); return { receipt: receiptRecord(prior.receipt), duplicate: true }; }
        assertRequestAvailable(prior); const head = await lockRuntimeRoutingHead(tx, actor.companyId);
        if (!head.policyId || head.generation !== input.expectedGeneration) throw conflict("runtime_routing_generation_changed");
        await assertRuntimeRoutingSession(tx, actor);
        const [receipt] = await tx.insert(receipts).values({ companyId: actor.companyId, policyId: head.policyId, action: "disable", generation: head.generation + 1, createdAt: await runtimeRoutingClock(tx),
          requestId: input.requestId, requestDigest: digest, actorUserId: actor.userId, actorSessionId: actor.sessionId }).returning();
        await tx.update(heads).set({ policyId: null, configuredAt: null, generation: receipt.generation }).where(eq(heads.companyId, actor.companyId));
        await routingAudit(tx, actor, "disabled", receipt.policyId, { generation: receipt.generation, futureOnly: true, executionStarted: false, pastEffectsReverted: false, providerStopConfirmed: false });
        return { receipt: receiptRecord(receipt), duplicate: false };
      });
    },
    async createTask(actor: PrivatePromptIdentity, raw: unknown) {
      const input = createRuntimeRoutingTaskSchema.parse(raw), digest = applicationDigest({ action: "create_task", ...input });
      return db.transaction(async tx => {
        // Core issue creation advances the company counter. Acquire UPDATE before
        // auth's SHARE lock, avoiding a concurrent request's lock-upgrade deadlock.
        await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, actor.companyId)).for("update");
        const principal = await authorizePrivatePrompt(tx, actor); await lockRuntimeRoutingRequest(tx, actor.companyId, input.requestId);
        const prior = await routingRequest(tx, actor, input.requestId);
        if (prior.binding?.requestId === input.requestId) { assertRequestDigest(prior.binding, actor, digest); return { binding: bindingRecord(prior.binding), duplicate: true }; }
        assertRequestAvailable(prior); requireRuntimeCostRoutingEnabled(); const head = await lockRuntimeRoutingHead(tx, actor.companyId);
        if (!head.policyId || head.generation !== input.expectedGeneration) throw conflict("runtime_routing_generation_changed");
        const policy = await getRuntimeRoutingPolicy(tx, actor, head.policyId), current = await snapshotRuntimeRoutingPool(tx, actor, policy.policy);
        assertRuntimeRoutingSnapshots(policy.candidates, current);
        const selected = selectRuntimeRoutingCandidate(current, policy.policy.minimumPassRate);
        const assignment = await accessService(tx as unknown as Db).decide({ actor: principal, action: "tasks:assign", resource: { type: "issue", companyId: actor.companyId, assigneeAgentId: selected.candidate.agentId } });
        if (!assignment.allowed) throw forbidden("runtime_routing_assignment_denied");
        const id = randomUUID();
        const issue = await issueService(db).create(actor.companyId, { id: randomUUID(), title: input.title, description: input.description ?? null,
          createdAt: await runtimeRoutingClock(tx), status: "backlog", visibility: "open", assigneeAgentId: selected.candidate.agentId, createdByUserId: actor.userId,
          actorResponsibleUserId: actor.userId, responsibleUserId: actor.userId, trustExplicitResponsibleUserId: true,
          originKind: "runtime_cost_routing", originId: id, skipExecutionWorkspaceInheritance: true }, tx);
        await assertRuntimeRoutingSession(tx, actor);
        const taskDigest = runtimeRoutingTaskDigest(issue), decisionDigest = applicationDigest({ companyId: actor.companyId, policyId: policy.id,
          generation: head.generation, selected, taskDigest, rule: "cost_ascending_quality_descending_identity_v2" });
        const [binding] = await tx.insert(bindings).values({ id, companyId: actor.companyId, issueId: issue.id, policyId: policy.id, generation: head.generation,
          selectedAgentId: selected.candidate.agentId, selectedCandidateSnapshot: selected, decisionDigest, taskDigest, createdAt: await runtimeRoutingClock(tx),
          requestId: input.requestId, requestDigest: digest, actorUserId: actor.userId, actorSessionId: actor.sessionId }).returning();
        await routingAudit(tx, actor, "task_bound", binding.id, { issueId: issue.id, decisionDigest, executionStarted: false, futureCostQuoted: false });
        return { binding: bindingRecord(binding), duplicate: false };
      });
    },
    async run(actor: PrivatePromptIdentity, id: string, raw: unknown) {
      const input = runRuntimeRoutingTaskSchema.parse(raw), digest = applicationDigest({ action: "run", id, ...input });
      const admitted = await db.transaction(async tx => {
        await authorizePrivatePrompt(tx, actor); await lockRuntimeRoutingRequest(tx, actor.companyId, input.requestId);
        const row = await getRuntimeRoutingBinding(tx, actor, id), prior = await routingRequest(tx, actor, input.requestId);
        if (row.dispatchRequestId === input.requestId) {
          if (row.dispatchRequestDigest !== digest || row.dispatchActorUserId !== actor.userId) throw conflict("runtime_routing_request_conflict");
          return { row, duplicate: true };
        }
        assertRequestAvailable(prior);
        if (row.dispatchRequestId || row.state !== "bound") throw conflict("runtime_routing_binding_already_claimed");
        requireRuntimeCostRoutingEnabled(); await assertRuntimeRoutingBindingCurrent(tx, row, actor);
        const [updated] = await tx.update(bindings).set({ dispatchRequestId: input.requestId, dispatchRequestDigest: digest,
          dispatchActorUserId: actor.userId, dispatchActorSessionId: actor.sessionId, wakeRequestedAt: await runtimeRoutingClock(tx), state: "wake_pending" }).where(eq(bindings.id, row.id)).returning();
        await routingAudit(tx, actor, "run_authorized", row.id, { issueId: row.issueId, executionStarted: false, providerConsumed: false });
        return { row: updated, duplicate: false };
      });
      if (admitted.row.state === "wake_pending") {
        if (!wake) throw conflict("runtime_routing_wake_unavailable");
        await wake(admitted.row.selectedAgentId, runtimeRoutingWakeOptions(admitted.row));
      }
      return { ...await this.binding(actor, id), duplicate: admitted.duplicate };
    },
  };
}
