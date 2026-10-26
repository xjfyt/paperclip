import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { and, eq } = await import(require.resolve("drizzle-orm"));
import { authUsers, companyMemberships, issues, issueRelations, agentWakeupRequests, heartbeatRuns, mimouseResearchCandidates as candidates, mimouseResearchPromotions as promotions } from "../../packages/db/src/index.js";
import { createFixtureDb } from "./fixture-db.js";
import { researchCandidateService } from "../../server/src/services/mimouse-research/service.js";
import { issueService } from "../../server/src/services/issues.js";
function body() { return { requestId: randomUUID(), title: "Research fixture", product: "Example product", currentState: "Manual steps", proposedState: "Reviewed automation",
  recommendation: "Evaluate evidence first", sources: [{ url: "https://docs.example.invalid/guide?token=fixture-secret", retrievedAt: "2026-10-25T04:00:00Z", evidence: "password=fixture-only-secret" }] }; }
function review(hash: string) { return { requestId: randomUUID(), confirm: true as const, expectedEvidenceHash: hash, title: "Human scope", scope: "Implement bounded candidate",
  expectedBenefit: "Reduce coordination (hypothesis)", acceptanceCriteria: ["Fixed regression passes"], dependencyIssueIds: [] as string[] }; }
async function company(request: APIRequestContext) { return (await (await request.post("/api/companies", { data: { name: "Research isolated fixture" } })).json()).id as string; }
async function member(db: Awaited<ReturnType<typeof createFixtureDb>>, companyId: string) {
  const id = randomUUID(); await db.insert(authUsers).values({ id, name: "Research reviewer", email: `${id}@fixture.invalid`, createdAt: new Date(), updatedAt: new Date() });
  await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: id, membershipRole: "owner", status: "active" }); return id;
}
test("manual evidence import is company scoped, redacted and idempotent without a fetch", async ({ request }) => {
  const companyId = await company(request), path = `/api/companies/${companyId}/research-candidates`, raw = body();
  const responses = await Promise.all([request.post(path, { data: raw }), request.post(path, { data: raw })]);
  expect(responses.map(r => r.status()).sort()).toEqual([200, 201]);
  const [a,b] = await Promise.all(responses.map(r => r.json())); expect(a.item.id).toBe(b.item.id);
  expect(a.item.evidence.evidenceMode).toBe("manual_import"); expect(JSON.stringify(a)).not.toContain("fixture-secret"); expect(JSON.stringify(a)).not.toContain("fixture-only-secret");
  expect((await request.post(path, { data: { ...raw, title: "Changed evidence" } })).status()).toBe(409);
  expect((await request.post(path, { data: { ...raw, companyId } })).status()).toBe(400);
  const other = await company(request);
  expect((await request.get(`/api/companies/${other}/research-candidates/${a.item.id}`)).status()).toBe(404);
  expect((await request.get(`/api/companies/${other}/research-candidates?beforeId=${a.item.id}`)).status()).toBe(404);
  expect((await request.post(`${path}/${a.item.id}/promote`, { data: review(a.item.evidenceHash) })).status()).toBe(403);
});
test("one human confirmation creates one private task with real dependency edges and recoverable receipt", async ({ request }) => {
  const companyId = await company(request), db = await createFixtureDb();
  try {
    const actor = await member(db, companyId), svc = researchCandidateService(db), candidate = (await svc.create(companyId, body(), actor)).item;
    const dependency = await issueService(db).create(companyId, { title: "Owned prerequisite", status: "backlog", visibility: "private", createdByUserId: actor, responsibleUserId: actor, actorResponsibleUserId: actor });
    const input = { ...review(candidate.evidenceHash), acceptanceCriteria: ["Fixed regression passes", "Existing permissions remain unchanged"], dependencyIssueIds: [dependency.id] };
    const [a,b] = await Promise.all([svc.promote(companyId, candidate.id, actor, input), svc.promote(companyId, candidate.id, actor, input)]);
    expect(a).toEqual(b); expect(a).toMatchObject({ initialStatus: "backlog", initialVisibility: "private", agentDispatched: false });
    expect((await svc.status(companyId, candidate.id, actor)).receipt).toEqual(a);
    const [issue] = await db.select().from(issues).where(eq(issues.id, a.issueId));
    expect(issue).toMatchObject({ status: "backlog", visibility: "private", responsibleUserId: actor, assigneeAgentId: null, assigneeUserId: null, sourceTrust: { preset: "low_trust_review", disposition: "quarantined" } });
    expect(issue.description).toContain(candidate.evidenceHash); expect(issue.description).toContain("2026-10-25T04:00:00.000Z"); expect(issue.description).not.toContain("fixture-only-secret");
    expect(issue.title).toBe(input.title);
    expect(issue.description).toContain(`## Confirmed scope\n\n${input.scope}`);
    expect(issue.description).toContain(`## Expected benefit (hypothesis)\n\n${input.expectedBenefit}`);
    expect(issue.description).toContain(`1. ${input.acceptanceCriteria[0]}\n\n2. ${input.acceptanceCriteria[1]}`);
    const saved = await db.select().from(promotions).where(eq(promotions.companyId, companyId));
    expect(saved).toHaveLength(1);
    expect(saved[0].review).toEqual({ title: input.title, scope: input.scope, expectedBenefit: input.expectedBenefit,
      acceptanceCriteria: input.acceptanceCriteria, dependencyIssueIds: input.dependencyIssueIds });
    // A new service instance recovers the persisted receipt, not in-memory state.
    expect((await researchCandidateService(db).status(companyId, candidate.id, actor)).receipt).toEqual(a);
    expect(await db.select().from(issueRelations).where(and(eq(issueRelations.issueId, dependency.id), eq(issueRelations.relatedIssueId, a.issueId), eq(issueRelations.type, "blocks")))).toHaveLength(1);
    expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId))).toHaveLength(0);
    await expect(svc.promote(companyId, candidate.id, actor, { ...input, scope: "Changed scope" })).rejects.toThrow("different content");
    await expect(svc.promote(companyId, candidate.id, actor, { ...input, requestId: randomUUID() })).rejects.toThrow("already has");
  } finally { await db.$client.end({ timeout: 1 }); }
});
test("foreign or unreadable private dependencies are not probed into the new task", async ({ request }) => {
  const companyId = await company(request), other = await company(request), db = await createFixtureDb();
  try {
    const actor = await member(db, companyId), otherActor = await member(db, companyId), svc = researchCandidateService(db);
    const privateIssue = await issueService(db).create(companyId, { title: "Unshared private", status: "backlog", visibility: "private", createdByUserId: otherActor, responsibleUserId: otherActor, actorResponsibleUserId: otherActor });
    const foreign = await issueService(db).create(other, { title: "Foreign", status: "backlog" });
    for (const dependency of [privateIssue.id, foreign.id, randomUUID()]) {
      const candidate = (await svc.create(companyId, body(), actor)).item;
      await expect(svc.promote(companyId, candidate.id, actor, { ...review(candidate.evidenceHash), dependencyIssueIds: [dependency] })).rejects.toThrow("Dependency task unavailable");
    }
    expect(await db.select().from(promotions).where(eq(promotions.companyId, companyId))).toHaveLength(0);
    expect(await db.select().from(issues).where(eq(issues.companyId, companyId))).toHaveLength(1);
  } finally { await db.$client.end({ timeout: 1 }); }
});
test("stale evidence, changed evidence and suspended reviewers fail closed", async ({ request }) => {
  const companyId = await company(request), db = await createFixtureDb();
  try {
    const actor = await member(db, companyId), svc = researchCandidateService(db), candidate = (await svc.create(companyId, body(), actor)).item;
    await expect(svc.promote(companyId, candidate.id, actor, review("0".repeat(64)))).rejects.toThrow("stale");
    await db.update(candidates).set({ evidence: { ...candidate.evidence, recommendation: "Unexpected change" } }).where(eq(candidates.id, candidate.id));
    await expect(svc.promote(companyId, candidate.id, actor, review(candidate.evidenceHash))).rejects.toThrow("changed");
    await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.principalId, actor));
    await expect(svc.promote(companyId, candidate.id, actor, review(candidate.evidenceHash))).rejects.toThrow("active company administrator");
    expect(await db.select().from(promotions).where(eq(promotions.companyId, companyId))).toHaveLength(0);
  } finally { await db.$client.end({ timeout: 1 }); }
});
