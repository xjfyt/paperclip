import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { mimouseWorkbuddyConnections as connections, mimouseWorkbuddyJobs as jobs, mimouseWorkbuddyTurns as turns, type Db } from "@paperclipai/db";
import { secretService } from "../secrets.js";
import { authorizationUrl, parseToken, runWorkBuddyAcp, workBuddyClient, WorkBuddyProtocolError, type WorkBuddyToken } from "./protocol.js";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
interface Actor { userId?: string; agentId?: string; responsibleUserId?: string | null }
export function workbuddyService(db: Db, deps: { client?: ReturnType<typeof workBuddyClient>; token?: (companyId: string, connectionId: string) => Promise<string>; acp?: typeof runWorkBuddyAcp } = {}) {
  const client = deps.client ?? workBuddyClient();
  async function connection(companyId: string, id: string, actor: Actor) {
    const [row] = await db.select().from(connections).where(and(eq(connections.companyId, companyId), eq(connections.id, id)));
    if (!row || (row.ownerUserId !== actor.userId && !(actor.agentId && actor.responsibleUserId === row.ownerUserId && row.allowedAgentIds.includes(actor.agentId)))) throw new WorkBuddyProtocolError("connection_access_denied", false);
    return row;
  }
  function appConfig() {
    const clientId = process.env.PAPERCLIP_WORKBUDDY_CLIENT_ID;
    const clientSecret = process.env.PAPERCLIP_WORKBUDDY_CLIENT_SECRET;
    const base = process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL;
    if (process.env.PAPERCLIP_WORKBUDDY_ENABLED !== "true" || !clientId || !clientSecret || !base) throw new WorkBuddyProtocolError("workbuddy_not_configured", false);
    const url = new URL(base); if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new WorkBuddyProtocolError("invalid_app_origin", false);
    return { clientId, clientSecret, base: url.origin };
  }
  async function accessToken(row: typeof connections.$inferSelect): Promise<string> {
    if (row.status !== "connected") throw new WorkBuddyProtocolError("connection_not_ready", false);
    if (deps.token) return deps.token(row.companyId, row.id);
    if (!row.tokenSecretRef) throw new WorkBuddyProtocolError("connection_token_missing", false);
    const secrets = secretService(db);
    const existing = parseToken(JSON.parse(await secrets.resolveSecretValue(row.companyId, row.tokenSecretRef, row.tokenVersion)));
    if (row.expiresAt && row.expiresAt.getTime() > Date.now() + 30000) return existing.access_token;
    const app = appConfig(); if (!existing.refresh_token) throw new WorkBuddyProtocolError("reauthorization_required", false);
    const lease = randomUUID();
    const claimed = await db.update(connections).set({ status: "refreshing", refreshLease: lease }).where(and(eq(connections.id, row.id), eq(connections.companyId, row.companyId), eq(connections.status, "connected"), eq(connections.tokenVersion, row.tokenVersion))).returning();
    if (!claimed.length) throw new WorkBuddyProtocolError("refresh_in_progress", false);
    try {
      const refreshed = await client.exchange({ grant_type: "refresh_token", refresh_token: existing.refresh_token, client_id: app.clientId, client_secret: app.clientSecret });
      if (refreshed.open_id !== existing.open_id) throw new WorkBuddyProtocolError("provider_identity_changed", true);
      const stored = { ...refreshed, refresh_token: refreshed.refresh_token ?? existing.refresh_token };
      await secrets.rotate(row.tokenSecretRef, { value: JSON.stringify(stored), expectedLatestVersion: row.tokenVersion }, { userId: row.ownerUserId });
      const saved = await db.update(connections).set({ status: "connected", refreshLease: null, tokenVersion: row.tokenVersion + 1, expiresAt: new Date(Date.now() + refreshed.expires_in * 1000), scopes: refreshed.scope.split(/\s+/) }).where(and(eq(connections.id, row.id), eq(connections.refreshLease, lease), eq(connections.status, "refreshing"))).returning();
      if (!saved.length) throw new WorkBuddyProtocolError("connection_revoked_during_refresh", true);
      return refreshed.access_token;
    } catch {
      await db.update(connections).set({ status: "indeterminate", lastCode: "refresh_unconfirmed", refreshLease: null }).where(and(eq(connections.id, row.id), eq(connections.refreshLease, lease)));
      throw new WorkBuddyProtocolError("refresh_requires_reconciliation", true);
    }
  }
  async function job(companyId: string, id: string, actor: Actor) {
    const [row] = await db.select().from(jobs).where(and(eq(jobs.companyId, companyId), eq(jobs.id, id)));
    if (!row) throw new WorkBuddyProtocolError("job_not_found", false);
    const account = await connection(companyId, row.connectionId, actor); return { row, account };
  }
  return {
    listConnections: (companyId: string, ownerUserId: string) => db.select({ id: connections.id, status: connections.status, expiresAt: connections.expiresAt, scopes: connections.scopes, lastCode: connections.lastCode }).from(connections).where(and(eq(connections.companyId, companyId), eq(connections.ownerUserId, ownerUserId))),
    begin: async (companyId: string, userId: string, sessionId: string) => {
      const app = appConfig(); const state = randomBytes(32).toString("base64url");
      const redirectUri = `${app.base}/api/companies/${companyId}/integrations/workbuddy/callback`;
      const fields = { oauthStateHash: digest(state), oauthSessionId: sessionId, oauthExpiresAt: new Date(Date.now() + 600000), oauthRedirectUri: redirectUri };
      await db.insert(connections).values({ companyId, ownerUserId: userId, ...fields }).onConflictDoUpdate({ target: [connections.companyId, connections.ownerUserId], set: fields });
      return { url: authorizationUrl(app.clientId, redirectUri, state) };
    },
    callback: async (companyId: string, userId: string, sessionId: string, state: string, code: string) => {
      const app = appConfig(); const lease = randomUUID();
      // Atomic single consumption bound to initiating session, user and company.
      const [row] = await db.update(connections).set({ oauthStateHash: null, oauthSessionId: null, oauthExpiresAt: null, status: "exchanging", refreshLease: lease }).where(and(eq(connections.companyId, companyId), eq(connections.ownerUserId, userId), eq(connections.oauthSessionId, sessionId), eq(connections.oauthStateHash, digest(state)), gt(connections.oauthExpiresAt, new Date()))).returning();
      if (!row?.oauthRedirectUri) throw new WorkBuddyProtocolError("invalid_oauth_state", false);
      try {
        const tokens = await client.exchange({ grant_type: "authorization_code", client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: row.oauthRedirectUri });
        if (!["user.task.readable", "user.task.invokable"].every(scope => tokens.scope.split(/\s+/).includes(scope))) throw new WorkBuddyProtocolError("missing_required_scopes", false);
        if (row.tokenSecretRef) {
          const previous = parseToken(JSON.parse(await secretService(db).resolveSecretValue(companyId, row.tokenSecretRef, row.tokenVersion)));
          if (previous.open_id !== tokens.open_id) throw new WorkBuddyProtocolError("provider_identity_changed", true);
        }
        const secret = await secretService(db).create(companyId, { name: `workbuddy-${row.id}-${randomUUID()}`, provider: "local_encrypted", value: JSON.stringify(tokens), description: "WorkBuddy OAuth; do not expose token values" }, { userId });
        const saved = await db.update(connections).set({ tokenSecretRef: secret.id, tokenVersion: secret.latestVersion, expiresAt: new Date(Date.now() + tokens.expires_in * 1000), scopes: tokens.scope.split(/\s+/), status: "connected", refreshLease: null, lastCode: null }).where(and(eq(connections.id, row.id), eq(connections.refreshLease, lease), eq(connections.status, "exchanging"))).returning();
        if (!saved.length) throw new WorkBuddyProtocolError("connection_revoked_during_exchange", true);
        return { id: row.id, status: "connected" };
      } catch {
        await db.update(connections).set({ status: "indeterminate", refreshLease: null, lastCode: "oauth_exchange_unconfirmed" }).where(and(eq(connections.id, row.id), eq(connections.refreshLease, lease)));
        throw new WorkBuddyProtocolError("oauth_exchange_failed", true);
      }
    },
    disconnect: async (companyId: string, id: string, userId: string) => {
      const row = await connection(companyId, id, { userId });
      await db.update(connections).set({ status: "disconnected", allowedAgentIds: [], oauthStateHash: null, refreshLease: null }).where(eq(connections.id, row.id));
      return { locallyDisconnected: true, providerRevocationConfirmed: false };
    },
    createJob: async (companyId: string, connectionId: string, actor: Actor, requestKey: string, prompt: string, runId?: string) => {
      const account = await connection(companyId, connectionId, actor);
      const promptHash = digest(prompt);
      const [prior] = await db.select().from(jobs).where(and(eq(jobs.companyId, companyId), eq(jobs.connectionId, connectionId), eq(jobs.requestKey, requestKey)));
      if (prior) {
        if (prior.promptHash !== promptHash) throw new WorkBuddyProtocolError("request_key_payload_mismatch", false);
        return { ...prior, dispatchState: prior.dispatchState === "dispatching" ? "indeterminate" : prior.dispatchState };
      }
      const token = await accessToken(account);
      const [created] = await db.insert(jobs).values({ companyId, connectionId, requestKey, promptHash, ...(runId ? { runId } : {}) }).onConflictDoNothing().returning();
      if (!created) {
        const [existing] = await db.select().from(jobs).where(and(eq(jobs.companyId, companyId), eq(jobs.connectionId, connectionId), eq(jobs.requestKey, requestKey)));
        if (existing.promptHash !== promptHash) throw new WorkBuddyProtocolError("request_key_payload_mismatch", false);
        // Dispatching may represent a crashed process. Never create again.
        return { ...existing, dispatchState: existing.dispatchState === "dispatching" ? "indeterminate" : existing.dispatchState };
      }
      try {
        const task = await client.create(token, prompt);
        const [saved] = await db.update(jobs).set({ providerJobId: task.task_id, dispatchState: "created", remoteState: task.status, updatedAt: new Date() }).where(eq(jobs.id, created.id)).returning();
        return saved; // link/token intentionally never persisted or returned.
      } catch (error) {
        const uncertain = !(error instanceof WorkBuddyProtocolError) || error.uncertain;
        const [saved] = await db.update(jobs).set({ dispatchState: uncertain ? "indeterminate" : "rejected", lastCode: error instanceof WorkBuddyProtocolError ? error.code : "create_unconfirmed", updatedAt: new Date() }).where(eq(jobs.id, created.id)).returning();
        return saved;
      }
    },
    refreshJob: async (companyId: string, id: string, actor: Actor) => {
      const { row, account } = await job(companyId, id, actor);
      if (!row.providerJobId) return row;
      const task = await client.get(await accessToken(account), row.providerJobId);
      if (task.task_id !== row.providerJobId) throw new WorkBuddyProtocolError("provider_task_identity_mismatch", false);
      const [saved] = await db.update(jobs).set({ remoteState: task.status, updatedAt: new Date() }).where(eq(jobs.id, row.id)).returning(); return saved;
    },
    promptJob: async (companyId: string, id: string, actor: Actor, requestKey: string, prompt: string) => {
      const { row, account } = await job(companyId, id, actor);
      if (!row.providerJobId) throw new WorkBuddyProtocolError("remote_creation_unresolved", true);
      const turn = await db.transaction(async tx => {
        const [existing] = await tx.select().from(turns).where(and(eq(turns.companyId, companyId), eq(turns.jobId, id), eq(turns.requestKey, requestKey)));
        if (existing) { if (existing.promptHash !== digest(prompt)) throw new WorkBuddyProtocolError("request_key_payload_mismatch", false); return { existing }; }
        const turnId = randomUUID();
        const claimed = await tx.execute(sql`UPDATE mimouse_workbuddy_jobs SET active_turn=${turnId} WHERE id=${id} AND company_id=${companyId} AND active_turn IS NULL RETURNING id`);
        if (!claimed.length) throw new WorkBuddyProtocolError("session_busy_or_unreconciled", true);
        const [created] = await tx.insert(turns).values({ id: turnId, companyId, jobId: id, requestKey, promptHash: digest(prompt) }).returning(); return { created };
      });
      if (turn.existing) return turn.existing;
      const turnId = turn.created!.id; let dispatched = false;
      try {
        const task = await client.get(await accessToken(account), row.providerJobId);
        if (task.task_id !== row.providerJobId || !task.link || !task.token) throw new WorkBuddyProtocolError("acp_not_ready", false);
        const allowedHosts = (process.env.PAPERCLIP_WORKBUDDY_ACP_HOSTS ?? "acp.workbuddy.cn").split(",").map(host => host.trim()).filter(Boolean);
        const result = await (deps.acp ?? runWorkBuddyAcp)({ link: task.link, token: task.token, taskId: task.task_id, prompt, allowedHosts,
          beforePrompt: async () => {
            const current = await connection(companyId, row.connectionId, actor);
            if (current.status !== "connected") throw new WorkBuddyProtocolError("connection_no_longer_active", false);
            await db.update(turns).set({ state: "dispatched" }).where(eq(turns.id, turnId)); dispatched = true; },
          onText: async text => { const redacted = text.split(task.token!).join("[REDACTED]"); await db.execute(sql`UPDATE mimouse_workbuddy_jobs SET report=left(report || ${redacted},1048576),updated_at=now() WHERE id=${id} AND active_turn=${turnId}`); },
        });
        await db.transaction(async tx => { await tx.update(turns).set({ state: "round_finished", stopReason: result.permissionDenied ? "permission_denied" : result.stopReason }).where(eq(turns.id, turnId)); await tx.update(jobs).set({ activeTurn: null }).where(and(eq(jobs.id, id), eq(jobs.activeTurn, turnId))); });
        return { id: turnId, ...result };
      } catch {
        await db.update(turns).set({ state: "indeterminate", stopReason: dispatched ? "prompt_outcome_unknown" : "setup_failed" }).where(eq(turns.id, turnId));
        // Release only pre-prompt setup failures. A possibly active remote turn
        // blocks further prompts until an operator has reconciled it.
        if (!dispatched) await db.update(jobs).set({ activeTurn: null }).where(and(eq(jobs.id, id), eq(jobs.activeTurn, turnId)));
        throw new WorkBuddyProtocolError("remote_turn_requires_reconciliation", dispatched);
      }
    },
  };
}
