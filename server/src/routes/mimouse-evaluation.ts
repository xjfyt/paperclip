import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { createEvaluationComparisonSchema, createEvaluationDatasetSchema, previewEvaluationFeedbackSchema } from "@paperclipai/shared/mimouse-evaluation";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { evaluationService } from "../services/mimouse-evaluation/service.js";
const page = z.object({ beforeId: z.string().uuid().optional() }).strict();
export function mimouseEvaluationRoutes(db: Db) {
  const router = Router(), service = evaluationService(db), root = "/companies/:companyId/skill-evaluations";
  function admin(req: Request) {
    const companyId = z.string().uuid().parse(req.params.companyId); assertBoard(req); assertCompanyAccess(req, companyId);
    const member = req.actor.memberships?.find(item => item.companyId === companyId);
    if (req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin && !(member?.status === "active" && ["owner", "admin"].includes(String(member.membershipRole)))) throw forbidden("Company administrator required");
    return companyId;
  }
  function human(req: Request) {
    if (req.actor.type !== "board" || req.actor.source !== "session" || !req.actor.userId) throw forbidden("A signed-in human must review feedback provenance");
    return req.actor.userId;
  }
  router.post(`${root}/datasets/feedback-preview`, validate(previewEvaluationFeedbackSchema), async (req, res) => res.json(await service.previewFeedback(admin(req), req.body, human(req))));
  router.get(`${root}/datasets`, async (req, res) => res.json(await service.listDatasets(admin(req), page.parse(req.query).beforeId)));
  router.post(`${root}/datasets`, validate(createEvaluationDatasetSchema), async (req, res) => { const companyId = admin(req); const actorId = req.body.cases.some((item: { feedback?: unknown }) => item.feedback) ? human(req) : getActorInfo(req).actorId; const result = await service.createDataset(companyId, req.body, actorId); res.status(result.duplicate ? 200 : 201).json(result); });
  router.get(`${root}/comparisons`, async (req, res) => res.json(await service.listComparisons(admin(req), page.parse(req.query).beforeId)));
  router.post(`${root}/comparisons`, validate(createEvaluationComparisonSchema), async (req, res) => { const result = await service.compare(admin(req), req.body, getActorInfo(req).actorId); res.status(result.duplicate ? 200 : 201).json(result); });
  router.get(`${root}/comparisons/:id`, async (req, res) => res.json(await service.getComparison(admin(req), z.string().uuid().parse(req.params.id))));
  router.get(`${root}/skills/:skillId/evidence`, async (req, res) => res.json(await service.evidence(admin(req), z.string().uuid().parse(req.params.skillId))));
  router.get(`${root}/readiness`, (req, res) => {
    const companyId = admin(req);
    res.json({
      // Legacy flags describe this comparison API, not the separate human
      // restoration API. Capability discovery never grants write authority.
      capabilityScope: "comparison_only", executionStarted: false,
      promotionSupported: false, rollbackSupported: false,
      blockers: ["report_specific_human_restore_readiness_required"],
      controlledRestore: {
        implemented: true, supportedMode: "paused_unused_managed_local_only",
        readinessPathTemplate: `/api/companies/${companyId}/skill-evaluations/restores/readiness/:reportId`,
        requiresHumanSession: true, requiresReport: true,
        readiness: null, authorityGranted: false, automaticallyPausesOrDetaches: false,
      },
      scorer: "exact_text_v1", costBasis: "recorded_issue_ledger_snapshot",
    });
  });
  // No run dispatch, file mutation, promotion or rollback endpoints.
  return router;
}
