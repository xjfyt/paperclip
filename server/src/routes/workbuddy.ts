import { workbuddyCreateSchema as createSchema, workbuddyPromptSchema as promptSchema, workbuddyAgentsSchema } from "./mimouse-api-schemas.js";
import { Router, type Request } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { companies, agents, mimouseWorkbuddyJobs as jobs, mimouseWorkbuddyConnections as connections, type Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { forbidden, unprocessable } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { workbuddyService } from "../services/workbuddy/service.js";
import { WorkBuddyProtocolError } from "../services/workbuddy/protocol.js";
import { logActivity } from "../services/activity-log.js";
export function workbuddyRoutes(db: Db) {
  const router = Router(); const service = workbuddyService(db); const root = "/companies/:companyId/integrations/workbuddy";
  function actor(req: Request) {
    const companyId = String(req.params.companyId); assertBoard(req); assertCompanyAccess(req, companyId);
    if (!req.actor.userId) throw forbidden("Signed-in user required");
    return { companyId, userId: req.actor.userId };
  }
  function executionActor(req: Request) {
    const companyId = String(req.params.companyId); assertCompanyAccess(req, companyId);
    if (req.actor.type === "board" && req.actor.userId) return { companyId, actor: { userId: req.actor.userId } };
    if (req.actor.type === "agent" && req.actor.source === "agent_jwt" && req.actor.runId && req.actor.agentId) return { companyId, actor: { agentId: req.actor.agentId, responsibleUserId: req.actor.onBehalfOfUserId } };
    throw forbidden("An authenticated owner or owner-authorized run is required");
  }
  function enabled() { if (process.env.PAPERCLIP_WORKBUDDY_ENABLED !== "true") throw unprocessable("WorkBuddy is disabled by deployment configuration"); }
  async function safe<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (error) { throw unprocessable(error instanceof WorkBuddyProtocolError ? error.code : "workbuddy_operation_failed", { uncertain: error instanceof WorkBuddyProtocolError && error.uncertain }); }
  }
  async function audit(req: Request, action: string, entityId: string) {
    const info = getActorInfo(req); await logActivity(db, { companyId: String(req.params.companyId), actorType: info.actorType, actorId: info.actorId, action, entityType: "workbuddy", entityId, details: {} });
  }
  router.get(root, async (req, res) => {
    const { companyId, userId } = actor(req);
    const accounts = await service.listConnections(companyId, userId);
    const rows = await db.select({ id: jobs.id, connectionId: jobs.connectionId, dispatchState: jobs.dispatchState, remoteState: jobs.remoteState, activeTurn: jobs.activeTurn, providerJobId: jobs.providerJobId, report: jobs.report, lastCode: jobs.lastCode }).from(jobs).innerJoin(connections, and(eq(connections.id, jobs.connectionId), eq(connections.companyId, jobs.companyId))).where(and(eq(jobs.companyId, companyId), eq(connections.ownerUserId, userId))).orderBy(desc(jobs.createdAt)).limit(50);
    res.json({ enabled: process.env.PAPERCLIP_WORKBUDDY_ENABLED === "true", connections: accounts, jobs: rows, verification: { implemented: true, contractTested: false, liveVerified: false, scenarioVerified: false }, capabilities: { confirmedCancellation: false, workspaceRoundTrip: false, toolApproval: false } });
  });
  router.post(`${root}/authorize`, async (req, res) => {
    enabled(); const { companyId, userId } = actor(req);
    if (!req.actor.sessionId) throw forbidden("An authenticated browser session is required for OAuth binding");
    res.json(await safe(() => service.begin(companyId, userId, req.actor.sessionId!)));
  });
  router.get(`${root}/callback`, async (req, res) => {
    enabled(); const { companyId, userId } = actor(req);
    if (!req.actor.sessionId || typeof req.query.state !== "string" || typeof req.query.code !== "string" || req.query.state.length > 256 || req.query.code.length > 4096) throw unprocessable("Invalid OAuth callback");
    const result = await safe(() => service.callback(companyId, userId, req.actor.sessionId!, String(req.query.state), String(req.query.code)));
    await audit(req, "workbuddy.connected", result.id);
    const [company] = await db.select({ prefix: companies.issuePrefix }).from(companies).where(eq(companies.id, companyId));
    if (!company) throw unprocessable("The authorized company is no longer available");
    res.redirect(`/${encodeURIComponent(company.prefix.toUpperCase())}/integrations/workbuddy`);
  });
  router.post(`${root}/connections/:id/disconnect`, async (req, res) => {
    const { companyId, userId } = actor(req); const result = await safe(() => service.disconnect(companyId, String(req.params.id), userId));
    await audit(req, "workbuddy.disconnected", String(req.params.id)); res.json(result);
  });
  router.post(`${root}/connections/:id/agents`, validate(workbuddyAgentsSchema), async (req, res) => {
    const { companyId, userId } = actor(req); const id = String(req.params.id); const ids = [...new Set(req.body.agentIds as string[])];
    const [connection] = await db.select().from(connections).where(and(eq(connections.companyId, companyId), eq(connections.id, id), eq(connections.ownerUserId, userId)));
    if (!connection) throw forbidden("Connection owner required");
    if (ids.length) {
      const valid = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.companyId, companyId), inArray(agents.id, ids)));
      if (valid.length !== ids.length) throw unprocessable("Agents must belong to this company");
    }
    await db.update(connections).set({ allowedAgentIds: ids }).where(and(eq(connections.id, id), eq(connections.ownerUserId, userId)));
    await audit(req, "workbuddy.agent_access.changed", id); res.json({ agentIds: ids, requiresResponsibleOwner: true });
  });
  router.post(`${root}/jobs`, validate(createSchema), async (req, res) => {
    enabled(); const { companyId, actor: caller } = executionActor(req); const input = createSchema.parse(req.body);
    const result = await safe(() => service.createJob(companyId, input.connectionId, caller, input.requestKey, input.prompt, req.actor.runId));
    await audit(req, "workbuddy.job.dispatched", result.id); res.status(202).json(result);
  });
  router.post(`${root}/jobs/:id/refresh`, async (req, res) => {
    enabled(); const { companyId, actor: caller } = executionActor(req); res.json(await safe(() => service.refreshJob(companyId, String(req.params.id), caller)));
  });
  router.post(`${root}/jobs/:id/prompt`, validate(promptSchema), async (req, res) => {
    enabled(); const { companyId, actor: caller } = executionActor(req); const input = promptSchema.parse(req.body);
    res.json(await safe(() => service.promptJob(companyId, String(req.params.id), caller, input.requestKey, input.prompt)));
    await audit(req, "workbuddy.prompt.finished", String(req.params.id));
  });
  return router;
}
