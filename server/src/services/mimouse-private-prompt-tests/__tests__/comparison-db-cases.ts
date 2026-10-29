import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { agents, authSessions, authUsers, companies, companyMemberships, companySkills, companySkillVersions, mimousePrompts,
  mimousePromptRevisions, mimouseEvaluationDatasets, heartbeatRuns, issues, agentWakeupRequests, costEvents, type Db } from "@paperclipai/db";
import { mimousePrivatePromptTests as tests } from "@paperclipai/db/schema/mimouse_private_prompt_tests";
import { comparisonFixture } from "../comparison-fixture.js";
import { privatePromptComparisonService } from "../comparison-service.js";
import { privatePromptHttpFixture } from "../http-fixture.js";
import { privateConfigDigest } from "../profile.js";
/** Called only by the marked, owned integration DB. Inserts synthetic sealed
 * history directly: proves read authorization/scoring, NOT runtime execution. */
export async function verifyPrivateHistoricalComparison(db: Db) {
  const e = comparisonFixture(), { actor } = e, now = new Date();
  await db.insert(authUsers).values({ id: actor.userId, name: "Comparison fixture", email: "comparison@example.invalid", createdAt: now, updatedAt: now });
  await db.insert(authSessions).values({ id: actor.sessionId, userId: actor.userId, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000), createdAt: now, updatedAt: now });
  await db.insert(companies).values({ id: actor.companyId, name: "Comparison fixture", issuePrefix: "CMP" });
  const [member] = await db.insert(companyMemberships).values({ companyId: actor.companyId, principalType: "user", principalId: actor.userId, membershipRole: "owner", status: "active" }).returning();
  await db.insert(agents).values({ id: e.tests[0].agentId, companyId: actor.companyId, name: "Never executed", role: "engineer", status: "idle", adapterType: "process" });
  await db.insert(companySkills).values({ id: e.version.companySkillId, companyId: actor.companyId, key: "comparison", slug: "comparison", name: "Comparison", markdown: "Synthetic fixture" });
  await db.insert(companySkillVersions).values({ ...e.version, revisionNumber: 1 });
  await db.insert(mimousePrompts).values({ id: e.promptId, companyId: actor.companyId, promptKey: "comparison" });
  for (const r of e.revisions) await db.insert(mimousePromptRevisions).values({ ...r, requestId: randomUUID(), requestDigest: "fixture", actorUserId: actor.userId });
  await db.insert(mimouseEvaluationDatasets).values({ ...e.dataset, requestId: randomUUID(), requestDigest: "fixture", name: "Comparison", actorId: actor.userId });
  for (const issue of e.issues) await db.insert(issues).values({ ...issue, title: "Synthetic historical comparison", status: "done" });
  for (const t of e.tests) await db.insert(agentWakeupRequests).values({ id: t.wakeupRequestId!, companyId: actor.companyId, agentId: t.agentId, source: "on_demand", status: "completed", runId: t.heartbeatRunId });
  for (const run of e.runs) await db.insert(heartbeatRuns).values(run);
  await db.insert(tests).values(e.tests);
  const service = privatePromptComparisonService(db), compare = () => service.compare(actor, e.promptId, e.input);
  // The agent's current config deliberately has no resemblance to history.
  const unknown = await compare();
  expect(unknown.candidate.passed).toBe(1); expect(unknown.candidate.totalCostCents).toBe(null);
  expect(unknown.eligibleForHumanReview).toBe(false);
  for (const t of e.tests) await db.insert(costEvents).values({ companyId: actor.companyId, agentId: t.agentId, issueId: t.issueId,
    heartbeatRunId: t.heartbeatRunId, provider: "fixture", model: "fixture", costCents: 0.125, billingType: "api", costStatus: "reported", occurredAt: now });
  async function state() {
    return db.execute(sql`select
      (select jsonb_agg(to_jsonb(t) order by id) from mimouse_private_prompt_tests t) as tests,
      (select count(*) from mimouse_evaluation_comparisons) as reports,
      (select count(*) from activity_log) as activity,
      (select count(*) from agent_wakeup_requests) as wakes,
      (select count(*) from heartbeat_runs) as runs,
      (select count(*) from cost_events) as costs`);
  }
  const before = await state();
  const good = await compare(); expect(good.eligibleForHumanReview).toBe(true);
  expect(good.candidate.totalCostCents).toBe(0.125); expect(await state()).toEqual(before);
  const upper = { ...e.input, datasetId: e.input.datasetId.toUpperCase(), baselineRevisionId: e.input.baselineRevisionId.toUpperCase(),
    candidateRevisionId: e.input.candidateRevisionId.toUpperCase(), testIds: e.input.testIds.map(id => id.toUpperCase()) };
  expect((await service.compare(actor, e.promptId, upper)).reportHash).toBe(good.reportHash);
  expect(JSON.stringify(good)).not.toMatch(/SENTINEL|WRONG_TRIMMED|fixed-fixture/);
  const fractional = [0.1, 0.2, 0.3].map((costCents, index) => ({ id: `0000000${index + 1}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    companyId: actor.companyId, agentId: e.tests[1].agentId, issueId: e.tests[1].issueId, heartbeatRunId: e.tests[1].heartbeatRunId,
    provider: "fixture", model: "fixture", costCents, billingType: "api", costStatus: "reported", occurredAt: now }));
  await db.insert(costEvents).values([...fractional].reverse()); const ordered = await compare();
  await db.delete(costEvents).where(inArray(costEvents.id, fractional.map(r => r.id)));
  await db.insert(costEvents).values(fractional); expect((await compare()).reportHash).toBe(ordered.reportHash);
  await db.delete(costEvents).where(inArray(costEvents.id, fractional.map(r => r.id)));
  // Excess historical text is rejected before selecting/scoring its contents.
  await db.update(mimouseEvaluationDatasets).set({ cases: [{ ...e.dataset.cases[0], input: "x".repeat(1_000_001) }] }).where(eq(mimouseEvaluationDatasets.id, e.dataset.id));
  await expect(compare()).rejects.toMatchObject({ status: 422, message: "private_comparison_resource_size" });
  await db.update(mimouseEvaluationDatasets).set({ cases: e.dataset.cases }).where(eq(mimouseEvaluationDatasets.id, e.dataset.id));
  await db.update(companySkillVersions).set({ fileInventory: [{ path: "SKILL.md", kind: "skill", content: "x".repeat(256001) }] }).where(eq(companySkillVersions.id, e.version.id));
  await expect(compare()).rejects.toMatchObject({ status: 422, message: "private_comparison_resource_size" });
  await db.update(companySkillVersions).set({ fileInventory: e.version.fileInventory }).where(eq(companySkillVersions.id, e.version.id));
  await db.update(tests).set({ privateResult: { summary: null, resultJson: { result: "x".repeat(160001) } } }).where(eq(tests.id, e.tests[1].id));
  await expect(compare()).rejects.toMatchObject({ status: 422, message: "private_comparison_result_size" });
  await db.update(tests).set({ privateResult: e.tests[1].privateResult }).where(eq(tests.id, e.tests[1].id));
  // Each resource is individually under its cap; their combined request is not.
  const extraRows = Array.from({ length: 16 }, () => ({ ...e.tests[0], id: randomUUID(), requestId: randomUUID(),
    status: "failed" as const, issueId: null, wakeupRequestId: null, heartbeatRunId: null, attemptId: null, prepared: null, spawnedAt: null,
    privateResult: { summary: null, resultJson: { result: "x".repeat(120000) } } }));
  await db.insert(tests).values(extraRows);
  await db.update(mimouseEvaluationDatasets).set({ cases: [{ ...e.dataset.cases[0], input: "x".repeat(900000) }] }).where(eq(mimouseEvaluationDatasets.id, e.dataset.id));
  await db.update(companySkillVersions).set({ fileInventory: [{ path: "SKILL.md", kind: "skill", content: "x".repeat(250000) }] }).where(eq(companySkillVersions.id, e.version.id));
  await expect(service.compare(actor, e.promptId, { ...e.input, testIds: [...e.input.testIds, ...extraRows.map(r => r.id)] }))
    .rejects.toMatchObject({ status: 422, message: "private_comparison_resource_size" });
  await db.delete(tests).where(inArray(tests.id, extraRows.map(r => r.id)));
  await db.update(mimouseEvaluationDatasets).set({ cases: e.dataset.cases }).where(eq(mimouseEvaluationDatasets.id, e.dataset.id));
  await db.update(companySkillVersions).set({ fileInventory: e.version.fileInventory }).where(eq(companySkillVersions.id, e.version.id));
  const configs: unknown[] = [];
  const observing = new Proxy(db, { get(target, key, receiver) {
    if (key !== "transaction") return Reflect.get(target, key, receiver);
    return (fn: Parameters<Db["transaction"]>[0], config: Parameters<Db["transaction"]>[1]) => target.transaction(async tx => {
      configs.push(config);
      expect((await tx.execute(sql`show transaction_read_only`))[0].transaction_read_only).toBe("on");
      expect((await tx.execute(sql`show transaction_isolation`))[0].transaction_isolation).toBe("repeatable read");
      return fn(tx);
    }, config);
  } });
  expect((await privatePromptComparisonService(observing).compare(actor, e.promptId, e.input)).reportHash).toBe(good.reportHash);
  expect(configs).toHaveLength(2); expect(await state()).toEqual(before);
  for (const role of ["member", "viewer"]) {
    await db.update(companyMemberships).set({ membershipRole: role }).where(eq(companyMemberships.id, member.id));
    await expect(compare()).rejects.toMatchObject({ status: 403 });
  }
  await db.update(companyMemberships).set({ membershipRole: "admin" }).where(eq(companyMemberships.id, member.id));
  expect((await compare()).eligibleForHumanReview).toBe(true);
  await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.id, member.id));
  await expect(compare()).rejects.toMatchObject({ status: 403 });
  await db.update(companyMemberships).set({ status: "active" }).where(eq(companyMemberships.id, member.id));
  await db.update(authSessions).set({ expiresAt: new Date(0) }).where(eq(authSessions.id, actor.sessionId));
  await expect(compare()).rejects.toMatchObject({ status: 403 });
  await db.update(authSessions).set({ expiresAt: new Date(Date.now() + 3600000) }).where(eq(authSessions.id, actor.sessionId));
  await db.update(companies).set({ status: "archived" }).where(eq(companies.id, actor.companyId));
  await expect(compare()).rejects.toMatchObject({ status: 422 });
  await db.update(companies).set({ status: "active" }).where(eq(companies.id, actor.companyId));
  const userId = randomUUID(), sessionId = randomUUID();
  await db.insert(authUsers).values({ id: userId, name: "Other admin", email: `${userId}@example.invalid`, createdAt: now, updatedAt: now });
  await db.insert(authSessions).values({ id: sessionId, userId, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000), createdAt: now, updatedAt: now });
  await db.insert(companyMemberships).values({ companyId: actor.companyId, principalType: "user", principalId: userId, membershipRole: "admin", status: "active" });
  await expect(service.compare({ ...actor, userId, sessionId }, e.promptId, e.input)).rejects.toMatchObject({ status: 404 });
  const [other] = await db.insert(companies).values({ name: "Foreign fixture", issuePrefix: "FCP" }).returning();
  await db.insert(companyMemberships).values({ companyId: other.id, principalType: "user", principalId: actor.userId, membershipRole: "owner", status: "active" });
  await expect(service.compare({ ...actor, companyId: other.id }, e.promptId, e.input)).rejects.toMatchObject({ status: 404 });
  const original = e.tests[1];
  for (const field of ["configDigest", "secretValueHash", "datasetHash", "skillVersionHash", "revisionHash"] as const) {
    await db.update(tests).set({ [field]: "0".repeat(64) }).where(eq(tests.id, original.id));
    await expect(compare()).rejects.toMatchObject({ status: 422, message: "private_comparison_evidence_invalid" });
    await db.update(tests).set({ [field]: original[field] }).where(eq(tests.id, original.id));
  }
  // Real migration enforces immutable revision history; never disable its trigger.
  await expect(db.update(mimousePromptRevisions).set({ content: "tampered" }).where(eq(mimousePromptRevisions.id, e.revisions[1].id)))
    .rejects.toMatchObject({ cause: { code: "23514" } });
  expect((await compare()).reportHash).toBe(good.reportHash);
  const expanded = [...e.dataset.cases, { id: randomUUID(), input: "Extra fixed case", expected: "Required" }], datasetHash = privateConfigDigest(expanded);
  await db.update(mimouseEvaluationDatasets).set({ cases: expanded, datasetHash }).where(eq(mimouseEvaluationDatasets.id, e.dataset.id));
  await db.update(tests).set({ datasetHash }).where(eq(tests.companyId, actor.companyId));
  const missing = await compare(); expect(missing.candidate).toMatchObject({ cases: 2, passed: 1, blocked: 1 }); expect(missing.eligibleForHumanReview).toBe(false);
  await db.update(mimouseEvaluationDatasets).set({ cases: e.dataset.cases, datasetHash: e.dataset.datasetHash }).where(eq(mimouseEvaluationDatasets.id, e.dataset.id));
  await db.update(tests).set({ datasetHash: e.dataset.datasetHash }).where(eq(tests.companyId, actor.companyId));
  await db.update(costEvents).set({ costStatus: "unpriced" }).where(and(eq(costEvents.companyId, actor.companyId), eq(costEvents.issueId, original.issueId!)));
  expect((await compare()).candidate.totalCostCents).toBe(null);
  await db.update(costEvents).set({ costStatus: "reported" }).where(eq(costEvents.companyId, actor.companyId));
  let transactions = 0;
  const revoking = new Proxy(db, { get(target, key, receiver) {
    if (key !== "transaction") return Reflect.get(target, key, receiver);
    return async (fn: Parameters<Db["transaction"]>[0], config: Parameters<Db["transaction"]>[1]) => {
      const result = await target.transaction(fn, config);
      if (++transactions === 1) await target.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.id, member.id));
      return result;
    };
  } });
  await expect(privatePromptComparisonService(revoking).compare(actor, e.promptId, e.input)).rejects.toMatchObject({ status: 403 });
  expect(transactions).toBe(1); // fresh authorization rejects before callback completion
  await db.update(companyMemberships).set({ status: "active" }).where(eq(companyMemberships.id, member.id));
  const board = { type: "board" as const, source: "session" as const, userId: actor.userId, sessionId: actor.sessionId,
    companyIds: [actor.companyId], memberships: [{ companyId: actor.companyId, status: "active" as const, membershipRole: "admin" }] };
  const http = await privatePromptHttpFixture(db, { owner: board, other: { ...board, userId, sessionId }, agent: { type: "agent", source: "agent_key", agentId: original.agentId, companyId: actor.companyId } });
  try {
    const path = `/api/companies/${actor.companyId}/prompt-registry/${e.promptId}/comparison`, prior = await state();
    const result = await http.call("POST", path, e.input);
    expect(result.status).toBe(200); expect(result.headers["cache-control"]).toBe("no-store"); expect(result.body.reportHash).toBe(good.reportHash);
    expect((await http.call("POST", path, e.input, "other")).status).toBe(404);
    expect((await http.call("POST", path, e.input, "agent")).status).toBe(403);
    expect((await http.call("POST", path, { ...e.input, output: "FORGED_PRIVATE_SENTINEL" })).status).toBe(400);
    expect((await http.call("POST", path, { ...e.input, testIds: [...e.input.testIds, e.input.testIds[0]] })).status).toBe(400);
    expect(await state()).toEqual(prior);
  } finally { await http.close(); }
}
