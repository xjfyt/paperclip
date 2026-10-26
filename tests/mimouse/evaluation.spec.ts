import { test, expect, type APIRequestContext } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createFixtureDb } from "./fixture-db.js";
import { activityLog, authUsers, companyMemberships, mimouseFeedbackInbox, agents, heartbeatRuns, issues, companySkills, companySkillVersions, companySkillTestInputs, companySkillTestRuns, costEvents,
  mimouseEvaluationDatasets as datasets, mimouseEvaluationComparisons as comparisons } from "../../packages/db/src/index.js";
import { feedbackInboxService } from "../../server/src/services/mimouse-feedback.js";
import { companySkillService } from "../../server/src/services/company-skills.js";
import { evaluationService } from "../../server/src/services/mimouse-evaluation/service.js";
import { mimouseEvaluationRoutes } from "../../server/src/routes/mimouse-evaluation.js";
import { canonical } from "../../server/src/services/mimouse-operations/preview.js";
import { HttpError } from "../../server/src/errors.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq } = await import(require.resolve("drizzle-orm"));
const express = require("express") as typeof import("express");
const supertest = require("supertest") as typeof import("supertest");
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
async function fixture(request: APIRequestContext, seedRecordedRuns = true) {
  const response = await request.post("/api/companies", { data: { name: "Recorded evaluation fixture — no model execution" } });
  expect(response.ok(), await response.text()).toBe(true); const companyId = (await response.json()).id as string;
  const db = await createFixtureDb();
  const [agent] = await db.insert(agents).values({ companyId, name: "Paused fixture agent", status: "paused", adapterType: "process", adapterConfig: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } } }).returning();
  const [skill] = await db.insert(companySkills).values({ companyId, key: `fixture-${randomUUID()}`, slug: `fixture-${randomUUID()}`, name: "Recorded skill fixture", markdown: "# Fixture only", sourceType: "local_path" }).returning();
  const versions = await db.insert(companySkillVersions).values([1, 2].map(revisionNumber => ({ companyId, companySkillId: skill.id, revisionNumber,
    fileInventory: [{ path: "SKILL.md", kind: "skill" as const, content: `# Version ${revisionNumber}`, encoding: "utf8" as const }] }))).returning();
  const [input] = await db.insert(companySkillTestInputs).values({ companyId, skillId: skill.id, name: "Frozen case", content: " \noriginal input: α\n  second line\n\t" }).returning();
  const harnesses = seedRecordedRuns ? await db.insert(issues).values(versions.map(version => ({ companyId, title: `Recorded fixture ${version.id}`, status: "done", harnessKind: "skill_test" }))).returning() : [];
  const runs = seedRecordedRuns ? await db.insert(companySkillTestRuns).values(versions.map((version, index) => ({ companyId, skillId: skill.id, inputId: input.id, inputSnapshot: input.content.trim(),
    skillVersionId: version.id, agentId: agent.id, agentConfigSnapshot: { agentId: agent.id, adapterType: "process", model: "fixture-only", adapterConfig: {} },
    issueId: harnesses[index]!.id, status: "succeeded", outputSnapshot: index ? "correct\noutput" : "wrong\noutput", templateBody: "Recorded fixture template" }))).returning() : [];
  const root = `/api/companies/${companyId}/skill-evaluations`;
  const datasetInput = { requestId: randomUUID(), skillId: skill.id, name: "Fixed regression v1", cases: [{ inputId: input.id, expected: "correct\noutput" }] };
  return { db, companyId, agent, skill, versions, input, runs, root, datasetInput, service: evaluationService(db) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function freeze(request: APIRequestContext, f: Fixture) {
  const response = await request.post(`${f.root}/datasets`, { data: f.datasetInput }); expect(response.status(), await response.text()).toBe(201); return (await response.json()).item;
}
function comparison(f: Fixture, datasetId: string) { return { requestId: randomUUID(), datasetId, baselineVersionId: f.versions[0]!.id, candidateVersionId: f.versions[1]!.id, runIds: f.runs.map(run => run.id), maxCandidateCostCents: null as number | null }; }
async function compare(request: APIRequestContext, f: Fixture, body: ReturnType<typeof comparison>) {
  const response = await request.post(`${f.root}/comparisons`, { data: body }); expect(response.status(), await response.text()).toBe(201); return (await response.json()).item;
}

test("dataset freezes server-loaded inputs, retries exactly once and rejects replacement", async ({ request }) => {
  const f = await fixture(request); try {
    const responses = await Promise.all([request.post(`${f.root}/datasets`, { data: f.datasetInput }), request.post(`${f.root}/datasets`, { data: f.datasetInput })]);
    expect(responses.map(response => response.status()).sort()).toEqual([200, 201]);
    const [a, b] = await Promise.all(responses.map(response => response.json())); expect(a.item.id).toBe(b.item.id);
    expect(a.item.cases).toEqual([{ id: f.input.id, input: f.input.content.trim(), sourceInputSnapshot: f.input.content, expected: "correct\noutput" }]);
    expect(a.item.datasetHash).toBe(digest(a.item.cases));
    await f.db.update(companySkillTestInputs).set({ content: "later edit must not change frozen input" }).where(eq(companySkillTestInputs.id, f.input.id));
    const retry = await request.post(`${f.root}/datasets`, { data: f.datasetInput }); expect(retry.status()).toBe(200); expect((await retry.json()).item).toEqual(a.item);
    expect((await request.post(`${f.root}/datasets`, { data: { ...f.datasetInput, name: "replacement" } })).status()).toBe(409);
    expect((await request.post(`${f.root}/datasets`, { data: { ...f.datasetInput, requestId: randomUUID(), cases: [{ ...f.datasetInput.cases[0], input: "forged" }] } })).status()).toBe(400);
    const stored = await f.db.select().from(datasets).where(eq(datasets.companyId, f.companyId)); expect(stored).toHaveLength(1); expect(stored[0]!.cases).toEqual(a.item.cases);
    const audit = await f.db.select().from(activityLog).where(eq(activityLog.entityId, a.item.id)); expect(audit).toHaveLength(1); expect(JSON.stringify(audit[0]!.details)).not.toContain(f.input.content);
    expect((await request.patch(`${f.root}/datasets/${a.item.id}`, { data: { name: "mutate" } })).status()).toBe(404);
    await f.db.update(companySkillTestInputs).set({ content: " \n\t " }).where(eq(companySkillTestInputs.id, f.input.id));
    expect((await request.post(`${f.root}/datasets`, { data: { ...f.datasetInput, requestId: randomUUID() } })).status()).toBe(422);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});

test("comparison is pinned to recorded snapshots and survives JSONB roundtrip and later edits", async ({ request }) => {
  const f = await fixture(request); try {
    const dataset = await freeze(request, f), body = comparison(f, dataset.id);
    const responses = await Promise.all([request.post(`${f.root}/comparisons`, { data: body }), request.post(`${f.root}/comparisons`, { data: body })]);
    expect(responses.map(response => response.status()).sort()).toEqual([200, 201]);
    const [a, b] = await Promise.all(responses.map(response => response.json())); expect(a.item).toEqual(b.item);
    expect(a.item.report).toMatchObject({ datasetHash: dataset.datasetHash, baseline: { cases: 1, passed: 0 }, candidate: { cases: 1, passed: 1, totalCostCents: null }, passCountDelta: 1, executionStarted: false, promoted: false });
    const [stored] = await f.db.select().from(comparisons).where(eq(comparisons.id, a.item.id));
    expect(stored!.report).toEqual(a.item.report); const { reportHash, ...reportBody } = stored!.report; expect(digest(reportBody)).toBe(reportHash);
    expect(JSON.stringify(stored!.evidenceSnapshot)).toContain("correct\\noutput"); expect(JSON.stringify(stored!.evidenceSnapshot)).not.toContain("adapterConfig");
    await f.db.update(companySkillTestRuns).set({ outputSnapshot: "later edited output", status: "failed" }).where(eq(companySkillTestRuns.id, f.runs[1]!.id));
    const retry = await request.post(`${f.root}/comparisons`, { data: body }); expect(retry.status()).toBe(200); expect((await retry.json()).item).toEqual(a.item);
    const read = await request.get(`${f.root}/comparisons/${a.item.id}`); expect(read.status()).toBe(200); expect((await read.json()).report).toEqual(a.item.report);
    expect((await request.post(`${f.root}/comparisons`, { data: { ...body, maxCandidateCostCents: 1 } })).status()).toBe(409);
    expect((await f.db.select().from(comparisons).where(eq(comparisons.companyId, f.companyId))).length).toBe(1);
    expect((await f.db.select().from(activityLog).where(eq(activityLog.entityId, a.item.id))).length).toBe(1);
    for (const action of ["promote", "rollback", "execute"]) expect((await request.post(`${f.root}/comparisons/${a.item.id}/${action}`, { data: { confirm: true } })).status()).toBe(404);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});

test("foreign datasets, versions and runs cannot cross company or skill boundaries", async ({ request }) => {
  const f = await fixture(request), foreign = await fixture(request); try {
    const dataset = await freeze(request, f), foreignDataset = await freeze(request, foreign), body = comparison(f, dataset.id);
    expect((await request.post(`${f.root}/datasets`, { data: { ...f.datasetInput, requestId: randomUUID(), cases: [{ inputId: foreign.input.id, expected: "correct" }] } })).status()).toBe(404);
    for (const patch of [{ datasetId: foreignDataset.id }, { candidateVersionId: foreign.versions[1]!.id }, { runIds: [foreign.runs[0]!.id] }]) expect((await request.post(`${f.root}/comparisons`, { data: { ...body, ...patch, requestId: randomUUID() } })).status()).toBe(404);
    const report = await compare(request, f, body); expect((await request.get(`${foreign.root}/comparisons/${report.id}`)).status()).toBe(404);
    const [stored] = await f.db.select().from(comparisons).where(eq(comparisons.id, report.id));
    await expect(f.db.insert(comparisons).values({ ...stored!, id: randomUUID(), companyId: foreign.companyId, requestId: randomUUID() })).rejects.toMatchObject({ cause: { code: "23503" } });
    const [otherSkill] = await f.db.insert(companySkills).values({ companyId: f.companyId, key: randomUUID(), slug: randomUUID(), name: "Other skill", markdown: "# Other" }).returning();
    const [otherVersion] = await f.db.insert(companySkillVersions).values({ companyId: f.companyId, companySkillId: otherSkill.id, revisionNumber: 1 }).returning();
    expect((await request.post(`${f.root}/comparisons`, { data: { ...body, requestId: randomUUID(), candidateVersionId: otherVersion.id } })).status()).toBe(404);
    expect((await request.post(`${f.root}/comparisons`, { data: { ...body, requestId: randomUUID(), candidateVersionId: body.baselineVersionId } })).status()).toBe(400);
    expect((await request.post(`${f.root}/comparisons`, { data: { ...body, requestId: randomUUID(), outputSnapshot: "forged", score: 100 } })).status()).toBe(400);
  } finally { await f.db.$client.end({ timeout: 1 }); await foreign.db.$client.end({ timeout: 1 }); }
});

test("missing, failed and edited-input runs keep the full denominator and block review", async ({ request }) => {
  const f = await fixture(request); try {
    const dataset = await freeze(request, f), body = comparison(f, dataset.id);
    const missing = await compare(request, f, { ...body, runIds: [f.runs[0]!.id] });
    expect(missing.report.candidate).toMatchObject({ cases: 1, passed: 0, blocked: 1 }); expect(missing.report.eligibleForHumanReview).toBe(false);
    expect(missing.report.results[1].blocked).toBe("missing_run");
    await f.db.update(companySkillTestRuns).set({ status: "failed" }).where(eq(companySkillTestRuns.id, f.runs[1]!.id));
    const failed = await compare(request, f, { ...body, requestId: randomUUID() }); expect(failed.report.results[1].blocked).toBe("run_not_succeeded");
    await f.db.update(companySkillTestRuns).set({ status: "succeeded", inputSnapshot: "not the frozen input" }).where(eq(companySkillTestRuns.id, f.runs[1]!.id));
    const mismatch = await compare(request, f, { ...body, requestId: randomUUID() }); expect(mismatch.report.results[1].blocked).toBe("input_snapshot_mismatch"); expect(mismatch.report.eligibleForHumanReview).toBe(false);
    await f.db.update(companySkillTestRuns).set({ inputSnapshot: f.input.content.trim(), agentConfigSnapshot: { adapterType: "process", model: "different-fixture-model" } }).where(eq(companySkillTestRuns.id, f.runs[1]!.id));
    const context = await compare(request, f, { ...body, requestId: randomUUID() }); expect(context.report.results[1].blocked).toBe("execution_context_mismatch");
    await f.db.update(companySkillTestRuns).set({ inputSnapshot: f.input.content.trim(), deletedAt: new Date() }).where(eq(companySkillTestRuns.id, f.runs[1]!.id));
    expect((await request.post(`${f.root}/comparisons`, { data: { ...body, requestId: randomUUID() } })).status()).toBe(404);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});

test("cost evidence is issue-scoped, decimal-safe, unknown when absent and immutable after capture", async ({ request }) => {
  const f = await fixture(request); try {
    const dataset = await freeze(request, f), body = { ...comparison(f, dataset.id), maxCandidateCostCents: 1 };
    const unknown = await compare(request, f, body); expect(unknown.report.candidate.totalCostCents).toBeNull(); expect(unknown.report.blockers).toContain("candidate_cost_unknown");
    await f.db.insert(costEvents).values(f.runs.map(run => ({ companyId: f.companyId, agentId: f.agent.id, issueId: run.issueId, provider: "fixture-record", model: "no-execution", costCents: 0.125, costStatus: "reported", billingType: "metered", occurredAt: new Date() })));
    const known = await compare(request, f, { ...body, requestId: randomUUID() }); expect(known.report.candidate.totalCostCents).toBe(0.125); expect(known.report.baseline.totalCostCents).toBe(0.125); expect(known.report.eligibleForHumanReview).toBe(true);
    await f.db.insert(costEvents).values({ companyId: f.companyId, agentId: f.agent.id, issueId: f.runs[1]!.issueId, provider: "fixture-record", model: "no-execution", costCents: 0, costStatus: "unpriced", billingType: "metered", occurredAt: new Date() });
    const unpriced = await compare(request, f, { ...body, requestId: randomUUID() }); expect(unpriced.report.candidate.totalCostCents).toBeNull(); expect(unpriced.report.eligibleForHumanReview).toBe(false);
    expect((await (await request.get(`${f.root}/comparisons/${unknown.id}`)).json()).report.candidate.totalCostCents).toBeNull();
    expect((await (await request.get(`${f.root}/comparisons/${known.id}`)).json()).report.candidate.totalCostCents).toBe(0.125);
    const { id: _id, ...duplicateRun } = f.runs[0]!;
    await expect(f.db.insert(companySkillTestRuns).values({ ...duplicateRun, id: randomUUID() })).rejects.toMatchObject({ cause: { code: "23505" } });
  } finally { await f.db.$client.end({ timeout: 1 }); }
});

test("real DB route contract accepts administrator session actors and denies members, agents and foreign sessions", async ({ request }) => {
  const f = await fixture(request); try {
    await freeze(request, f);
    // The disposable server is local_trusted. These explicit actor fixtures test
    // the route contract against the real DB, not a real authentication/SSO flow.
    function app(actor: Express.Request["actor"]) {
      const server = express(); server.use(express.json()); server.use((req, _res, next) => { req.actor = actor; next(); }); server.use(mimouseEvaluationRoutes(f.db));
      server.use((error: unknown, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => { res.status(error instanceof HttpError ? error.status : 500).json({ error: "denied" }); }); return server;
    }
    const owner: Express.Request["actor"] = { type: "board", source: "session", userId: "fixture-owner", companyIds: [f.companyId], memberships: [{ companyId: f.companyId, membershipRole: "owner", status: "active" }] };
    const base = `/companies/${f.companyId}/skill-evaluations`;
    expect((await supertest(app(owner)).get(`${base}/datasets`)).status).toBe(200);
    for (const actor of [
      { ...owner, memberships: [{ companyId: f.companyId, membershipRole: "member", status: "active" }] },
      { ...owner, companyIds: [randomUUID()], memberships: [] },
      { type: "agent", source: "agent_key", companyId: f.companyId, agentId: f.agent.id },
    ] as Express.Request["actor"][]) {
      expect((await supertest(app(actor)).get(`${base}/datasets`)).status).toBe(403);
      expect((await supertest(app(actor)).post(`${base}/datasets`).send({ ...f.datasetInput, requestId: randomUUID() })).status).toBe(403);
    }
    expect((await f.db.select().from(datasets).where(eq(datasets.companyId, f.companyId))).length).toBe(1);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});


test("normal sequential upstream test runs retain completed superseded evidence without waking an agent", async ({ request }) => {
  const f = await fixture(request, false); try {
    const dataset = await freeze(request, f), skills = companySkillService(f.db);
    // The real upstream API disallows paused agents. Direct DB fixtures keep all
    // lifecycle scheduling inactive; the only wake dependency below is a NO-OP.
    await f.db.update(agents).set({ status: "idle" }).where(eq(agents.id, f.agent.id));
    let wakeInvocations = 0;
    const deps: Parameters<typeof skills.createTestRun>[4] = {
      createHarnessIssue: async input => {
        const [row] = await f.db.insert(issues).values({ ...input, companyId: f.companyId }).returning({ id: issues.id });
        return row!;
      },
      wakeHarnessIssue: async () => { wakeInvocations += 1; return { fixtureNoOp: true }; },
    };
    const create = (versionId: string) => skills.createTestRun(f.companyId, f.skill.id, { inputId: f.input.id, agentId: f.agent.id, skillVersionId: versionId, templateId: null }, { type: "system" }, deps);
    const completeFixture = async (run: Awaited<ReturnType<typeof create>>, outputSnapshot: string) => {
      // Explicit recorded fixtures only: no provider, runner, heartbeat or model.
      await f.db.update(companySkillTestRuns).set({ outputSnapshot }).where(eq(companySkillTestRuns.id, run.id));
      await skills.completeTestRunForIssue({ companyId: f.companyId, issueId: run.issueId, outcome: "succeeded" });
    };
    const baseline = await create(f.versions[0]!.id); await completeFixture(baseline, "wrong\noutput");
    const candidate = await create(f.versions[1]!.id); await completeFixture(candidate, "correct\noutput");
    const [historical] = await f.db.select().from(companySkillTestRuns).where(eq(companySkillTestRuns.id, baseline.id));
    expect(historical!.supersededAt).not.toBeNull(); expect(historical!.status).toBe("succeeded"); expect(historical!.inputSnapshot).toBe(f.input.content.trim());
    expect(dataset.cases[0]).toMatchObject({ id: f.input.id, input: f.input.content.trim(), sourceInputSnapshot: f.input.content });
    const evidenceResponse = await request.get(`${f.root}/skills/${f.skill.id}/evidence`); expect(evidenceResponse.status()).toBe(200);
    const evidence = await evidenceResponse.json(); expect(evidence.runs.find((run: { id: string }) => run.id === baseline.id)).toMatchObject({ status: "succeeded", supersededAt: historical!.supersededAt!.toISOString() });
    const body = { ...comparison(f, dataset.id), runIds: [baseline.id, candidate.id] };
    const report = await compare(request, f, body);
    expect(report.report).toMatchObject({ eligibleForHumanReview: true, passCountDelta: 1, baseline: { passed: 0, blocked: 0 }, candidate: { passed: 1, blocked: 0 } });
    expect(report.report.results[0].supersededAt).toBe(historical!.supersededAt!.toISOString());
    // Superseding an unfinished run really cancels it upstream; preserving it
    // as history must not turn that cancelled snapshot into successful evidence.
    const unfinished = await create(f.versions[0]!.id), newest = await create(f.versions[1]!.id); await completeFixture(newest, "correct\noutput");
    const [cancelled] = await f.db.select().from(companySkillTestRuns).where(eq(companySkillTestRuns.id, unfinished.id));
    expect(cancelled!.supersededAt).not.toBeNull(); expect(cancelled!.status).toBe("cancelled");
    const blocked = await compare(request, f, { ...body, requestId: randomUUID(), runIds: [unfinished.id, newest.id] });
    expect(blocked.report.results[0].blocked).toBe("run_not_succeeded"); expect(blocked.report.eligibleForHumanReview).toBe(false);
    expect(wakeInvocations).toBe(4);
    expect(await f.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.companyId))).toHaveLength(0);
    // Previously persisted comparison remains pinned despite later superseding.
    expect((await (await request.get(`${f.root}/comparisons/${report.id}`)).json()).report).toEqual(report.report);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});

/** Explicit session actor + actual persisted membership, not an SSO/login proof. */
async function lineageFixture(request: APIRequestContext) {
  const f = await fixture(request, false), userId = randomUUID();
  await f.db.insert(authUsers).values({ id: userId, name: "Lineage reviewer", email: `${userId}@fixture.invalid`, createdAt: new Date(), updatedAt: new Date() });
  const [membership] = await f.db.insert(companyMemberships).values({ companyId: f.companyId, principalType: "user", principalId: userId, status: "active", membershipRole: "owner" }).returning();
  const imported = await feedbackInboxService(f.db).import(f.companyId, {
    sourceKind: "manual", sourceInstance: "lineage-fixture", externalId: randomUUID(), title: "Fixture source title",
    text: "UNTRUSTED_SOURCE_DO_NOT_EXECUTE_OR_COPY", product: "Fixture app", softwareVersion: "1.0", commitSha: null, traceId: "fixture-trace", occurredAt: "2026-10-26T00:00:00Z",
  }, userId);
  const owner: Express.Request["actor"] = { type: "board", source: "session", userId, companyIds: [f.companyId], memberships: [{ companyId: f.companyId, membershipRole: "owner", status: "active" }] };
  function app(actor: Express.Request["actor"] = owner) {
    const server = express(); server.use(express.json()); server.use((req, _res, next) => { req.actor = actor; next(); }); server.use(mimouseEvaluationRoutes(f.db));
    server.use((error: unknown, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => { res.status(error instanceof HttpError ? error.status : 500).json({ error: "denied" }); }); return server;
  }
  const base = `/companies/${f.companyId}/skill-evaluations/datasets`;
  const previewBody = { skillId: f.skill.id, inputId: f.input.id, feedbackId: imported.item.id, expected: "correct\noutput" };
  const rows = () => f.db.select().from(datasets).where(eq(datasets.companyId, f.companyId));
  const audits = async () => (await f.db.select().from(activityLog).where(eq(activityLog.companyId, f.companyId))).filter(row => row.action === "evaluation.dataset.created");
  async function preview() { const response = await supertest(app()).post(`${base}/feedback-preview`).send(previewBody); expect(response.status, JSON.stringify(response.body)).toBe(200); return response.body as { previewDigest: string }; }
  const draft = (previewDigest: string) => ({ ...f.datasetInput, cases: [{ inputId: f.input.id, expected: previewBody.expected, feedback: { feedbackId: imported.item.id, previewDigest, reviewed: true as const } }] });
  return { ...f, owner, userId, membership, source: imported.item, app, base, previewBody, preview, draft, rows, audits };
}

test("feedback lineage real DB API freezes exact references once and never alters the actual test input", async ({ request }) => {
  const f = await lineageFixture(request); try {
    const preview = await f.preview(), body = f.draft(preview.previewDigest);
    expect(await f.rows()).toHaveLength(0); expect(await f.audits()).toHaveLength(0);
    const responses = await Promise.all([supertest(f.app()).post(f.base).send(body), supertest(f.app()).post(f.base).send(body)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    const [a, b] = responses.map(response => response.body); expect(a.item).toEqual(b.item);
    expect(a.item.cases[0]).toMatchObject({ id: f.input.id, input: f.input.content.trim(), sourceInputSnapshot: f.input.content, expected: f.previewBody.expected,
      feedbackSource: { companyId: f.companyId, feedbackId: f.source.id, sourceInstance: f.source.sourceInstance, externalId: f.source.externalId, softwareVersion: "1.0", commitSha: null,
        sourceTrust: "quarantined", reproductionStatus: "not_reproduced", previewDigest: preview.previewDigest, reviewedBy: f.userId } });
    expect(a.item.cases[0].feedbackSource.sanitizedSnapshotDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(a.item.datasetHash).toBe(digest(a.item.cases)); expect(await f.rows()).toHaveLength(1); expect(await f.audits()).toHaveLength(1);
    expect(JSON.stringify(await f.rows())).not.toContain("UNTRUSTED_SOURCE"); expect(JSON.stringify(await f.audits())).not.toContain(f.input.content);
    expect((await supertest(f.app()).post(f.base).send({ ...body, name: "changed payload" })).status).toBe(409);
    // Same production input-building method as real skill tests, but a fixture
    // NO-OP wake dependency: no model, provider, heartbeat or external account.
    await f.db.update(agents).set({ status: "idle" }).where(eq(agents.id, f.agent.id));
    let wakes = 0;
    const skills = companySkillService(f.db);
    const run = await skills.createTestRun(f.companyId, f.skill.id, { inputId: f.input.id, agentId: f.agent.id, skillVersionId: f.versions[0]!.id, templateId: null }, { type: "system" }, {
      createHarnessIssue: async input => { const [row] = await f.db.insert(issues).values({ ...input, companyId: f.companyId }).returning({ id: issues.id }); return row!; },
      wakeHarnessIssue: async () => { wakes += 1; return { fixtureNoOp: true }; },
    });
    const [storedRun] = await f.db.select().from(companySkillTestRuns).where(eq(companySkillTestRuns.id, run.id));
    const [harness] = await f.db.select().from(issues).where(eq(issues.id, run.issueId));
    expect(storedRun!.inputSnapshot).toBe(f.input.content.trim()); expect(JSON.stringify(storedRun)).not.toContain(f.source.id);
    expect(harness!.description).not.toContain("UNTRUSTED_SOURCE"); expect(harness!.description).not.toContain(f.source.id);
    expect(wakes).toBe(1); expect(await f.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.companyId))).toHaveLength(0);
    const legacy = await freeze(request, { ...f, datasetInput: { ...f.datasetInput, requestId: randomUUID() } });
    expect(legacy.cases[0]).toEqual({ id: f.input.id, input: f.input.content.trim(), sourceInputSnapshot: f.input.content, expected: f.previewBody.expected });
    expect(legacy.datasetHash).toBe(digest(legacy.cases)); expect(legacy.cases[0].feedbackSource).toBeUndefined();
  } finally { await f.db.$client.end({ timeout: 1 }); }
});

test("feedback lineage real DB rejects non-human, foreign and stale snapshots without dataset or audit writes", async ({ request }) => {
  const f = await lineageFixture(request), other = await lineageFixture(request); try {
    const preview = await f.preview(), body = f.draft(preview.previewDigest);
    for (const actor of [
      { ...f.owner, source: "local_implicit" },
      { ...f.owner, companyIds: [other.companyId], memberships: [{ companyId: other.companyId, membershipRole: "owner", status: "active" }] },
      { ...f.owner, memberships: [{ companyId: f.companyId, membershipRole: "member", status: "active" }] },
      { type: "agent", source: "agent_key", companyId: f.companyId, agentId: f.agent.id },
    ] as Express.Request["actor"][]) {
      expect((await supertest(f.app(actor)).post(`${f.base}/feedback-preview`).send(f.previewBody)).status).toBe(403);
      expect((await supertest(f.app(actor)).post(f.base).send(body)).status).toBe(403);
    }
    for (const patch of [{ feedbackId: other.source.id }, { inputId: other.input.id }]) expect((await supertest(f.app()).post(`${f.base}/feedback-preview`).send({ ...f.previewBody, ...patch })).status).toBe(404);
    expect((await supertest(f.app()).post(f.base).send({ ...body, cases: [{ ...body.cases[0], feedback: { ...body.cases[0]!.feedback, feedbackId: other.source.id } }] })).status).toBe(404);
    await f.db.update(companySkillTestInputs).set({ content: "changed after preview" }).where(eq(companySkillTestInputs.id, f.input.id));
    expect((await supertest(f.app()).post(f.base).send(body)).status).toBe(409);
    await f.db.update(companySkillTestInputs).set({ content: f.input.content }).where(eq(companySkillTestInputs.id, f.input.id));
    // Keep the old raw-import contentDigest unchanged: current sanitized content
    // must independently bind the confirmation snapshot.
    await f.db.update(mimouseFeedbackInbox).set({ body: "changed sanitized source" }).where(eq(mimouseFeedbackInbox.id, f.source.id));
    expect((await supertest(f.app()).post(f.base).send(body)).status).toBe(409);
    const current = await f.preview();
    await f.db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.id, f.membership.id));
    expect((await supertest(f.app()).post(f.base).send(f.draft(current.previewDigest))).status).toBe(403);
    expect((await supertest(f.app()).post(`${f.base}/feedback-preview`).send(f.previewBody)).status).toBe(403);
    expect(await f.rows()).toHaveLength(0); expect(await f.audits()).toHaveLength(0);
  } finally { await other.db.$client.end({ timeout: 1 }); await f.db.$client.end({ timeout: 1 }); }
});

test("feedback lineage audit failure rolls the real transaction back and the same request can recover", async ({ request }) => {
  const f = await lineageFixture(request), name = `fixture_lineage_audit_${randomUUID().replaceAll("-", "")}`;
  let functionCreated = false, triggerCreated = false;
  try {
    const body = f.draft((await f.preview()).previewDigest);
    await f.db.$client.unsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.company_id = '${f.companyId}'::uuid AND NEW.action = 'evaluation.dataset.created' THEN RAISE EXCEPTION 'fixture lineage audit failure'; END IF;
      RETURN NEW; END; $$`); functionCreated = true;
    await f.db.$client.unsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION ${name}()`); triggerCreated = true;
    expect((await supertest(f.app()).post(f.base).send(body)).status).toBe(500);
    expect(await f.rows()).toHaveLength(0); expect(await f.audits()).toHaveLength(0);
    await f.db.$client.unsafe(`DROP TRIGGER ${name} ON activity_log`); triggerCreated = false;
    const created = await supertest(f.app()).post(f.base).send(body); expect(created.status).toBe(201);
    const retry = await supertest(f.app()).post(f.base).send(body); expect(retry.status).toBe(200); expect(retry.body.item).toEqual(created.body.item);
    expect(await f.rows()).toHaveLength(1); expect(await f.audits()).toHaveLength(1);
  } finally {
    try { if (triggerCreated) await f.db.$client.unsafe(`DROP TRIGGER IF EXISTS ${name} ON activity_log`);
      if (functionCreated) await f.db.$client.unsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    } finally { await f.db.$client.end({ timeout: 1 }); }
  }
});
