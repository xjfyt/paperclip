import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { researchCandidateSchema, researchPromotionSchema } from "@paperclipai/shared";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { forbidden, notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { researchCandidateService } from "../services/mimouse-research/service.js";
const pageSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), beforeId: z.string().uuid().optional() }).strict();
export function mimouseResearchRoutes(db: Db) {
  const router = Router(), service = researchCandidateService(db), path = "/companies/:companyId/research-candidates";
  function admin(req: Request) {
    const companyId = z.string().uuid().parse(req.params.companyId); assertBoard(req); assertCompanyAccess(req, companyId);
    const member = req.actor.memberships?.find(item => item.companyId === companyId);
    if (req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin && !(member?.status === "active" && ["owner", "admin"].includes(String(member.membershipRole)))) throw forbidden("Company administrator required");
    return companyId;
  }
  function id(req: Request) { const parsed = z.string().uuid().safeParse(req.params.id); if (!parsed.success) throw notFound("Research candidate not found"); return parsed.data; }
  function human(req: Request) {
    if (req.actor.type !== "board" || req.actor.source !== "session" || !req.actor.userId) throw forbidden("A signed-in human must confirm research scope");
    return req.actor.userId;
  }
  router.get(path, async (req, res) => { const companyId = admin(req), query = pageSchema.parse(req.query); res.json(await service.list(companyId, query.limit, query.beforeId)); });
  router.post(path, validate(researchCandidateSchema), async (req, res) => { const companyId = admin(req), result = await service.create(companyId, req.body, getActorInfo(req).actorId); res.status(result.duplicate ? 200 : 201).json(result); });
  router.get(`${path}/:id`, async (req, res) => { const companyId = admin(req); res.json(await service.get(companyId, id(req))); });
  router.get(`${path}/:id/promotion`, async (req, res) => { const companyId = admin(req), actor = human(req); res.json(await service.status(companyId, id(req), actor)); });
  router.post(`${path}/:id/promote`, validate(researchPromotionSchema), async (req, res) => { const companyId = admin(req), actor = human(req); res.json(await service.promote(companyId, id(req), actor, req.body)); });
  return router;
}
