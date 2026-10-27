import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { mimouseCostRoutingRoutes } from "../routes/mimouse-cost-routing.js";
import { HttpError } from "../errors.js";
const calls = vi.hoisted(() => ({ current: vi.fn(), prepare: vi.fn(), approve: vi.fn(), closeExpired: vi.fn(), disable: vi.fn(), createTask: vi.fn(), run: vi.fn(), request: vi.fn(), binding: vi.fn(), detail: vi.fn(), wake: vi.fn() }));
vi.mock("../services/mimouse-cost-routing/service.js", () => ({ runtimeCostRoutingService: () => calls }));
vi.mock("../services/heartbeat.js", () => ({ heartbeatService: () => ({ wakeup: calls.wake }) }));
const companyId = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
const owner = { type: "board", source: "session", userId: "owner", sessionId: "session", companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }] } as Express.Request["actor"];
function app(actor: Express.Request["actor"]) {
  const server = express(); server.use(express.json()); server.use((req, _res, next) => { req.actor = actor; next(); }); server.use(mimouseCostRoutingRoutes({} as Db));
  server.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error instanceof HttpError ? error.status : 400).json({ error: error instanceof Error ? error.message : "denied" })); return server;
}
const root = `/companies/${companyId}/runtime-cost-routing`;
beforeEach(() => { for (const fn of Object.values(calls)) fn.mockReset(); calls.current.mockResolvedValue({ enabled: false, generation: 0, policy: null }); });
it.each(["local_implicit", "board_key", "cloud_tenant", "mcp_oauth"] as const)("rejects %s even for instance admin", async source => {
  const server = app({ ...owner, source, isInstanceAdmin: true });
  expect((await request(server).get(root)).status).toBe(403); expect((await request(server).post(`${root}/bindings/${id}/run`).send({ requestId: id })).status).toBe(403);
  expect(calls.current).not.toHaveBeenCalled(); expect(calls.run).not.toHaveBeenCalled();
});
it("rejects missing session, agent and other company identities", async () => {
  for (const actor of [{ ...owner, sessionId: undefined }, { ...owner, companyIds: [id] }, { type: "agent", source: "agent_jwt", companyId, agentId: id }] as Express.Request["actor"][]) expect((await request(app(actor)).get(root)).status).toBe(403);
});
it("propagates current session into every request and sets no-store", async () => {
  const response = await request(app(owner)).get(root); expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
  expect(calls.current).toHaveBeenCalledWith({ companyId, userId: "owner", sessionId: "session" }); expect(calls.wake).not.toHaveBeenCalled();
});
it("metadata prepare/approve/disable/create routes never call wake directly", async () => {
  calls.prepare.mockResolvedValue({ duplicate: false, item: { id } }); calls.createTask.mockResolvedValue({ duplicate: false, binding: { id } });
  for (const path of ["prepare", `policies/${id}/approve`, `policies/${id}/close-expired`, "disable", "tasks"]) expect((await request(app(owner)).post(`${root}/${path}`).send({ requestId: id })).status).toBeLessThan(300);
  expect(calls.wake).not.toHaveBeenCalled(); expect(calls.run).not.toHaveBeenCalled();
});
it("explicit expired closure carries only fresh session identity and proposal generation", async () => {
  calls.closeExpired.mockResolvedValue({ item: { id, approvalClosedAt: "2026-10-27T00:00:00Z" }, duplicate: false });
  const response = await request(app(owner)).post(`${root}/policies/${id}/close-expired`).send({ expectedGeneration: 0 });
  expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
  expect(calls.closeExpired).toHaveBeenCalledWith({ companyId, userId: "owner", sessionId: "session" }, id, { expectedGeneration: 0 });
  expect(calls.wake).not.toHaveBeenCalled(); expect(calls.approve).not.toHaveBeenCalled();
});
it("only the explicit binding run route asks the service to execute", async () => {
  await request(app(owner)).post(`${root}/bindings/${id}/run`).send({ requestId: id, confirmExecution: true, confirmPossibleCharges: true });
  expect(calls.run).toHaveBeenCalledWith({ companyId, userId: "owner", sessionId: "session" }, id, { requestId: id, confirmExecution: true, confirmPossibleCharges: true });
});
it("scrubs unexpected database/proof errors instead of exposing prompt or secret text", async () => {
  calls.prepare.mockRejectedValue(Error("SQL private prompt provider secret")); const response = await request(app(owner)).post(`${root}/prepare`).send({});
  expect(response.status).toBe(422); expect(response.body.error).toBe("runtime_routing_operation_failed"); expect(response.headers["cache-control"]).toBe("no-store");
});
it("request readback is scoped, read-only, and preserves all-null unknown", async () => {
  const result = { enabled: false, companyPaused: true, policy: null, receipt: null, binding: null, closure: null }; calls.request.mockResolvedValue(result);
  const response = await request(app(owner)).get(`${root}/requests/${id}?action=run&bindingId=${id}`); expect(response.body).toEqual(result);
  expect(calls.wake).not.toHaveBeenCalled(); expect(calls.run).not.toHaveBeenCalled();
});
