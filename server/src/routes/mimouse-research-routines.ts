import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { researchRoutineBindingSchema, researchRoutineReportSchema } from "@paperclipai/shared/mimouse-research-routines";
import { assertCompanyAccess } from "./authz.js";
import { validate } from "../middleware/validate.js";
import { researchRoutineService } from "../services/mimouse-research-routines/service.js";
export function mimouseResearchRoutineRoutes(db: Db) {
  const router = Router(), service = researchRoutineService(db), path = "/companies/:companyId/research-routines";
  const id = (value: unknown) => z.string().uuid().parse(value);
  router.get(path, async (req, res) => { const companyId = id(req.params.companyId); assertCompanyAccess(req, companyId); res.json(await service.list(companyId, req.actor)); });
  router.get(`${path}/available`, async (req, res) => { const companyId = id(req.params.companyId); assertCompanyAccess(req, companyId); res.json(await service.available(companyId, req.actor)); });
  router.put(`${path}/:routineId`, validate(researchRoutineBindingSchema), async (req, res) => {
    const companyId = id(req.params.companyId); assertCompanyAccess(req, companyId);
    res.json(await service.bind(companyId, id(req.params.routineId), req.actor, req.body));
  });
  router.post(`${path}/:routineId/reports`, validate(researchRoutineReportSchema), async (req, res) => {
    const companyId = id(req.params.companyId); assertCompanyAccess(req, companyId);
    const result = await service.report(companyId, id(req.params.routineId), req.actor, req.body);
    res.status(result.duplicate ? 200 : 201).json(result);
  });
  return router;
}
