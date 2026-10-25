import { codingRepairService } from "../services/mimouse-coding/repairs.js";
import { repairSettingsSchema } from "../services/mimouse-coding/repair-policy.js";
import { artifactManifest } from "../services/mimouse-coding/artifacts.js";
import { enqueueNotification } from "../services/mimouse-notifications/outbox.js";
import { Router, type Request } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { companySecrets, executionWorkspaces, issues, mimouseCodingDeliveries as deliveries, mimouseCodingRepairAttempts as repairAttempts, type Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { forbidden, notFound, unprocessable } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { canActorReadIssuePrivacy } from "../services/authorization.js";
import { codingService, verifyLocalCodingHead } from "../services/mimouse-coding/service.js";
import { deliveryGate, gitlabOrigin, GitLabError, type CheckEvidence, type GitLabMergeRequest, type GitLabPipeline } from "../services/mimouse-coding/gitlab.js";
import { logActivity } from "../services/activity-log.js";
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const createSchema = z.object({ issueId: z.string().uuid(), workspaceId: z.string().uuid(), gitlabOrigin: z.string().url(), projectId: z.number().int().positive(), secretRef: z.string().uuid(), baseSha: sha, headSha: sha, targetBranch: z.string().min(1).max(200) }).strict();
const confirmSchema = z.object({ headSha: sha, confirm: z.literal(true), title: z.string().min(1).max(200).optional() }).strict();
const evidenceSchema = z.object({ headSha: sha, checks: z.array(z.object({ commitSha: sha, command: z.string().min(1).max(2000), exitCode: z.number().int().nullable(), startedAt: z.string().datetime(), finishedAt: z.string().datetime(), logRef: z.string().min(1).max(2000), status: z.enum(["passed", "failed", "blocked", "not_run"]) }).strict()).max(100) }).strict();
const artifactsSchema = z.object({ headSha: sha, version: z.string().min(1).max(100), artifacts: z.array(z.object({ path: z.string().min(1).max(1000), platform: z.enum(["windows", "macos", "linux"]), arch: z.enum(["x86_64", "arm64"]), buildJob: z.string().min(1).max(200) }).strict()).min(1).max(30) }).strict();
export function mimouseCodingRoutes(db: Db) {
  const router = Router(); const service = codingService(db); const root = "/companies/:companyId/coding";
  function admin(req: Request) {
    const companyId = String(req.params.companyId); assertBoard(req); assertCompanyAccess(req, companyId);
    const role = req.actor.memberships?.find(item => item.companyId === companyId);
    if (req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin && !(role?.status === "active" && ["owner", "admin"].includes(String(role.membershipRole)))) throw forbidden("Company administrator required");
    return companyId;
  }
  async function issueAccess(req: Request, companyId: string, issueId: string) {
    const [issue] = await db.select().from(issues).where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)));
    if (!issue || !await canActorReadIssuePrivacy(db, req.actor, issue)) throw notFound("Coding task not found"); return issue;
  }
  async function load(req: Request) {
    const companyId = admin(req); const row = await service.load(companyId, String(req.params.id)); await issueAccess(req, companyId, row.issueId); return row;
  }
  async function safe<T>(action: () => Promise<T>) { try { return await action(); } catch (error) { throw unprocessable(error instanceof GitLabError ? error.code : "coding_operation_failed", { uncertain: error instanceof GitLabError && error.uncertain }); } }
  async function audit(req: Request, action: string, id: string) { const actor = getActorInfo(req); await logActivity(db, { companyId: String(req.params.companyId), actorType: actor.actorType, actorId: actor.actorId, action, entityType: "coding_delivery", entityId: id, details: {} }); }
  router.post(`${root}/:id/repair-settings`, validate(repairSettingsSchema), async (req, res) => {
    const companyId = admin(req); const id = String(req.params.id);
    if (req.actor.type !== "board" || req.actor.source !== "session" || !req.actor.userId) throw forbidden("A signed-in owner is required for repair authorization");
    const ownerUserId = req.actor.userId; const row = await service.load(companyId, id); await issueAccess(req, companyId, row.issueId);
    const result = await safe(() => codingRepairService(db).configure(companyId, id, req.body, ownerUserId));
    await audit(req, req.body.enabled ? "coding.repair.authorized" : "coding.repair.disabled", id); res.json(result);
  });
  router.get(`${root}/:id/repairs`, async (req, res) => {
    const companyId = admin(req); const row = await service.load(companyId, String(req.params.id)); await issueAccess(req, companyId, row.issueId);
    const history = await db.select({ id: repairAttempts.id, attempt: repairAttempts.attempt, state: repairAttempts.state, pipelineId: repairAttempts.pipelineId, headSha: repairAttempts.headSha,
      routineRunId: repairAttempts.routineRunId, issueId: repairAttempts.issueId, lastCode: repairAttempts.lastCode, createdAt: repairAttempts.createdAt }).from(repairAttempts)
      .where(and(eq(repairAttempts.companyId, companyId), eq(repairAttempts.deliveryId, row.id))).orderBy(desc(repairAttempts.createdAt)).limit(10);
    res.json({ operatorEnabled: process.env.PAPERCLIP_CODING_REPAIR_ENABLED === "true", status: row.repairStatus, lastCode: row.repairLastCode, policy: row.repairPolicy, attempts: history });
  });
  router.get(root, async (req, res) => {
    const companyId = admin(req); const rows = await db.select().from(deliveries).where(eq(deliveries.companyId, companyId)).orderBy(desc(deliveries.updatedAt)).limit(100); const visible = [];
    for (const row of rows) {
      const [issue] = await db.select().from(issues).where(and(eq(issues.companyId, companyId), eq(issues.id, row.issueId)));
      if (!issue || !await canActorReadIssuePrivacy(db, req.actor, issue)) continue;
      const { secretRef: _secretRef, operationLease: _lease, ...publicRow } = row;
      visible.push({ ...publicRow, gate: deliveryGate({ headSha: row.headSha, reviewedSha: row.reviewedSha, mr: row.remoteEvidence.mr as GitLabMergeRequest ?? null, pipeline: row.remoteEvidence.pipeline as GitLabPipeline ?? null, evidence: row.evidence as unknown as CheckEvidence[] }) });
    }
    res.json({ deliveries: visible, publishEnabled: process.env.PAPERCLIP_GITLAB_PUBLISH_ENABLED === "true", liveVerified: false, automaticRepairEnabled: false });
  });
  router.post(root, validate(createSchema), async (req, res) => {
    const companyId = admin(req); const input = createSchema.parse(req.body); const issue = await issueAccess(req, companyId, input.issueId);
    const [workspace] = await db.select().from(executionWorkspaces).where(and(eq(executionWorkspaces.id, input.workspaceId), eq(executionWorkspaces.companyId, companyId)));
    if (!workspace?.cwd || !workspace.repoUrl || !workspace.branchName || workspace.status !== "active" || workspace.providerType !== "local_fs" || issue.executionWorkspaceId !== workspace.id) throw unprocessable("Task must reference an active local execution workspace");
    if (input.targetBranch === workspace.branchName) throw unprocessable("Source and target branches must differ");
    const [secret] = await db.select({ id: companySecrets.id }).from(companySecrets).where(and(eq(companySecrets.id, input.secretRef), eq(companySecrets.companyId, companyId), eq(companySecrets.scope, "company"), eq(companySecrets.status, "active")));
    if (!secret) throw notFound("GitLab credential not found");
    gitlabOrigin(input.gitlabOrigin, (process.env.PAPERCLIP_GITLAB_ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()));
    await safe(() => verifyLocalCodingHead({ cwd: workspace.cwd!, repoUrl: workspace.repoUrl!, branchName: workspace.branchName! }, input.baseSha, input.headSha));
    const [row] = await db.insert(deliveries).values({ ...input, companyId, sourceBranch: workspace.branchName }).returning();
    await audit(req, "coding.delivery.created", row.id); res.status(201).json({ id: row.id, headSha: row.headSha });
  });
  router.post(`${root}/:id/evidence`, validate(evidenceSchema), async (req, res) => {
    const row = await load(req); const input = evidenceSchema.parse(req.body);
    if (row.headSha !== input.headSha || input.checks.some(check => check.commitSha !== row.headSha)) throw unprocessable("Evidence must match the recorded commit");
    await db.update(deliveries).set({ evidence: input.checks, reviewedSha: null, reviewerUserId: null, updatedAt: new Date() }).where(and(eq(deliveries.id, row.id), eq(deliveries.headSha, input.headSha)));
    await audit(req, "coding.evidence.recorded", row.id); res.json({ recorded: true, reviewRequired: true });
  });
  router.post(`${root}/:id/artifacts`, validate(artifactsSchema), async (req, res) => {
    const row = await load(req); const input = artifactsSchema.parse(req.body);
    if (row.headSha !== input.headSha) throw unprocessable("Artifact SHA is stale");
    const [workspace] = await db.select().from(executionWorkspaces).where(and(eq(executionWorkspaces.id, row.workspaceId), eq(executionWorkspaces.companyId, row.companyId)));
    if (!workspace?.cwd || !workspace.repoUrl || workspace.status !== "active" || workspace.providerType !== "local_fs" || workspace.branchName !== row.sourceBranch) throw unprocessable("Active local workspace required");
    await safe(() => verifyLocalCodingHead({ cwd: workspace.cwd!, repoUrl: workspace.repoUrl!, branchName: row.sourceBranch }, row.baseSha, row.headSha));
    // These are local bytes, not a signed or independently verified build receipt.
    const manifest = await safe(() => artifactManifest({ project: String(row.projectId), version: input.version, commitSha: row.headSha, root: workspace.cwd!, artifacts: input.artifacts.map(item => ({ ...item, signatureStatus: "unknown" as const, testStatus: "not_run" as const })) }));
    await db.transaction(async tx => {
      const changed = await tx.update(deliveries).set({ artifactManifest: manifest, updatedAt: new Date() }).where(and(eq(deliveries.id, row.id), eq(deliveries.headSha, input.headSha))).returning();
      if (!changed.length) throw unprocessable("Delivery changed while hashing");
      if (process.env.PAPERCLIP_NOTIFICATIONS_ENABLED === "true") await enqueueNotification(tx, { companyId: row.companyId, eventId: `coding-artifact:${row.id}:${row.headSha}`, type: "coding.artifact_ready", resourceId: row.id });
    });
    await audit(req, "coding.artifacts.recorded", row.id); res.json(manifest);
  });
  router.post(`${root}/:id/review`, validate(confirmSchema), async (req, res) => {
    const row = await load(req); const input = confirmSchema.parse(req.body); if (input.headSha !== row.headSha) throw unprocessable("Review SHA is stale");
    await db.update(deliveries).set({ reviewedSha: input.headSha, reviewerUserId: req.actor.userId ?? "local-board", updatedAt: new Date() }).where(and(eq(deliveries.id, row.id), eq(deliveries.headSha, input.headSha)));
    await audit(req, "coding.head.reviewed", row.id); res.json({ reviewedSha: input.headSha, productionReleaseAuthorized: false });
  });
  router.post(`${root}/:id/publish`, validate(confirmSchema), async (req, res) => {
    const row = await load(req); const input = confirmSchema.parse(req.body); const result = await safe(() => service.publish(row.companyId, row.id, input.headSha)); await audit(req, "coding.branch.published", row.id); res.json(result);
  });
  router.post(`${root}/:id/merge-request`, validate(confirmSchema), async (req, res) => {
    const row = await load(req); const input = confirmSchema.parse(req.body); const result = await safe(() => service.openMr(row.companyId, row.id, input.headSha, input.title ?? `Paperclip delivery ${row.id}`)); await audit(req, "coding.mr.created", row.id); res.json(result);
  });
  router.post(`${root}/:id/sync`, async (req, res) => { const row = await load(req); res.json(await safe(() => service.sync(row.companyId, row.id))); });
  return router;
}
