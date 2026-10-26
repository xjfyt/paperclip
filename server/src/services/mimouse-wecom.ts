import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { activityLog, companies, instanceUserRoles, companySecrets, companySecretVersions, mimouseFeedbackInbox as inbox, type Db } from "@paperclipai/db";
import { mimouseWecomConnections as connections } from "@paperclipai/db/schema/mimouse_wecom";
import type { FeedbackImportInput } from "@paperclipai/shared";
import { conflict, forbidden, HttpError, notFound, unprocessable } from "../errors.js";
import { prepareFeedbackImport } from "./mimouse-feedback.js";
import { wecomConfigSchema, type WecomConfig, type WecomStopReason } from "./mimouse-wecom/protocol.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Actor = { actorType: "agent" | "user" | "system" | "plugin"; actorId: string };
export type WecomLease = { companyId: string; id: string; token: string; config: WecomConfig };
const systemActor: Actor = { actorType: "system", actorId: "wecom-inbound" };
const scope = (companyId: string, id: string) => and(eq(connections.companyId, companyId), eq(connections.id, id));
const botHash = (id: string) => createHash("sha256").update(id).digest("hex");
const activeLease = (lease: WecomLease) => and(scope(lease.companyId, lease.id), eq(connections.enabled, true),
  eq(connections.leaseToken, lease.token), gt(connections.leaseExpiresAt, sql`clock_timestamp()`));
