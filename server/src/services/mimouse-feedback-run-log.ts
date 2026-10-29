import { createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { activityLog, authSessions, heartbeatRuns as runs, heartbeatRunEvents as events, mimouseFeedbackInbox as inbox, type Db } from "@paperclipai/db";
import { RUN_LOG_SOURCE_INSTANCE, feedbackRunLogSelectionSchema, feedbackRunLogImportSchema, feedbackRunLogReferenceSchema,
  type FeedbackRunLogSelection, type FeedbackRunLogImport, type FeedbackRunLogReference } from "@paperclipai/shared/mimouse-feedback-run-log";
import { conflict, forbidden, notFound } from "../errors.js";
import { authorizationService, type AuthorizationActor } from "./authorization.js";
import { canActorReadHeartbeatRun } from "./heartbeat-run-privacy.js";
import { assertFeedbackReviewer } from "./mimouse-evaluation/feedback-lineage.js";
import { feedbackInboxService } from "./mimouse-feedback.js";
import { canonical } from "./mimouse-operations/preview.js";
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const unavailable = () => notFound("Run-log source not accessible");
export function runLogPreviewDigest(reference: FeedbackRunLogReference, actor: AuthorizationActor) {
  return digest({ purpose: "feedback_run_log_preview_v1", actorUserId: actor.userId, sessionId: actor.sessionId, reference });
}
async function reviewer(tx: Tx, companyId: string, actor: AuthorizationActor) {
  if (actor.type !== "board" || actor.source !== "session" || !actor.userId || !actor.sessionId) throw forbidden("A signed-in human must review run-log references");
  const [session] = await tx.select({ id: authSessions.id }).from(authSessions).where(and(eq(authSessions.id, actor.sessionId), eq(authSessions.userId, actor.userId), gt(authSessions.expiresAt, sql`clock_timestamp()`))).for("share");
  if (!session) throw forbidden("A current signed-in session is required");
  await assertFeedbackReviewer(tx, companyId, actor.userId);
}
async function load(tx: Tx, companyId: string, actor: AuthorizationActor, input: FeedbackRunLogSelection) {
  // Explicit projections: never load contextSnapshot, provider fields, messages,
  // payloads, stdout/stderr, log paths, or private task text, even for hashing.
  const [run] = await tx.select({ id: runs.id, companyId: runs.companyId, agentId: runs.agentId,
    scopeKind: runs.scopeKind, issueId: runs.issueId,
    createdAt: sql<string>`to_char(${runs.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  }).from(runs).where(and(eq(runs.id, input.runId), eq(runs.companyId, companyId))).for("share");
  if (!run) throw unavailable();
  const access = authorizationService(tx);
  const allowed = async () => run && (await access.decide({ actor, action: "company_scope:read", resource: { type: "company", companyId } })).allowed
    && await canActorReadHeartbeatRun(tx as unknown as Db, access, actor, run);
  if (!await allowed()) throw unavailable();
  const [event] = await tx.select({ id: sql<string>`${events.id}::text`, companyId: events.companyId, runId: events.runId, agentId: events.agentId, seq: events.seq,
    createdAt: sql<string>`to_char(${events.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  }).from(events).where(and(eq(events.companyId, companyId), eq(events.runId, run.id), eq(events.seq, input.eventSeq))).for("share");
  if (!event || event.agentId !== run.agentId || !Number.isSafeInteger(event.seq) || event.seq <= 0) throw unavailable();
  const metadata = { contractVersion: "feedback-run-log-reference-v1" as const, companyId, runId: run.id,
    eventId: event.id, eventSeq: event.seq, runCreatedAt: run.createdAt, eventCreatedAt: event.createdAt };
  const reference = feedbackRunLogReferenceSchema.parse({ ...metadata, referenceDigest: digest(metadata),
    softwareVersion: "unknown", commitSha: null, reproduction: "not_performed", contentIncluded: false });
  return { reference, allowed };
}
/** Manual confirmation of content-free references only; no execution or publication. */
export function feedbackRunLogService(db: Db) {
  return {
    async preview(companyId: string, actor: AuthorizationActor, raw: FeedbackRunLogSelection) {
      const input = feedbackRunLogSelectionSchema.parse(raw);
      return db.transaction(async tx => {
        await reviewer(tx, companyId, actor);
        const { reference } = await load(tx, companyId, actor, input);
        return { reference, previewDigest: runLogPreviewDigest(reference, actor) };
      });
    },
    async import(companyId: string, actor: AuthorizationActor, raw: FeedbackRunLogImport) {
      const input = feedbackRunLogImportSchema.parse(raw);
      return db.transaction(async tx => {
        // One selected event serializes imports across users/processes; existing
        // source-event uniqueness remains the final database fence.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`feedback-run-log:${companyId}:${input.runId}:${input.eventSeq}`},0))`);
        await reviewer(tx, companyId, actor);
        const { reference, allowed } = await load(tx, companyId, actor, input);
        if (runLogPreviewDigest(reference, actor) !== input.previewDigest) throw conflict("Run-log reference changed; preview again");
        const externalId = `${reference.runId}:${reference.eventSeq}`;
        const [prior] = await tx.select({ id: inbox.id, contentDigest: inbox.contentDigest }).from(inbox).where(and(eq(inbox.companyId, companyId), eq(inbox.sourceKind, "application_log"), eq(inbox.sourceInstance, RUN_LOG_SOURCE_INSTANCE), eq(inbox.externalId, externalId))).for("share");
        // Recheck original visibility even for a duplicate. A candidate is never
        // a grant to the source, and changed metadata is not a second event.
        await reviewer(tx, companyId, actor);
        if (!await allowed()) throw unavailable();
        if (prior) {
          if (prior.contentDigest !== reference.referenceDigest) throw conflict("Run-log source identity changed");
          return { item: await feedbackInboxService(tx as unknown as Db).get(companyId, prior.id), duplicate: true };
        }
        const [row] = await tx.insert(inbox).values({ companyId, actorId: actor.userId!, sourceKind: "application_log", sourceInstance: RUN_LOG_SOURCE_INSTANCE, externalId,
          contentDigest: reference.referenceDigest, candidateKey: digest(["run-log", companyId, reference.eventId]), title: "Internal run-log reference",
          body: canonical(reference), product: "Paperclip", softwareVersion: "unknown", commitSha: null, traceId: null,
          occurredAt: new Date(reference.eventCreatedAt), redacted: false }).returning({ id: inbox.id });
        // Audit is atomic, content-free, and does not publish notifications or
        // plugin events. No source task linkage is disclosed to other reviewers.
        await tx.insert(activityLog).values({ companyId, actorType: "user", actorId: actor.userId!, action: "feedback.run_log.imported",
          entityType: "feedback", entityId: row.id, details: { referenceDigest: reference.referenceDigest } });
        return { item: await feedbackInboxService(tx as unknown as Db).get(companyId, row.id), duplicate: false };
      });
    },
    async source(companyId: string, actor: AuthorizationActor, feedbackId: string) {
      return db.transaction(async tx => {
        await reviewer(tx, companyId, actor);
        const [row] = await tx.select({ body: inbox.body, contentDigest: inbox.contentDigest, externalId: inbox.externalId }).from(inbox).where(and(eq(inbox.id, feedbackId), eq(inbox.companyId, companyId), eq(inbox.sourceKind, "application_log"), eq(inbox.sourceInstance, RUN_LOG_SOURCE_INSTANCE))).for("share");
        if (!row) throw unavailable();
        let stored: FeedbackRunLogReference;
        try { stored = feedbackRunLogReferenceSchema.parse(JSON.parse(row.body)); } catch { throw unavailable(); }
        if (stored.companyId !== companyId || row.externalId !== `${stored.runId}:${stored.eventSeq}` || row.contentDigest !== stored.referenceDigest) throw unavailable();
        const { reference, allowed } = await load(tx, companyId, actor, stored);
        if (canonical(reference) !== canonical(stored)) throw conflict("Run-log source identity changed");
        if (!await allowed()) throw unavailable();
        return { reference };
      });
    },
  };
}
