import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, lte, ne, sql } from "drizzle-orm";
import { activityLog, mimouseCodingBuildObservationRequests as requests, mimouseCodingBuildObservationReceipts as receipts, type Db } from "@paperclipai/db";
import { mimouseBuildObservationSummarySchema, startMimouseBuildObservationSchema, closeMimouseBuildObservationSchema,
  type MimouseBuildObservationContext, type MimouseBuildObservationCurrentness, type MimouseBuildObservationPage,
  type MimouseBuildObservationReceipt, type MimouseBuildObservationRequestOutcome, type MimouseBuildObservationSummary,
  type StartMimouseBuildObservationInput, type CloseMimouseBuildObservationInput } from "@paperclipai/shared";
import { conflict, HttpError, notFound, tooManyRequests, unprocessable } from "../../errors.js";
import { authorizeObservation, bindObservation, observationDigest, observationTransaction, type ObservationIdentity, type ObservationTx } from "./build-observation-binding.js";
import { loadBuildObservationConfig, type BuildObservationConfig } from "./build-observation-config.js";
import { buildObservationExpired } from "./build-observation-freshness.js";
import { parseBuildObservationSecret } from "./build-observation-secret.js";
import { observeMimouseGitlabBuild } from "./gitlab-build-observer.js";
import type { GitlabBuildObservationTransport } from "./gitlab-build-observation-contract.js";

