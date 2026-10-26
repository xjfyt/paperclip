import express from "express";
import request from "supertest";
import { expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { mimouseEvaluationRestoreRoutes } from "../routes/mimouse-evaluation-restore.js";
import { HttpError } from "../errors.js";
const calls = vi.hoisted(() => ({ create: vi.fn(), recover: vi.fn(), list: vi.fn(async () => []) }));
vi.mock("../services/mimouse-evaluation/restore-service.js", () => ({ evaluationRestoreService: () => calls }));
const companyId = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
const body = { requestId: id, reportId: id, expectedReportHash: "a".repeat(64), expectedCurrentVersionId: id, action: "activate", confirm: true };
function app(actor: Express.Request["actor"]) {
  const server = express(); server.use(express.json()); server.use((req, _res, next) => { req.actor = actor; next(); }); server.use(mimouseEvaluationRestoreRoutes({} as Db));
  server.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error instanceof HttpError ? error.status : 400).json({ error: "denied" })); return server;
}
const owner = { type: "board", source: "session", userId: "owner", companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }] } as Express.Request["actor"];
it.each(["local_implicit", "board_key", "cloud_tenant", "mcp_oauth"] as const)("%s does not confer human file-write authority", async source => {
  calls.create.mockClear(); const response = await request(app({ ...owner, source, isInstanceAdmin: true })).post(`/companies/${companyId}/skill-evaluations/restores`).send(body);
  expect(response.status).toBe(403); expect(calls.create).not.toHaveBeenCalled();
});
it("requires an actual administrator session and explicit confirmation", async () => {
  calls.create.mockClear();
  expect((await request(app({ ...owner, memberships: [{ companyId, membershipRole: "member", status: "active" }] })).post(`/companies/${companyId}/skill-evaluations/restores`).send(body)).status).toBe(403);
  expect((await request(app(owner)).post(`/companies/${companyId}/skill-evaluations/restores`).send({ ...body, confirm: false })).status).toBe(400);
  expect(calls.create).not.toHaveBeenCalled();
});
it("pending recovery is HTTP202, never a completed activation claim", async () => {
  calls.create.mockResolvedValue({ item: { status: "prepared" }, duplicate: false });
  const response = await request(app(owner)).post(`/companies/${companyId}/skill-evaluations/restores`).send(body);
  expect(response.status).toBe(202); expect(response.body.item.status).toBe("prepared");
});
