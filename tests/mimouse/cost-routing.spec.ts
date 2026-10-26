import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { NextFunction, Request, Response } from "express";
import { activityLog, agents, authUsers, companies, companyMemberships, companySkills, companySkillVersions,
  companySkillTestInputs, companySkillTestRuns, costEvents, heartbeatRuns, issues, runUsageReceipts,
  mimouseEvaluationComparisons as comparisons } from "../../packages/db/src/index.js";
import { costRoutingPolicies, costRoutingPreviews } from "../../packages/db/src/schema/cost_routing_preview.js";
import { costRoutingPreviewService } from "../../server/src/services/cost-routing-preview/service.js";
import { costRoutingPreviewRoutes } from "../../server/src/routes/cost-routing-preview.js";
import { evaluationService } from "../../server/src/services/mimouse-evaluation/service.js";
import { compareRecordedSkillRuns } from "../../server/src/services/mimouse-evaluation/compare.js";
import { canonical } from "../../server/src/services/mimouse-operations/preview.js";
import { accessService } from "../../server/src/services/access.js";
import { HttpError } from "../../server/src/errors.js";
import { createFixtureDb } from "./fixture-db.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const express = require("express") as typeof import("express");
const supertest = require("supertest") as typeof import("supertest");
const { and, eq } = await import(require.resolve("drizzle-orm"));
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

