import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { forbidden } from "../errors.js";
import { langfuseFeedbackService } from "../services/mimouse-langfuse.js";
import { langfuseCreateSchema, LangfuseReadError } from "../services/mimouse-langfuse/protocol.js";

/** Board-admin pull only. No background polling, customer messages or agent execution. */
export function mimouseLangfuseRoutes(db: Db) {
  const router = Router(), service = langfuseFeedbackService(db), path = "/companies/:companyId/feedback-langfuse/pulls";
  function admin(req: Request) {
    const companyId = z.string().uuid().parse(req.params.companyId);
    assertBoard(req); assertCompanyAccess(req, companyId);
    if (req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin) {
      const member = req.actor.memberships?.find(item => item.companyId === companyId);
      if (member?.status !== "active" || !["owner", "admin"].includes(String(member.membershipRole))) throw forbidden("Company administrator required");
    }
    return companyId;
  }
  router.get(path, async (req, res) => { res.json(await service.list(admin(req))); });
  router.post(path, async (req, res) => {
    const companyId = admin(req), row = await service.create(companyId, langfuseCreateSchema.parse(req.body), getActorInfo(req));
    res.status(201).json(row);
  });
  router.post(`${path}/:id/restart`, async (req, res) => {
    const companyId = admin(req), id = z.string().uuid().parse(req.params.id);
    z.object({ confirm: z.literal(true) }).strict().parse(req.body);
    const row = await service.restart(companyId, id, getActorInfo(req));
    res.json(row);
  });
  router.post(`${path}/:id/pull`, async (req, res) => {
    const companyId = admin(req), id = z.string().uuid().parse(req.params.id), controller = new AbortController();
    z.object({}).strict().parse(req.body ?? {});
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", disconnect);
    try {
      const row = await service.pull(companyId, id, getActorInfo(req), controller.signal);
      res.json(row);
    } catch (error) {
      if (!(error instanceof LangfuseReadError)) throw error;
      if (error.retryAfterSeconds) res.setHeader("Retry-After", error.retryAfterSeconds);
      res.status(error.code === "rate_limited" ? 429 : error.code === "unsupported" ? 422 : 502).json({ error: error.message, code: error.code });
    } finally { res.off("close", disconnect); }
  });
  return router;
}
