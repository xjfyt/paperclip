import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { activityLog, agents, authUsers, companies, companyMemberships, companySkills, companySkillVersions, heartbeatRuns,
  mimouseEvaluationComparisons as comparisons, mimouseEvaluationRestores as restores, type Db } from "@paperclipai/db";
import { createEvaluationRestoreSchema, recoverEvaluationRestoreSchema, type CreateEvaluationRestore, type RecoverEvaluationRestore, type EvaluationRestoreReceipt } from "@paperclipai/shared/mimouse-evaluation-restore";
import { normalizeSkillPolicySourceLocator } from "@paperclipai/shared";
import { companySkillService, auditSkillSnapshot } from "../company-skills.js";
import { companySkillPolicyService, normalizeSkillPolicySourceType } from "../company-skill-policy.js";
import { canonical } from "../mimouse-operations/preview.js";
import { stageRestoreTree, resolveRestoreTree, validateRestoreSnapshot, type RestoreTreePlan } from "./restore-files.js";
import { conflict, forbidden, HttpError, notFound, unprocessable } from "../../errors.js";
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Record = typeof restores.$inferSelect;
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const operationIdFor = (companyId: string, requestId: string) => { const value = hash([companyId, requestId]); return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`; };
function receipt(row: Record): EvaluationRestoreReceipt {
  return { id: row.id, companyId: row.companyId, skillId: row.skillId, reportId: row.reportId, action: row.action, rollbackOf: row.rollbackOf,
    status: row.status, resolution: row.resolution, beforeVersionId: row.beforeVersionId, targetVersionId: row.targetVersionId,
    beforeHash: row.beforeHash, targetHash: row.targetHash, operationHash: row.operationHash, actorUserId: row.actorUserId,
    completedByUserId: row.completedByUserId, createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null, errorCode: row.errorCode };
}
async function authorize(tx: Pick<Tx, "select">, companyId: string, userId: string, requirePaused = true) {
  const [user] = await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.id, userId)).for("share");
  const [membership] = await tx.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalId, userId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.status, "active"), inArray(companyMemberships.membershipRole, ["owner", "admin"]))).for("share");
  if (!user || !membership) throw forbidden("restore_active_company_administrator_required");
  const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).for("update");
  if (!company) throw notFound("Company not found");
  if (requirePaused && company.status !== "paused") throw conflict("restore_company_must_be_paused");
  const active = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(eq(heartbeatRuns.companyId, companyId), inArray(heartbeatRuns.status, ["queued", "running"]))).limit(1);
  const runningAgents = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.status, "running"))).limit(1);
  if (requirePaused && (active.length || runningAgents.length)) throw conflict("restore_active_runs_present");
  return { companyPaused: company.status === "paused", activeRuns: active.length > 0 || runningAgents.length > 0 };
}
async function audit(tx: Pick<Tx, "insert">, row: Record, userId: string, action: string) {
  await tx.insert(activityLog).values({ companyId: row.companyId, actorType: "user", actorId: userId, action: `evaluation.restore.${action}`, entityType: "evaluation_restore", entityId: row.id,
    details: { operationHash: row.operationHash, reportId: row.reportId, beforeVersionId: row.beforeVersionId, targetVersionId: row.targetVersionId } });
}
export function evaluationRestoreService(db: Db, testHooks: { checkpoint?: (phase: string) => Promise<void> } = {}) {
  const skills = companySkillService(db), policies = companySkillPolicyService(db);
  async function load(companyId: string, id: string) { const [row] = await db.select().from(restores).where(and(eq(restores.companyId, companyId), eq(restores.id, id))); if (!row) throw notFound("Restore receipt not found"); return row; }
  async function policy(companyId: string, userId: string, skill: { id: string; key: string; sourceType: string; sourceLocator: string | null }) {
    const decision = await policies.evaluate({ companyId, principal: { type: "board", id: userId, role: "board" }, action: "skills.edit",
      resource: { skillId: skill.id, skillKey: skill.key, sourceType: normalizeSkillPolicySourceType(skill.sourceType), ...(skill.sourceLocator ? { sourceLocator: normalizeSkillPolicySourceLocator(skill.sourceLocator) } : {}) } });
    if (!decision.allowed) throw forbidden("restore_skill_policy_denied");
  }
  async function resolve(companyId: string, id: string, userId: string, raw: RecoverEvaluationRestore) {
    const input = recoverEvaluationRestoreSchema.parse(raw), initial = await load(companyId, id);
    if (input.expectedOperationHash !== initial.operationHash) throw conflict("restore_operation_hash_changed");
    if (initial.status !== "prepared") { await db.transaction(tx => authorize(tx, companyId, userId, false)); return receipt(initial); }
    // Latch compensation durably before moving a tree; after a crash it must not
    // accidentally resume apply. Receipt reads never recurse through getById.
    const latched = await skills.withManagedRestoreLock(companyId, initial.skillId, initial.id, async ({ tx, skill }) => {
      await authorize(tx as Tx, companyId, userId); await policy(companyId, userId, skill);
      const [current] = await tx.select().from(restores).where(and(eq(restores.companyId, companyId), eq(restores.id, id))).for("update");
      if (!current) throw notFound("Restore receipt not found");
      if (current.status !== "prepared") return current;
      if (skill.metadata?.mimouseRestorePending !== id || skill.currentVersionId !== current.beforeVersionId) throw conflict("restore_pending_identity_changed");
      if (current.resolution === "compensate" && input.resolution !== "compensate") throw conflict("restore_compensation_already_selected");
      if (current.resolution !== input.resolution) {
        const [row] = await tx.update(restores).set({ resolution: input.resolution }).where(eq(restores.id, id)).returning();
        await audit(tx as Tx, row!, userId, "compensation_requested"); return row!;
      }
      return current;
    });
    if (latched.status !== "prepared") return receipt(latched);
    try {
      return await skills.withManagedRestoreLock(companyId, initial.skillId, initial.id, async ({ tx, skill, root, directory, complete }) => {
        await authorize(tx as Tx, companyId, userId); await policy(companyId, userId, skill);
        const [current] = await tx.select().from(restores).where(and(eq(restores.companyId, companyId), eq(restores.id, id))).for("update");
        if (!current) throw notFound("Restore receipt not found");
        if (current.status !== "prepared") return receipt(current);
        if (skill.metadata?.mimouseRestorePending !== id || skill.currentVersionId !== current.beforeVersionId || directory !== current.sourceDirectory) throw conflict("restore_pending_identity_changed");
        const [target] = await tx.select().from(companySkillVersions).where(and(eq(companySkillVersions.companyId, companyId), eq(companySkillVersions.companySkillId, skill.id), eq(companySkillVersions.id, current.targetVersionId)));
        if (current.resolution === "apply" && (!target || validateRestoreSnapshot(target.fileInventory) !== current.targetHash)) throw conflict("restore_target_version_changed");
        const plan: RestoreTreePlan = { root, live: directory, operationId: id, beforeHash: current.beforeHash, targetHash: current.targetHash };
        await resolveRestoreTree(plan, current.resolution, testHooks.checkpoint);
        await complete(current.resolution === "apply" ? target! : null, { name: current.targetName, description: current.targetDescription });
        const [finished] = await tx.update(restores).set({ status: current.resolution === "apply" ? "applied" : "compensated", completedAt: new Date(), completedByUserId: userId, errorCode: null }).where(eq(restores.id, id)).returning();
        await audit(tx as Tx, finished!, userId, finished!.status); await testHooks.checkpoint?.("before_database_commit");
        return receipt(finished!);
      });
    } catch (error) {
      // DB rolled back: the previously committed marker/journal still blocks
      // ordinary reads, mutation and runtime use. Do not erase uncertain trees.
      const errorCode = error instanceof Error && /^restore_[a-z_]+$/.test(error.message) ? error.message : "restore_recovery_required";
      await db.update(restores).set({ errorCode }).where(and(eq(restores.companyId, companyId), eq(restores.id, id), eq(restores.status, "prepared")));
      if (error instanceof HttpError && [401, 403].includes(error.status)) throw error;
      return receipt(await load(companyId, id));
    }
  }
  return {
    async list(companyId: string, userId: string) { await db.transaction(tx => authorize(tx, companyId, userId, false)); return (await db.select().from(restores).where(eq(restores.companyId, companyId)).orderBy(desc(restores.createdAt)).limit(100)).map(receipt); },
    async get(companyId: string, id: string, userId: string) { await db.transaction(tx => authorize(tx, companyId, userId, false)); return receipt(await load(companyId, id)); },
    async readiness(companyId: string, reportId: string, userId: string) {
      const state = await db.transaction(tx => authorize(tx, companyId, userId, false));
      const [comparison] = await db.select().from(comparisons).where(and(eq(comparisons.companyId, companyId), eq(comparisons.id, reportId)));
      if (!comparison) throw notFound("Evaluation comparison not found");
      const support = await skills.managedRestoreSupport(companyId, comparison.report.skillId);
      return { ...support, ...state, blockers: [...support.blockers, ...(!state.companyPaused ? ["restore_company_must_be_paused"] : []), ...(state.activeRuns ? ["restore_active_runs_present"] : []), ...(!comparison.report.eligibleForHumanReview ? ["restore_report_not_eligible"] : []), ...(process.platform === "win32" ? ["restore_platform_unsupported"] : [])],
        supportedMode: "paused_unused_managed_local_only", requiresHumanSession: true, automaticallyPausesOrDetaches: false, filesystemVerified: false };
    },
    async create(companyId: string, userId: string, raw: CreateEvaluationRestore) {
      const input = createEvaluationRestoreSchema.parse(raw), requestDigest = hash(input), operationId = operationIdFor(companyId, input.requestId);
      const [existing] = await db.select().from(restores).where(and(eq(restores.companyId, companyId), eq(restores.requestId, input.requestId)));
      if (existing) { await db.transaction(tx => authorize(tx, companyId, userId, false)); if (existing.requestDigest !== requestDigest) throw conflict("restore_request_identity_conflict"); return { item: receipt(existing), duplicate: true }; }
      const [comparison] = await db.select().from(comparisons).where(and(eq(comparisons.companyId, companyId), eq(comparisons.id, input.reportId)));
      if (!comparison) throw notFound("Evaluation comparison not found");
      const { reportHash, ...reportBody } = comparison.report;
      if (reportHash !== input.expectedReportHash || hash(reportBody) !== reportHash || !comparison.report.eligibleForHumanReview) throw conflict("restore_report_not_eligible");
      const beforeVersionId = input.action === "activate" ? comparison.report.baseline.versionId : comparison.report.candidate.versionId;
      const targetVersionId = input.action === "activate" ? comparison.report.candidate.versionId : comparison.report.baseline.versionId;
      if (input.expectedCurrentVersionId !== beforeVersionId) throw conflict("restore_expected_version_mismatch");
      const prepared = await skills.withManagedRestoreLock(companyId, comparison.report.skillId, operationId, async ({ tx, skill, root, directory, identityFor }) => {
        await authorize(tx as Tx, companyId, userId); await policy(companyId, userId, skill);
        const [duplicate] = await tx.select().from(restores).where(and(eq(restores.companyId, companyId), eq(restores.requestId, input.requestId)));
        if (duplicate) { if (duplicate.requestDigest !== requestDigest) throw conflict("restore_request_identity_conflict"); return { row: duplicate, duplicate: true }; }
        if (skill.currentVersionId !== beforeVersionId) throw conflict("restore_current_version_changed");
        let rollbackIdentity: { name: string; description: string | null } | undefined;
        if (input.action === "rollback") {
          const [activation] = await tx.select().from(restores).where(and(eq(restores.companyId, companyId), eq(restores.id, input.rollbackOf!)));
          if (!activation || activation.status !== "applied" || activation.action !== "activate" || activation.skillId !== skill.id || activation.reportId !== input.reportId || activation.targetVersionId !== beforeVersionId || activation.beforeVersionId !== targetVersionId || skill.metadata?.mimouseLastRestoreId !== activation.id) throw conflict("restore_rollback_receipt_mismatch");
          rollbackIdentity = { name: activation.beforeName, description: activation.beforeDescription };
        }
        const versions = await tx.select().from(companySkillVersions).where(and(eq(companySkillVersions.companyId, companyId), eq(companySkillVersions.companySkillId, skill.id), inArray(companySkillVersions.id, [beforeVersionId, targetVersionId])));
        const before = versions.find(version => version.id === beforeVersionId), target = versions.find(version => version.id === targetVersionId);
        if (!before || !target) throw notFound("Skill version not found");
        const versionHashes = comparison.evidenceSnapshot.versionHashes;
        if (!Array.isArray(versionHashes) || versions.some(version => !versionHashes.some(value => value && typeof value === "object" && value.id === version.id && value.hash === hash(version.fileInventory)))) throw conflict("restore_report_version_changed");
        const beforeHash = validateRestoreSnapshot(before.fileInventory), targetHash = validateRestoreSnapshot(target.fileInventory);
        if ((await auditSkillSnapshot(target.fileInventory)).some(finding => finding.severity === "error")) throw unprocessable("restore_target_audit_failed");
        await stageRestoreTree({ root, live: directory, operationId, beforeHash, targetHash }, target.fileInventory);
        const beforeIdentity = { name: skill.name, description: skill.description }, targetIdentity = rollbackIdentity ?? identityFor(target);
        const operationHash = hash({ beforeIdentity, targetIdentity, companyId, skillId: skill.id, reportId: input.reportId, requestDigest, sourceDirectory: directory, beforeVersionId, targetVersionId, beforeHash, targetHash });
        const [row] = await tx.insert(restores).values({ id: operationId, companyId, skillId: skill.id, reportId: input.reportId, requestId: input.requestId, requestDigest,
          action: input.action, rollbackOf: input.rollbackOf ?? null, beforeVersionId, targetVersionId, beforeHash, targetHash, operationHash, sourceDirectory: directory, actorUserId: userId, beforeName: beforeIdentity.name, beforeDescription: beforeIdentity.description, targetName: targetIdentity.name, targetDescription: targetIdentity.description }).onConflictDoNothing().returning();
        if (!row) throw conflict("restore_request_identity_conflict");
        await tx.update(companySkills).set({ metadata: { ...(skill.metadata ?? {}), mimouseRestorePending: row.id }, updatedAt: new Date() }).where(eq(companySkills.id, skill.id));
        await audit(tx as Tx, row, userId, "prepared"); return { row, duplicate: false };
      });
      if (prepared.duplicate) return { item: receipt(prepared.row), duplicate: true };
      await testHooks.checkpoint?.("journal_committed");
      return { item: await resolve(companyId, prepared.row.id, userId, { expectedOperationHash: prepared.row.operationHash, resolution: "apply", confirm: true }), duplicate: false };
    },
    recover: resolve,
  };
}
