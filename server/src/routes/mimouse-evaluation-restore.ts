import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { createEvaluationRestoreSchema, recoverEvaluationRestoreSchema } from "@paperclipai/shared/mimouse-evaluation-restore";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { forbidden, HttpError, unprocessable } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { evaluationRestoreService } from "../services/mimouse-evaluation/restore-service.js";
/** Deliberately separate from evaluation read access: neither local implicit
 * board, Board API keys nor a passing report confer human file-write authority. */
export function mimouseEvaluationRestoreRoutes(db: Db) {
  const router = Router(), service = evaluationRestoreService(db), root = "/companies/:companyId/skill-evaluations/restores";
  function human(req: Request) {
    const companyId = z.string().uuid().parse(req.params.companyId); assertBoard(req); assertCompanyAccess(req, companyId);
    if (req.actor.source !== "session" || !req.actor.userId) throw forbidden("restore_signed_in_human_required");
    const member = req.actor.memberships?.find(value => value.companyId === companyId);
    if (!member || member.status !== "active" || !["owner", "admin"].includes(String(member.membershipRole))) throw forbidden("restore_active_company_administrator_required");
    return { companyId, userId: req.actor.userId };
  }
  async function safe<T>(action: () => Promise<T>) { try { return await action(); } catch (error) {
    if (error instanceof HttpError) throw error;
    throw unprocessable(error instanceof Error && /^restore_[a-z_]+$/.test(error.message) ? error.message : "restore_preparation_failed");
  } }
  router.get(root, async (req, res) => { const { companyId, userId } = human(req); res.json(await safe(() => service.list(companyId, userId))); });
  router.get(`${root}/readiness/:reportId`, async (req, res) => { const { companyId, userId } = human(req), reportId = z.string().uuid().parse(req.params.reportId); res.json(await safe(() => service.readiness(companyId, reportId, userId))); });
  router.get(`${root}/:id`, async (req, res) => { const { companyId, userId } = human(req), id = z.string().uuid().parse(req.params.id); res.json(await safe(() => service.get(companyId, id, userId))); });
  router.post(root, validate(createEvaluationRestoreSchema), async (req, res) => {
    const { companyId, userId } = human(req), result = await safe(() => service.create(companyId, userId, req.body));
    res.status(result.item.status === "prepared" ? 202 : result.duplicate ? 200 : 201).json(result);
  });
  router.post(`${root}/:id/recover`, validate(recoverEvaluationRestoreSchema), async (req, res) => {
    const { companyId, userId } = human(req), id = z.string().uuid().parse(req.params.id), result = await safe(() => service.recover(companyId, id, userId, req.body));
    res.status(result.status === "prepared" ? 202 : 200).json(result);
  });
  return router;
}