function publicConnection(row: typeof connections.$inferSelect) {
  // No bot IDs, sender/group IDs, aliases, references, credentials or lease tokens in status.
  return { id: row.id, companyId: row.companyId, product: row.config.product, transport: row.config.transport,
    enabled: row.enabled, state: row.state, gapDetected: row.gapDetected, imported: row.imported,
    allowedGroupCount: row.config.allowedGroupIds.length, allowedDirectSenderCount: row.config.allowedDirectSenderIds.length,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    replaySupported: false, sourceTrust: { preset: "low_trust_review", disposition: "quarantined" } as const };
}
async function assertCredential(tx: Tx, companyId: string, config: WecomConfig) {
  const [secret] = await tx.select({ id: companySecrets.id, scope: companySecrets.scope, status: companySecrets.status, deletedAt: companySecrets.deletedAt })
    .from(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.id, config.secret.secretId))).for("share");
  const [version] = await tx.select({ status: companySecretVersions.status, revokedAt: companySecretVersions.revokedAt })
    .from(companySecretVersions).where(and(eq(companySecretVersions.secretId, config.secret.secretId), eq(companySecretVersions.version, config.secret.version))).for("share");
  if (!secret || secret.scope !== "company" || secret.status !== "active" || secret.deletedAt || !version || version.revokedAt ||
      !["current", "previous"].includes(version.status)) throw unprocessable("Active pinned company credential required");
}
async function audit(tx: Tx, companyId: string, id: string, actor: Actor, action: string) {
  await tx.insert(activityLog).values({ companyId, ...actor, action, entityType: "wecom_connection", entityId: id,
    responsibleUserId: actor.actorType === "user" ? actor.actorId : null, details: { provider: "wecom_smart_bot", receiveOnly: true } });
}
async function boundedTransaction<T>(db: Db, work: (tx: Tx) => Promise<T>) {
  return db.transaction(async tx => {
    // Server-enforced per-statement/lock bounds, scoped to this transaction only.
    await tx.execute(sql`select set_config('lock_timeout', '1000', true), set_config('statement_timeout', '2000', true), set_config('idle_in_transaction_session_timeout', '5000', true)`);
    return work(tx);
  });
}
async function requireRegistrar(tx: Tx, actor: Actor) {
  if (actor.actorType !== "user") throw forbidden("Instance administrator registration required");
  const [role] = await tx.select({ id: instanceUserRoles.id }).from(instanceUserRoles)
    .where(and(eq(instanceUserRoles.userId, actor.actorId), eq(instanceUserRoles.role, "instance_admin"))).for("share");
  if (!role) throw forbidden("Instance administrator registration required");
}
// Always lock company first, then connection, then credential rows. A pause/archive
// transaction cannot commit while an authorized receive transaction is in flight.
async function activeCompany(tx: Tx, companyId: string) {
  const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).for("share");
  return company?.status === "active";
}
async function requireActiveCompany(tx: Tx, companyId: string) {
  if (!await activeCompany(tx, companyId)) throw conflict("Active company required");
}
async function stopInactiveCompany(tx: Tx, companyId: string, id: string) {
  await tx.update(connections).set({ enabled: false, state: "company_inactive", gapDetected: true,
    leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() }).where(scope(companyId, id));
  await audit(tx, companyId, id, systemActor, "feedback.wecom.stopped");
}
/** No network side effects in configuration; worker ownership is fenced by PostgreSQL. */
export function wecomFeedbackService(db: Db) {
  return {
    async create(companyId: string, raw: WecomConfig, actor: Actor) {
      const config = wecomConfigSchema.parse(raw);
      return boundedTransaction(db, async tx => {
        await requireActiveCompany(tx, companyId);
        await requireRegistrar(tx, actor);
        await assertCredential(tx, companyId, config);
        const [row] = await tx.insert(connections).values({ companyId, config, botHash: botHash(config.botId) })
          .onConflictDoNothing({ target: connections.botHash }).returning();
        if (!row) throw conflict("Bot identity is already reserved; update its existing configuration instead");
        await audit(tx, companyId, row.id, actor, "feedback.wecom.created");
        return publicConnection(row);
      });
    },
    async update(companyId: string, id: string, raw: WecomConfig, actor: Actor) {
      const config = wecomConfigSchema.parse(raw);
      return boundedTransaction(db, async tx => {
        await requireActiveCompany(tx, companyId);
        const [row] = await tx.select().from(connections).where(scope(companyId, id)).for("update");
        if (!row) throw notFound("WeCom connection not found");
        if (row.enabled || row.leaseToken) throw conflict("Disable the connection before changing configuration");
        if (row.botHash !== botHash(config.botId)) throw conflict("Bot identity is immutable");
        await assertCredential(tx, companyId, config);
        const [updated] = await tx.update(connections).set({ config, updatedAt: new Date() }).where(scope(companyId, id)).returning();
        await audit(tx, companyId, id, actor, "feedback.wecom.updated");
        return publicConnection(updated);
      });
    },
    async list(companyId: string) {
      return (await db.select().from(connections).where(eq(connections.companyId, companyId)).orderBy(desc(connections.createdAt)).limit(100)).map(publicConnection);
    },
    async setEnabled(companyId: string, id: string, enabled: boolean, actor: Actor) {
      return boundedTransaction(db, async tx => {
        if (enabled) await requireActiveCompany(tx, companyId);
        const [row] = await tx.select().from(connections).where(scope(companyId, id)).for("update");
        if (!row) throw notFound("WeCom connection not found");
        if (enabled) await assertCredential(tx, companyId, row.config);
        // Idempotent enable cannot steal a live lease or reset a displacement stop.
        if (row.enabled === enabled) return publicConnection(row);
        const [updated] = await tx.update(connections).set({ enabled, state: enabled ? "pending" : "disabled",
          leaseToken: null, leaseExpiresAt: null, gapDetected: row.gapDetected || !enabled, updatedAt: new Date() }).where(scope(companyId, id)).returning();
        await audit(tx, companyId, id, actor, enabled ? "feedback.wecom.enabled" : "feedback.wecom.disabled");
        return publicConnection(updated);
      });
    },
    async acquire(companyId: string, id: string): Promise<WecomLease | null> {
      return boundedTransaction(db, async tx => {
        const active = await activeCompany(tx, companyId);
        const [row] = await tx.select().from(connections).where(and(scope(companyId, id), eq(connections.enabled, true),
          or(isNull(connections.leaseToken), lte(connections.leaseExpiresAt, sql`clock_timestamp()`)))).for("update", { skipLocked: true });
        if (!row) return null;
        if (!active) { await stopInactiveCompany(tx, companyId, id); return null; }
        try { await assertCredential(tx, companyId, row.config); }
        catch (error) {
          if (!(error instanceof HttpError) || error.status !== 422) throw error;
          // Commit the revocation stop instead of rolling it back with an exception.
          await tx.update(connections).set({ enabled: false, state: "revoked", gapDetected: true,
            leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() }).where(scope(companyId, id));
          await audit(tx, companyId, id, systemActor, "feedback.wecom.stopped");
          return null;
        }
        const config = wecomConfigSchema.parse(row.config), token = randomUUID();
        await tx.update(connections).set({ leaseToken: token, leaseExpiresAt: sql`clock_timestamp() + interval '30 seconds'`,
          state: "connecting", gapDetected: row.gapDetected || row.leaseToken !== null, updatedAt: new Date() }).where(scope(companyId, id));
        return { companyId, id, token, config };
      });
    },
    async renew(lease: WecomLease) {
      return boundedTransaction(db, async tx => {
        const active = await activeCompany(tx, lease.companyId);
        const [row] = await tx.select().from(connections).where(activeLease(lease)).for("update");
        if (!row) return false;
        if (!active) { await stopInactiveCompany(tx, lease.companyId, lease.id); return false; }
        await assertCredential(tx, lease.companyId, row.config);
        const updated = await tx.update(connections).set({ leaseExpiresAt: sql`clock_timestamp() + interval '30 seconds'`, updatedAt: new Date() })
          .where(activeLease(lease)).returning({ id: connections.id });
        return updated.length === 1;
      });
    },
    async resolveCredential(lease: WecomLease) {
      // Commit lifecycle stops before rejecting; do not roll them back via throw.
      const readAuthorizedConfig = () => boundedTransaction(db, async tx => {
        const active = await activeCompany(tx, lease.companyId);
        const [row] = await tx.select().from(connections).where(activeLease(lease)).for("update");
        if (!row) throw conflict("WeCom worker lease lost");
        if (!active) { await stopInactiveCompany(tx, lease.companyId, lease.id); return null; }
        await assertCredential(tx, lease.companyId, row.config);
        return row.config;
      });
      const config = await readAuthorizedConfig();
      if (!config) throw conflict("Active company required");
      const { secretService } = await import("./secrets.js");
      const value = await secretService(db).resolveSecretValue(lease.companyId, config.secret.secretId, config.secret.version);
      if (!await readAuthorizedConfig()) throw conflict("Active company required");
      if (!value.trim()) throw unprocessable("Active nonempty company credential required");
      return value;
    },
    async markAuthenticated(lease: WecomLease) {
      return boundedTransaction(db, async tx => {
        const active = await activeCompany(tx, lease.companyId);
        const [row] = await tx.select().from(connections).where(activeLease(lease)).for("update");
        if (!row) return false;
        if (!active) { await stopInactiveCompany(tx, lease.companyId, lease.id); return false; }
        await assertCredential(tx, lease.companyId, row.config);
        const updated = await tx.update(connections).set({ state: "authenticated", updatedAt: new Date() })
          .where(activeLease(lease)).returning({ id: connections.id });
        return updated.length === 1;
      });
    },
    async markGap(lease: WecomLease) {
      return boundedTransaction(db, async tx => {
        const active = await activeCompany(tx, lease.companyId);
        const [row] = await tx.select().from(connections).where(activeLease(lease)).for("update");
        if (!row) return false;
        if (!active) { await stopInactiveCompany(tx, lease.companyId, lease.id); return false; }
        const updated = await tx.update(connections).set({ gapDetected: true, state: "reconnecting", updatedAt: new Date() })
          .where(activeLease(lease)).returning({ id: connections.id });
        return updated.length === 1;
      });
    },
    async release(lease: WecomLease, reason: WecomStopReason) {
      return boundedTransaction(db, async tx => {
        const [row] = await tx.update(connections).set({ leaseToken: null, leaseExpiresAt: null, state: reason,
          enabled: false, gapDetected: true, updatedAt: new Date() })
          .where(and(scope(lease.companyId, lease.id), eq(connections.leaseToken, lease.token))).returning();
        if (row) await audit(tx, lease.companyId, lease.id, systemActor, "feedback.wecom.stopped");
      });
    },
    async persist(lease: WecomLease, raw: FeedbackImportInput, signal?: AbortSignal, knownCredential?: string) {
      const result = await boundedTransaction(db, async tx => {
        signal?.throwIfAborted();
        const active = await activeCompany(tx, lease.companyId);
        const [row] = await tx.select().from(connections).where(activeLease(lease)).for("update");
        if (!row) throw conflict("WeCom worker lease lost");
        if (!active) { await stopInactiveCompany(tx, lease.companyId, lease.id); return null; }
        await assertCredential(tx, lease.companyId, row.config);
        // Internal worker-only literal redaction; never accept product attribution from a payload.
        const product = knownCredential ? row.config.product.split(knownCredential).join("[REDACTED]") : row.config.product;
        const item = prepareFeedbackImport({ ...raw, sourceKind: "wecom_smart_bot", product,
          sourceInstance: `wecom:${row.botHash}`, softwareVersion: "", commitSha: null, traceId: null });
        item.redacted ||= product !== row.config.product || raw.text.includes("[REDACTED]");
        signal?.throwIfAborted();
        // First snapshot wins. No replay overwrites even when provider payload changes.
        const inserted = await tx.insert(inbox).values({ ...item, companyId: row.companyId, actorId: systemActor.actorId, ingestionMode: "provider_push" })
          .onConflictDoNothing({ target: [inbox.companyId, inbox.sourceKind, inbox.sourceInstance, inbox.externalId] }).returning({ id: inbox.id });
        if (inserted.length) await audit(tx, row.companyId, row.id, systemActor, "feedback.wecom.received");
        const updated = await tx.update(connections).set({ state: "receiving", imported: row.imported + inserted.length, updatedAt: new Date() })
          .where(activeLease(lease)).returning({ id: connections.id });
        if (!updated.length) throw conflict("WeCom worker lease expired");
        signal?.throwIfAborted();
        return inserted.length === 1;
      });
      if (result === null) throw conflict("Active company required");
      return result;
    },
  };
}
