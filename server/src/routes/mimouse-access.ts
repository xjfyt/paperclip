import { Router } from "express";
import { eq } from "drizzle-orm";
import { companies, type Db } from "@paperclipai/db";
import type { CompanySetupCapabilities } from "@paperclipai/shared";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { notFound } from "../errors.js";
import { accessService } from "../services/access.js";

/** Read-only UX hint. Every mutation still performs its own authorization. */
export function mimouseSetupAccessRoutes(db: Db) {
  const router = Router(); const access = accessService(db);
  router.get("/companies/:companyId/setup-capabilities", async (req, res) => {
    const companyId = String(req.params.companyId); assertBoard(req); assertCompanyAccess(req, companyId);
    const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company) throw notFound("Company not found");
    const decision = await access.decide({ actor: req.actor, action: "agents:create", resource: { type: "company", companyId } });
    const capabilities: CompanySetupCapabilities = { canCreateAgents: decision.allowed === true };
    res.setHeader("Cache-Control", "private, no-store"); res.json(capabilities);
  });
  return router;
}
