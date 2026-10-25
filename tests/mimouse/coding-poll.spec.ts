import { expect, test, type APIRequestContext } from "@playwright/test";
import { createRequire } from "node:module";
import { createFixtureDb } from "./fixture-db.js";
import { projects, companies, executionWorkspaces, mimouseCodingDeliveries as deliveries } from "../../packages/db/src/index.js";
import { secretService } from "../../server/src/services/secrets.js";
import { codingService } from "../../server/src/services/mimouse-coding/service.js";
import { codingPoller } from "../../server/src/services/mimouse-coding/poller.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq } = await import(require.resolve("drizzle-orm"));
const head = "a".repeat(40);
let savedFlag: string | undefined;
test.beforeEach(() => { savedFlag = process.env.PAPERCLIP_GITLAB_POLL_ENABLED; process.env.PAPERCLIP_GITLAB_POLL_ENABLED = "true"; });
test.afterEach(() => { if (savedFlag === undefined) delete process.env.PAPERCLIP_GITLAB_POLL_ENABLED; else process.env.PAPERCLIP_GITLAB_POLL_ENABLED = savedFlag; });
async function fixture(request: APIRequestContext) {
  const company = await (await request.post("/api/companies", { data: { name: `poll ${Date.now()}` } })).json();
  const issue = await (await request.post(`/api/companies/${company.id}/issues`, { data: { title: "Poll fixture", status: "backlog" } })).json();
  const db = await createFixtureDb();
  const [project] = await db.insert(projects).values({ companyId: company.id, name: "Poll fixture" }).returning();
  const [workspace] = await db.insert(executionWorkspaces).values({ companyId: company.id, projectId: project.id, sourceIssueId: issue.id, mode: "isolated", strategyType: "git_worktree", name: "fixture", branchName: "paperclip/poll", cwd: "/tmp/not-executed" }).returning();
  const secret = await secretService(db).create(company.id, { name: "poll-fixture", provider: "local_encrypted", value: JSON.stringify({ token: "fixture-no-live-access" }) });
  const [row] = await db.insert(deliveries).values({ companyId: company.id, issueId: issue.id, workspaceId: workspace.id, secretRef: secret.id, gitlabOrigin: "https://git.example", projectId: 1, sourceBranch: "paperclip/poll", targetBranch: "main", baseSha: "b".repeat(40), headSha: head, mrIid: 1, operationState: "mr_created", nextSyncAt: new Date(0) }).returning();
  const state = { mr: "opened", pipeline: "success", reads: 0 };
  const fake = { mergeRequest: async () => { state.reads++; return { iid: 1, sha: head, state: state.mr }; }, pipelines: async () => [{ id: 1, sha: head, status: state.pipeline }], pipeline: async () => ({ id: 1, sha: head, status: state.pipeline }) };
  const deps = { client: (() => fake) as any };
  return { db, company, row, fake, deps, state, read: async () => (await db.select().from(deliveries).where(eq(deliveries.id, row.id)))[0] };
}

test("CI poll cursor survives restart, excludes parallel workers and stops for a closed MR", async ({ request }) => {
  const f = await fixture(request); let release!: () => void; let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const original = f.fake.mergeRequest; f.fake.mergeRequest = async () => { entered(); await gate; return original(); };
  try {
    const first = codingPoller(f.db, f.deps).tick(f.company.id); await enteredPromise;
    expect(await codingPoller(f.db, f.deps).tick(f.company.id)).toBe(false); release(); expect(await first).toBe(true);
    expect(f.state.reads).toBe(1); expect((await f.read()).syncLease).toBeNull();
    expect(await codingPoller(f.db, f.deps).tick(f.company.id)).toBe(false);
    f.state.mr = "closed"; await f.db.update(deliveries).set({ nextSyncAt: new Date(0) }).where(eq(deliveries.id, f.row.id));
    expect(await codingPoller(f.db, f.deps).tick(f.company.id)).toBe(true); expect((await f.read()).nextSyncAt).toBeNull();
    expect(await codingPoller(f.db, f.deps).tick(f.company.id)).toBe(false);
  } finally { release?.(); await f.db.$client.end({ timeout: 1 }); }
});