type RequestRow = typeof requests.$inferSelect;
type ReceiptRow = typeof receipts.$inferSelect;
export interface BuildObservationServiceDependencies {
  loadConfig?: () => Promise<BuildObservationConfig>;
  transport?: GitlabBuildObservationTransport;
  resolveSecret?: (companyId: string, secretId: string, version: number, actor: ObservationIdentity) => Promise<string>;
}
function failure(diagnostic: string): MimouseBuildObservationSummary {
  return { status: "blocked", diagnostic, admission: "blocked", jobRechecked: false, pipelineRechecked: false,
    provenance: { status: "not_checked", reason: "not_collected" },
    blockers: ["controller_provenance_unavailable", "workflow_closure_unassessed", "platform_unassessed", "tests_unassessed", "code_signature_unassessed"],
    otherFacts: { workflowClosure: "unassessed", platform: "unassessed", tests: "unassessed", artifactCodeSignature: "unassessed", controllerObservation: "blocked", c3: "blocked" } };
}
function safeError(error: unknown): HttpError {
  return error instanceof HttpError && /^observation_[a-z_]+$/.test(error.message) ? error : unprocessable("observation_unavailable");
}
async function dbTime(tx: ObservationTx) {
  const [row] = await tx.execute<{ now: string }>(sql`select clock_timestamp()::text as now`); return new Date(row.now);
}
export function buildObservationService(db: Db, deps: BuildObservationServiceDependencies = {}) {
  const config = deps.loadConfig ?? loadBuildObservationConfig;
  const resolveSecret = deps.resolveSecret ?? (async (companyId, secretId, version, actor) => {
    const { secretService } = await import("../secrets.js");
    return secretService(db).resolveSecretValue(companyId, secretId, version, { accessContext: {
      consumerType: "system", consumerId: "coding-build-observation", actorType: "user", actorId: actor.userId,
      actorSource: "session", responsibleUserId: actor.userId,
    } });
  });
  async function bindCurrent(tx: ObservationTx, actor: ObservationIdentity, delivery: Awaited<ReturnType<typeof authorizeObservation>>, profileId: string) {
    const loaded = await config();
    if (!loaded.enabled) throw unprocessable(loaded.diagnostic === "disabled" ? "observation_disabled" : "observation_config_invalid");
    const profile = loaded.profiles.find(item => item.companyId === actor.companyId && item.id === profileId);
    if (!profile) throw unprocessable("observation_profile_unavailable");
    return bindObservation(tx, actor, delivery, profile, loaded.digest);
  }
  async function current(tx: ObservationTx, actor: ObservationIdentity, deliveryId: string, profileId: string) {
    return bindCurrent(tx, actor, await authorizeObservation(tx, actor, deliveryId, { allowPausedCompany: true }), profileId);
  }
  async function currentness(tx: ObservationTx, actor: ObservationIdentity, row: RequestRow, receipt: ReceiptRow): Promise<MimouseBuildObservationCurrentness> {
    if (receipt.diagnostic === "observation_closed_unconfirmed") return { status: "unknown", reasons: ["historical_observation"] };
    try {
      const bound = await current(tx, actor, row.deliveryId, row.profileId); const now = await dbTime(tx);
      if (bound.snapshotDigest !== row.snapshotDigest) return { status: "stale", reasons: ["context_changed", "historical_observation"] };
      if (buildObservationExpired(bound.profile, receipt.result.provenance, receipt.observedAt ?? receipt.createdAt, now)) {
        return { status: "stale", reasons: ["verification_expired", "historical_observation"] };
      }
      return { status: "local_current", reasons: ["historical_observation"] };
    } catch (error) {
      if (error instanceof HttpError && [403, 404].includes(error.status)) throw error;
      return { status: "unknown", reasons: ["context_unavailable", "historical_observation"] };
    }
  }
  async function receiptDto(tx: ObservationTx, actor: ObservationIdentity, row: RequestRow, receipt: ReceiptRow): Promise<MimouseBuildObservationReceipt> {
    return { id: receipt.id, requestId: receipt.requestId, deliveryId: receipt.deliveryId, profileId: row.profileId,
      status: receipt.status, diagnostic: receipt.diagnostic, admission: "blocked", result: mimouseBuildObservationSummarySchema.parse(receipt.result),
      observedAt: receipt.observedAt?.toISOString() ?? null, createdAt: receipt.createdAt.toISOString(), currentness: await currentness(tx, actor, row, receipt) };
  }
  async function outcome(tx: ObservationTx, actor: ObservationIdentity, row: RequestRow): Promise<MimouseBuildObservationRequestOutcome> {
    const [receipt] = await tx.select().from(receipts).where(and(eq(receipts.companyId, actor.companyId), eq(receipts.requestId, row.requestId)));
    const now = await dbTime(tx); const live = row.leaseExpiresAt !== null && row.leaseExpiresAt > now;
    return { input: { requestId: row.requestId, profileId: row.profileId, jobId: row.jobId, expectedBinding: row.snapshotDigest }, requestId: row.requestId, state: row.state === "terminal" ? "terminal" : live ? "running"
      : row.attemptCount < 2 && row.retryUntil > now ? "retryable" : "interrupted", attemptCount: row.attemptCount,
      createdAt: row.createdAt.toISOString(), retryUntil: row.retryUntil.toISOString(), receipt: receipt ? await receiptDto(tx, actor, row, receipt) : null };
  }
  async function get(actor: ObservationIdentity, deliveryId: string, requestId: string) {
    return observationTransaction(db, async tx => {
      await authorizeObservation(tx, actor, deliveryId, { allowPausedCompany: true });
      const [row] = await tx.select().from(requests).where(and(eq(requests.companyId, actor.companyId), eq(requests.deliveryId, deliveryId), eq(requests.requestId, requestId)));
      if (!row || row.actorUserId !== actor.userId) throw notFound("observation_request_not_found");
      return outcome(tx, actor, row);
    });
  }
  async function fence(tx: ObservationTx, actor: ObservationIdentity, row: RequestRow, token: string) {
    const delivery = await authorizeObservation(tx, actor, row.deliveryId);
    const [live] = await tx.select().from(requests).where(and(eq(requests.companyId, actor.companyId), eq(requests.id, row.id),
      eq(requests.state, "running"), eq(requests.leaseToken, token), gt(requests.leaseExpiresAt, sql`clock_timestamp()`))).for("update");
    if (!live) throw conflict("observation_lease_lost");
    const bound = await bindCurrent(tx, actor, delivery, row.profileId);
    if (bound.snapshotDigest !== row.snapshotDigest) throw conflict("observation_context_changed");
    return bound;
  }
  async function persist(tx: ObservationTx, row: RequestRow, token: string, result: MimouseBuildObservationSummary) {
    const [changed] = await tx.update(requests).set({ state: "terminal", leaseToken: null, leaseExpiresAt: null, updatedAt: sql`clock_timestamp()` })
      .where(and(eq(requests.companyId, row.companyId), eq(requests.id, row.id), eq(requests.state, "running"), eq(requests.leaseToken, token),
        gt(requests.leaseExpiresAt, sql`clock_timestamp()`))).returning();
    if (!changed) throw conflict("observation_lease_lost");
    await recordReceipt(tx, row, result, "coding.build_observation.recorded");
  }
  async function recordReceipt(tx: ObservationTx, row: RequestRow, result: MimouseBuildObservationSummary, action: string) {
    await tx.insert(receipts).values({ companyId: row.companyId, deliveryId: row.deliveryId, requestId: row.requestId,
      status: result.status === "observed" ? "observed" : "blocked", diagnostic: result.diagnostic, result, admission: "blocked",
      snapshotDigest: row.snapshotDigest, observedAt: result.observedAt ? new Date(result.observedAt) : null });
    await tx.insert(activityLog).values({ companyId: row.companyId, actorType: "user", actorId: row.actorUserId,
      action, entityType: "coding_delivery", entityId: row.deliveryId,
      details: { requestId: row.requestId, diagnostic: result.diagnostic, admission: "blocked" } });
  }
  async function start(actor: ObservationIdentity, deliveryId: string, raw: StartMimouseBuildObservationInput, signal?: AbortSignal) {
    const input = startMimouseBuildObservationSchema.parse(raw); const requestDigest = observationDigest({ actorUserId: actor.userId, companyId: actor.companyId, deliveryId, input });
    const reserved = await observationTransaction(db, async tx => {
      const delivery = await authorizeObservation(tx, actor, deliveryId);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`build-observation:${actor.companyId}`}, 0))`);
      const [existing] = await tx.select().from(requests).where(and(eq(requests.companyId, actor.companyId), eq(requests.requestId, input.requestId))).for("update");
      if (existing && (existing.requestDigest !== requestDigest || existing.actorUserId !== actor.userId || existing.deliveryId !== deliveryId)) throw conflict("observation_request_conflict");
      const now = await dbTime(tx);
      if (existing && (existing.state === "terminal" || existing.leaseExpiresAt && existing.leaseExpiresAt > now)) return { kind: "existing" as const, value: await outcome(tx, actor, existing) };
      if (existing && (existing.attemptCount >= 2 || existing.retryUntil <= now)) throw conflict("observation_retry_exhausted");
      const active = await tx.select({ id: requests.id }).from(requests).where(and(eq(requests.companyId, actor.companyId), eq(requests.state, "running"),
        gt(requests.leaseExpiresAt, sql`clock_timestamp()`), existing ? ne(requests.id, existing.id) : undefined)).limit(1);
      if (active.length) throw tooManyRequests("observation_company_busy");
      if (!existing) {
        const recent = await tx.select({ id: requests.id }).from(requests).where(and(eq(requests.companyId, actor.companyId), gt(requests.createdAt, sql`clock_timestamp() - interval '1 hour'`))).limit(10);
        if (recent.length >= 10) throw tooManyRequests("observation_company_rate_limited");
      }
      const bound = await bindCurrent(tx, actor, delivery, input.profileId);
      if (bound.snapshotDigest !== input.expectedBinding || existing && existing.snapshotDigest !== bound.snapshotDigest) throw conflict("observation_context_changed");
      const token = randomUUID();
      const [row] = existing ? await tx.update(requests).set({ leaseToken: token, leaseExpiresAt: sql`least(clock_timestamp() + interval '45 seconds', ${requests.retryUntil})`,
        attemptCount: existing.attemptCount + 1, actorSessionId: actor.sessionId, updatedAt: sql`clock_timestamp()` }).where(eq(requests.id, existing.id)).returning()
        : await tx.insert(requests).values({ companyId: actor.companyId, deliveryId, actorUserId: actor.userId, actorSessionId: actor.sessionId,
          requestId: input.requestId, requestDigest, snapshotDigest: bound.snapshotDigest, profileId: input.profileId, jobId: input.jobId,
          leaseToken: token, leaseExpiresAt: sql`clock_timestamp() + interval '45 seconds'`, retryUntil: sql`clock_timestamp() + interval '5 minutes'` }).returning();
      return { kind: "reserved" as const, row, bound, token };
    });
    if (reserved.kind === "existing") return reserved.value;
    const { row, bound, token } = reserved;
    try {
      signal?.throwIfAborted();
      await observationTransaction(db, tx => fence(tx, actor, row, token));
      const credential = await resolveSecret(actor.companyId, bound.credential.secretId, bound.credential.version, actor);
      if (createHash("sha256").update(credential).digest("hex") !== bound.credential.valueSha256) throw conflict("observation_credential_changed");
      let gitlabToken: string;
      try { gitlabToken = parseBuildObservationSecret(credential); } catch { throw unprocessable("observation_secret_invalid"); }
      const now = new Date();
      const result = await observeMimouseGitlabBuild({ token: gitlabToken, signal, provenancePolicy: bound.profile.provenancePolicy ?? undefined,
        context: { companyId: actor.companyId, operationId: row.id, projectId: bound.profile.observer.projectId, pipelineId: bound.pipelineId,
          jobId: row.jobId, source: { uri: bound.profile.observer.sourceUri, digest: { gitCommit: bound.headSha } },
          subject: { name: bound.profile.subjectName, digest: { sha256: bound.artifact.sha256 } }, expectedSizeBytes: bound.artifact.sizeBytes,
          buildNotBefore: new Date(now.getTime() - (bound.profile.provenancePolicy?.maxBuildAgeSeconds ?? bound.profile.maxObservationAgeSeconds) * 1000).toISOString() },
      }, bound.profile.observer, { transport: deps.transport, beforeDispatch: async () => {
        await observationTransaction(db, tx => fence(tx, actor, row, token));
      } });
      const { binding: _binding, ...summary } = result;
      await observationTransaction(db, async tx => {
        await fence(tx, actor, row, token); await persist(tx, row, token, mimouseBuildObservationSummarySchema.parse(summary));
      });
    } catch (error) {
      // A revoked actor gets no private result. Only the leased request can be
      // closed internally, with an empty diagnostic receipt (no fetched facts).
      const safe = safeError(error);
      await observationTransaction(db, tx => persist(tx, row, token, failure(safe.message))).catch(() => undefined);
      throw safe;
    }
    return get(actor, deliveryId, row.requestId); // Fresh authorization after the write, before responding.
  }
  async function context(actor: ObservationIdentity, deliveryId: string): Promise<MimouseBuildObservationContext> {
    return observationTransaction(db, async tx => {
      const delivery = await authorizeObservation(tx, actor, deliveryId); const loaded = await config();
      if (!loaded.enabled) return { enabled: false, diagnostic: loaded.diagnostic, profiles: [] };
      const profiles: MimouseBuildObservationContext["profiles"] = [];
      for (const profile of loaded.profiles.filter(item => item.companyId === actor.companyId)) {
        try { const bound = await bindObservation(tx, actor, delivery, profile, loaded.digest);
          profiles.push({ id: profile.id, expectedBinding: bound.snapshotDigest, artifactName: bound.artifact.fileName, pipelineId: bound.pipelineId, headSha: bound.headSha });
        } catch (error) { if (!(error instanceof HttpError)) throw error; }
      }
      return { enabled: true, diagnostic: profiles.length ? "observation_available" : "observation_identity_unavailable", profiles };
    });
  }
  async function history(actor: ObservationIdentity, deliveryId: string, cursor?: string): Promise<MimouseBuildObservationPage> {
    return observationTransaction(db, async tx => {
      await authorizeObservation(tx, actor, deliveryId, { allowPausedCompany: true });
      const [anchor] = cursor ? await tx.select().from(receipts).where(and(eq(receipts.companyId, actor.companyId), eq(receipts.deliveryId, deliveryId), eq(receipts.id, cursor))) : [];
      if (cursor && !anchor) throw notFound("observation_cursor_not_found");
      const rows = await tx.select({ receipt: receipts, request: requests }).from(receipts).innerJoin(requests,
        and(eq(requests.companyId, receipts.companyId), eq(requests.requestId, receipts.requestId))).where(and(eq(receipts.companyId, actor.companyId),
          eq(receipts.deliveryId, deliveryId), anchor ? sql`(${receipts.createdAt}, ${receipts.id}) < (${anchor.createdAt}, ${anchor.id})` : undefined))
        .orderBy(desc(receipts.createdAt), desc(receipts.id)).limit(11);
      const page = rows.slice(0, 10); const result: MimouseBuildObservationReceipt[] = [];
      for (const item of page) result.push(await receiptDto(tx, actor, item.request, item.receipt));
      return { receipts: result, nextCursor: rows.length > 10 ? page[page.length - 1].receipt.id : null };
    });
  }
  async function currentRequest(actor: ObservationIdentity, deliveryId: string) {
    return observationTransaction(db, async tx => {
      await authorizeObservation(tx, actor, deliveryId, { allowPausedCompany: true });
      const [row] = await tx.select().from(requests).where(and(eq(requests.companyId, actor.companyId), eq(requests.deliveryId, deliveryId),
        eq(requests.actorUserId, actor.userId))).orderBy(desc(requests.createdAt), desc(requests.id)).limit(1);
      return { request: row ? await outcome(tx, actor, row) : null };
    });
  }
  async function closeUnknown(actor: ObservationIdentity, deliveryId: string, raw: CloseMimouseBuildObservationInput) {
    const { confirmClose: _confirm, ...input } = closeMimouseBuildObservationSchema.parse(raw);
    const requestDigest = observationDigest({ actorUserId: actor.userId, companyId: actor.companyId, deliveryId, input });
    await observationTransaction(db, async tx => {
      await authorizeObservation(tx, actor, deliveryId, { allowPausedCompany: true });
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`build-observation:${actor.companyId}`}, 0))`);
      const [existing] = await tx.select().from(requests).where(and(eq(requests.companyId, actor.companyId), eq(requests.requestId, input.requestId))).for("update");
      if (existing && (existing.requestDigest !== requestDigest || existing.actorUserId !== actor.userId || existing.deliveryId !== deliveryId)) throw conflict("observation_request_conflict");
      if (existing?.state === "terminal") return;
      const now = await dbTime(tx);
      if (existing?.leaseExpiresAt && existing.leaseExpiresAt > now) throw conflict("observation_request_in_progress");
      if (!existing) {
        const recent = await tx.select({ id: requests.id }).from(requests).where(and(eq(requests.companyId, actor.companyId), gt(requests.createdAt, sql`clock_timestamp() - interval '1 hour'`))).limit(10);
        if (recent.length >= 10) throw tooManyRequests("observation_company_rate_limited");
      }
      const [row] = existing ? await tx.update(requests).set({ state: "terminal", leaseToken: null, leaseExpiresAt: null, updatedAt: sql`clock_timestamp()` })
        .where(and(eq(requests.id, existing.id), eq(requests.state, "running"), lte(requests.leaseExpiresAt, sql`clock_timestamp()`))).returning()
        : await tx.insert(requests).values({ companyId: actor.companyId, deliveryId, actorUserId: actor.userId, actorSessionId: actor.sessionId,
          requestId: input.requestId, requestDigest, snapshotDigest: input.expectedBinding, profileId: input.profileId, jobId: input.jobId,
          state: "terminal", leaseToken: null, leaseExpiresAt: null, retryUntil: sql`clock_timestamp() + interval '5 minutes'` }).returning();
      if (!row) throw conflict("observation_request_in_progress");
      // This negative marker blocks future same-ID dispatch. It says NOTHING
      // about whether an earlier read happened, and never cancels remote work.
      await recordReceipt(tx, row, failure("observation_closed_unconfirmed"), "coding.build_observation.closed");
    });
    return get(actor, deliveryId, input.requestId);
  }
  return { start, context, get, history, currentRequest, closeUnknown };
}
