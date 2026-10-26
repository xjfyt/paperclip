import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { createOperationPreviewSchema, requestOperationApprovalSchema } from "@paperclipai/shared";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { forbidden, notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { operationPreviewService } from "../services/mimouse-operations/service.js";
const pageSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), beforeId: z.string().uuid().optional() }).strict();
export function mimouseOperationRoutes(db: Db) {
  const router = Router(), service = operationPreviewService(db), root = "/companies/:companyId/data-operations";
  function admin(req: Request) { const companyId = z.string().uuid().parse(req.params.companyId); assertBoard(req); assertCompanyAccess(req, companyId);
    const member = req.actor.memberships?.find(item => item.companyId === companyId);
    if (req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin && !(member?.status === "active" && ["owner", "admin"].includes(String(member.membershipRole)))) throw forbidden("Company administrator required");
    return companyId;
  }
  function id(req: Request) { const result = z.string().uuid().safeParse(req.params.id); if (!result.success) throw notFound("Data preview not found"); return result.data; }
  router.get(root, async (req, res) => { const companyId = admin(req), query = pageSchema.parse(req.query); res.json(await service.list(companyId, query.limit, query.beforeId)); });
  router.post(root, validate(createOperationPreviewSchema), async (req, res) => { const companyId = admin(req), result = await service.create(companyId, req.body, getActorInfo(req).actorId); res.status(result.duplicate ? 200 : 201).json(result); });
  router.get(`${root}/:id`, async (req, res) => { const companyId = admin(req); res.json(await service.get(companyId, id(req))); });
  router.get(`${root}/:id/readiness`, async (req, res) => { const companyId = admin(req); res.json(await service.readiness(companyId, id(req))); });
  router.post(`${root}/:id/request-approval`, validate(requestOperationApprovalSchema), async (req, res) => {
    const companyId = admin(req);
    if (req.actor.type !== "board" || req.actor.source !== "session" || !req.actor.userId) throw forbidden("A signed-in human must request data review");
    res.json(await service.requestApproval(companyId, id(req), req.actor.userId, req.body));
  });
  // Intentionally no apply/write route until an actual target contract exists.
  return router;
}
