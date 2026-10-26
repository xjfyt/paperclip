import { assertApplicationAttemptsStopped } from "./recovery.js";
import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { activityLog, agents, type Db } from "@paperclipai/db";
import { mimousePromptApplications as applications, mimousePromptApplicationHeads as heads,
  mimousePromptApplicationReceipts as receipts, mimousePromptApplicationDispatches as dispatches } from "@paperclipai/db/schema/mimouse_prompt_applications";
import { approvePromptApplicationSchema, preparePromptApplicationSchema, rollbackPromptApplicationSchema,
  type ApprovePromptApplication, type PreparePromptApplication, type RollbackPromptApplication,
  type PromptApplicationRecord, type PromptApplicationReceipt, type PromptApplicationRequestQuery, type PromptApplicationRequestClosure } from "@paperclipai/shared/mimouse-prompt-applications";
import { conflict, notFound, unprocessable } from "../../errors.js";
import { authorizePrivatePrompt, type PrivatePromptIdentity, type PrivatePromptTx } from "../mimouse-private-prompt-tests/service.js";
import { privatePromptComparisonService } from "../mimouse-private-prompt-tests/comparison-service.js";
import { agentExecutionsHaveStopped } from "../agent-execution-stop.js";
import { applicationDigest, assertApplicationConfigurationAuthority, assertApplicationTarget, resolvePromptApplicationTarget } from "./target.js";
export const promptApplicationsEnabled = () => process.env.PAPERCLIP_PROMPT_APPLICATIONS_ENABLED === "true";
export type PromptApplicationRow = typeof applications.$inferSelect;
function enabled() { if (!promptApplicationsEnabled()) throw unprocessable("prompt_application_disabled"); }
async function lockRequest(tx: PrivatePromptTx, companyId: string, requestId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${companyId}:prompt-application:${requestId}`}, 0))`);
}
async function lockAgent(tx: PrivatePromptTx, companyId: string, agentId: string) {
  const [agent] = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).for("update");
  if (!agent) throw notFound("prompt_application_agent_not_found");
}
export async function lockApplicationHead(tx: PrivatePromptTx, companyId: string, agentId: string) {
  await tx.insert(heads).values({ companyId, agentId }).onConflictDoNothing();
  const [head] = await tx.select().from(heads).where(and(eq(heads.companyId, companyId), eq(heads.agentId, agentId))).for("update");
  if (!head) throw conflict("prompt_application_head_unavailable");
  return head;
}
function receipt(row: typeof receipts.$inferSelect): PromptApplicationReceipt {
  return { id: row.id, requestId: row.requestId, applicationId: row.applicationId, agentId: row.agentId,
    action: row.action, generation: row.generation, createdAt: row.createdAt.toISOString(), executionStarted: false };
}
async function record(tx: PrivatePromptTx, row: PromptApplicationRow): Promise<PromptApplicationRecord> {
  const [head] = await tx.select().from(heads).where(and(eq(heads.companyId, row.companyId), eq(heads.agentId, row.agentId)));
  const [count] = await tx.select({ value: sql<number>`count(*)::int` }).from(dispatches).where(and(eq(dispatches.applicationId, row.id), eq(dispatches.state, "dispatched")));
  const configured = head?.applicationId === row.id;
  return { id: row.id, requestId: row.requestId, companyId: row.companyId, promptId: row.promptId, revisionId: row.revisionId,
    revisionHash: row.revisionHash, agentId: row.agentId, actorUserId: row.actorUserId, expectedGeneration: row.expectedGeneration,
    approvalDigest: row.approvalDigest, comparison: row.comparison, reportHash: row.reportHash, snapshot: row.snapshot,
    approvalExpiresAt: row.approvalExpiresAt.toISOString(), createdAt: row.createdAt.toISOString(), currentGeneration: head?.generation ?? 0,
    configured, configuredAt: configured ? head.configuredAt?.toISOString() ?? null : null, dispatchedCount: count?.value ?? 0, executionStarted: false };
}
async function audit(tx: PrivatePromptTx, actor: PrivatePromptIdentity, action: string, id: string, details: Record<string, unknown>) {
  await tx.insert(activityLog).values({ companyId: actor.companyId, actorType: "user", actorId: actor.userId,
    action, entityType: "prompt_application", entityId: id, details });
}
export function promptApplicationService(db: Db) {
  const compare = privatePromptComparisonService(db);
  async function get(tx: PrivatePromptTx, actor: PrivatePromptIdentity, promptId: string, id: string) {
    const [row] = await tx.select().from(applications).where(and(eq(applications.companyId, actor.companyId), eq(applications.promptId, promptId), eq(applications.id, id)));
    if (!row) throw notFound("prompt_application_not_found");
    return row;
  }
  async function priorReceipt(tx: PrivatePromptTx, actor: PrivatePromptIdentity, applicationId: string, requestId: string, requestDigest: string) {
    const [prior] = await tx.select().from(receipts).where(and(eq(receipts.companyId, actor.companyId), eq(receipts.requestId, requestId)));
    if (!prior) return null;
    if (prior.applicationId !== applicationId || prior.actorUserId !== actor.userId || prior.requestDigest !== requestDigest) throw conflict("prompt_application_request_conflict");
    return { receipt: receipt(prior), duplicate: true };
  }
  return {
    async detail(actor: PrivatePromptIdentity, promptId: string, id: string) {
      return db.transaction(async tx => { await authorizePrivatePrompt(tx, actor);
        return { item: await record(tx, await get(tx, actor, promptId, id)), enabled: promptApplicationsEnabled() }; });
    },
    async head(actor: PrivatePromptIdentity, agentId: string) {
      return db.transaction(async tx => {
        await authorizePrivatePrompt(tx, actor);
        const [agent] = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, actor.companyId), eq(agents.id, agentId)));
        if (!agent) throw notFound("prompt_application_agent_not_found");
        const [head] = await tx.select().from(heads).where(and(eq(heads.companyId, actor.companyId), eq(heads.agentId, agentId)));
        return { enabled: promptApplicationsEnabled(), generation: head?.generation ?? 0, applicationId: head?.applicationId ?? null, configuredAt: head?.configuredAt?.toISOString() ?? null };
      });
    },
    async list(actor: PrivatePromptIdentity, promptId: string, beforeId?: string) {
      return db.transaction(async tx => {
        await authorizePrivatePrompt(tx, actor);
        const rows = await tx.select().from(applications).where(and(eq(applications.companyId, actor.companyId), eq(applications.promptId, promptId), beforeId ? lt(applications.id, beforeId) : undefined)).orderBy(desc(applications.id)).limit(51);
        return { enabled: promptApplicationsEnabled(), items: await Promise.all(rows.slice(0, 50).map(row => record(tx, row))), nextBeforeId: rows.length > 50 ? rows[49]!.id : null };
      });
    },
    async request(actor: PrivatePromptIdentity, promptId: string, requestId: string, query: PromptApplicationRequestQuery = {}) {
      return db.transaction(async tx => {
        await authorizePrivatePrompt(tx, actor);
        await lockRequest(tx, actor.companyId, requestId);
        let closure: PromptApplicationRequestClosure | null = null;
        let target: PromptApplicationRow | null = null;
        if (query.applicationId && query.action && query.expectedGeneration !== undefined) {
          target = await get(tx, actor, promptId, query.applicationId);
          await lockAgent(tx, actor.companyId, target.agentId);
        }
        const [proposal] = await tx.select().from(applications).where(and(eq(applications.companyId, actor.companyId), eq(applications.promptId, promptId), eq(applications.actorUserId, actor.userId), eq(applications.requestId, requestId)));
        const [mutation] = await tx.select({ receipt: receipts }).from(receipts).innerJoin(applications, eq(applications.id, receipts.applicationId)).where(and(
          eq(receipts.companyId, actor.companyId), eq(applications.promptId, promptId), eq(receipts.actorUserId, actor.userId), eq(receipts.requestId, requestId)));
        if (!mutation && target && query.action && query.expectedGeneration !== undefined) {
          const [head] = await tx.select().from(heads).where(and(eq(heads.companyId, actor.companyId), eq(heads.agentId, target.agentId))).for("share");
          const generation = head?.generation ?? 0;
          const reason = generation > query.expectedGeneration ? "generation_advanced" :
            query.action === "approve" && target.approvalExpiresAt <= new Date() ? "approval_expired" : null;
          if (reason) closure = { outcome: "not_applied_closed", requestId, action: query.action, applicationId: target.id, agentId: target.agentId,
            expectedGeneration: query.expectedGeneration, currentGeneration: generation, reason };
        }
        return { enabled: promptApplicationsEnabled(), application: proposal ? await record(tx, proposal) : null, receipt: mutation ? receipt(mutation.receipt) : null, closure };
      });
    },
    async dispatches(actor: PrivatePromptIdentity, promptId: string, id: string, beforeId?: string) {
      return db.transaction(async tx => {
        await authorizePrivatePrompt(tx, actor); await get(tx, actor, promptId, id);
        const rows = await tx.select().from(dispatches).where(and(eq(dispatches.companyId, actor.companyId), eq(dispatches.applicationId, id), beforeId ? lt(dispatches.id, beforeId) : undefined)).orderBy(desc(dispatches.id)).limit(51);
        return { items: rows.slice(0, 50).map(row => ({ id: row.id, applicationId: row.applicationId, agentId: row.agentId, runId: row.runId,
          issueId: row.issueId, generation: row.generation, state: row.state, configuredAt: row.configuredAt.toISOString(), preparedAt: row.preparedAt.toISOString(),
          dispatchedAt: row.dispatchedAt?.toISOString() ?? null, promptHash: row.promptHash, effectiveContextHash: row.effectiveContextHash, providerConsumed: false as const })), nextBeforeId: rows.length > 50 ? rows[49]!.id : null };
      });
    },
    async prepare(actor: PrivatePromptIdentity, promptId: string, raw: PreparePromptApplication) {
      const input = preparePromptApplicationSchema.parse(raw), digest = applicationDigest({ promptId, ...input });
      // Read retries return the existing immutable proposal, never refresh its expiry.
      const existing = await db.transaction(async tx => {
        await authorizePrivatePrompt(tx, actor);
        const [row] = await tx.select().from(applications).where(and(eq(applications.companyId, actor.companyId), eq(applications.requestId, input.requestId)));
        if (!row) return null;
        if (row.actorUserId !== actor.userId || row.requestDigest !== digest) throw conflict("prompt_application_request_conflict");
        return { item: await record(tx, row), duplicate: true };
      });
      if (existing) return existing;
      enabled();
      const report = await compare.compare(actor, promptId, input.comparison);
      if (!report.eligibleForHumanReview) throw unprocessable("prompt_application_comparison_blocked");
      return db.transaction(async tx => {
        await authorizePrivatePrompt(tx, actor); await lockRequest(tx, actor.companyId, input.requestId); await lockAgent(tx, actor.companyId, input.agentId);
        const head = await lockApplicationHead(tx, actor.companyId, input.agentId);
        const [prior] = await tx.select().from(applications).where(and(eq(applications.companyId, actor.companyId), eq(applications.requestId, input.requestId)));
        if (prior) {
          if (prior.actorUserId !== actor.userId || prior.requestDigest !== digest) throw conflict("prompt_application_request_conflict");
          return { item: await record(tx, prior), duplicate: true };
        }
        if (head.generation !== input.expectedGeneration) throw conflict("prompt_application_generation_changed");
        const snapshot = await resolvePromptApplicationTarget(tx, actor.companyId, input.agentId, actor.userId), id = randomUUID();
        const approvalExpiresAt = new Date(Date.now() + input.approvalValidForMinutes * 60000);
        const approvalDigest = applicationDigest({ id, companyId: actor.companyId, actorUserId: actor.userId, promptId, revisionId: report.candidate.revisionId,
          revisionHash: report.candidate.revisionHash, reportHash: report.reportHash, snapshot, expectedGeneration: head.generation, approvalExpiresAt: approvalExpiresAt.toISOString() });
        const [row] = await tx.insert(applications).values({ id, companyId: actor.companyId, promptId, revisionId: report.candidate.revisionId, revisionHash: report.candidate.revisionHash,
          agentId: input.agentId, actorUserId: actor.userId, actorSessionId: actor.sessionId, requestId: input.requestId, requestDigest: digest,
          expectedGeneration: head.generation, approvalDigest, comparison: input.comparison, reportHash: report.reportHash, snapshot, approvalExpiresAt }).returning();
        await audit(tx, actor, "prompt_application.prepared", row.id, { agentId: row.agentId, revisionId: row.revisionId, reportHash: row.reportHash, targetDigest: snapshot.targetDigest, executionStarted: false });
        return { item: await record(tx, row), duplicate: false };
      });
    },
    async approve(actor: PrivatePromptIdentity, promptId: string, id: string, raw: ApprovePromptApplication) {
      const input = approvePromptApplicationSchema.parse(raw), digest = applicationDigest({ action: "configure", promptId, id, ...input });
      const initial = await db.transaction(async tx => { await authorizePrivatePrompt(tx, actor); const row = await get(tx, actor, promptId, id);
        return { row, prior: await priorReceipt(tx, actor, id, input.requestId, digest) }; });
      if (initial.prior) return initial.prior;
      enabled();
      if (initial.row.actorUserId !== actor.userId) throw conflict("prompt_application_proposer_required");
      const report = await compare.compare(actor, promptId, initial.row.comparison);
      if (!report.eligibleForHumanReview || report.reportHash !== initial.row.reportHash) throw conflict("prompt_application_comparison_changed");
      return db.transaction(async tx => {
        await authorizePrivatePrompt(tx, actor); await lockRequest(tx, actor.companyId, input.requestId); await lockAgent(tx, actor.companyId, initial.row.agentId);
        const head = await lockApplicationHead(tx, actor.companyId, initial.row.agentId), row = await get(tx, actor, promptId, id);
        const prior = await priorReceipt(tx, actor, id, input.requestId, digest); if (prior) return prior;
        if (row.approvalExpiresAt <= new Date()) throw conflict("prompt_application_approval_expired");
        if (head.generation !== input.expectedGeneration || row.expectedGeneration !== input.expectedGeneration || row.approvalDigest !== input.approvalDigest) throw conflict("prompt_application_generation_or_digest_changed");
        assertApplicationTarget(row.snapshot, await resolvePromptApplicationTarget(tx, actor.companyId, row.agentId, actor.userId));
        await assertApplicationAttemptsStopped(tx, actor.companyId, row.agentId);
        if (!await agentExecutionsHaveStopped(tx as unknown as Db, [row.agentId])) throw conflict("prompt_application_agent_execution_not_stopped");
        const generation = head.generation + 1;
        // Transaction-start now() predates lock waits and file checks. This is
        // the configuration admission cutover, after all approval validation.
        const clock = await tx.execute(sql`select clock_timestamp() as cutover`);
        const configuredAt = clock[0].cutover instanceof Date ? clock[0].cutover : new Date(String(clock[0].cutover));
        const [saved] = await tx.insert(receipts).values({ companyId: actor.companyId, agentId: row.agentId, applicationId: row.id, action: "configure", generation, createdAt: configuredAt,
          actorUserId: actor.userId, actorSessionId: actor.sessionId, requestId: input.requestId, requestDigest: digest }).returning();
        await tx.update(heads).set({ generation, applicationId: row.id, configuredAt: saved.createdAt }).where(eq(heads.agentId, row.agentId));
        await audit(tx, actor, "prompt_application.configured", row.id, { agentId: row.agentId, receiptId: saved.id, generation, visibility: "ordinary_run_tools_logs_and_artifacts", bareComparisonNotToolQuality: true, executionStarted: false });
        return { receipt: receipt(saved), duplicate: false };
      });
    },
    async rollback(actor: PrivatePromptIdentity, promptId: string, id: string, raw: RollbackPromptApplication) {
      const input = rollbackPromptApplicationSchema.parse(raw), digest = applicationDigest({ action: "rollback", promptId, id, ...input });
      // Revocation is available even when new applications are disabled or drifted.
      return db.transaction(async tx => {
        await authorizePrivatePrompt(tx, actor); await lockRequest(tx, actor.companyId, input.requestId); const row = await get(tx, actor, promptId, id); await lockAgent(tx, actor.companyId, row.agentId);
        await assertApplicationConfigurationAuthority(tx, actor.companyId, row.agentId, actor.userId);
        const head = await lockApplicationHead(tx, actor.companyId, row.agentId), prior = await priorReceipt(tx, actor, id, input.requestId, digest); if (prior) return prior;
        if (head.generation !== input.expectedGeneration || head.applicationId !== row.id) throw conflict("prompt_application_current_binding_required");
        await assertApplicationAttemptsStopped(tx, actor.companyId, row.agentId);
        if (!await agentExecutionsHaveStopped(tx as unknown as Db, [row.agentId])) throw conflict("prompt_application_agent_execution_not_stopped");
        const generation = head.generation + 1;
        const [saved] = await tx.insert(receipts).values({ companyId: actor.companyId, agentId: row.agentId, applicationId: row.id, action: "rollback", generation,
          actorUserId: actor.userId, actorSessionId: actor.sessionId, requestId: input.requestId, requestDigest: digest }).returning();
        await tx.update(heads).set({ generation, applicationId: null, configuredAt: null }).where(eq(heads.agentId, row.agentId));
        await audit(tx, actor, "prompt_application.rolled_back", row.id, { agentId: row.agentId, receiptId: saved.id, generation, executionStarted: false, pastEffectsReverted: false });
        return { receipt: receipt(saved), duplicate: false };
      });
    },
  };
}
