import { verifyLocalCodingHead } from "../services/mimouse-coding/readonly-git.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, chmod, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { fixedCommitDiff, reviewBinding, reviewedHead, reviewReceipt, type ReviewDelivery } from "../services/mimouse-coding/diff-review.js";
const exec = promisify(execFile); const roots: string[] = [];
const project = { id: 3, http_url_to_repo: "https://git.example/team/repo.git", ssh_url_to_repo: "git@git.example:team/repo.git" };
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(content = "new value\n", extra?: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "coding-diff-")); roots.push(cwd);
  const git = async (...args: string[]) => (await exec("git", args, { cwd })).stdout.trim();
  await git("init", "-b", "paperclip/review"); await git("config", "user.name", "Fixture"); await git("config", "user.email", "fixture@example.test");
  await git("remote", "add", "origin", project.http_url_to_repo);
  await writeFile(path.join(cwd, "source.txt"), "old value\n"); await git("add", "."); await git("commit", "-m", "base"); const baseSha = await git("rev-parse", "HEAD");
  await writeFile(path.join(cwd, "source.txt"), content); await extra?.(cwd); await git("add", "."); await git("commit", "-m", "head"); const headSha = await git("rev-parse", "HEAD");
  const row: ReviewDelivery = { id: "delivery", companyId: "company", issueId: "issue", workspaceId: "workspace", gitlabOrigin: "https://git.example", projectId: 3, baseSha, headSha, sourceBranch: "paperclip/review", targetBranch: "main", evidence: [], artifactManifest: null };
  const workspace = { cwd, repoUrl: project.http_url_to_repo, branchName: row.sourceBranch };
  return { cwd, git, row, workspace, diff: () => fixedCommitDiff(row, workspace, project) };
}
describe("source-pinned coding review", () => {
  it("reads a real patch with exact base/head and binds consent to its digest", async () => {
    const f = await fixture(); const diff = await f.diff();
    expect(diff.complete).toBe(true); expect(diff.patch).toContain("-old value"); expect(diff.patch).toContain("+new value"); expect(diff.fileCount).toBe(1);
    expect(await f.diff()).toEqual(diff);
    const receipt = reviewReceipt(f.row, diff, diff.digest, "reviewer");
    expect(reviewedHead({ ...f.row, reviewedSha: f.row.headSha, reviewReceipt: receipt, reviewerUserId: "reviewer" })).toBe(f.row.headSha);
    expect(() => reviewReceipt(f.row, diff, "0".repeat(64), "reviewer")).toThrow("review_digest_stale");
    expect(reviewedHead({ ...f.row, reviewedSha: f.row.headSha })).toBeNull();
  });
  it.each(["companyId", "id", "issueId", "workspaceId", "gitlabOrigin", "projectId", "baseSha", "headSha", "sourceBranch", "targetBranch", "evidence", "artifactManifest"] as const)("invalidates consent when %s changes", async key => {
    const f = await fixture(); const diff = await f.diff(); const receipt = reviewReceipt(f.row, diff, diff.digest, "reviewer");
    const changed = { ...f.row, reviewedSha: f.row.headSha, reviewReceipt: receipt, reviewerUserId: "reviewer", [key]: key === "projectId" ? 4 : key === "evidence" ? [{ status: "passed" }] : key === "artifactManifest" ? { sha256: "changed bytes" } : "changed" };
    expect(reviewedHead(changed)).toBeNull(); expect(() => reviewReceipt(changed, diff, diff.digest, "reviewer")).toThrow("review_digest_stale");
  });
  it("blocks a manifest from another project or commit", async () => {
    const f = await fixture();
    const diff = await fixedCommitDiff({ ...f.row, artifactManifest: { project: "other", commitSha: f.row.headSha } }, f.workspace, project);
    expect(diff.complete).toBe(false); expect(diff.blockers).toContain("artifact_manifest_identity_mismatch");
  });
  it("normalizes JSONB key ordering without losing array order", async () => {
    const f = await fixture(); expect(reviewBinding({ ...f.row, evidence: [{ a: 1, b: 2 }] })).toBe(reviewBinding({ ...f.row, evidence: [{ b: 2, a: 1 }] }));
    expect(reviewBinding({ ...f.row, evidence: [1, 2] })).not.toBe(reviewBinding({ ...f.row, evidence: [2, 1] }));
  });
  it("rejects another project in the same origin and a spoofed local origin", async () => {
    const f = await fixture(); await expect(fixedCommitDiff(f.row, f.workspace, { ...project, id: 4 })).rejects.toThrow("project_identity_mismatch");
    await expect(fixedCommitDiff(f.row, f.workspace, { ...project, http_url_to_repo: "https://git.example/team/other.git" })).rejects.toThrow("repository_identity_mismatch");
    await f.git("remote", "set-url", "origin", "https://git.example/team/other.git"); await expect(f.diff()).rejects.toThrow("repository_identity_mismatch");
  });
  it("rejects dirty trees and later commits", async () => {
    const f = await fixture(); await writeFile(path.join(f.cwd, "source.txt"), "unreviewed\n"); await expect(f.diff()).rejects.toThrow("workspace_not_clean");
    await expect(verifyLocalCodingHead(f.workspace, f.row.baseSha, f.row.headSha)).rejects.toThrow("workspace_not_clean");
    await f.git("add", "."); await f.git("commit", "-m", "later"); await expect(f.diff()).rejects.toThrow("workspace_head_changed");
  });
  it("rejects an incorrect or non-ancestor base", async () => {
    const f = await fixture(); await expect(fixedCommitDiff({ ...f.row, baseSha: "b".repeat(40) }, f.workspace, project)).rejects.toThrow();
    await f.git("checkout", "--orphan", "other"); await f.git("add", "."); await f.git("commit", "-m", "unrelated"); const unrelated = await f.git("rev-parse", "HEAD"); await f.git("checkout", f.row.sourceBranch);
    await expect(fixedCommitDiff({ ...f.row, baseSha: unrelated }, f.workspace, project)).rejects.toThrow();
  });
  it("never accepts a binary diff as a full text review", async () => {
    const f = await fixture("binary\0data"); const diff = await f.diff(); expect(diff.blockers).toContain("binary_diff_requires_external_review"); expect(diff.complete).toBe(false);
    expect(() => reviewReceipt(f.row, diff, diff.digest, "reviewer")).toThrow("diff_incomplete");
  });
  it("bounds patch bytes and does not expose a truncated patch as complete", async () => {
    const f = await fixture("x".repeat(600000)); const diff = await f.diff(); expect(diff.blockers).toContain("diff_byte_limit"); expect(diff.complete).toBe(false); expect(diff.patch).toBe("");
  });
  it("bounds file count", async () => {
    const f = await fixture("changed\n", async cwd => { for (let n = 0; n < 200; n++) await writeFile(path.join(cwd, `${n}.txt`), "file\n"); });
    const diff = await f.diff(); expect(diff.fileCount).toBe(201); expect(diff.blockers).toContain("diff_file_limit"); expect(diff.complete).toBe(false);
  });
  it("never invokes a repository fsmonitor command", async () => {
    const f = await fixture();
    const hook = path.join(f.cwd, ".git", "fixture-monitor"); const marker = path.join(f.cwd, ".git", "monitor-ran");
    await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\n`); await chmod(hook, 0o755); await f.git("config", "core.fsmonitor", hook);
    expect((await f.diff()).complete).toBe(true); await verifyLocalCodingHead(f.workspace, f.row.baseSha, f.row.headSha); await expect(access(marker)).rejects.toThrow();
  });
  it.each(["clean", "process"])("never invokes configured %s filters while refreshing status", async driver => {
    const f = await fixture("changed\n", async cwd => { await writeFile(path.join(cwd, ".gitattributes"), "source.txt filter=unsafe\n"); });
    const marker = path.join(f.cwd, ".git", "filter-ran"); const hook = path.join(f.cwd, ".git", "fixture-filter");
    await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\ncat\n`); await chmod(hook, 0o755);
    await f.git("config", `filter.unsafe.${driver}`, hook); await f.git("config", "filter.unsafe.required", "true");
    await writeFile(path.join(f.cwd, "source.txt"), "changed\n");
    expect((await f.diff()).complete).toBe(true); await verifyLocalCodingHead(f.workspace, f.row.baseSha, f.row.headSha); await expect(access(marker)).rejects.toThrow();
  });
  it("blocks nested gitlink workspaces before running recursive status", async () => {
    const f = await fixture(); await f.git("update-index", "--add", "--cacheinfo", `160000,${f.row.baseSha},nested`);
    await f.git("commit", "-m", "gitlink"); f.row.headSha = await f.git("rev-parse", "HEAD");
    await expect(f.diff()).rejects.toThrow("submodule_workspace_requires_external_review");
    await expect(verifyLocalCodingHead(f.workspace, f.row.baseSha, f.row.headSha)).rejects.toThrow("submodule_workspace_requires_external_review");
  });
  it("does not execute configured external diff commands", async () => {
    const f = await fixture(); await f.git("config", "diff.external", "command-that-must-not-exist"); expect((await f.diff()).complete).toBe(true);
  });
});
