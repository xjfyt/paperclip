import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import { revokeLocalAuthSchema } from "@paperclipai/shared";
import { forbidden } from "../errors.js";
import { getHiddenSettings } from "../services/settings-visibility.js";
import { mimouseAuthRevocationService } from "../services/mimouse-auth-revocations.js";
import { validate } from "../middleware/validate.js";
function actor(req: Request) {
  if (getHiddenSettings().has("instance.access")) throw forbidden("Instance user administration is managed by the hosting operator");
  if (req.actor.type !== "board" || req.actor.source !== "session" || !req.actor.userId) throw forbidden("An instance administrator browser session is required");
  return req.actor.userId;
}
export function mimouseAuthRevocationRoutes(db: Db) {
  const router = Router(), service = mimouseAuthRevocationService(db);
  router.get("/admin/users/:userId/auth-revocations", async (req, res) => {
    const result = await service.list(actor(req), String(req.params.userId)); res.setHeader("Cache-Control", "private, no-store"); res.json(result);
  });
  router.post("/admin/users/:userId/auth-revocations", validate(revokeLocalAuthSchema), async (req, res) => {
    const result = await service.revoke(actor(req), String(req.params.userId), req.body); res.setHeader("Cache-Control", "private, no-store"); res.json(result);
  });
  return router;
}
