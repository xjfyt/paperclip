import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { forbidden } from "../errors.js";
import { accessService } from "../services/access.js";
import { costRoutingPreviewService } from "../services/cost-routing-preview/service.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
export function costRoutingPreviewRoutes(db: Db) {
  const router = Router(), service = costRoutingPreviewService(db), access = accessService(db);
  async function authorize(req: Parameters<typeof assertBoard>[0]) {
    const companyId = z.string().uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId); assertBoard(req);
    if (req.actor.type !== "board" || !(req.actor.source === "local_implicit" || req.actor.isInstanceAdmin
      || await access.canUser(companyId, req.actor.userId, "users:manage_permissions"))) throw forbidden("Company administrator required");
    return companyId;
  }
  router.use("/companies/:companyId/cost-routing", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/companies/:companyId/cost-routing/policy", async (req, res) => res.json(await service.current(await authorize(req))));
  router.post("/companies/:companyId/cost-routing/policy", async (req, res) => res.json(await service.save(await authorize(req), getActorInfo(req).actorId, req.body)));
  router.post("/companies/:companyId/cost-routing/previews", async (req, res) => res.json(await service.preview(await authorize(req), getActorInfo(req).actorId, req.body)));
  router.get("/companies/:companyId/cost-routing/previews/:id", async (req, res) => res.json(await service.getPreview(await authorize(req), z.string().uuid().parse(req.params.id))));
  return router;
}
