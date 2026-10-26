import { fixedCommitDiff, reviewedHead } from "./diff-review.js";
import { enqueueNotification } from "../mimouse-notifications/outbox.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { issues, executionWorkspaces, mimouseCodingDeliveries as deliveries, type Db } from "@paperclipai/db";
import { secretService } from "../secrets.js";
import { deliveryGate, gitlabClient, GitLabError, type CheckEvidence, type GitLabMergeRequest, type GitLabPipeline } from "./gitlab.js";
const exec = promisify(execFile);
export interface CodingWorkspace { cwd: string; repoUrl: string; branchName: string }
export async function verifyLocalCodingHead(workspace: CodingWorkspace, baseSha: string, headSha: string) {
  if (!/^[a-f0-9]{40}$/.test(headSha) || !/^[a-f0-9]{40}$/.test(baseSha)) throw new GitLabError("invalid_commit_sha");
  const options = { cwd: workspace.cwd, timeout: 30000, maxBuffer: 65536 };
  const [head, branch, status] = await Promise.all([exec("git", ["rev-parse", "HEAD"], options), exec("git", ["branch", "--show-current"], options), exec("git", ["status", "--porcelain"], options)]);
  if (head.stdout.trim() !== headSha || branch.stdout.trim() !== workspace.branchName) throw new GitLabError("workspace_head_changed");
  if (status.stdout.trim()) throw new GitLabError("workspace_not_clean");
  await exec("git", ["check-ref-format", "--branch", workspace.branchName], options);
  await exec("git", ["merge-base", "--is-ancestor", baseSha, headSha], options);
}
export async function publishCodingHead(workspace: CodingWorkspace, baseSha: string, headSha: string, approvedRepoUrls: string[]) {
  if (process.env.PAPERCLIP_GITLAB_PUBLISH_ENABLED !== "true") throw new GitLabError("operator_publish_disabled");
  if (!approvedRepoUrls.includes(workspace.repoUrl)) throw new GitLabError("repository_identity_mismatch");
  const prefixes = (process.env.PAPERCLIP_GITLAB_WORK_BRANCH_PREFIXES ?? "paperclip/").split(",").map(value => value.trim()).filter(Boolean);
  if (!prefixes.some(prefix => workspace.branchName.startsWith(prefix))) throw new GitLabError("branch_outside_operator_work_prefix");
  await verifyLocalCodingHead(workspace, baseSha, headSha);
  const env: NodeJS.ProcessEnv = { GIT_TERMINAL_PROMPT: "0" };
  for (const key of ["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "LANG", "LC_ALL", "SSH_AUTH_SOCK", "SSH_AGENT_PID", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"]) if (process.env[key]) env[key] = process.env[key];
  // paperclip:allow-git-push: Explicit operator opt-in, board-confirmed fixed SHA, company-owned workspace and verified GitLab repository; never force, merge or tag.
  await exec("git", ["push", "--", workspace.repoUrl, `${headSha}:refs/heads/${workspace.branchName}`], { cwd: workspace.cwd, timeout: 60000, maxBuffer: 65536, env });
}
export function codingService(db: Db, deps: { client?: typeof gitlabClient } = {}) {
  async function load(companyId: string, id: string) {
    const [row] = await db.select().from(deliveries).where(and(eq(deliveries.companyId, companyId), eq(deliveries.id, id)));
    if (!row) throw new GitLabError("delivery_not_found"); return row;
  }
  async function client(row: typeof deliveries.$inferSelect, signal?: AbortSignal) {
    const value = await secretService(db).resolveSecretValue(row.companyId, row.secretRef, "latest");
    let token: string; try { token = JSON.parse(value).token; } catch { throw new GitLabError("invalid_gitlab_secret"); }
    if (!token) throw new GitLabError("invalid_gitlab_secret");
    return (deps.client ?? gitlabClient)({ origin: row.gitlabOrigin, projectId: row.projectId, token, signal, allowedOrigins: (process.env.PAPERCLIP_GITLAB_ALLOWED_ORIGINS ?? "").split(",").map(origin => origin.trim()).filter(Boolean) });
  }
  async function saveRemote(row: typeof deliveries.$inferSelect, mr: GitLabMergeRequest | null, pipeline: GitLabPipeline | null, syncLease?: string) {
    const remoteEvidence = { mr, pipeline, checkedAt: new Date().toISOString() };
    let observedReview = reviewedHead(row); let observedEvidence = row.evidence;
    await db.transaction(async tx => {
      const saved = await tx.update(deliveries).set({ remoteEvidence, ...(syncLease ? { syncLease: null, syncLeaseExpiresAt: null, syncLastCode: null, nextSyncAt: mr && ["closed", "merged"].includes(mr.state) ? null : new Date(Date.now() + 60000) } : {}), ...(mr ? { mrIid: mr.iid } : {}), ...(pipeline ? { pipelineId: pipeline.id } : {}), ...(mr && mr.sha !== row.headSha ? { reviewedSha: null, reviewerUserId: null, reviewReceipt: null } : {}), updatedAt: new Date() }).where(and(eq(deliveries.id, row.id), eq(deliveries.headSha, row.headSha), ...(syncLease ? [eq(deliveries.syncLease, syncLease), gt(deliveries.syncLeaseExpiresAt, new Date())] : []))).returning();
      if (syncLease && !saved.length) throw new GitLabError("sync_lease_lost", true);
      observedReview = saved[0] ? reviewedHead(saved[0]) : null; observedEvidence = saved[0]?.evidence ?? [];
      if (saved.length && process.env.PAPERCLIP_NOTIFICATIONS_ENABLED === "true") {
        if (mr?.state === "opened" && mr.sha === row.headSha) await enqueueNotification(tx, { companyId: row.companyId, eventId: `coding-mr:${row.id}:${mr.iid}:${mr.sha}`, type: "coding.mr_ready", resourceId: row.id });
        if (pipeline?.sha === row.headSha && pipeline.status === "failed") await enqueueNotification(tx, { companyId: row.companyId, eventId: `coding-ci:${row.id}:${pipeline.id}:${pipeline.sha}`, type: "coding.ci_failed", resourceId: row.id });
      }
    });
    return { ...remoteEvidence, gate: deliveryGate({ headSha: row.headSha, reviewedSha: observedReview, mr, pipeline, evidence: observedEvidence as unknown as CheckEvidence[] }) };
  }
  return {
    load,
    reviewDiff: async (companyId: string, id: string) => {
      const row = await load(companyId, id);
      const [workspace] = await db.select().from(executionWorkspaces).where(and(eq(executionWorkspaces.id, row.workspaceId), eq(executionWorkspaces.companyId, companyId)));
      if (!workspace?.cwd || !workspace.repoUrl || workspace.status !== "active" || workspace.providerType !== "local_fs" || workspace.branchName !== row.sourceBranch) throw new GitLabError("workspace_not_reviewable");
      const [issue] = await db.select().from(issues).where(and(eq(issues.id, row.issueId), eq(issues.companyId, companyId)));
      if (!issue || issue.executionWorkspaceId !== workspace.id || issue.projectId !== workspace.projectId) throw new GitLabError("workspace_task_project_mismatch");
      const api = await client(row, AbortSignal.timeout(30000));
      return fixedCommitDiff(row, { cwd: workspace.cwd, repoUrl: workspace.repoUrl, branchName: row.sourceBranch }, await api.project());
    },
    publish: async (companyId: string, id: string, approvedSha: string) => {
      if (process.env.PAPERCLIP_GITLAB_PUBLISH_ENABLED !== "true") throw new GitLabError("operator_publish_disabled");
      const row = await load(companyId, id); if (row.headSha !== approvedSha || row.sourceBranch === row.targetBranch) throw new GitLabError("publication_confirmation_stale");
      const api = await client(row); const project = await api.project();
      if (project.id !== row.projectId) throw new GitLabError("project_identity_mismatch");
      try { const remote = await api.branch(row.sourceBranch); if (remote.protected) throw new GitLabError("protected_source_branch"); if (remote.commit.id === row.headSha) {
        await db.update(deliveries).set({ operationState: "published", operationLease: null }).where(and(eq(deliveries.id, id), inArray(deliveries.operationState, ["local", "publishing", "publish_indeterminate", "published"])));
        return { state: "published", headSha: row.headSha };
      } }
      catch (error) { if (!(error instanceof GitLabError) || error.code !== "gitlab_http_404") throw error; }
      const [workspace] = await db.select().from(executionWorkspaces).where(and(eq(executionWorkspaces.id, row.workspaceId), eq(executionWorkspaces.companyId, companyId)));
      if (!workspace?.cwd || !workspace.repoUrl || workspace.branchName !== row.sourceBranch || workspace.providerType !== "local_fs" || workspace.status !== "active") throw new GitLabError("workspace_not_publishable");
      const origin = new URL(row.gitlabOrigin);
      const urls = [project.http_url_to_repo, project.ssh_url_to_repo].filter(value => {
        if (!value) return false;
        if (value.startsWith("https://") || value.startsWith("http://")) { const url = new URL(value); return url.origin === origin.origin && !url.username && !url.password; }
        return value.startsWith(`git@${origin.hostname}:`) && /^[A-Za-z0-9_./-]+$/.test(value.split(":").slice(1).join(":"));
      });
      const lease = randomUUID();
      const claimed = await db.update(deliveries).set({ operationState: "publishing", operationLease: lease }).where(and(eq(deliveries.id, id), inArray(deliveries.operationState, ["local", "published"]))).returning();
      if (!claimed.length) throw new GitLabError("publication_in_progress_or_unconfirmed", true);
      try {
        await publishCodingHead({ cwd: workspace.cwd, repoUrl: workspace.repoUrl, branchName: row.sourceBranch }, row.baseSha, row.headSha, urls);
        const remote = await api.branch(row.sourceBranch); if (remote.commit.id !== row.headSha) throw new GitLabError("remote_head_not_confirmed", true);
        await db.update(deliveries).set({ operationState: "published", operationLease: null }).where(and(eq(deliveries.id, id), eq(deliveries.operationLease, lease)));
        return { state: "published", headSha: row.headSha };
      } catch { await db.update(deliveries).set({ operationState: "publish_indeterminate", operationLease: null }).where(and(eq(deliveries.id, id), eq(deliveries.operationLease, lease))); throw new GitLabError("publication_requires_reconciliation", true); }
    },
    openMr: async (companyId: string, id: string, approvedSha: string, title: string) => {
      const row = await load(companyId, id); if (row.headSha !== approvedSha || row.sourceBranch === row.targetBranch) throw new GitLabError("mr_confirmation_stale");
      const api = await client(row); const branch = await api.branch(row.sourceBranch);
      if (branch.commit.id !== row.headSha || branch.protected) throw new GitLabError("source_branch_not_verified");
      const existing = await api.listMergeRequests(row.sourceBranch, row.targetBranch);
      if (!Array.isArray(existing)) throw new GitLabError("invalid_mr_list");
      if (existing.length > 1) throw new GitLabError("multiple_merge_requests_require_review");
      if (existing.length === 1) { if (existing[0].sha !== row.headSha) throw new GitLabError("mr_head_not_verified"); await saveRemote(row, existing[0], null); await db.update(deliveries).set({ operationState: "mr_created", operationLease: null }).where(and(eq(deliveries.id, id), eq(deliveries.headSha, row.headSha))); return existing[0]; }
      const lease = randomUUID();
      const claimed = await db.update(deliveries).set({ operationState: "creating_mr", operationLease: lease }).where(and(eq(deliveries.id, id), inArray(deliveries.operationState, ["local", "published"]))).returning();
      if (!claimed.length) throw new GitLabError("mr_creation_unconfirmed", true);
      try {
        const mr = await api.createMergeRequest(row.sourceBranch, row.targetBranch, `WIP: ${title}`);
        if (!Number.isSafeInteger(mr.iid) || mr.sha !== row.headSha) throw new GitLabError("mr_receipt_invalid", true);
        await db.update(deliveries).set({ operationState: "mr_created", operationLease: null, mrIid: mr.iid }).where(and(eq(deliveries.id, id), eq(deliveries.operationLease, lease)));
        await saveRemote(row, mr, null); return mr;
      } catch { await db.update(deliveries).set({ operationState: "mr_indeterminate", operationLease: null }).where(and(eq(deliveries.id, id), eq(deliveries.operationLease, lease))); throw new GitLabError("mr_creation_requires_reconciliation", true); }
    },
    failureContext: async (companyId: string, id: string) => {
      const row = await load(companyId, id); const remote = row.remoteEvidence;
      const mr = remote.mr as GitLabMergeRequest | undefined; const pipeline = remote.pipeline as GitLabPipeline | undefined;
      const checkedAt = typeof remote.checkedAt === "string" ? Date.parse(remote.checkedAt) : NaN;
      if (row.syncLastCode || !mr || mr.state !== "opened" || mr.sha !== row.headSha || !pipeline || pipeline.sha !== row.headSha || pipeline.status !== "failed" || !Number.isFinite(checkedAt) || Date.now() - checkedAt > 60000 || checkedAt > Date.now() + 5000) throw new GitLabError("repair_evidence_stale_or_unverified");
      const api = await client(row, AbortSignal.timeout(30000)); const jobs = (await api.jobs(pipeline.id)).filter(job => job.status === "failed");
      if (!jobs.length || jobs.some(job => job.commitSha !== row.headSha || job.pipelineId !== pipeline.id)) throw new GitLabError("repair_job_evidence_unverified");
      // Runner/timeout/permission failures require an operator, not code edits.
      if (jobs.some(job => job.failureReason !== "script_failure")) throw new GitLabError("repair_environment_requires_operator");
      const signature = jobs.map(job => [job.name, job.stage, job.failureReason]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      const fingerprint = createHash("sha256").update(JSON.stringify(["coding-failure-v1", row.headSha, signature])).digest("hex");
      return { headSha: row.headSha, pipelineId: pipeline.id, fingerprint, jobs };
    },
    sync: async (companyId: string, id: string, options: { onlyWhenDue?: boolean } = {}) => {
      const now = new Date(); const lease = randomUUID();
      const [row] = await db.update(deliveries).set({ syncLease: lease, syncLeaseExpiresAt: new Date(now.getTime() + 90000) }).where(and(
        eq(deliveries.companyId, companyId), eq(deliveries.id, id),
        or(isNull(deliveries.syncLease), lte(deliveries.syncLeaseExpiresAt, now)),
        ...(options.onlyWhenDue ? [eq(deliveries.operationState, "mr_created"), lte(deliveries.nextSyncAt, now)] : []),
      )).returning();
      if (!row) throw new GitLabError("sync_busy_or_not_due");
      try {
        // A single deadline bounds all read-only pagination, not just each page.
        const api = await client(row, AbortSignal.timeout(30000));
        const mr = row.mrIid ? await api.mergeRequest(row.mrIid) : null;
        const pipelines = await api.pipelines(row.headSha);
        const latest = pipelines.filter(pipeline => pipeline.sha === row.headSha).sort((a, b) => b.id - a.id)[0];
        const pipeline = latest ? await api.pipeline(latest.id) : null;
        return await saveRemote(row, mr, pipeline, lease);
      } catch (error) {
        const code = error instanceof GitLabError && /^[a-z0-9_]{1,80}$/.test(error.code) ? error.code : "sync_failed";
        // Unknown latest evidence must not leave a cached green release gate.
        // CAS prevents an expired worker from clearing a newer worker's result.
        await db.update(deliveries).set({ syncLease: null, syncLeaseExpiresAt: null, syncLastCode: code,
          nextSyncAt: new Date(Date.now() + 300000), remoteEvidence: { mr: null, pipeline: null, checkedAt: new Date().toISOString(), lastCode: code }, updatedAt: new Date(),
        }).where(and(eq(deliveries.id, row.id), eq(deliveries.syncLease, lease)));
        throw error;
      }
    },
  };
}