test("expired read-only sync cannot overwrite a newer worker or its evidence", async ({ request }) => {
  const f = await fixture(request); let release!: () => void; let entered!: () => void; let calls = 0;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  f.fake.mergeRequest = async () => { if (++calls === 1) { entered(); await gate; return { iid: 1, sha: "c".repeat(40), state: "opened" }; } return { iid: 1, sha: head, state: "opened" }; };
  try {
    const service = codingService(f.db, f.deps); const late = service.sync(f.company.id, f.row.id).then(value => ({ value }), error => ({ error })); await enteredPromise;
    await f.db.update(deliveries).set({ syncLeaseExpiresAt: new Date(0) }).where(eq(deliveries.id, f.row.id)); f.state.pipeline = "failed";
    const current = await service.sync(f.company.id, f.row.id); expect(current.gate.readyForReleaseCandidate).toBe(false);
    release(); expect((await late as { error: { code: string } }).error.code).toBe("sync_lease_lost");
    const row = await f.read(); expect((row.remoteEvidence.pipeline as { status: string }).status).toBe("failed"); expect((row.remoteEvidence.mr as { sha: string }).sha).toBe(head); expect(row.syncLastCode).toBeNull();
  } finally { release?.(); await f.db.$client.end({ timeout: 1 }); }
});

test("failed poll clears cached green evidence, backs off, and respects company and operator pause", async ({ request }) => {
  const f = await fixture(request);
  try {
    await f.db.update(deliveries).set({ remoteEvidence: { mr: { iid: 1, sha: head, state: "opened" }, pipeline: { id: 1, sha: head, status: "success" } } }).where(eq(deliveries.id, f.row.id));
    f.fake.mergeRequest = async () => { throw Error("private-vendor-detail-must-not-persist"); };
    expect(await codingPoller(f.db, f.deps).tick(f.company.id)).toBe(true);
    const row = await f.read(); expect(row.remoteEvidence.pipeline).toBeNull(); expect(row.syncLastCode).toBe("sync_failed"); expect(row.nextSyncAt!.getTime()).toBeGreaterThan(Date.now() + 240000); expect(JSON.stringify(row)).not.toContain("private-vendor-detail");
    expect(await codingPoller(f.db, f.deps).tick(f.company.id)).toBe(false);
    await f.db.update(deliveries).set({ nextSyncAt: new Date(0) }).where(eq(deliveries.id, f.row.id));
    await f.db.update(companies).set({ status: "paused" }).where(eq(companies.id, f.company.id)); expect(await codingPoller(f.db, f.deps).tick(f.company.id)).toBe(false);
    await f.db.update(companies).set({ status: "active" }).where(eq(companies.id, f.company.id)); process.env.PAPERCLIP_GITLAB_POLL_ENABLED = "false"; expect(await codingPoller(f.db, f.deps).tick(f.company.id)).toBe(false);
  } finally { await f.db.update(deliveries).set({ nextSyncAt: null }).where(eq(deliveries.id, f.row.id)); await f.db.$client.end({ timeout: 1 }); }
});

test("a review or evidence change during a provider read is rechecked before returning its gate", async ({ request }) => {
  const f = await fixture(request); let release!: () => void; let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const original = f.fake.mergeRequest; f.fake.mergeRequest = async () => { entered(); await gate; return original(); };
  try {
    const evidence = [{ commitSha: head, command: "fixture-test", exitCode: 0, startedAt: "2026-10-25T00:00:00Z", finishedAt: "2026-10-25T00:00:01Z", logRef: "fixture/log", status: "passed" }];
    await f.db.update(deliveries).set({ reviewedSha: head, evidence }).where(eq(deliveries.id, f.row.id));
    const pending = codingService(f.db, f.deps).sync(f.company.id, f.row.id); await enteredPromise;
    await f.db.update(deliveries).set({ reviewedSha: null, evidence: [{ ...evidence[0], exitCode: 1, status: "failed" }] }).where(eq(deliveries.id, f.row.id));
    release(); expect((await pending).gate.readyForReleaseCandidate).toBe(false);
  } finally { release?.(); await f.db.$client.end({ timeout: 1 }); }
});
