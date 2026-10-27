import { randomUUID } from "node:crypto";
import { expect, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { agents, companies, companyMemberships, principalPermissionGrants, heartbeatRuns, heartbeatRunEvents, issues, agentWakeupRequests, type Db } from "@paperclipai/db";
import { runtimeRoutingBindings } from "@paperclipai/db/schema/runtime_cost_routing";
import { promptApplicationService } from "../mimouse-prompt-applications/service.js";
import { issueService } from "../issues.js";
import { runtimeCostRoutingService } from "./service.js";
import type { verifyProducedRuntimeRoutingEvidence } from "./evidence-db-cases.js";
import type { PrivatePromptIdentity } from "../mimouse-private-prompt-tests/service.js";
import type { heartbeatService } from "../heartbeat.js";
import { drainHeartbeatRunsToQuiescence } from "../../__tests__/helpers/drain-heartbeat-runs.js";
/** Shares the marked disposable PG fixture; every qualifying receipt is produced
 * by the real private heartbeat/accounting flow, never fabricated ledger rows. */
export async function verifyRuntimeRoutingDispatch(db: Db, actor: PrivatePromptIdentity, heartbeat: ReturnType<typeof heartbeatService>,
  produced: Awaited<ReturnType<typeof verifyProducedRuntimeRoutingEvidence>>, ordinaryCalls: () => number) {
  const applications = promptApplicationService(db), service = runtimeCostRoutingService(db, heartbeat.wakeup), candidates = [];
  // Private test authority is narrower than ordinary agent configuration.
  // Supply the same explicit fixture grant as the standalone application suite;
  // owner membership alone must not bypass the production configuration check.
  const [configurationGrant] = await db.insert(principalPermissionGrants).values({ companyId: actor.companyId,
    principalType: "user", principalId: actor.userId, permissionKey: "agents:configure", scope: null, grantedByUserId: actor.userId }).returning();
  for (const item of produced) {
    const head = await applications.head(actor, item.reference.agentId);
    const prepared = await applications.prepare(actor, item.reference.promptId, { requestId: randomUUID(), agentId: item.reference.agentId,
      comparison: item.reference.comparison, expectedGeneration: head.generation, approvalValidForMinutes: 60 });
    const approved = await applications.approve(actor, item.reference.promptId, prepared.item.id, { requestId: randomUUID(), expectedGeneration: head.generation,
      approvalDigest: prepared.item.approvalDigest, confirmOrdinaryVisibility: true, confirmBareComparisonNotToolQuality: true, confirmNewTasksOnly: true, confirmNoAutomaticRun: true });
    candidates.push({ ...item.reference, applicationId: prepared.item.id, applicationGeneration: approved.receipt.generation });
  }
  const before = ordinaryCalls(), wakeBefore = await db.select().from(agentWakeupRequests), costsBefore = await db.execute(sql`select count(*) as n from cost_events`);
  const preparation = { requestId: randomUUID(), expectedGeneration: 0, policy: { datasetId: produced[0].evidence.datasetId,
    datasetHash: produced[0].evidence.datasetHash, minimumPassRate: 1, maxEvidenceAgeHours: 24, candidates }, approvalValidForMinutes: 60 };
  const proposal = await service.prepare(actor, preparation);
  expect((await service.prepare(actor, preparation)).item.id).toBe(proposal.item.id);
  const { verifyRuntimeRoutingExpiredClosure } = await import("./closure-db-cases.js");
  await verifyRuntimeRoutingExpiredClosure(db, actor, proposal.item.id);
  const approval = { requestId: randomUUID(), expectedGeneration: 0, approvalDigest: proposal.item.approvalDigest,
    confirmBareTextProxy: true, confirmHistoricalCostNotQuote: true, confirmNewTasksOnly: true, confirmNoAutomaticRun: true };
  const approved = await service.approve(actor, proposal.item.id, approval);
  expect((await service.approve(actor, proposal.item.id, approval)).receipt.id).toBe(approved.receipt.id);
  await expect(service.closeExpired(actor, proposal.item.id, { expectedGeneration: 0 })).rejects.toThrow("runtime_routing_approved_policy_cannot_close");
  expect(ordinaryCalls()).toBe(before); expect(await db.select().from(agentWakeupRequests)).toEqual(wakeBefore);
  expect(await db.execute(sql`select count(*) as n from cost_events`)).toEqual(costsBefore);
  const task = { requestId: randomUUID(), expectedGeneration: approved.receipt.generation, title: "Bound routing inert task", description: "Return the controlled prompt as inert text.", confirmOrdinaryTaskVisibility: true };
  const [created, replay] = await Promise.all([service.createTask(actor, task), service.createTask(actor, task)]);
  expect(created.binding.id).toBe(replay.binding.id); expect(created.binding.selectedAgentId).toBe(produced[1].reference.agentId);
  expect(created.binding.state).toBe("bound"); expect(created.binding.runId).toBeNull(); expect(ordinaryCalls()).toBe(before);
  const [issue] = await db.select().from(issues).where(eq(issues.id, created.binding.issueId)); expect(issue.projectId).toBeNull(); expect(issue.visibility).toBe("open");
  for (const issueId of [issue.id, issue.identifier!]) await expect(heartbeat.wakeup(created.binding.selectedAgentId, {
    source: "on_demand", requestedByActorType: "user", requestedByActorId: actor.userId, payload: { issueId } })).rejects.toThrow("runtime_routing_generic_wake_denied");
  expect(await db.select().from(agentWakeupRequests)).toEqual(wakeBefore);
  const runRequest = { requestId: randomUUID(), confirmExecution: true, confirmPossibleCharges: true };
  const starts = await Promise.all([service.run(actor, created.binding.id, runRequest), service.run(actor, created.binding.id, runRequest)]);
  expect(starts[0].binding.runId).toBe(starts[1].binding.runId);
  await drainHeartbeatRunsToQuiescence(db, heartbeat);
  const bound = (await service.binding(actor, created.binding.id)).binding;
  const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, bound.runId!));
  expect(run.status, JSON.stringify({ error: run.error, code: run.errorCode })).toBe("succeeded"); expect(ordinaryCalls()).toBe(before + 1);
  await expect(issueService(db).checkout(bound.issueId, bound.selectedAgentId, ["backlog", "todo", "in_progress"], run.id)).rejects.toThrow("runtime_routing_checkout_denied");
  expect(bound.state).toBe("start_requested"); expect(bound.providerConsumed).toBe(false);
  expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.idempotencyKey, `runtime-cost-routing:${bound.id}`))).toHaveLength(1);
  expect(await db.select().from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.runId, run.id), eq(heartbeatRunEvents.eventType, "runtime_cost_routing.start_requested")))).toHaveLength(1);
  // New service object models a restarted controller's metadata retry: no new wake.
  await runtimeCostRoutingService(db, heartbeat.wakeup).run(actor, bound.id, runRequest); expect(ordinaryCalls()).toBe(before + 1);
  expect((await service.request(actor, runRequest.requestId, { action: "run", bindingId: bound.id })).binding?.runId).toBe(run.id);
  await expect(heartbeat.wakeup(bound.selectedAgentId, { source: "on_demand", requestedByActorType: "user", requestedByActorId: actor.userId,
    payload: { resumeFromRunId: run.id } })).rejects.toThrow("runtime_routing_generic_wake_denied");
  await expect(heartbeat.wakeup(produced[0].reference.agentId, { source: "on_demand", payload: { issueId: bound.issueId } })).rejects.toThrow("runtime_routing_generic_wake_denied");
  const drift = await service.createTask(actor, { ...task, requestId: randomUUID() });
  await db.update(issues).set({ priority: "critical" }).where(eq(issues.id, drift.binding.issueId));
  await expect(service.run(actor, drift.binding.id, { ...runRequest, requestId: randomUUID() })).rejects.toThrow("runtime_routing_binding_or_task_changed");
  const revoked = await service.createTask(actor, { ...task, requestId: randomUUID() });
  await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, actor.companyId), eq(companyMemberships.principalId, actor.userId)));
  await expect(service.run(actor, revoked.binding.id, { ...runRequest, requestId: randomUUID() })).rejects.toThrow("private_prompt_active_session_administrator_required");
  await db.update(companyMemberships).set({ status: "active" }).where(and(eq(companyMemberships.companyId, actor.companyId), eq(companyMemberships.principalId, actor.userId)));
  const configDrift = await service.createTask(actor, { ...task, requestId: randomUUID() }), [agent] = await db.select().from(agents).where(eq(agents.id, bound.selectedAgentId));
  await db.update(agents).set({ adapterConfig: { ...agent.adapterConfig, model: "claude-unproved" } }).where(eq(agents.id, agent.id));
  await expect(service.run(actor, configDrift.binding.id, { ...runRequest, requestId: randomUUID() })).rejects.toThrow();
  await db.update(agents).set({ adapterConfig: agent.adapterConfig }).where(eq(agents.id, agent.id));
  const budget = await service.createTask(actor, { ...task, requestId: randomUUID() }), budgetRequest = { ...runRequest, requestId: randomUUID() };
  await db.update(agents).set({ budgetMonthlyCents: 1, spentMonthlyCents: 1, spendMonthUtc: new Date().toISOString().slice(0, 7) }).where(eq(agents.id, agent.id));
  try { await service.run(actor, budget.binding.id, budgetRequest); } catch { /* Core can reject or record a skipped budget admission. */ }
  await drainHeartbeatRunsToQuiescence(db, heartbeat); expect(ordinaryCalls()).toBe(before + 1);
  await db.update(agents).set({ budgetMonthlyCents: agent.budgetMonthlyCents, spentMonthlyCents: agent.spentMonthlyCents,
    spendMonthUtc: agent.spendMonthUtc, status: "idle" }).where(eq(agents.id, agent.id));
  // A failed/skipped receipt never authorizes an unbound second provider turn.
  const budgetWake = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.idempotencyKey, `runtime-cost-routing:${budget.binding.id}`));
  if (budgetWake.length) { try { await service.run(actor, budget.binding.id, budgetRequest); } catch {} await drainHeartbeatRunsToQuiescence(db, heartbeat); expect(ordinaryCalls()).toBe(before + 1); }
  await db.update(companies).set({ status: "paused" }).where(eq(companies.id, actor.companyId));
  expect((await service.current(actor)).companyPaused).toBe(true);
  await expect(service.prepare(actor, { ...preparation, requestId: randomUUID(), expectedGeneration: approved.receipt.generation })).rejects.toThrow("private_prompt_active_company_required");
  const disabled = await service.disable(actor, { requestId: randomUUID(), expectedGeneration: approved.receipt.generation });
  expect(disabled.receipt.action).toBe("disable"); await db.update(companies).set({ status: "active" }).where(eq(companies.id, actor.companyId));
  await expect(service.closeExpired(actor, proposal.item.id, { expectedGeneration: 0 })).rejects.toThrow("runtime_routing_approved_policy_cannot_close");
  await expect(service.run(actor, revoked.binding.id, { ...runRequest, requestId: randomUUID() })).rejects.toThrow("runtime_routing_binding_or_task_changed");
  expect(ordinaryCalls()).toBe(before + 1);
  expect((await db.select().from(runtimeRoutingBindings).where(eq(runtimeRoutingBindings.id, bound.id)))[0].runId).toBe(run.id);
  for (const candidate of candidates) await applications.rollback(actor, candidate.promptId, candidate.applicationId, { requestId: randomUUID(), expectedGeneration: candidate.applicationGeneration });
  vi.stubEnv("PAPERCLIP_RUNTIME_COST_ROUTING_ENABLED", "false");
  const [ordinary] = await db.insert(issues).values({ companyId: actor.companyId, identifier: `ROUTING-${Date.now()}`, title: "Unbound identifier lookup", assigneeAgentId: agent.id, responsibleUserId: actor.userId }).returning();
  expect(await heartbeat.wakeup(agent.id, { reason: "issue_comment_mentioned", payload: { issueId: ordinary.identifier } })).toBeNull();
  await expect(heartbeat.wakeup(agent.id, { source: "on_demand", requestedByActorType: "user", requestedByActorId: actor.userId,
    payload: { issueId: ordinary.id, resumeFromRunId: run.id } })).rejects.toThrow("runtime_routing_generic_wake_denied");
  expect(ordinaryCalls()).toBe(before + 1);
  await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, actor.companyId), eq(principalPermissionGrants.id, configurationGrant.id)));
}
