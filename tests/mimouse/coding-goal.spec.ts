import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createFixtureDb } from "./fixture-db.js";
import { activityLog, agentWakeupRequests, companyMemberships, documentRevisions, documents, issueDocuments, issues, mimouseCodingDeliveries } from "../../packages/db/src/index.js";
import { mimouseCodingRoutes } from "../../server/src/routes/mimouse-coding.js";
import { errorHandler } from "../../server/src/middleware/error-handler.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const express = require("express"); const supertest = require("supertest"); const { and, eq } = await import(require.resolve("drizzle-orm"));
const goal = { schemaVersion: 1, problemValue: "Preserve the reported behavior", acceptanceScenarios: ["Reproduce before fixing"],
  allowedRepositories: [{ repoUrl: "https://git.example/repo.git", paths: ["src", "tests"] }], baseSha: "a".repeat(40),
  testCommands: ["echo literal; never executed"], budget: { maxCostCents: 0 }, maxRepairRounds: 2,
  artifactRequirements: ["Local manifest"], humanReviewActions: ["Push, MR, merge and release"] };
// Real isolated PostgreSQL and HTTP. No agents, workspaces, commands or provider calls.
test("coding goal stores nine fields, serializes revisions and stays planning-only under privacy and audit failures", async ({ request }) => {
  const db = await createFixtureDb(); const owner = randomUUID(); const foreignOwner = randomUUID();
  const company = await (await request.post("/api/companies", { data: { name: "Coding goal fixture" } })).json();
  const other = await (await request.post("/api/companies", { data: { name: "Other coding goal company" } })).json();
  const [issue] = await db.insert(issues).values({ companyId: company.id, title: "Goal before workspace", status: "backlog" }).returning();
  await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: owner, membershipRole: "admin", status: "active" });
  const admin = { type: "board", source: "session", userId: owner, companyIds: [company.id, other.id], memberships: [{ companyId: company.id, membershipRole: "admin", status: "active" }, { companyId: other.id, membershipRole: "admin", status: "active" }] };
  let actor: any = admin; const app = express(); app.use(express.json()); app.use((req: any, _res: any, next: any) => { req.actor = actor; next(); });
  app.use("/api", mimouseCodingRoutes(db)); app.use(errorHandler); const http = supertest(app); const url = `/api/companies/${company.id}/coding/tasks/${issue.id}/goal`;
  const trigger = `coding_goal_${randomUUID().replaceAll("-", "")}`;
  try {
    const initial = await http.get(url); expect(initial.status).toBe(200); expect(initial.headers["cache-control"]).toBe("no-store"); expect(initial.body.goal).toBeNull();
    expect((await http.put(url).send({ goal: { ...goal, execute: true }, baseRevisionId: null })).status).toBe(400);
    const concurrent = await Promise.all([http.put(url).send({ goal, baseRevisionId: null }), http.put(url).send({ goal, baseRevisionId: null })]);
    expect(concurrent.map((response: any) => response.status)).toEqual([200, 200]); expect(concurrent[0].body.revisionId).toBe(concurrent[1].body.revisionId);
    const r1 = concurrent[0].body.revisionId; expect(concurrent[0].body).toMatchObject({ goal, planningOnly: true });
    const [link] = await db.select().from(issueDocuments).where(eq(issueDocuments.issueId, issue.id));
    expect(await db.select().from(documentRevisions).where(eq(documentRevisions.documentId, link.documentId))).toHaveLength(1);
    const changed = await Promise.all(["first", "second"].map(problemValue => http.put(url).send({ goal: { ...goal, problemValue }, baseRevisionId: r1 })));
    expect(changed.map((response: any) => response.status).sort()).toEqual([200, 409]);
    const current = await http.get(url); expect(current.body.revisionId).not.toBe(r1);
    const logs = await db.select().from(activityLog).where(and(eq(activityLog.companyId, company.id), eq(activityLog.action, "coding.goal.saved")));
    expect(logs).toHaveLength(2); expect(JSON.stringify(logs)).not.toContain(goal.testCommands[0]);
    expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, company.id))).toHaveLength(0);
    expect(await db.select().from(mimouseCodingDeliveries).where(eq(mimouseCodingDeliveries.companyId, company.id))).toHaveLength(0);
    const [unchanged] = await db.select().from(issues).where(eq(issues.id, issue.id)); expect(unchanged.executionWorkspaceId).toBeNull(); expect(unchanged.status).toBe("backlog");
    // Role checked before resource lookup, including revoked membership despite stale actor data.
    await db.update(companyMemberships).set({ status: "inactive" }).where(eq(companyMemberships.principalId, owner));
    expect((await http.get(url)).status).toBe(403); expect((await http.put(url).send({ goal, baseRevisionId: r1 })).status).toBe(403);
    await db.update(companyMemberships).set({ status: "active" }).where(eq(companyMemberships.principalId, owner));
    actor = { ...admin, memberships: [{ companyId: company.id, status: "active", membershipRole: "member" }] }; expect((await http.get(url)).status).toBe(403);
    actor = { type: "agent", companyId: company.id, source: "agent_key" }; expect((await http.get(url)).status).toBe(403);
    actor = { ...admin, isInstanceAdmin: true }; expect((await http.get(`/api/companies/${other.id}/coding/tasks/${issue.id}/goal`)).status).toBe(404);
    actor = admin;
    const [parent] = await db.insert(issues).values({ companyId: company.id, title: "Private parent", status: "backlog", visibility: "private", createdByUserId: foreignOwner }).returning();
    await db.update(issues).set({ privacyParentIssueId: parent.id }).where(eq(issues.id, issue.id));
    expect((await http.get(url)).status).toBe(404); expect((await http.put(url).send({ goal, baseRevisionId: r1 })).status).toBe(404);
    await db.update(issues).set({ privacyParentIssueId: null }).where(eq(issues.id, issue.id));
    await db.update(documents).set({ lockedAt: new Date() }).where(eq(documents.id, link.documentId));
    expect((await http.put(url).send({ goal: { ...goal, problemValue: "locked edit" }, baseRevisionId: current.body.revisionId })).status).toBe(409);
    await db.update(documents).set({ lockedAt: null }).where(eq(documents.id, link.documentId));
    // A database-enforced audit failure must roll back the document revision too.
    await db.$client.unsafe(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.company_id = '${company.id}' AND NEW.action = 'coding.goal.saved' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$`);
    await db.$client.unsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
    expect((await http.put(url).send({ goal: { ...goal, problemValue: "must roll back" }, baseRevisionId: current.body.revisionId })).status).toBe(500);
    expect((await http.get(url)).body).toEqual(current.body);
    expect(await db.select().from(documentRevisions).where(eq(documentRevisions.documentId, link.documentId))).toHaveLength(2);
  } finally {
    await db.$client.unsafe(`DROP TRIGGER IF EXISTS ${trigger} ON activity_log`);
    await db.$client.unsafe(`DROP FUNCTION IF EXISTS ${trigger}()`);
    await db.$client.end({ timeout: 1 });
  }
});
