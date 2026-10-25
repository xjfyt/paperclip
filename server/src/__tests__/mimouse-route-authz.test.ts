import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { mimouseNotificationRoutes } from "../routes/mimouse-notifications.js";
import { mimouseCodingRoutes } from "../routes/mimouse-coding.js";
import { workbuddyRoutes } from "../routes/workbuddy.js";
import { HttpError } from "../errors.js";
vi.unmock("http"); vi.unmock("node:http");
const companyId = "22222222-2222-4222-8222-222222222222";
function app(actor: Express.Request["actor"]) {
  const select = vi.fn(() => { throw Error("must deny before database access"); });
  const db = { select } as unknown as Db; const server = express(); server.use(express.json());
  server.use((req, _res, next) => { req.actor = actor; next(); });
  server.use(mimouseNotificationRoutes(db), mimouseCodingRoutes(db), workbuddyRoutes(db));
  server.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error instanceof HttpError ? error.status : 500).json({ error: "denied" }); });
  return { server, select };
}
describe("new integration route authorization boundary", () => {
  it.each(["notifications", "coding", "integrations/workbuddy"])("denies other-company %s before reading resources", async route => {
    const { server, select } = app({ type: "board", source: "session", userId: "owner", companyIds: ["other"], memberships: [{ companyId: "other", membershipRole: "owner", status: "active" }] });
    expect((await request(server).get(`/companies/${companyId}/${route}`)).status).toBe(403); expect(select).not.toHaveBeenCalled();
  });
  it.each(["notifications", "coding"])("denies ordinary members access to %s administration", async route => {
    const { server, select } = app({ type: "board", source: "session", userId: "member", companyIds: [companyId], memberships: [{ companyId, membershipRole: "member", status: "active" }] });
    expect((await request(server).get(`/companies/${companyId}/${route}`)).status).toBe(403); expect(select).not.toHaveBeenCalled();
  });
  it.each(["notifications", "coding", "integrations/workbuddy"])("does not grant an Agent the %s owner settings view", async route => {
    const { server, select } = app({ type: "agent", source: "agent_jwt", companyId, agentId: "33333333-3333-4333-8333-333333333333", runId: "44444444-4444-4444-8444-444444444444" });
    expect((await request(server).get(`/companies/${companyId}/${route}`)).status).toBe(403); expect(select).not.toHaveBeenCalled();
  });
});

it("local implicit board access cannot authorize paid background repairs", async () => {
  const { server, select } = app({ type: "board", source: "local_implicit", userId: "local-board", companyIds: [companyId], isInstanceAdmin: true });
  const response = await request(server).post(`/companies/${companyId}/coding/33333333-3333-4333-8333-333333333333/repair-settings`).send({ enabled: true, confirm: true, headSha: "a".repeat(40), routineId: "44444444-4444-4444-8444-444444444444", expectedRoutineRevisionId: "55555555-5555-4555-8555-555555555555", maxAttempts: 2, maxDurationMinutes: 15, maxCostCents: 100 });
  expect(response.status).toBe(403); expect(select).not.toHaveBeenCalled();
});
