import { test, expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  activityLog, agents, authSessions, companies, companyMemberships, companySecrets, executionWorkspaces,
  heartbeatRunEvents, heartbeatRuns, issues, mimouseCodingDeliveries as deliveries,
  mimouseFeedbackInbox, mimouseResearchCandidates as candidates, projects, routineRuns, routines,
} from "../../packages/db/src/index.js";
import { createFixtureDb } from "./fixture-db.js";

const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { and, eq } = await import(require.resolve("drizzle-orm"));
type FixtureDb = Awaited<ReturnType<typeof createFixtureDb>>;
type Session = { http: APIRequestContext; userId: string; sessionId: string };
let db: FixtureDb, owner: Session, reviewer: Session;
const sessions: APIRequestContext[] = [];

// Only DB seeding is direct. Every recovery read/write below traverses the
// compiled entry, real BetterAuth cookie/session middleware and registered route.
// No source router/service/auth import, injected actor, model or provider call.
async function json(response: APIResponse, status = 200) {
  expect(response.status(), `${response.url()}: ${await response.text()}`).toBe(status);
  return response.json();
}
async function signIn(http: APIRequestContext): Promise<Session> {
  const email = `${randomUUID()}@recovery-fixture.invalid`;
  await json(await http.post("/api/auth/sign-up/email", { data: {
    email, password: `inert-fixture-${randomUUID()}`, name: "Recovery HTTP fixture",
  } }));
  const identity = await json(await http.get("/api/auth/get-session"));
  expect(identity.user.email).toBe(email);
  // The app's get-session route deliberately returns this derived public ID;
  // check the source, then verify the corresponding real persisted session.
  expect(identity.session.id).toBe(`paperclip:session:${identity.user.id}`);
  const stored = await db.select({ id: authSessions.id, expiresAt: authSessions.expiresAt }).from(authSessions)
    .where(eq(authSessions.userId, identity.user.id));
  expect(stored).toHaveLength(1); expect(stored[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  return { http, userId: identity.user.id, sessionId: stored[0].id };
}
async function company(name: string) {
  const id = randomUUID();
  await db.insert(companies).values({ id, name, issuePrefix: `C${id.slice(0, 7)}` });
  await db.insert(companyMemberships).values([owner, reviewer].map(session => ({
    companyId: id, principalType: "user", principalId: session.userId, membershipRole: "owner", status: "active",
  })));
  return id;
}

test.beforeAll(async ({ playwright, request }) => {
  // Fail rather than silently proving source routes or local_implicit actors.
  expect(process.env.PAPERCLIP_MIMOUSE_TEST_COMPILED, "Run with the compiled fixture").toBe("true");
  expect(process.env.PAPERCLIP_MIMOUSE_TEST_AUTHENTICATED, "Run the separate authenticated recovery suite").toBe("true");
  const health = await json(await request.get("/api/health"));
  expect(health.deploymentMode).toBe("authenticated");
  expect((await request.get("/api/auth/get-session")).status()).toBe(401);
  const unknownCompany = randomUUID(), unknownRun = randomUUID();
  for (const response of [
    await request.get(`/api/companies/${unknownCompany}/coding`),
    await request.post(`/api/companies/${unknownCompany}/feedback-inbox/run-log-preview`, { data: { runId: unknownRun, eventSeq: 1 } }),
    await request.get(`/api/companies/${unknownCompany}/research-routines/${randomUUID()}/history`),
  ]) expect([401, 403]).toContain(response.status());
  db = await createFixtureDb(); // Verifies the existing fixture's real PG data_directory.
  for (let i = 0; i < 2; i++) sessions.push(await playwright.request.newContext({
    baseURL: "http://127.0.0.1:3100", extraHTTPHeaders: { origin: "http://127.0.0.1:3100" },
  }));
  owner = await signIn(sessions[0]); reviewer = await signIn(sessions[1]);
  expect(owner.userId).not.toBe(reviewer.userId); expect(owner.sessionId).not.toBe(reviewer.sessionId);
});
test.afterAll(async () => {
  try { for (const http of sessions) await http.dispose(); }
  finally { await db?.$client.end({ timeout: 1 }); }
});

test("compiled coding list applies privacy before limit and keeps readable filtered pages", async () => {
  const companyId = await company("Compiled coding privacy fixture");
  const [project] = await db.insert(projects).values({ companyId, name: "Inert coding project" }).returning();
  const [issue, hidden] = await db.insert(issues).values([
    { companyId, projectId: project.id, title: "Readable delivery", createdByUserId: owner.userId },
    { companyId, projectId: project.id, title: "PRIVATE_CODING_SENTINEL", visibility: "private", createdByUserId: reviewer.userId, responsibleUserId: reviewer.userId },
  ]).returning();
  const [workspace] = await db.insert(executionWorkspaces).values({
    companyId, projectId: project.id, name: "Never executed", mode: "isolated", strategyType: "git_worktree",
    cwd: process.env.PAPERCLIP_MIMOUSE_TEST_HOME!, repoUrl: "https://gitlab.example.invalid/fixture/repo.git", branchName: "fixture/never-run",
  }).returning();
  const [secret] = await db.insert(companySecrets).values({
    companyId, key: `inert-${randomUUID()}`, name: "Not resolvable", provider: "local_encrypted", scope: "company", status: "active", latestVersion: 1,
  }).returning();
  const base = { companyId, issueId: issue.id, workspaceId: workspace.id, secretRef: secret.id,
    gitlabOrigin: "https://gitlab.example.invalid", projectId: 42, baseSha: "b".repeat(40), sourceBranch: "fixture/never-run", targetBranch: "main" };
  const visible = await db.insert(deliveries).values([
    { ...base, headSha: "a".repeat(40), createdAt: new Date("2026-10-28T01:00:03Z") },
    { ...base, gitlabOrigin: `${base.gitlabOrigin}/`, headSha: "c".repeat(40), createdAt: new Date("2026-10-28T01:00:02Z") },
    { ...base, gitlabOrigin: "https://other.example.invalid", headSha: "d".repeat(40), createdAt: new Date("2026-10-28T01:00:01Z") },
  ]).returning();
  // More than the old fixed 100-row window: post-limit filtering would falsely
  // return an empty first page even though older readable deliveries exist.
  const privateRows = await db.insert(deliveries).values(Array.from({ length: 105 }, (_, i) => ({
    ...base, issueId: hidden.id, headSha: i.toString(16).padStart(40, "0"), createdAt: new Date("2026-10-28T02:00:00Z"),
  }))).returning({ id: deliveries.id });
  const url = `/api/companies/${companyId}/coding`;
  const firstResponse = await owner.http.get(`${url}?limit=2`), first = await json(firstResponse);
  expect(firstResponse.headers()["cache-control"]).toBe("no-store");
  expect(first.deliveries.map((row: { id: string }) => row.id)).toEqual(visible.slice(0, 2).map(row => row.id));
  expect(first.pagination).toMatchObject({ hasMore: true, nextCursor: visible[1].id });
  expect(first.projectSummary).toMatchObject({ scope: "authorized_delivery_page", deliveryCount: 2,
    projects: [{ gitlabOrigin: base.gitlabOrigin, projectId: 42, deliveryCount: 2, readyForRelease: false }] });
  const last = await json(await owner.http.get(`${url}?limit=2&after=${first.pagination.nextCursor}`));
  expect(last.deliveries.map((row: { id: string }) => row.id)).toEqual([visible[2].id]);
  expect(last.pagination).toMatchObject({ hasMore: false, nextCursor: null });
  const filtered = await json(await owner.http.get(url, { params: { gitlabOrigin: `${base.gitlabOrigin}/`, projectId: "42" } }));
  expect(filtered.deliveries.map((row: { id: string }) => row.id)).toEqual(visible.slice(0, 2).map(row => row.id));
  const byIssue = await json(await owner.http.get(url, { params: { issueId: issue.id } }));
  expect(byIssue.deliveries).toHaveLength(3);
  for (const cursor of [privateRows[0].id, randomUUID()]) expect((await owner.http.get(`${url}?after=${cursor}`)).status()).toBe(404);
  expect((await owner.http.get(url, { params: { after: visible[2].id, gitlabOrigin: base.gitlabOrigin, projectId: "42" } })).status()).toBe(404);
  expect((await owner.http.get(`${url}?projectId=42`)).status()).toBe(400);
  const output = JSON.stringify([first, last, filtered, byIssue]);
  for (const value of [hidden.id, privateRows[0].id, secret.id, "PRIVATE_CODING_SENTINEL"]) expect(output).not.toContain(value);
});

test("compiled run-log session preview and confirmation import one metadata-only reference without granting source access", async () => {
  const companyId = await company("Compiled run-log fixture");
  const [agent] = await db.insert(agents).values({ companyId, name: "Inert run-log agent", adapterType: "process", status: "paused" }).returning();
  const [issue] = await db.insert(issues).values({ companyId, title: "PRIVATE_TASK_SENTINEL", description: "PRIVATE_BODY_SENTINEL",
    visibility: "private", createdByUserId: owner.userId, responsibleUserId: owner.userId }).returning();
  const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent.id, scopeKind: "issue", issueId: issue.id, status: "failed",
    contextSnapshot: { secret: "CONTEXT_SENTINEL" }, stdoutExcerpt: "STDOUT_SENTINEL", stderrExcerpt: "STDERR_SENTINEL", logRef: "/private/LOG_PATH_SENTINEL" }).returning();
  await db.insert(heartbeatRunEvents).values({ companyId, agentId: agent.id, runId: run.id, seq: 1,
    eventType: "PROVIDER_SENTINEL", message: "MESSAGE_SENTINEL", payload: { secret: "PAYLOAD_SENTINEL" } });
  const url = `/api/companies/${companyId}/feedback-inbox`, selection = { runId: run.id, eventSeq: 1 };
  const response = await owner.http.post(`${url}/run-log-preview`, { data: selection }), preview = await json(response);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(preview.reference).toMatchObject({ companyId, runId: run.id, eventSeq: 1, softwareVersion: "unknown", commitSha: null, reproduction: "not_performed", contentIncluded: false });
  expect(JSON.stringify(preview)).not.toContain("SENTINEL");
  expect(await db.select().from(mimouseFeedbackInbox).where(eq(mimouseFeedbackInbox.companyId, companyId))).toHaveLength(0);
  const confirmation = { ...selection, previewDigest: preview.previewDigest, confirm: true };
  expect((await owner.http.post(`${url}/run-log-import`, { data: { ...confirmation, confirm: false } })).status()).toBe(400);
  const receipt = await json(await owner.http.post(`${url}/run-log-import`, { data: confirmation }), 201);
  const replay = await json(await owner.http.post(`${url}/run-log-import`, { data: confirmation }));
  expect(receipt.duplicate).toBe(false); expect(replay).toMatchObject({ duplicate: true, item: { id: receipt.item.id } });
  const source = await json(await owner.http.get(`${url}/${receipt.item.id}/run-log-source`));
  expect(source.reference).toEqual(preview.reference);
  // Another genuine company-owner session can inspect the quarantined reference,
  // but that candidate is not permission to the original private task/run.
  await json(await reviewer.http.get(`${url}/${receipt.item.id}`));
  expect((await reviewer.http.post(`${url}/run-log-preview`, { data: selection })).status()).toBe(404);
  expect((await reviewer.http.get(`${url}/${receipt.item.id}/run-log-source`)).status()).toBe(404);
  expect((await reviewer.http.post(`${url}/run-log-import`, { data: confirmation })).status()).toBe(404);
  const rows = await db.select().from(mimouseFeedbackInbox).where(eq(mimouseFeedbackInbox.companyId, companyId));
  const audits = await db.select().from(activityLog).where(and(eq(activityLog.companyId, companyId), eq(activityLog.action, "feedback.run_log.imported")));
  expect(rows).toHaveLength(1); expect(audits).toHaveLength(1);
  expect(JSON.parse(rows[0].body)).toEqual(preview.reference); expect(audits[0].runId).toBeNull();
  expect(JSON.stringify([rows, audits, receipt, replay, source])).not.toContain("SENTINEL");
  expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId))).toHaveLength(1);
});

