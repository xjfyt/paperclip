import express from "express";
import request from "supertest";
import { expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { mimouseEvaluationRoutes } from "../routes/mimouse-evaluation.js";
import { HttpError } from "../errors.js";
const calls = vi.hoisted(() => ({ list: vi.fn(async () => ({ items: [] })), create: vi.fn() }));
vi.mock("../services/mimouse-evaluation/service.js", () => ({ evaluationService: () => ({ listDatasets: calls.list, listComparisons: calls.list, createDataset: calls.create, compare: calls.create, getComparison: calls.list, evidence: calls.list }) }));
const companyId = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
function app(actor: Express.Request["actor"]) {
  const server = express(); server.use(express.json()); server.use((req, _res, next) => { req.actor = actor; next(); });
  server.use(mimouseEvaluationRoutes({} as Db));
  server.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error instanceof HttpError ? error.status : 400).json({ error: "denied" }));
  return server;
}
const owner = { type: "board", source: "session", userId: "owner", companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }] } as Express.Request["actor"];
it.each(["member", "foreign-owner", "agent", "suspended"])("denies %s before reading evaluation evidence", async role => {
  calls.list.mockClear();
  const actor: Express.Request["actor"] = role === "agent" ? { type: "agent", source: "agent_jwt", companyId, agentId: id } : { ...owner, companyIds: role === "foreign-owner" ? [id] : [companyId], memberships: [{ companyId: role === "foreign-owner" ? id : companyId, membershipRole: role === "member" ? "member" : "owner", status: role === "suspended" ? "suspended" : "active" }] };
  for (const suffix of ["datasets", "comparisons", `comparisons/${id}`, `skills/${id}/evidence`, "readiness"]) expect((await request(app(actor)).get(`/companies/${companyId}/skill-evaluations/${suffix}`)).status).toBe(403);
  expect(calls.list).not.toHaveBeenCalled();
});
it("an administrator can inspect fail-closed readiness but cannot activate or execute", async () => {
  const server = app(owner), base = `/companies/${companyId}/skill-evaluations`;
  const response = await request(server).get(`${base}/readiness`);
  expect(response.status).toBe(200); expect(response.body).toMatchObject({ capabilityScope: "comparison_only", promotionSupported: false, rollbackSupported: false, executionStarted: false,
    blockers: ["report_specific_human_restore_readiness_required"],
    controlledRestore: { implemented: true, supportedMode: "paused_unused_managed_local_only",
      readinessPathTemplate: `/api/companies/${companyId}/skill-evaluations/restores/readiness/:reportId`,
      requiresHumanSession: true, requiresReport: true, readiness: null, authorityGranted: false, automaticallyPausesOrDetaches: false } });
  expect(JSON.stringify(response.body)).not.toContain("atomic_version_snapshot_restore_not_implemented");
  for (const action of ["promote", "rollback", "execute"]) expect((await request(server).post(`${base}/comparisons/${id}/${action}`).send({ confirm: true })).status).toBe(404);
});
it("rejects request supplied scores and output snapshots without touching the service", async () => {
  calls.create.mockClear();
  const body = { requestId: id, datasetId: id, baselineVersionId: id, candidateVersionId: companyId, runIds: [], maxCandidateCostCents: null, score: 100, outputSnapshot: "forged" };
  expect((await request(app(owner)).post(`/companies/${companyId}/skill-evaluations/comparisons`).send(body)).status).toBe(400);
  expect(calls.create).not.toHaveBeenCalled();
});

it("local implicit evaluation discovery does not grant human restore authority or load evidence", async () => {
  calls.create.mockClear(); calls.list.mockClear();
  const response = await request(app({ ...owner, source: "local_implicit" })).get(`/companies/${companyId}/skill-evaluations/readiness`);
  expect(response.status).toBe(200);
  expect(response.body.controlledRestore).toMatchObject({ implemented: true, requiresHumanSession: true, readiness: null, authorityGranted: false });
  expect(calls.create).not.toHaveBeenCalled(); expect(calls.list).not.toHaveBeenCalled();
});
