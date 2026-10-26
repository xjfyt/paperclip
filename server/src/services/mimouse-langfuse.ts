import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { companySecrets, mimouseFeedbackInbox as inbox, type Db } from "@paperclipai/db";
import { mimouseLangfusePulls as pulls } from "@paperclipai/db/schema/mimouse_langfuse";
import { conflict, notFound, unprocessable } from "../errors.js";
import { langfuseConfigSchema, readLangfusePage, type LangfuseConfig } from "./mimouse-langfuse/protocol.js";

function publicPull(row: typeof pulls.$inferSelect) {
  return { id: row.id, companyId: row.companyId, origin: row.config.origin, projectId: row.config.projectId,
    product: row.config.product, from: row.config.from, to: row.config.to, api: row.config.api,
    completed: row.completed, pages: row.pages, imported: row.imported,
    hasMore: !row.completed, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    sourceTrust: { preset: "low_trust_review", disposition: "quarantined" } as const };
}
export function langfuseFeedbackService(db: Db) {
  const scope = (companyId: string, id: string) => and(eq(pulls.companyId, companyId), eq(pulls.id, id));
  return {
    async create(companyId: string, raw: LangfuseConfig) {
      const config = langfuseConfigSchema.parse(raw);
      for (const ref of [config.publicKey, config.secretKey]) {
        const [secret] = await db.select().from(companySecrets).where(and(eq(companySecrets.companyId, companyId), eq(companySecrets.id, ref.secretId)));
        if (!secret || secret.scope !== "company" || secret.status !== "active") throw unprocessable("Active company-scoped credential references required");
      }
      const [row] = await db.insert(pulls).values({ companyId, config }).returning();
      return publicPull(row);
    },
    async list(companyId: string) {
      return (await db.select().from(pulls).where(eq(pulls.companyId, companyId)).orderBy(desc(pulls.createdAt)).limit(50)).map(publicPull);
    },
    async restart(companyId: string, id: string) {
      // Explicit fixed-window replay includes late-arriving observations; dedup remains durable.
      const [row] = await db.update(pulls).set({ cursor: null, cursorDigests: [], completed: false, pages: 0, updatedAt: new Date() }).where(scope(companyId, id)).returning();
      if (!row) throw notFound("Langfuse pull not found");
      return publicPull(row);
    },
    async pull(companyId: string, id: string, actorId: string, signal?: AbortSignal) {
      return db.transaction(async tx => {
        // One bounded page per transaction; NOWAIT avoids queued duplicate fetches.
        const [row] = await tx.select().from(pulls).where(scope(companyId, id)).for("update", { noWait: true });
        if (!row) throw notFound("Langfuse pull not found");
        if (row.completed) return publicPull(row);
        if (row.pages >= 1000) throw conflict("Window exceeds 1000 pages; create narrower windows, do not assume complete coverage");
        const { secretService } = await import("./secrets.js");
        const vault = secretService(db);
        const publicKey = await vault.resolveSecretValue(companyId, row.config.publicKey.secretId, row.config.publicKey.version);
        const secretKey = await vault.resolveSecretValue(companyId, row.config.secretKey.secretId, row.config.secretKey.version);
        const page = await readLangfusePage(row.config, row.cursor, { publicKey, secretKey }, signal);
        const digest = page.cursor ? createHash("sha256").update(page.cursor).digest("hex") : null;
        if (digest && row.cursorDigests.includes(digest)) throw conflict("Provider cursor cycle; restart or narrow the time window");
        let imported = 0;
        for (const item of page.items) {
          signal?.throwIfAborted();
          // First observed snapshot wins, even if the upstream observation is later edited.
          // Never overwrite a human-imported candidate with the same provider identity.
          const inserted = await tx.insert(inbox).values({ ...item, companyId, actorId }).onConflictDoNothing({ target: [inbox.companyId, inbox.sourceKind, inbox.sourceInstance, inbox.externalId] }).returning({ id: inbox.id });
          imported += inserted.length;
        }
        signal?.throwIfAborted();
        const [updated] = await tx.update(pulls).set({ cursor: page.cursor, completed: !page.cursor,
          cursorDigests: digest ? [...row.cursorDigests, digest] : row.cursorDigests,
          pages: row.pages + 1, imported: row.imported + imported, updatedAt: new Date() }).where(scope(companyId, id)).returning();
        return publicPull(updated);
      });
    },
  };
}
