import { Router, type Request } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { forbidden } from "../errors.js";
import { wecomFeedbackService } from "../services/mimouse-wecom.js";
import { wecomConfigSchema } from "../services/mimouse-wecom/protocol.js";

/** Saving stays disabled. Explicit enabling permits the separately gated worker to connect. */
export function mimouseWecomRoutes(db: Db) {
  const router = Router(), service = wecomFeedbackService(db);
  const path = "/companies/:companyId/feedback-wecom/connections";
  function admin(req: Request) {
    const companyId = z.string().uuid().parse(req.params.companyId);
    assertBoard(req); assertCompanyAccess(req, companyId);
    if (req.actor.source !== "local_implicit" && !req.actor.isInstanceAdmin) {
      const member = req.actor.memberships?.find(item => item.companyId === companyId);
      if (member?.status !== "active" || !["owner", "admin"].includes(String(member.membershipRole))) {
        throw forbidden("Company administrator required");
      }
    }
    return companyId;
  }
  router.get(path, async (req, res) => { res.json(await service.list(admin(req))); });
  router.post(path, async (req, res) => {
    const companyId = admin(req);
    if (!req.actor.isInstanceAdmin) throw forbidden("Instance administrator registration required");
    const config = wecomConfigSchema.parse(req.body);
    res.status(201).json(await service.create(companyId, config, getActorInfo(req)));
  });
  router.post(`${path}/:id/enabled`, async (req, res) => {
    const companyId = admin(req), id = z.string().uuid().parse(req.params.id);
    const { enabled } = z.object({ enabled: z.boolean(), confirm: z.literal(true) }).strict().parse(req.body);
    res.json(await service.setEnabled(companyId, id, enabled, getActorInfo(req)));
  });
  router.patch(`${path}/:id`, async (req, res) => {
    const companyId = admin(req), id = z.string().uuid().parse(req.params.id);
    const { config } = z.object({ config: wecomConfigSchema, confirm: z.literal(true) }).strict().parse(req.body);
    res.json(await service.update(companyId, id, config, getActorInfo(req)));
  });
  return router;
}
