import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { preparePromptApplicationSchema, approvePromptApplicationSchema, rollbackPromptApplicationSchema, promptApplicationRequestQuerySchema } from "@paperclipai/shared/mimouse-prompt-applications";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { forbidden, HttpError, unprocessable } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { promptApplicationService } from "../services/mimouse-prompt-applications/service.js";
const uuid = z.string().uuid(), page = z.object({ beforeId: uuid.optional() }).strict();
export function mimousePromptApplicationRoutes(db: Db) {
  const router = Router(), service = promptApplicationService(db), root = "/companies/:companyId/prompt-registry/:promptId/applications";
  function human(req: Request) {
    const companyId = uuid.parse(req.params.companyId); assertBoard(req); assertCompanyAccess(req, companyId);
    if (req.actor.source !== "session" || !req.actor.userId || !req.actor.sessionId) throw forbidden("prompt_application_signed_in_human_required");
    return { companyId, userId: req.actor.userId, sessionId: req.actor.sessionId };
  }
  async function safe<T>(action: () => Promise<T>) {
    try { return await action(); } catch (error) { if (error instanceof HttpError) throw error; throw unprocessable("prompt_application_operation_failed"); }
  }
  router.use([root, "/companies/:companyId/prompt-applications"], (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/companies/:companyId/prompt-applications/agents/:agentId/head", async (req, res) => {
    const actor = human(req); res.json(await safe(() => service.head(actor, uuid.parse(req.params.agentId))));
  });
  router.get(root, async (req, res) => { const actor = human(req), promptId = uuid.parse(req.params.promptId);
    res.json(await safe(() => service.list(actor, promptId, page.parse(req.query).beforeId))); });
  router.get(`${root}/requests/:requestId`, async (req, res) => { const actor = human(req), promptId = uuid.parse(req.params.promptId), requestId = uuid.parse(req.params.requestId);
    res.json(await safe(() => service.request(actor, promptId, requestId, promptApplicationRequestQuerySchema.parse(req.query)))); });
  router.get(`${root}/:applicationId`, async (req, res) => { const actor = human(req), promptId = uuid.parse(req.params.promptId), id = uuid.parse(req.params.applicationId);
    res.json(await safe(() => service.detail(actor, promptId, id))); });
  router.get(`${root}/:applicationId/dispatches`, async (req, res) => { const actor = human(req), promptId = uuid.parse(req.params.promptId), id = uuid.parse(req.params.applicationId);
    res.json(await safe(() => service.dispatches(actor, promptId, id, page.parse(req.query).beforeId))); });
  router.post(root, validate(preparePromptApplicationSchema), async (req, res) => { const actor = human(req), promptId = uuid.parse(req.params.promptId);
    const result = await safe(() => service.prepare(actor, promptId, req.body)); res.status(result.duplicate ? 200 : 201).json(result); });
  router.post(`${root}/:applicationId/approve`, validate(approvePromptApplicationSchema), async (req, res) => { const actor = human(req), promptId = uuid.parse(req.params.promptId), id = uuid.parse(req.params.applicationId);
    res.json(await safe(() => service.approve(actor, promptId, id, req.body))); });
  router.post(`${root}/:applicationId/rollback`, validate(rollbackPromptApplicationSchema), async (req, res) => { const actor = human(req), promptId = uuid.parse(req.params.promptId), id = uuid.parse(req.params.applicationId);
    res.json(await safe(() => service.rollback(actor, promptId, id, req.body))); });
  return router;
}
