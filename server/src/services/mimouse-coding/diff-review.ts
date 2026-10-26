import { readonlyCodingGit } from "./readonly-git.js";
import { createHash } from "node:crypto";
import { GitLabError } from "./gitlab.js";
const MAX_PATCH_BYTES = 512 * 1024;
const MAX_FILES = 200;
export interface ReviewDelivery {
  id: string; companyId: string; issueId: string; workspaceId: string; gitlabOrigin: string; projectId: number;
  baseSha: string; headSha: string; sourceBranch: string; targetBranch: string;
  evidence: unknown; artifactManifest: unknown; reviewerUserId?: string | null; reviewedSha?: string | null; reviewReceipt?: Record<string, unknown> | null;
}
// Stable JSON survives JSONB key ordering; metadata changes invalidate human consent.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
function digest(value: unknown) { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function reviewBinding(row: ReviewDelivery) {
  return digest(["coding-review-v1", row.companyId, row.id, row.issueId, row.workspaceId, row.gitlabOrigin, row.projectId,
    row.baseSha, row.headSha, row.sourceBranch, row.targetBranch, row.evidence, row.artifactManifest]);
}
export function reviewedHead(row: ReviewDelivery): string | null {
  const receipt = row.reviewReceipt;
  return row.reviewedSha === row.headSha && receipt?.version === 1 && typeof receipt.reviewerUserId === "string" && receipt.reviewerUserId.length > 0 && receipt.reviewerUserId === row.reviewerUserId && receipt.binding === reviewBinding(row)
    && receipt.headSha === row.headSha && typeof receipt.digest === "string" && /^[a-f0-9]{64}$/.test(receipt.digest)
    ? row.headSha : null;
}
export interface CodingDiff {
  baseSha: string; headSha: string; projectId: number; repository: string;
  evidence: unknown; artifactManifest: unknown; digest: string; binding: string; patch: string; fileCount: number; complete: boolean; blockers: string[];
}
export function reviewReceipt(row: ReviewDelivery, diff: CodingDiff, expectedDigest: string, reviewerUserId: string) {
  if (!reviewerUserId.trim()) throw new GitLabError("reviewer_identity_required");
  if (!diff.complete || diff.blockers.length) throw new GitLabError("diff_incomplete");
  if (diff.binding !== reviewBinding(row) || diff.baseSha !== row.baseSha || diff.headSha !== row.headSha || diff.projectId !== row.projectId || diff.digest !== expectedDigest) throw new GitLabError("review_digest_stale");
  return { version: 1, reviewerUserId, binding: diff.binding, digest: diff.digest, headSha: row.headSha, reviewedAt: new Date().toISOString() };
}
export async function fixedCommitDiff(row: ReviewDelivery, workspace: { cwd: string; repoUrl: string; branchName: string }, project: { id: number; http_url_to_repo: string; ssh_url_to_repo: string }): Promise<CodingDiff> {
  if (project.id !== row.projectId) throw new GitLabError("project_identity_mismatch");
  const origin = new URL(row.gitlabOrigin);
  const allowed = [project.http_url_to_repo, project.ssh_url_to_repo].filter(url => {
    if (!url) return false;
    if (url.startsWith("https://") || url.startsWith("http://")) { const parsed = new URL(url); return parsed.origin === origin.origin && !parsed.username && !parsed.password && !parsed.search && !parsed.hash; }
    return url.startsWith(`git@${origin.hostname}:`) && /^[A-Za-z0-9_./-]+$/.test(url.split(":").slice(1).join(":"));
  });
  if (!allowed.includes(workspace.repoUrl)) throw new GitLabError("repository_identity_mismatch");
  if (!/^[a-f0-9]{40}$/.test(row.baseSha) || !/^[a-f0-9]{40}$/.test(row.headSha)) throw new GitLabError("invalid_commit_sha");
  const git = await readonlyCodingGit(workspace.cwd, MAX_PATCH_BYTES);
  // No fetch, external diff, textconv or checkout. Only immutable local objects.
  const checkIdentity = async () => {
    if ((await git(["remote", "get-url", "origin"])).trim() !== workspace.repoUrl) throw new GitLabError("repository_identity_mismatch");
    if ((await git(["rev-parse", "HEAD"])).trim() !== row.headSha || (await git(["branch", "--show-current"])).trim() !== row.sourceBranch || workspace.branchName !== row.sourceBranch) throw new GitLabError("workspace_head_changed");
    if ((await git(["status", "--porcelain"])).trim()) throw new GitLabError("workspace_not_clean");
    for (const sha of [row.baseSha, row.headSha]) if ((await git(["rev-parse", `${sha}^{commit}`])).trim() !== sha) throw new GitLabError("commit_identity_mismatch");
    await git(["merge-base", "--is-ancestor", row.baseSha, row.headSha]);
  };
  await checkIdentity();
  let patch = ""; let fileCount = 0; const blockers: string[] = [];
  try {
    const stats = await git(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--ignore-submodules=none", "--no-relative", "--numstat", "-z", row.baseSha, row.headSha, "--"]);
    const files = stats.split("\0").filter(Boolean); fileCount = files.length;
    if (files.some(file => file.startsWith("-\t-\t"))) blockers.push("binary_diff_requires_external_review");
    if (fileCount > MAX_FILES) blockers.push("diff_file_limit");
    if (!blockers.length) patch = await git(["-c", "core.quotePath=true", "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--submodule=short", "--ignore-submodules=none", "--no-relative", "--full-index", "--src-prefix=a/", "--dst-prefix=b/", "--unified=3", row.baseSha, row.headSha, "--"]);
    // A gitlink diff only exposes commit IDs, not the nested repository's code.
    if (/^[-+]Subproject commit /m.test(patch)) blockers.push("submodule_diff_requires_external_review");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") blockers.push("diff_byte_limit");
    else throw error;
  }
  await checkIdentity();
  if (row.artifactManifest != null) {
    const manifest = row.artifactManifest as Record<string, unknown>;
    if (manifest.project !== String(row.projectId) || manifest.commitSha !== row.headSha) blockers.push("artifact_manifest_identity_mismatch");
  }
  const binding = reviewBinding(row);
  return { baseSha: row.baseSha, headSha: row.headSha, projectId: row.projectId, repository: workspace.repoUrl,
    evidence: row.evidence, artifactManifest: row.artifactManifest, binding, digest: digest([binding, workspace.repoUrl, patch, fileCount, blockers]), patch, fileCount, complete: blockers.length === 0, blockers };
}
