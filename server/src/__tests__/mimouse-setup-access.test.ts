import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { mimouseSetupAccessRoutes } from "../routes/mimouse-access.js";
import { HttpError } from "../errors.js";
vi.unmock("http"); vi.unmock("node:http");
const decide = vi.hoisted(() => vi.fn()); vi.mock("../services/access.js", () => ({ accessService: () => ({ decide }) }));
const companyId = "22222222-2222-4222-8222-222222222222";
function app(actor: Express.Request["actor"]) {
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => [{ id: companyId }] }) }) }));
  const server = express(); server.use((req, _res, next) => { req.actor = actor; next(); }); server.use(mimouseSetupAccessRoutes({ select } as unknown as Db));
  server.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error instanceof HttpError ? error.status : 500).json({ error: "denied" }); });
  return { server, select };
}
beforeEach(() => decide.mockReset());
it.each([true, false])("returns the authoritative permission decision %s, not a role heuristic", async allowed => {
  decide.mockResolvedValue({ allowed });
  const actor: Express.Request["actor"] = { type: "board", source: "session", userId: "member", companyIds: [companyId], memberships: [{ companyId, membershipRole: "viewer", status: "active" }] };
  const { server } = app(actor); const result = await request(server).get(`/companies/${companyId}/setup-capabilities`);
  expect(result.status).toBe(200); expect(result.body).toEqual({ canCreateAgents: allowed }); expect(result.headers["cache-control"]).toContain("no-store");
  expect(decide).toHaveBeenCalledWith({ actor, action: "agents:create", resource: { type: "company", companyId } });
});
it.each(["foreign", "agent"])("denies %s actors before company reads", async role => {
  const actor: Express.Request["actor"] = role === "agent" ? { type: "agent", source: "agent_jwt", companyId, agentId: "fixture" } : { type: "board", source: "session", userId: "foreign", companyIds: ["other"] };
  const { server, select } = app(actor); expect((await request(server).get(`/companies/${companyId}/setup-capabilities`)).status).toBe(403); expect(select).not.toHaveBeenCalled(); expect(decide).not.toHaveBeenCalled();
});
