import { expect, test } from "@playwright/test";
import { mkdtemp, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createDb, projects, issues, executionWorkspaces, companySecrets, mimouseCodingDeliveries as deliveries, mimouseNotificationEndpoints as endpoints, mimouseNotificationSubscriptions as subscriptions, mimouseNotificationDeliveries as notices } from "../../packages/db/src/index.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq } = await import(require.resolve("drizzle-orm"));
test("artifact API hashes local bytes without upgrading signature or release claims", async ({ request }) => {
  const root = await mkdtemp(path.join(tmpdir(), "paperclip-artifact-api-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).trim();
  git("init", "-b", "paperclip/artifact-fixture"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  await writeFile(path.join(root, "artifact.txt"), "fixture artifact bytes\n"); await writeFile(path.join(root, ".gitignore"), "escape\n"); git("add", "."); git("commit", "-m", "test: fixture"); const head = git("rev-parse", "HEAD");
  const company = await (await request.post("/api/companies", { data: { name: `artifacts ${Date.now()}` } })).json();
  const issue = await (await request.post(`/api/companies/${company.id}/issues`, { data: { title: "Artifact fixture", status: "backlog" } })).json();
  const db = createDb("postgres://paperclip:paperclip@127.0.0.1:54329/paperclip");
  try {
    const [project] = await db.insert(projects).values({ companyId: company.id, name: "Artifact fixture" }).returning();
    const [workspace] = await db.insert(executionWorkspaces).values({ companyId: company.id, projectId: project.id, sourceIssueId: issue.id, mode: "isolated", strategyType: "git_worktree", providerType: "local_fs", status: "active", name: "fixture", branchName: "paperclip/artifact-fixture", repoUrl: "https://git.example/group/repo.git", cwd: root }).returning();
    await db.update(issues).set({ executionWorkspaceId: workspace.id }).where(eq(issues.id, issue.id));
    const [secret] = await db.insert(companySecrets).values({ companyId: company.id, name: "fixture", key: company.id }).returning();
    const [delivery] = await db.insert(deliveries).values({ companyId: company.id, issueId: issue.id, workspaceId: workspace.id, secretRef: secret.id, gitlabOrigin: "https://git.example", projectId: 1, sourceBranch: workspace.branchName!, targetBranch: "main", baseSha: head, headSha: head }).returning();
    const [endpoint] = await db.insert(endpoints).values({ companyId: company.id, name: "fixture", kind: "wecom_webhook", config: {}, secretRef: secret.id, secretVersion: 1, targetKey: company.id, enabled: true }).returning();
    await db.insert(subscriptions).values({ companyId: company.id, endpointId: endpoint.id, eventType: "coding.artifact_ready", locale: "es" });
    const body = { headSha: head, version: "fixture-1", artifacts: [{ path: "artifact.txt", platform: "linux", arch: "x86_64", buildJob: "fixture" }] };
    const response = await request.post(`/api/companies/${company.id}/coding/${delivery.id}/artifacts`, { data: body });
    expect(response.ok(), await response.text()).toBeTruthy(); const manifest = await response.json();
    expect(manifest.uploaded).toBe(false); expect(manifest.productionReleased).toBe(false);
    expect(manifest.artifacts[0]).toMatchObject({ signatureStatus: "unknown", testStatus: "not_run", sizeBytes: 23 }); expect(manifest.artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    const again = await request.post(`/api/companies/${company.id}/coding/${delivery.id}/artifacts`, { data: body }); expect(again.ok()).toBe(true);
    expect(await db.select().from(notices).where(eq(notices.companyId, company.id))).toHaveLength(1);
    await symlink("/etc/hostname", path.join(root, "escape"));
    const escaped = await request.post(`/api/companies/${company.id}/coding/${delivery.id}/artifacts`, { data: { ...body, artifacts: [{ ...body.artifacts[0], path: "escape" }] } }); expect(escaped.status()).toBe(422);
  } finally { await db.update(endpoints).set({ enabled: false }).where(eq(endpoints.companyId, company.id)); await db.$client.end({ timeout: 1 }); }
});
