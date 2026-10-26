import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { mimouseFeedbackRoutes } from "../routes/mimouse-feedback.js";
import { HttpError } from "../errors.js";
const calls = vi.hoisted(() => ({ options: vi.fn(), history: vi.fn(), preview: vi.fn(), confirm: vi.fn() }));
vi.mock("../services/mimouse-feedback-verification.js", () => ({ feedbackVerificationService: () => calls }));
vi.mock("../services/mimouse-feedback.js", () => ({ feedbackInboxService: () => ({}) }));
vi.mock("../services/mimouse-feedback-promotion.js", () => ({ feedbackPromotionService: () => ({}) }));
const companyId = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
const owner = { type: "board", source: "session", userId: "owner", companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }] } as Express.Request["actor"];
const base = `/companies/${companyId}/feedback-inbox/${id}`;
const selection = { reproduction: { deliveryId: id, checkIndex: 0 }, regression: { deliveryId: companyId, checkIndex: 1 } };
function app(actor: Express.Request["actor"]) {
  const server = express(); server.use(express.json()); server.use((req, _res, next) => { req.actor = actor; next(); }); server.use(mimouseFeedbackRoutes({} as Db));
  server.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error instanceof HttpError ? error.status : 400).json({ error: "denied" })); return server;
}
beforeEach(() => { for (const call of Object.values(calls)) call.mockReset().mockResolvedValue({}); });
it.each(["member", "foreign-owner", "agent", "suspended", "local", "board-key"])("denies %s on every verification route before service access", async role => {
  const actor = role === "agent" ? { type: "agent", source: "agent_jwt", companyId, agentId: id }
    : role === "local" || role === "board-key" ? { ...owner, source: role === "local" ? "local_implicit" : "board_key" }
    : { ...owner, companyIds: role === "foreign-owner" ? [id] : [companyId], memberships: [{ companyId: role === "foreign-owner" ? id : companyId, membershipRole: role === "member" ? "member" : "owner", status: role === "suspended" ? "suspended" : "active" }] };
  const server = app(actor as Express.Request["actor"]);
  for (const suffix of ["verification-options", "verifications"]) expect((await request(server).get(`${base}/${suffix}`)).status).toBe(403);
  expect((await request(server).post(`${base}/verification-preview`).send(selection)).status).toBe(403);
  expect((await request(server).post(`${base}/verifications`).send({ ...selection, requestId: id, previewDigest: "a".repeat(64), confirmReproduction: true, confirmFix: true, confirmComparableEnvironment: true })).status).toBe(403);
  for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
});
it("uses authenticated identity, no-store responses and only server-selected reference payloads", async () => {
  const server = app(owner);
  const options = await request(server).get(`${base}/verification-options`); expect(options.status).toBe(200); expect(options.headers["cache-control"]).toBe("no-store");
  expect(calls.options).toHaveBeenCalledWith(companyId, id, "owner");
  const p = await request(server).post(`${base}/verification-preview`).send(selection); expect(p.status).toBe(200); expect(p.headers["cache-control"]).toBe("no-store");
  expect(calls.preview).toHaveBeenCalledWith(companyId, id, "owner", selection);
  calls.preview.mockClear();
  for (const patch of [{ actorUserId: "other" }, { status: "passed" }, { executionStarted: true }]) expect((await request(server).post(`${base}/verification-preview`).send({ ...selection, ...patch })).status).toBe(400);
  expect(calls.preview).not.toHaveBeenCalled();
});
