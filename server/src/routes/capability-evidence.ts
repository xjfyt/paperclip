import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { z } from "zod";
import { forbidden } from "../errors.js";
import { accessService } from "../services/access.js";
import { capabilityEvidenceService } from "../services/capability-evidence.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

export function capabilityEvidenceRoutes(db: Db) {
  const router = Router();
  const service = capabilityEvidenceService(db);
  const access = accessService(db);
  // Receipts contain operator references; both read/write are company-admin only.
  async function authorize(req: Parameters<typeof assertBoard>[0]) {
    const companyId = z.string().uuid().parse(req.params.companyId);
    assertCompanyAccess(req, companyId);
    assertBoard(req);
    if (req.actor.type !== "board" || !(req.actor.source === "local_implicit" || req.actor.isInstanceAdmin
      || await access.canUser(companyId, req.actor.userId, "users:manage_permissions"))) {
      throw forbidden("Company administrator required for capability evidence");
    }
    return companyId;
  }
  router.get("/companies/:companyId/capability-evidence", async (req, res) => {
    const companyId = await authorize(req);
    const after = z.coerce.number().int().min(0).max(2147483646).parse(req.query.afterRevision ?? 0);
    res.setHeader("Cache-Control", "no-store");
    res.json(await service.list(companyId, after));
  });
  router.post("/companies/:companyId/capability-evidence", async (req, res) => {
    const companyId = await authorize(req);
    res.json(await service.append(companyId, getActorInfo(req).actorId, req.body));
  });
  return router;
}
