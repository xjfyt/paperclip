import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { activityLog, companySecrets, companySecretVersions, mimouseFeedbackInbox as inbox, type Db } from "@paperclipai/db";
import { mimouseLangfusePulls as pulls } from "@paperclipai/db/schema/mimouse_langfuse";
import { conflict, notFound, unprocessable } from "../errors.js";
import { langfuseCreateSchema, readLangfusePage, type LangfuseConfig, type LangfuseTransport } from "./mimouse-langfuse/protocol.js";
type Actor = { actorType: "agent" | "user" | "system" | "plugin"; actorId: string };
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
function publicPull(row: typeof pulls.$inferSelect) {
  return { id: row.id, companyId: row.companyId, origin: row.config.origin, projectId: row.config.projectId,
    product: row.config.product, from: row.config.from, to: row.config.to, api: row.config.api,
    completed: row.completed, pages: row.pages, imported: row.imported,
    hasMore: !row.completed, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    sourceTrust: { preset: "low_trust_review", disposition: "quarantined" } as const };
}
async function assertReferences(tx: Tx, companyId: string, config: LangfuseConfig, lock = false) {
  for (const ref of [config.publicKey, config.secretKey]) {
    const secrets = tx.select().from(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.id, ref.secretId)));
    const versions = tx.select().from(companySecretVersions).where(and(eq(companySecretVersions.secretId, ref.secretId), eq(companySecretVersions.version, ref.version)));
    const [secret] = lock ? await secrets.for("share") : await secrets;
    const [version] = lock ? await versions.for("share") : await versions;
    if (!secret || secret.scope !== "company" || secret.status !== "active" || !version || version.revokedAt || ["disabled", "destroyed"].includes(version.status)) throw unprocessable("Active company-scoped credential references and pinned versions required");
  }
}
async function audit(tx: Tx, companyId: string, id: string, actor: Actor, action: string) {
  // Atomic durable audit, fixed allowlisted details only; no response/config/secret material.
  await tx.insert(activityLog).values({ companyId, ...actor, action, entityType: "langfuse_pull", entityId: id,
    responsibleUserId: actor.actorType === "user" ? actor.actorId : null, details: { provider: "langfuse", readOnly: true } });
}
/** Test seams are dependency injection only; production routes never supply them. */
export function langfuseFeedbackService(db: Db, testOnly?: {
  transport: LangfuseTransport;
  resolveSecret: (companyId: string, secretId: string, version: number) => Promise<string>;
}) {
  const scope = (companyId: string, id: string) => and(eq(pulls.companyId, companyId), eq(pulls.id, id));
  return {
    async create(companyId: string, raw: { requestId: string; config: LangfuseConfig }, actor: Actor) {
      const input = langfuseCreateSchema.parse(raw), configDigest = createHash("sha256").update(JSON.stringify(input.config)).digest("hex");
      return db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`langfuse-create:${companyId}:${input.requestId}`},0))`);
        const [prior] = await tx.select().from(pulls).where(and(eq(pulls.companyId, companyId), eq(pulls.requestId, input.requestId)));
        if (prior) {
          if (prior.configDigest !== configDigest || prior.actorId !== actor.actorId) throw conflict("Read job request already has different configuration or actor");
          return publicPull(prior);
        }
        await assertReferences(tx, companyId, input.config, true);
        const [row] = await tx.insert(pulls).values({ companyId, config: input.config, requestId: input.requestId, configDigest, actorId: actor.actorId }).returning();
        await audit(tx, companyId, row.id, actor, "feedback.langfuse.created");
        return publicPull(row);
      });
    },
    async list(companyId: string) {
      return (await db.select().from(pulls).where(eq(pulls.companyId, companyId)).orderBy(desc(pulls.createdAt)).limit(50)).map(publicPull);
    },
    async restart(companyId: string, id: string, actor: Actor) {
      return db.transaction(async tx => {
        const [row] = await tx.update(pulls).set({ cursor: null, cursorDigests: [], completed: false, pages: 0, updatedAt: new Date() }).where(scope(companyId, id)).returning();
        if (!row) throw notFound("Langfuse pull not found");
        await audit(tx, companyId, id, actor, "feedback.langfuse.restarted");
        return publicPull(row);
      });
    },
    async pull(companyId: string, id: string, actor: Actor, signal?: AbortSignal) {
      return db.transaction(async tx => {
        const [row] = await tx.select().from(pulls).where(scope(companyId, id)).for("update", { noWait: true });
        if (!row) throw notFound("Langfuse pull not found");
        if (row.completed) return publicPull(row);
        if (row.pages >= 1000) throw conflict("Window exceeds 1000 pages; create narrower windows, do not assume complete coverage");
        await assertReferences(tx, companyId, row.config);
        const resolveSecret = testOnly?.resolveSecret ?? (async (company: string, secret: string, version: number) => {
          const { secretService } = await import("./secrets.js");
          return secretService(db).resolveSecretValue(company, secret, version);
        });
        const publicKey = await resolveSecret(companyId, row.config.publicKey.secretId, row.config.publicKey.version);
        const secretKey = await resolveSecret(companyId, row.config.secretKey.secretId, row.config.secretKey.version);
        const page = await readLangfusePage(row.config, row.cursor, { publicKey, secretKey }, signal, testOnly?.transport);
        const digest = page.cursor ? createHash("sha256").update(page.cursor).digest("hex") : null;
        if (digest && row.cursorDigests.includes(digest)) throw conflict("Provider cursor cycle; restart or narrow the time window");
        let imported = 0;
        for (const item of page.items) {
          signal?.throwIfAborted();
          const inserted = await tx.insert(inbox).values({ ...item, companyId, actorId: actor.actorId }).onConflictDoNothing({ target: [inbox.companyId, inbox.sourceKind, inbox.sourceInstance, inbox.externalId] }).returning({ id: inbox.id });
          imported += inserted.length;
        }
        signal?.throwIfAborted();
        await assertReferences(tx, companyId, row.config, true);
        const [updated] = await tx.update(pulls).set({ cursor: page.cursor, completed: !page.cursor,
          cursorDigests: digest ? [...row.cursorDigests, digest] : row.cursorDigests,
          pages: row.pages + 1, imported: row.imported + imported, updatedAt: new Date() }).where(scope(companyId, id)).returning();
        await audit(tx, companyId, id, actor, "feedback.langfuse.page_read");
        return publicPull(updated);
      }).catch((error: unknown) => {
        const pg = error as { code?: string; cause?: { code?: string } };
        if (pg.code === "55P03" || pg.cause?.code === "55P03") throw conflict("Langfuse pull already in progress; refresh status");
        throw error;
      });
    },
  };
}
