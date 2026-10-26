import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { feedbackImportSchema } from "@paperclipai/shared";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { forbidden, notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { feedbackInboxService } from "../services/mimouse-feedback.js";
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), beforeId: z.string().uuid().optional() }).strict();
export function mimouseFeedbackRoutes(db: Db) {
  const router = Router(), service = feedbackInboxService(db), path = "/companies/:companyId/feedback-inbox";
  function admin(req: Request) {
    const companyId = String(req.params.companyId); assertBoard(req); assertCompanyAccess(req, companyId);
    if (req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin) {
      const member = req.actor.memberships?.find(item => item.companyId === companyId);
      if (member?.status !== "active" || !["owner", "admin"].includes(String(member.membershipRole))) throw forbidden("Company administrator required");
    }
    return companyId;
  }
  function id(req: Request) { const parsed = z.string().uuid().safeParse(req.params.id); if (!parsed.success) throw notFound("Feedback candidate not found"); return parsed.data; }
  router.get(path, async (req, res) => { const companyId = admin(req), query = listSchema.parse(req.query); res.json(await service.list(companyId, query.limit, query.beforeId)); });
  router.post(path, validate(feedbackImportSchema), async (req, res) => {
    const companyId = admin(req), result = await service.import(companyId, feedbackImportSchema.parse(req.body), getActorInfo(req).actorId);
    res.status(result.duplicate ? 200 : 201).json(result);
  });
  router.get(`${path}/:id`, async (req, res) => { const companyId = admin(req); res.json(await service.get(companyId, id(req))); });
  router.get(`${path}/:id/candidates`, async (req, res) => { const companyId = admin(req); res.json(await service.candidates(companyId, id(req))); });
  return router;
}
