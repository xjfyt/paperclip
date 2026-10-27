import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { startMimouseBuildObservationSchema, closeMimouseBuildObservationSchema } from "@paperclipai/shared";
import { forbidden, badRequest, HttpError, unprocessable } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { buildObservationService, type BuildObservationServiceDependencies } from "../services/mimouse-coding/build-observation-service.js";

/** No cached-role or test-header bypass. The service rechecks persisted ACL. */
export function mimouseBuildObservationRoutes(db: Db, deps: BuildObservationServiceDependencies = {}) {
  const router = Router(); const service = buildObservationService(db, deps);
  const root = "/companies/:companyId/coding/:id/build-observations";
  const uuid = z.string().uuid();
  function identity(req: Request) {
    if (req.actor.type !== "board" || req.actor.source !== "session" || !req.actor.userId || !req.actor.sessionId) throw forbidden("observation_session_required");
    const companyId = String(req.params.companyId); const deliveryId = String(req.params.id);
    if (!uuid.safeParse(companyId).success || !uuid.safeParse(deliveryId).success) throw badRequest("observation_identity_invalid");
    return { actor: { companyId, userId: req.actor.userId, sessionId: req.actor.sessionId }, deliveryId };
  }
  async function safe<T>(action: () => Promise<T>) {
    try { return await action(); }
    catch (error) {
      if (error instanceof HttpError && /^observation_[a-z_]+$/.test(error.message)) throw error;
      throw unprocessable("observation_unavailable");
    }
  }
  router.use(root, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get(`${root}/context`, async (req, res) => {
    const { actor, deliveryId } = identity(req); res.json(await safe(() => service.context(actor, deliveryId)));
  });
  router.get(`${root}/requests/current`, async (req, res) => {
    const { actor, deliveryId } = identity(req); res.json(await safe(() => service.currentRequest(actor, deliveryId)));
  });
  router.get(`${root}/requests/:requestId`, async (req, res) => {
    const { actor, deliveryId } = identity(req); const requestId = String(req.params.requestId);
    if (!uuid.safeParse(requestId).success) throw badRequest("observation_request_invalid");
    res.json(await safe(() => service.get(actor, deliveryId, requestId)));
  });
  router.get(root, async (req, res) => {
    const { actor, deliveryId } = identity(req); const query = z.object({ cursor: uuid.optional() }).strict().safeParse(req.query);
    if (!query.success) throw badRequest("observation_query_invalid");
    res.json(await safe(() => service.history(actor, deliveryId, query.data.cursor)));
  });
  router.post(`${root}/requests/:requestId/close-unknown`, validate(closeMimouseBuildObservationSchema), async (req, res) => {
    const { actor, deliveryId } = identity(req); const input = closeMimouseBuildObservationSchema.parse(req.body);
    if (String(req.params.requestId) !== input.requestId) throw badRequest("observation_request_invalid");
    res.json(await safe(() => service.closeUnknown(actor, deliveryId, input)));
  });
  router.post(root, validate(startMimouseBuildObservationSchema), async (req, res) => {
    const { actor, deliveryId } = identity(req); const controller = new AbortController();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    req.once("aborted", disconnect); res.once("close", disconnect);
    try {
      const result = await safe(() => service.start(actor, deliveryId, startMimouseBuildObservationSchema.parse(req.body), controller.signal));
      res.status(result.state === "running" ? 202 : 200).json(result);
    } finally { req.removeListener("aborted", disconnect); res.removeListener("close", disconnect); }
  });
  return router;
}
