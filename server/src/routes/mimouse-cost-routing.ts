import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { runtimeRoutingRequestQuerySchema } from "@paperclipai/shared/runtime-cost-routing";
import { forbidden, HttpError, unprocessable } from "../errors.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { runtimeCostRoutingService } from "../services/mimouse-cost-routing/service.js";
import { heartbeatService } from "../services/heartbeat.js";
const uuid = z.string().uuid();
export function mimouseCostRoutingRoutes(db: Db) {
  const router = Router(), root = "/companies/:companyId/runtime-cost-routing";
  const service = runtimeCostRoutingService(db, (agentId, options) => heartbeatService(db).wakeup(agentId, options));
  function human(req: Request) {
    const companyId = uuid.parse(req.params.companyId); assertBoard(req); assertCompanyAccess(req, companyId);
    if (req.actor.type !== "board" || req.actor.source !== "session" || !req.actor.userId || !req.actor.sessionId) throw forbidden("runtime_routing_signed_in_human_required");
    return { companyId, userId: req.actor.userId, sessionId: req.actor.sessionId };
  }
  async function safe<T>(action: () => Promise<T>) {
    try { return await action(); } catch (error) { if (error instanceof HttpError) throw error; throw unprocessable("runtime_routing_operation_failed"); }
  }
  router.use(root, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get(root, async (req, res) => { const actor = human(req); res.json(await safe(() => service.current(actor))); });
  router.get(`${root}/policies/:id`, async (req, res) => { const actor = human(req), id = uuid.parse(req.params.id); res.json(await safe(() => service.detail(actor, id))); });
  router.get(`${root}/bindings/:id`, async (req, res) => { const actor = human(req), id = uuid.parse(req.params.id); res.json(await safe(() => service.binding(actor, id))); });
  router.get(`${root}/requests/:requestId`, async (req, res) => { const actor = human(req), requestId = uuid.parse(req.params.requestId), query = runtimeRoutingRequestQuerySchema.parse(req.query);
    res.json(await safe(() => service.request(actor, requestId, query))); });
  router.post(`${root}/prepare`, async (req, res) => { const actor = human(req); const result = await safe(() => service.prepare(actor, req.body)); res.status(result.duplicate ? 200 : 201).json(result); });
  router.post(`${root}/policies/:id/approve`, async (req, res) => { const actor = human(req), id = uuid.parse(req.params.id); res.json(await safe(() => service.approve(actor, id, req.body))); });
  router.post(`${root}/policies/:id/close-expired`, async (req, res) => { const actor = human(req), id = uuid.parse(req.params.id); res.json(await safe(() => service.closeExpired(actor, id, req.body))); });
  router.post(`${root}/disable`, async (req, res) => { const actor = human(req); res.json(await safe(() => service.disable(actor, req.body))); });
  router.post(`${root}/tasks`, async (req, res) => { const actor = human(req); const result = await safe(() => service.createTask(actor, req.body)); res.status(result.duplicate ? 200 : 201).json(result); });
  router.post(`${root}/bindings/:id/run`, async (req, res) => { const actor = human(req), id = uuid.parse(req.params.id); res.json(await safe(() => service.run(actor, id, req.body))); });
  return router;
}