// Disposable PostgreSQL only; guard precedes every mutation. All accounting,
// heartbeat and output rows below are SYNTHETIC records, not live execution or
// provider evidence. No adapter, wake, permission expansion or model call occurs.
async function fixture() {
  const db = await createFixtureDb();
  try {
    const [company, other] = await db.insert(companies).values([
      { name: "Cost preview fixture only", status: "active", issuePrefix: `C${randomUUID().slice(0, 8)}` },
      { name: "Foreign cost preview fixture", status: "active", issuePrefix: `C${randomUUID().slice(0, 8)}` },
    ]).returning();
    const config = { model: "fixture-model", env: { FIXTURE_CANARY: "fixture-secret-do-not-return" } };
    const runtimeConfig = { heartbeat: { enabled: false, wakeOnDemand: false } };
    const [agent, foreignAgent] = await db.insert(agents).values([company, other].map(c => ({ companyId: c.id,
      name: "Synthetic no-execution agent", status: "paused", adapterType: "qoder_cn", adapterConfig: config, runtimeConfig }))).returning();
    const actorId = `fixture-reviewer-${randomUUID()}`;
    const [skill] = await db.insert(companySkills).values({ companyId: company.id, key: randomUUID(), slug: randomUUID(),
      name: "Synthetic routing regression", markdown: "# No execution", sourceType: "local_path" }).returning();
    const versions = await db.insert(companySkillVersions).values([1, 2].map(revisionNumber => ({ companyId: company.id,
      companySkillId: skill.id, revisionNumber, fileInventory: [{ path: "SKILL.md", kind: "skill" as const,
        content: `# Synthetic ${revisionNumber}`, encoding: "utf8" as const }] }))).returning();
    const [input] = await db.insert(companySkillTestInputs).values({ companyId: company.id, skillId: skill.id, name: "Fixed input", content: "fixture input" }).returning();
    const harnesses = await db.insert(issues).values(versions.map(v => ({ companyId: company.id,
      title: `No-execution harness ${v.id}`, status: "done", harnessKind: "skill_test" }))).returning();
    const agentConfigSnapshot = { agentId: agent.id, adapterType: agent.adapterType, model: config.model, adapterConfig: config, runtimeConfig };
    const templateBody = "Synthetic fixed prompt, no execution";
    const runs = await db.insert(companySkillTestRuns).values(versions.map((v, i) => ({ companyId: company.id,
      skillId: skill.id, inputId: input.id, inputSnapshot: input.content, skillVersionId: v.id, agentId: agent.id,
      agentConfigSnapshot, issueId: harnesses[i]!.id, status: "succeeded", outputSnapshot: i ? "expected" : "wrong", templateBody }))).returning();
    const evaluation = evaluationService(db), service = costRoutingPreviewService(db);
    const dataset = (await evaluation.createDataset(company.id, { requestId: randomUUID(), skillId: skill.id,
      name: "Fixed fixture dataset", cases: [{ inputId: input.id, expected: "expected" }] }, actorId)).item;
    const comparisonInput = () => ({ requestId: randomUUID(), datasetId: dataset.id, baselineVersionId: versions[0]!.id,
      candidateVersionId: versions[1]!.id, runIds: runs.map(r => r.id), maxCandidateCostCents: null });
    const report = (await evaluation.compare(company.id, comparisonInput(), actorId)).item;
    const contextHash = digest({ agent: agentConfigSnapshot, template: templateBody });
    const policy = (reportId = report.id, reportHash = report.report.reportHash) => ({ datasetId: dataset.id, datasetHash: dataset.datasetHash,
      minimumPassRate: 1, maxEvidenceAgeHours: 24, requiredCapabilities: [],
      candidates: [{ agentId: agent.id, provider: "fixture-provider", model: config.model, reportId, reportHash, executionContextHash: contextHash }] });
    const save = (expectedRevision = 0) => ({ requestId: randomUUID(), expectedRevision, policy: policy() });
    const policyRows = () => db.select().from(costRoutingPolicies).where(eq(costRoutingPolicies.companyId, company.id));
    const previewRows = () => db.select().from(costRoutingPreviews).where(eq(costRoutingPreviews.companyId, company.id));
    const audit = () => db.select().from(activityLog).where(and(eq(activityLog.companyId, company.id), eq(activityLog.entityType, "cost_routing_preview")));
    return { db, company, other, actorId, agent, foreignAgent, skill, versions, input, runs, dataset, report,
      contextHash, evaluation, comparisonInput, service, policy, save, policyRows, previewRows, audit };
  } catch (error) { await db.$client.end({ timeout: 1 }); throw error; }
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function seedAccountedUsd(f: Fixture) {
  const finishedAt = new Date(Date.now() - 60_000);
  for (const run of f.runs) {
    const receiptId = randomUUID(), heartbeatId = randomUUID();
    await f.db.insert(heartbeatRuns).values({ id: heartbeatId, companyId: f.company.id, agentId: f.agent.id, issueId: run.issueId,
      scopeKind: "issue", status: "succeeded", startedAt: finishedAt, finishedAt, costAccountingPending: false, costAccountedAt: new Date(),
      runnerProfileJson: { adapterDispatch: { adapterType: "qoder_cn" } },
      usageJson: { accountingReceiptId: receiptId, accountingReceiptReady: true } });
    const envelope = { schema: "paperclip/accounting-receipt/v1", id: receiptId, companyId: f.company.id, runId: heartbeatId,
      adapterType: "qoder_cn", receipt: { complete: true, usageBasis: "per_run", model: "fixture-model", provider: "fixture-provider",
        billingType: "metered_api", costStatus: "reported", costUsdExact: "0.00125", pricingProvenance: { source: "provider_reported" } } };
    await f.db.insert(runUsageReceipts).values({ id: receiptId, companyId: f.company.id, runId: heartbeatId,
      sourceId: randomUUID(), sequence: 1, receiptHash: digest(envelope), receiptJson: envelope, complete: true, receivedAt: finishedAt });
    await f.db.insert(costEvents).values({ companyId: f.company.id, agentId: f.agent.id, issueId: run.issueId, heartbeatRunId: heartbeatId,
      provider: "fixture-provider", model: "fixture-model", costCents: 0.125, billingType: "metered_api", costStatus: "reported", occurredAt: finishedAt });
  }
}

test("independent connections serialize policy CAS; exact retry is actor-bound and audited once", async () => {
  const f = await fixture(), second = await createFixtureDb();
  try {
    const remote = costRoutingPreviewService(second), inputs = [f.save(), f.save()];
    const results = await Promise.allSettled([f.service.save(f.company.id, f.actorId, inputs[0]), remote.save(f.company.id, f.actorId, inputs[1])]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    const index = results.findIndex(r => r.status === "fulfilled"), winner = (results[index] as PromiseFulfilledResult<unknown>).value;
    expect(await remote.save(f.company.id, f.actorId, inputs[index])).toEqual(winner);
    await expect(remote.save(f.company.id, "another-fixture-actor", inputs[index])).rejects.toMatchObject({ status: 409 });
    await expect(remote.save(f.company.id, f.actorId, { ...inputs[index], policy: { ...inputs[index]!.policy, minimumPassRate: 0.5 } })).rejects.toMatchObject({ status: 409 });
    expect(await f.policyRows()).toHaveLength(1); expect(await f.audit()).toHaveLength(1);
    await remote.save(f.company.id, f.actorId, f.save(1));
    expect(await f.service.save(f.company.id, f.actorId, inputs[index])).toEqual(winner);
    expect(await f.audit()).toHaveLength(2);
    expect(JSON.stringify(await f.audit())).not.toContain("fixture-secret-do-not-return");
  } finally { await second.$client.end({ timeout: 1 }); await f.db.$client.end({ timeout: 1 }); }
});

test("owned candidates/reports, preview revision and retry identity cannot cross company boundaries", async () => {
  const f = await fixture(), foreign = await fixture();
  try {
    await expect(f.service.save(f.company.id, f.actorId, { ...f.save(), policy: { ...f.policy(), candidates: [{ ...f.policy().candidates[0]!, agentId: f.foreignAgent.id }] } })).rejects.toMatchObject({ status: 404 });
    await expect(f.service.save(f.company.id, f.actorId, { ...f.save(), policy: f.policy(foreign.report.id, foreign.report.reportHash) })).rejects.toMatchObject({ status: 404 });
    await expect(f.service.save(f.other.id, f.actorId, f.save())).rejects.toMatchObject({ status: 404 });
    await expect(f.service.save(f.company.id, f.actorId, { ...f.save(), policy: f.policy(randomUUID()) })).rejects.toMatchObject({ status: 404 });
    await f.service.save(f.company.id, f.actorId, f.save());
    const request = { requestId: randomUUID(), policyRevision: 1 }, first = await f.service.preview(f.company.id, f.actorId, request);
    expect(first.preview).toMatchObject({ outcome: "blocked", selectedAgentId: null, dispatchAuthority: false, executionStarted: false, budgetReserved: false });
    expect(first.preview.candidates[0]!.comparableCost).toBeNull();
    expect(first.preview.candidates[0]!.blockers).toContain("agent_model_mapping_unverified");
    expect(await f.service.preview(f.company.id, f.actorId, request)).toEqual(first);
    await expect(f.service.preview(f.company.id, "another-fixture-actor", request)).rejects.toMatchObject({ status: 409 });
    await expect(f.service.preview(f.company.id, f.actorId, { ...request, policyRevision: 2 })).rejects.toMatchObject({ status: 409 });
    expect(await f.service.current(f.other.id)).toBeNull();
    await expect(f.service.getPreview(f.other.id, first.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.service.preview(f.other.id, f.actorId, request)).rejects.toMatchObject({ status: 409 });
    await f.service.save(f.company.id, f.actorId, f.save(1));
    await expect(f.service.preview(f.company.id, f.actorId, { ...request, requestId: randomUUID() })).rejects.toMatchObject({ status: 409 });
    expect(await f.service.preview(f.company.id, f.actorId, request)).toEqual(first);
    expect(await f.service.getPreview(f.company.id, first.id)).toEqual(first);
    expect(await f.previewRows()).toHaveLength(1); expect(await f.audit()).toHaveLength(3);
  } finally { await foreign.db.$client.end({ timeout: 1 }); await f.db.$client.end({ timeout: 1 }); }
});

test("actual migration triggers make both policy and preview history append-only", async () => {
  const f = await fixture();
  try {
    await f.service.save(f.company.id, f.actorId, f.save());
    const receipt = await f.service.preview(f.company.id, f.actorId, { requestId: randomUUID(), policyRevision: 1 });
    const [policy] = await f.policyRows();
    for (const [table, id] of [["cost_routing_policies", policy!.id], ["cost_routing_previews", receipt.id]]) {
      await expect(f.db.$client.unsafe(`UPDATE ${table} SET actor_id = 'changed' WHERE id = $1`, [id!])).rejects.toThrow("append-only");
      await expect(f.db.$client.unsafe(`DELETE FROM ${table} WHERE id = $1`, [id!])).rejects.toThrow("append-only");
    }
    const [stored] = await f.previewRows();
    await expect(f.db.insert(costRoutingPreviews).values({ ...stored!, id: randomUUID(), companyId: f.other.id, requestId: randomUUID() })).rejects.toThrow();
    expect(await f.policyRows()).toHaveLength(1); expect(await f.previewRows()).toHaveLength(1);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});

test("a company-scoped audit failure rolls policy and preview back with reusable request IDs", async () => {
  const f = await fixture(), name = `fixture_cost_audit_${randomUUID().replaceAll("-", "")}`;
  let functionCreated = false, triggerCreated = false;
  const install = async () => { await f.db.$client.unsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION ${name}()`); triggerCreated = true; };
  const remove = async () => { await f.db.$client.unsafe(`DROP TRIGGER ${name} ON activity_log`); triggerCreated = false; };
  try {
    await f.db.$client.unsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.company_id = '${f.company.id}'::uuid AND NEW.entity_type = 'cost_routing_preview' THEN RAISE EXCEPTION 'fixture routing audit failure'; END IF;
      RETURN NEW; END; $$`); functionCreated = true; await install();
    const input = f.save(); await expect(f.service.save(f.company.id, f.actorId, input)).rejects.toThrow();
    expect(await f.policyRows()).toHaveLength(0); expect(await f.audit()).toHaveLength(0);
    await remove(); expect((await f.service.save(f.company.id, f.actorId, input)).revision).toBe(1);
    await install(); const preview = { requestId: randomUUID(), policyRevision: 1 };
    await expect(f.service.preview(f.company.id, f.actorId, preview)).rejects.toThrow();
    expect(await f.previewRows()).toHaveLength(0); expect(await f.audit()).toHaveLength(1);
    await remove(); await f.service.preview(f.company.id, f.actorId, preview);
    expect(await f.previewRows()).toHaveLength(1); expect(await f.audit()).toHaveLength(2);
  } finally {
    try { if (triggerCreated) await f.db.$client.unsafe(`DROP TRIGGER IF EXISTS ${name} ON activity_log`);
      if (functionCreated) await f.db.$client.unsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    } finally { await f.db.$client.end({ timeout: 1 }); }
  }
});

test("real evaluation capture preserves scoring/hash and valid USD diagnostics still cannot recommend", async () => {
  const f = await fixture();
  try {
    const [original] = await f.db.select().from(comparisons).where(eq(comparisons.id, f.report.id));
    expect(original!.evidenceSnapshot.routingEvidenceV1).toBeNull();
    // Historical report shape: no new proof field, not a client-provided price.
    const { routingEvidenceV1: _removed, ...oldSnapshot } = original!.evidenceSnapshot;
    const [historical] = await f.db.insert(comparisons).values({ ...original!, id: randomUUID(), requestId: randomUUID(), evidenceSnapshot: oldSnapshot }).returning();
    await f.service.save(f.company.id, f.actorId, { ...f.save(), policy: f.policy(historical!.id) });
    const legacy = await f.service.preview(f.company.id, f.actorId, { requestId: randomUUID(), policyRevision: 1 });
    expect(legacy.preview.candidates[0]!.blockers).toContain("cost_currency_unit_unverified");
    await seedAccountedUsd(f);
    const input = f.comparisonInput(), captured = (await f.evaluation.compare(f.company.id, input, f.actorId)).item;
    const expected = await compareRecordedSkillRuns({ companyId: f.company.id, skillId: f.skill.id, datasetId: f.dataset.id,
      baselineVersionId: f.versions[0]!.id, candidateVersionId: f.versions[1]!.id, cases: f.dataset.cases,
      runs: f.runs.map(run => ({ id: run.id, companyId: run.companyId, skillId: run.skillId, versionId: run.skillVersionId,
        caseId: run.inputId!, inputSnapshot: run.inputSnapshot, outputSnapshot: run.outputSnapshot, status: "succeeded",
        costCents: 0.125, executionContextHash: f.contextHash, supersededAt: null })), maxCandidateCostCents: null });
    expect(captured.report).toEqual(expected);
    const { reportHash, ...reportBody } = captured.report; expect(digest(reportBody)).toBe(reportHash);
    expect(captured.report).toMatchObject({ eligibleForHumanReview: true, candidate: { passed: 1, totalCostCents: 0.125 } });
    const [stored] = await f.db.select().from(comparisons).where(eq(comparisons.id, captured.id));
    expect(stored!.evidenceSnapshot.routingEvidenceV1).toMatchObject({ version: 1, executionContextVerification: "unverified_test_creation_snapshot",
      agentId: f.agent.id, adapterType: "qoder_cn", currency: "USD", unit: "cent", costCents: "0.1250000" });
    const safeProof = JSON.stringify(stored!.evidenceSnapshot.routingEvidenceV1);
    expect(safeProof).not.toContain("fixture-secret-do-not-return"); expect(safeProof).not.toContain("adapterConfig");
    expect((await f.evaluation.compare(f.company.id, input, f.actorId)).item).toEqual(captured);
    // Ready state here is a direct synthetic DB row, with heartbeat disabled.
    await f.db.update(agents).set({ status: "idle" }).where(eq(agents.id, f.agent.id));
    await f.service.save(f.company.id, f.actorId, { ...f.save(1), policy: f.policy(captured.id, captured.report.reportHash) });
    const receipt = await f.service.preview(f.company.id, f.actorId, { requestId: randomUUID(), policyRevision: 2 });
    expect(receipt.preview).toMatchObject({ outcome: "blocked", selectedAgentId: null, executionStarted: false, budgetReserved: false, dispatchAuthority: false });
    expect(receipt.preview.candidates[0]).toMatchObject({ comparableCost: null, observedPassRate: 1, blockers: ["execution_context_unverified"] });
    // Actual dispatch adapter mismatch removes accounting diagnostics, but must
    // not change comparison quality/report hash for the same recorded outputs.
    await f.db.update(heartbeatRuns).set({ runnerProfileJson: { adapterDispatch: { adapterType: "other-fixture-adapter" } } }).where(eq(heartbeatRuns.companyId, f.company.id));
    const changed = (await f.evaluation.compare(f.company.id, f.comparisonInput(), f.actorId)).item;
    expect(changed.report).toEqual(captured.report);
    const [blocked] = await f.db.select().from(comparisons).where(eq(comparisons.id, changed.id));
    expect(blocked!.evidenceSnapshot.routingEvidenceV1).toBeNull();
    expect(await f.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.company.id))).toHaveLength(2);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});

test("real router ACL uses persisted owner grants, rejects other actors and mounts behind the API", async ({ request }) => {
  const f = await fixture();
  try {
    const ownerId = randomUUID(), viewerId = randomUUID();
    await f.db.insert(authUsers).values([ownerId, viewerId].map(id => ({ id, name: "Routing fixture user", email: `${id}@fixture.invalid`, createdAt: new Date(), updatedAt: new Date() })));
    await f.db.insert(companyMemberships).values([{ companyId: f.company.id, principalType: "user", principalId: ownerId, membershipRole: "owner", status: "active" },
      { companyId: f.company.id, principalType: "user", principalId: viewerId, membershipRole: "viewer", status: "active" }]);
    await accessService(f.db).ensureRoleDefaultGrants(f.company.id, ownerId, "owner", ownerId);
    function app(actor: Express.Request["actor"]) {
      const server = express(); server.use(express.json());
      server.use((req: Request, _res: Response, next: NextFunction) => { req.actor = actor; next(); });
      server.use("/api", costRoutingPreviewRoutes(f.db));
      server.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        res.status(error instanceof HttpError ? error.status : error instanceof Error && error.name === "ZodError" ? 400 : 500).json({ error: "fixture request rejected" });
      }); return supertest(server);
    }
    // These explicit actors exercise route ACL, not login/session authentication.
    const owner: Express.Request["actor"] = { type: "board", source: "session", userId: ownerId, companyIds: [f.company.id],
      memberships: [{ companyId: f.company.id, membershipRole: "owner", status: "active" }] };
    const root = `/api/companies/${f.company.id}/cost-routing`, admin = app(owner);
    expect((await admin.post(`${root}/policy`).send(f.save())).status).toBe(200);
    const receipt = await admin.post(`${root}/previews`).send({ requestId: randomUUID(), policyRevision: 1 });
    expect(receipt.status).toBe(200); expect(receipt.body.preview.selectedAgentId).toBeNull();
    const read = await admin.get(`${root}/policy`); expect(read.status).toBe(200); expect(read.headers["cache-control"]).toBe("no-store");
    for (const actor of [{ ...owner, userId: viewerId, memberships: [{ companyId: f.company.id, membershipRole: "viewer", status: "active" }] },
      { ...owner, companyIds: [f.other.id], memberships: [] },
      { type: "agent", source: "agent_key", companyId: f.company.id, agentId: f.agent.id },
      { type: "agent", source: "agent_key", companyId: f.other.id, agentId: f.foreignAgent.id }] as Express.Request["actor"][]) {
      const denied = app(actor);
      expect((await denied.get(`${root}/policy`)).status).toBe(403);
      expect((await denied.post(`${root}/policy`).send(f.save(1))).status).toBe(403);
      expect((await denied.post(`${root}/previews`).send({ requestId: randomUUID(), policyRevision: 1 })).status).toBe(403);
      expect((await denied.get(`${root}/previews/${receipt.body.id}`)).status).toBe(403);
    }
    expect((await app({ type: "none", source: "none" } as Express.Request["actor"]).get(`${root}/policy`)).status).toBe(401);
    expect((await admin.post(`${root}/policy`).send({ ...f.save(1), price: 0, score: 1 })).status).toBe(400);
    expect((await admin.get(`/api/companies/${f.other.id}/cost-routing/previews/${receipt.body.id}`)).status).toBe(403);
    expect(await f.policyRows()).toHaveLength(1); expect(await f.previewRows()).toHaveLength(1);
    const audit = await f.audit(); expect(audit).toHaveLength(2); expect(audit.every(row => row.actorId === ownerId)).toBe(true);
    // Separate local-trusted disposable-server mount check; not an SSO test.
    const mounted = await request.get(`${root}/policy`); expect(mounted.status()).toBe(200); expect((await mounted.json()).revision).toBe(1);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});
