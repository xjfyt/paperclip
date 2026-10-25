import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { createDb, projects, issues, executionWorkspaces, mimouseCodingDeliveries as deliveries } from "../../packages/db/src/index.js";
import { secretService } from "../../server/src/services/secrets.js";
import { codingService } from "../../server/src/services/mimouse-coding/service.js";
import { GitLabError } from "../../server/src/services/mimouse-coding/gitlab.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq } = await import(require.resolve("drizzle-orm"));
test("durable SCM: unknown MR creation is not repeated; new SHA invalidates review", async ({ request }) => {
  const company = await (await request.post("/api/companies", { data: { name: `coding ${Date.now()}` } })).json();
  const issue = await (await request.post(`/api/companies/${company.id}/issues`, { data: { title: "Fixture coding delivery", status: "backlog" } })).json();
  const db = createDb("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip"); const head = "a".repeat(40);
  try {
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "SCM fixture" }).returning();
    const [workspace] = await db.insert(executionWorkspaces).values({ companyId: company.id, projectId: project.id, sourceIssueId: issue.id, mode: "isolated", strategyType: "git_worktree", name: "fixture", branchName: "paperclip/fixture", repoUrl: "https://git.example/group/repo.git", cwd: "/tmp/fixture-not-executed" }).returning();
    await db.update(issues).set({ executionWorkspaceId: workspace.id }).where(eq(issues.id, issue.id));
    const secret = await secretService(db).create(company.id, { name: "gitlab-fixture", provider: "local_encrypted", value: JSON.stringify({ token: "fixture-no-live-access" }) });
    const [delivery] = await db.insert(deliveries).values({ companyId: company.id, issueId: issue.id, workspaceId: workspace.id, secretRef: secret.id, gitlabOrigin: "https://git.example", projectId: 1, sourceBranch: "paperclip/fixture", targetBranch: "main", baseSha: "b".repeat(40), headSha: head }).returning();
    let creations = 0; let listed: any[] = []; let remoteSha = head;
    const fake = {
      capabilities: async () => ({ version: "12.3.5", advancedApprovals: "unknown" }),
      project: async () => ({ id: 1, http_url_to_repo: "https://git.example/group/repo.git", ssh_url_to_repo: "", default_branch: "main" }),
      branch: async () => ({ name: "paperclip/fixture", commit: { id: head }, protected: false }),
      listMergeRequests: async () => listed,
      createMergeRequest: async () => { creations++; throw new GitLabError("gitlab_transport_unconfirmed", true); },
      mergeRequest: async () => ({ iid: 1, sha: remoteSha, state: "opened" }),
      pipelines: async () => [{ id: 3, sha: head, status: "success" }], pipeline: async () => ({ id: 3, sha: head, status: "success" }), jobs: async () => [],
    };
    const service = codingService(db, { client: (() => fake) as any });
    await expect(service.openMr(company.id, delivery.id, head, "Fixture")).rejects.toThrow("mr_creation_requires_reconciliation");
    await expect(service.openMr(company.id, delivery.id, head, "Fixture")).rejects.toThrow("mr_creation_unconfirmed"); expect(creations).toBe(1);
    listed = [{ iid: 1, sha: head, state: "opened" }];
    expect((await service.openMr(company.id, delivery.id, head, "Fixture")).iid).toBe(1); expect(creations).toBe(1);
    await db.update(deliveries).set({ reviewedSha: head, evidence: [{ commitSha: head, command: "fixture check", exitCode: 0, startedAt: "2026-10-25T00:00:00Z", finishedAt: "2026-10-25T00:01:00Z", logRef: "fixture/log", status: "passed" }] }).where(eq(deliveries.id, delivery.id));
    expect((await service.sync(company.id, delivery.id)).gate.readyForReleaseCandidate).toBe(true);
    remoteSha = "c".repeat(40); expect((await service.sync(company.id, delivery.id)).gate.readyForReleaseCandidate).toBe(false);
    expect((await db.select().from(deliveries).where(eq(deliveries.id, delivery.id)))[0].reviewedSha).toBeNull();
    const view = await request.get(`/api/companies/${company.id}/coding`); expect(view.ok(), await view.text()).toBeTruthy(); expect(JSON.stringify(await view.json())).not.toContain("fixture-no-live-access");
  } finally { await db.$client.end({ timeout: 1 }); }
});