test("compiled research history reads paused receipts without dispatch and rejects hidden cursors", async () => {
  const companyId = await company("Compiled paused research fixture");
  const [project] = await db.insert(projects).values({ companyId, name: "Open research source", visibility: "open" }).returning();
  const [routine] = await db.insert(routines).values({ companyId, projectId: project.id, title: "Paused research", status: "paused" }).returning();
  const [agent] = await db.insert(agents).values({ companyId, name: "Never dispatched", adapterType: "process", status: "paused" }).returning();
  const [receipt, older, hidden] = await db.insert(routineRuns).values([
    { companyId, routineId: routine.id, source: "schedule", status: "issue_created", createdAt: new Date("2026-10-28T02:00:00Z"), triggerPayload: { secret: "TRIGGER_SENTINEL" } },
    { companyId, routineId: routine.id, source: "schedule", status: "received", createdAt: new Date("2026-10-28T01:00:00Z") },
    { companyId, routineId: routine.id, source: "schedule", status: "issue_created", createdAt: new Date("2026-10-28T03:00:00Z") },
  ]).returning();
  const [issue, privateIssue] = await db.insert(issues).values([
    { companyId, projectId: project.id, title: "Research execution", originKind: "routine_execution", originId: routine.id, originRunId: receipt.id, status: "done" },
    { companyId, projectId: project.id, title: "PRIVATE_RESEARCH_SENTINEL", visibility: "private", createdByUserId: reviewer.userId, responsibleUserId: reviewer.userId },
  ]).returning();
  await db.update(routineRuns).set({ linkedIssueId: issue.id }).where(eq(routineRuns.id, receipt.id));
  await db.update(routineRuns).set({ linkedIssueId: privateIssue.id }).where(eq(routineRuns.id, hidden.id));
  const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId: agent.id, scopeKind: "issue", issueId: issue.id, status: "failed", stdoutExcerpt: "RUNTIME_SENTINEL" }).returning();
  const [report] = await db.insert(candidates).values({ companyId, requestId: run.id, requestDigest: "a".repeat(64), actorId: `agent:${agent.id}`, evidenceHash: "b".repeat(64), evidence: {
    title: "REPORT_SENTINEL", product: "MiWork", currentState: "Manual", proposedState: "Review", recommendation: "Human review",
    sources: [{ url: "https://example.invalid/not-fetched", retrievedAt: "2026-10-28T00:00:00Z", evidence: "SOURCE_SENTINEL", product: "MiWork", gap: "Fixture", suggestion: "Review" }],
    redacted: false, redactionVersion: 1, evidenceMode: "agent_report", provenance: { companyId, routineId: routine.id, routineRunId: receipt.id, issueId: issue.id, runId: run.id, agentId: agent.id,
      bindingUpdatedAt: new Date().toISOString(), reportBodyHash: "c".repeat(64), sourceVerification: "agent_report", disposition: "quarantined" },
  } }).returning();
  await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
  const url = `/api/companies/${companyId}/research-routines/${routine.id}`;
  const before = { runs: await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId)),
    receipts: await db.select().from(routineRuns).where(eq(routineRuns.companyId, companyId)),
    audits: await db.select().from(activityLog).where(eq(activityLog.companyId, companyId)) };
  const response = await owner.http.get(`${url}/history?limit=1`), first = await json(response);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(first).toMatchObject({ agentDispatched: false, externalSourcesVerified: false, nextBeforeId: receipt.id,
    items: [{ id: receipt.id, reportState: "received", attempts: [{ id: run.id, status: "failed" }],
      reports: [{ candidateId: report.id, sourceVerification: "agent_report", disposition: "quarantined" }], agentDispatched: false, externalSourcesVerified: false }] });
  const last = await json(await owner.http.get(`${url}/history?limit=1&beforeId=${first.nextBeforeId}`));
  expect(last).toMatchObject({ items: [{ id: older.id, reportState: "not_received" }], nextBeforeId: null });
  for (const cursor of [hidden.id, randomUUID()]) expect((await owner.http.get(`${url}/history?beforeId=${cursor}`)).status()).toBe(404);
  expect((await owner.http.get(`${url}/history?limit=21`)).status()).toBe(400);
  expect((await owner.http.put(url, { data: { product: "MiWork", enabled: true } })).status()).toBe(403);
  const output = JSON.stringify([first, last]);
  for (const value of [hidden.id, privateIssue.id, "SENTINEL"]) expect(output).not.toContain(value);
  expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, companyId))).toEqual(before.runs);
  expect(await db.select().from(routineRuns).where(eq(routineRuns.companyId, companyId))).toEqual(before.receipts);
  expect(await db.select().from(activityLog).where(eq(activityLog.companyId, companyId))).toEqual(before.audits);
  expect((await db.select().from(routines).where(eq(routines.id, routine.id)))[0].status).toBe("paused");
});
