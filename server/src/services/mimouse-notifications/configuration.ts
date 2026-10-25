import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { mimouseNotificationEndpoints as endpoints, mimouseNotificationRevisions as revisions, type Db } from "@paperclipai/db";
import { conflict, notFound, unprocessable } from "../../errors.js";
import { secretService } from "../secrets.js";
import { buildNotificationRequest, type ChannelSecret } from "./drivers.js";
import { validationSecret } from "./app-credentials.js";
import { renderTemplateData } from "./render.js";

export interface NotificationConfigurationInput {
  name: string; kind: "wecom_webhook" | "feishu_webhook" | "dingtalk_webhook_legacy" | "dingtalk_app" | "wechat_official_account";
  config: Record<string, unknown>; secretRef: string; secretVersion: number;
}
type Endpoint = typeof endpoints.$inferSelect;
const snapshot = (row: Endpoint) => ({ name: row.name, kind: row.kind, config: row.config, secretRef: row.secretRef, secretVersion: row.secretVersion, configVersion: row.configVersion });

/** Configuration is validated locally. Saving never grants a token or sends a message. */
export function notificationConfiguration(db: Db) {
  async function validate(companyId: string, input: NotificationConfigurationInput) {
    let secret: ChannelSecret;
    try { secret = JSON.parse(await secretService(db).resolveSecretValue(companyId, input.secretRef, input.secretVersion)); }
    catch { throw unprocessable("Secret unavailable or invalid JSON for this company"); }
    try {
      buildNotificationRequest({ ...input.config, ...(input.config.templateData ? { templateData: renderTemplateData(input.config.templateData, { title: "Configuration validation", text: "No message is sent when saving." }, "resource-preview") } : {}), kind: input.kind, title: "Configuration validation", text: "No message is sent when saving." }, validationSecret(input.kind, secret));
    } catch { throw unprocessable("Channel configuration is incomplete or invalid"); }
    const identity = input.kind.endsWith("webhook") || input.kind === "dingtalk_webhook_legacy" ? secret.url : [input.kind, input.config.target, input.config.robotCode].join(":");
    return createHash("sha256").update(String(identity)).digest("hex");
  }
  async function load(companyId: string, id: string) {
    const [row] = await db.select().from(endpoints).where(and(eq(endpoints.companyId, companyId), eq(endpoints.id, id)));
    if (!row) throw notFound("Notification endpoint not found"); return row;
  }
  return {
    load,
    async create(companyId: string, input: NotificationConfigurationInput, actorId: string) {
      const targetKey = await validate(companyId, input);
      return db.transaction(async tx => {
        const [row] = await tx.insert(endpoints).values({ ...input, companyId, targetKey, enabled: false }).returning();
        await tx.insert(revisions).values({ companyId, endpointId: row.id, configVersion: row.configVersion, snapshot: snapshot(row), actorId });
        return row;
      });
    },
    async revise(companyId: string, id: string, expectedVersion: number, input: NotificationConfigurationInput, actorId: string) {
      // Resolve company ownership before touching a supplied secret reference.
      const old = await load(companyId, id);
      if (old.configVersion !== expectedVersion) throw conflict("Notification configuration changed; reload before saving");
      if (old.kind !== input.kind) throw unprocessable("Create a separate endpoint to change channel kind");
      const targetKey = await validate(companyId, input);
      return db.transaction(async tx => {
        // Disabling here also serializes with the worker's pre-dispatch row lock.
        // Already-dispatched external messages cannot be recalled by a revision.
        const [row] = await tx.update(endpoints).set({ ...input, targetKey, configVersion: expectedVersion + 1, enabled: false })
          .where(and(eq(endpoints.companyId, companyId), eq(endpoints.id, id), eq(endpoints.configVersion, expectedVersion))).returning();
        if (!row) throw conflict("Notification configuration changed; reload before saving");
        // Existing installations may predate the history table. Preserve v1 on first edit.
        await tx.insert(revisions).values({ companyId, endpointId: id, configVersion: old.configVersion, snapshot: snapshot(old), actorId: "system:history-backfill" }).onConflictDoNothing();
        await tx.insert(revisions).values({ companyId, endpointId: id, configVersion: row.configVersion, snapshot: snapshot(row), actorId });
        return row;
      });
    },
    async history(companyId: string, id: string) {
      await load(companyId, id);
      return db.select().from(revisions).where(and(eq(revisions.companyId, companyId), eq(revisions.endpointId, id))).orderBy(desc(revisions.configVersion)).limit(100);
    },
  };
}
