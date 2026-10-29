import { feedbackRunLogService } from "../services/mimouse-feedback-run-log.js";
import { feedbackRunLogSelectionSchema, feedbackRunLogImportSchema } from "@paperclipai/shared/mimouse-feedback-run-log";
import { feedbackVerificationService } from "../services/mimouse-feedback-verification.js";
import { feedbackVerificationPreviewSchema, feedbackVerificationConfirmSchema } from "@paperclipai/shared/mimouse-feedback-verification";
import { feedbackPromotionService } from "../services/mimouse-feedback-promotion.js";
import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { feedbackImportSchema, feedbackPromotionSchema } from "@paperclipai/shared";
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
  function reviewer(req: Request) {
    if (req.actor.type !== "board" || req.actor.source !== "session" || !req.actor.userId) throw forbidden("A signed-in human must review feedback verification");
    return req.actor.userId;
  }
  const runLogs = feedbackRunLogService(db);
  router.post(`${path}/run-log-preview`, validate(feedbackRunLogSelectionSchema), async (req, res) => {
    const companyId = admin(req); reviewer(req); res.setHeader("Cache-Control", "no-store");
    res.json(await runLogs.preview(companyId, req.actor, feedbackRunLogSelectionSchema.parse(req.body)));
  });
  router.post(`${path}/run-log-import`, validate(feedbackRunLogImportSchema), async (req, res) => {
    const companyId = admin(req); reviewer(req); res.setHeader("Cache-Control", "no-store");
    const result = await runLogs.import(companyId, req.actor, feedbackRunLogImportSchema.parse(req.body));
    res.status(result.duplicate ? 200 : 201).json(result);
  });
  router.get(`${path}/:id/run-log-source`, async (req, res) => {
    const companyId = admin(req); reviewer(req); res.setHeader("Cache-Control", "no-store");
    res.json(await runLogs.source(companyId, req.actor, id(req)));
  });
  const verification = feedbackVerificationService(db);
  router.get(`${path}/:id/verification-options`, async (req, res) => {
    const companyId = admin(req), actor = reviewer(req); res.setHeader("Cache-Control", "no-store");
    res.json(await verification.options(companyId, id(req), actor));
  });
  router.get(`${path}/:id/verifications`, async (req, res) => {
    const companyId = admin(req), actor = reviewer(req); res.setHeader("Cache-Control", "no-store");
    res.json(await verification.history(companyId, id(req), actor));
  });
  router.post(`${path}/:id/verification-preview`, validate(feedbackVerificationPreviewSchema), async (req, res) => {
    const companyId = admin(req), actor = reviewer(req); res.setHeader("Cache-Control", "no-store");
    res.json(await verification.preview(companyId, id(req), actor, feedbackVerificationPreviewSchema.parse(req.body)));
  });
  router.post(`${path}/:id/verifications`, validate(feedbackVerificationConfirmSchema), async (req, res) => {
    const companyId = admin(req), actor = reviewer(req); res.setHeader("Cache-Control", "no-store");
    res.json(await verification.confirm(companyId, id(req), actor, feedbackVerificationConfirmSchema.parse(req.body)));
  });
  router.get(`${path}/:id/promotion`, async (req, res) => {
    const companyId = admin(req);
    if (req.actor.type !== "board" || req.actor.source !== "session" || !req.actor.userId) throw forbidden("A signed-in human must inspect confirmation state");
    res.json(await feedbackPromotionService(db).status(companyId, id(req), req.actor.userId));
  });
  router.post(`${path}/:id/promote`, validate(feedbackPromotionSchema), async (req, res) => {
    const companyId = admin(req);
    if (req.actor.type !== "board" || req.actor.source !== "session" || !req.actor.userId) throw forbidden("A signed-in human must confirm task creation");
    res.json(await feedbackPromotionService(db).promote(companyId, id(req), req.actor.userId, feedbackPromotionSchema.parse(req.body)));
  });
  router.get(`${path}/:id/evidence`, async (req, res) => {
    const companyId = admin(req), query = z.object({ beforeId: z.string().uuid().optional() }).strict().parse(req.query);
    res.json(await service.evidence(companyId, id(req), query.beforeId));
  });
  router.get(`${path}/:id`, async (req, res) => { const companyId = admin(req); res.json(await service.get(companyId, id(req))); });
  router.get(`${path}/:id/candidates`, async (req, res) => { const companyId = admin(req); res.json(await service.candidates(companyId, id(req))); });
  return router;
}
