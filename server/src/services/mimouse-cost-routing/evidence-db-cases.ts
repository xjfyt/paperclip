import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { agents, companySkillVersions, mimouseEvaluationDatasets, heartbeatRuns, runUsageReceipts, costEvents, type Db } from "@paperclipai/db";
import type { heartbeatService } from "../heartbeat.js";
import { privatePromptTestService, type PrivatePromptIdentity } from "../mimouse-private-prompt-tests/service.js";
import { privateConfigDigest, privatePromptFixedContext, assertPrivatePromptTextInventory } from "../mimouse-private-prompt-tests/profile.js";
import { promptRegistryService } from "../mimouse-prompt-registry/service.js";
import { secretService } from "../secrets.js";
import { drainHeartbeatRunsToQuiescence } from "../../__tests__/helpers/drain-heartbeat-runs.js";
import { buildRuntimeRoutingCandidate } from "./evidence-service.js";

/** Called by the existing owned PG fixture, whose sole provider process is an
 * inert no-network Node stdin echo. All proof rows below come from the production
 * private prepare/execute/wake/heartbeat/recorder/settlement path, never inserts. */
export async function verifyProducedRuntimeRoutingEvidence(db: Db, actor: PrivatePromptIdentity,
  heartbeat: ReturnType<typeof heartbeatService>, agentId: string, skillVersionId: string) {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  const [version] = await db.select().from(companySkillVersions).where(eq(companySkillVersions.id, skillVersionId));
  const config: Record<string, unknown> = { ...agent.adapterConfig, model: "claude-haiku-4-5" };
  const [other] = await db.insert(agents).values({ companyId: actor.companyId, name: "Routing candidate fixture", role: "engineer",
    status: "idle", adapterType: "claude_local", adapterConfig: config }).returning();
  const secret = (config.env as Record<string, { secretId: string; version: number }>).ANTHROPIC_API_KEY;
  await secretService(db).createBinding({ companyId: actor.companyId, secretId: secret.secretId, targetType: "agent",
    targetId: other.id, configPath: "env.ANTHROPIC_API_KEY", versionSelector: secret.version });
  const registry = promptRegistryService(db), promptKey = `routing_fixture_${randomUUID()}`;
  const baseline = await registry.create(actor.companyId, actor.userId, { requestId: randomUUID(), promptKey, content: "ROUTING_PRIVATE_BASELINE" });
  const content = "ROUTING_PRIVATE_CANDIDATE", candidate = await registry.create(actor.companyId, actor.userId,
    { requestId: randomUUID(), promptKey, content });
  const caseInput = "ROUTING_PRIVATE_INPUT", fixed = privatePromptFixedContext(caseInput, version.id, assertPrivatePromptTextInventory(version.fileInventory), content);
  const cases = [{ id: randomUUID(), input: caseInput, expected: `${fixed}\n\n<private-prompt-revision>\n${content}\n</private-prompt-revision>` }];
  const [dataset] = await db.insert(mimouseEvaluationDatasets).values({ companyId: actor.companyId, skillId: version.companySkillId,
    requestId: randomUUID(), requestDigest: "inert-runtime-routing-fixture", name: "Private routing", cases,
    datasetHash: privateConfigDigest(cases), actorId: actor.userId }).returning();
  const service = privatePromptTestService(db, heartbeat.wakeup), results = [];
  for (const ownAgentId of [agentId, other.id]) {
    const testIds: string[] = [];
    for (const revision of [baseline.item, candidate.item]) {
      const prepared = await service.prepare(actor, candidate.item.promptId, { requestId: randomUUID(), revisionId: revision.id,
        expectedHeadReceiptId: null, agentId: ownAgentId, datasetId: dataset.id, caseId: cases[0].id,
        skillVersionId, executionProfile: "claude_cli_bare_api_key_v1" });
      expect(prepared.item.status).toBe("awaiting_confirmation");
      expect(prepared.item.heartbeatRunId).toBeNull();
      const executed = await service.execute(actor, candidate.item.promptId, prepared.item.id, {
        approvalDigest: prepared.item.approvalDigest, executionProfile: "claude_cli_bare_api_key_v1",
        confirmExecution: true, confirmPossibleCharges: true, confirmRestrictedProfile: true });
      await drainHeartbeatRunsToQuiescence(db, heartbeat);
      const detail = await service.detail(actor, candidate.item.promptId, executed.item.id);
      expect(detail.item.status).toBe("completed"); testIds.push(detail.item.id);
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, detail.item.heartbeatRunId!));
      expect(run).toMatchObject({ status: "succeeded", costAccountingPending: false, accountingProjectionVersion: "v2" });
      expect(run.costAccountedAt).not.toBeNull();
      const journal = await db.select().from(runUsageReceipts).where(eq(runUsageReceipts.runId, run.id));
      expect(journal).toHaveLength(1); expect(journal[0].complete).toBe(true);
      const ledger = await db.select().from(costEvents).where(eq(costEvents.heartbeatRunId, run.id));
      expect(ledger).toHaveLength(1); expect(ledger[0].idempotencyKey).toBe(`heartbeat:${run.id}:final`);
      // Replaying the already-confirmed intent is metadata-only, no extra spend.
      await service.execute(actor, candidate.item.promptId, prepared.item.id, { approvalDigest: prepared.item.approvalDigest,
        executionProfile: "claude_cli_bare_api_key_v1", confirmExecution: true, confirmPossibleCharges: true, confirmRestrictedProfile: true });
      expect(await db.select().from(costEvents).where(eq(costEvents.heartbeatRunId, run.id))).toEqual(ledger);
    }
    const reference = { agentId: ownAgentId, promptId: candidate.item.promptId, applicationId: randomUUID(), applicationGeneration: 1,
      comparison: { datasetId: dataset.id, baselineRevisionId: baseline.item.id, candidateRevisionId: candidate.item.id, testIds, maxCandidateCostCents: null } };
    const constraints = { datasetId: dataset.id, datasetHash: dataset.datasetHash, maxEvidenceAgeHours: 24, now: new Date() };
    const build = () => db.transaction(tx => buildRuntimeRoutingCandidate(tx, actor, reference, constraints));
    const evidence = await build();
    expect(evidence).toMatchObject({ agentId: ownAgentId, passedCases: 1, totalCases: 1, costBasis: "settled_per_run_cli_reported_usd" });
    expect(JSON.stringify(evidence)).not.toMatch(/ROUTING_PRIVATE|fixture-not-a-real-key|secretId|privateResult/);
    const readState = () => db.execute(sql`select (select count(*) from cost_events) as costs,
      (select count(*) from run_usage_receipts) as receipts, (select count(*) from agent_wakeup_requests) as wakes,
      (select count(*) from activity_log) as activity`);
    const before = await readState(); expect(await build()).toEqual(evidence); expect(await readState()).toEqual(before);
    await expect(db.transaction(tx => buildRuntimeRoutingCandidate(tx, { ...actor, userId: "foreign-author" }, reference, constraints))).rejects.toMatchObject({ status: 404 });
    await expect(db.transaction(tx => buildRuntimeRoutingCandidate(tx, actor, { ...reference, agentId: ownAgentId === agentId ? other.id : agentId }, constraints))).rejects.toMatchObject({ status: 404 });
    const original = ownAgentId === agentId ? agent.adapterConfig : config;
    await db.update(agents).set({ adapterConfig: { ...original, model: "claude-unproved" } }).where(eq(agents.id, ownAgentId));
    await expect(build()).rejects.toMatchObject({ status: 422 });
    await db.update(agents).set({ adapterConfig: original }).where(eq(agents.id, ownAgentId));
    expect(await build()).toEqual(evidence);
    results.push({ reference, evidence });
  }
  expect(new Set(results.map(r => r.evidence.agentId)).size).toBe(2);
  expect(new Set(results.map(r => r.evidence.model)).size).toBe(2);
  expect(results[1].evidence.observedCostCents).toBe("0.1250000");
  expect(results[0].evidence.observedCostCents).toBe("0.2500000");
  const runIds = results.flatMap(r => r.evidence.cases.map(c => c.heartbeatRunId));
  expect(await db.select().from(costEvents).where(and(eq(costEvents.companyId, actor.companyId), inArray(costEvents.heartbeatRunId, runIds)))).toHaveLength(2);
  return results;
}
