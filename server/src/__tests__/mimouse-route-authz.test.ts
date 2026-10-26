import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { mimouseOperationRoutes } from "../routes/mimouse-operations.js";
import { mimouseFeedbackRoutes } from "../routes/mimouse-feedback.js";
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
  server.use(mimouseOperationRoutes(db), mimouseFeedbackRoutes(db), mimouseNotificationRoutes(db), mimouseCodingRoutes(db), workbuddyRoutes(db));
  server.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error instanceof HttpError ? error.status : 500).json({ error: "denied" }); });
  return { server, select };
}
describe("new integration route authorization boundary", () => {
  it.each(["data-operations", "feedback-inbox", "notifications", "coding", "coding/33333333-3333-4333-8333-333333333333/build-matrix", "integrations/workbuddy"])("denies other-company %s before reading resources", async route => {
    const { server, select } = app({ type: "board", source: "session", userId: "owner", companyIds: ["other"], memberships: [{ companyId: "other", membershipRole: "owner", status: "active" }] });
    expect((await request(server).get(`/companies/${companyId}/${route}`)).status).toBe(403); expect(select).not.toHaveBeenCalled();
  });
  it.each(["data-operations", "feedback-inbox", "notifications", "coding", "coding/33333333-3333-4333-8333-333333333333/build-matrix"])("denies ordinary members access to %s administration", async route => {
    const { server, select } = app({ type: "board", source: "session", userId: "member", companyIds: [companyId], memberships: [{ companyId, membershipRole: "member", status: "active" }] });
    expect((await request(server).get(`/companies/${companyId}/${route}`)).status).toBe(403); expect(select).not.toHaveBeenCalled();
  });
  it.each(["data-operations", "feedback-inbox", "notifications", "coding", "coding/33333333-3333-4333-8333-333333333333/build-matrix", "integrations/workbuddy"])("does not grant an Agent the %s owner settings view", async route => {
    const { server, select } = app({ type: "agent", source: "agent_jwt", companyId, agentId: "33333333-3333-4333-8333-333333333333", runId: "44444444-4444-4444-8444-444444444444" });
    expect((await request(server).get(`/companies/${companyId}/${route}`)).status).toBe(403); expect(select).not.toHaveBeenCalled();
  });
});

it("local implicit board access cannot authorize paid background repairs", async () => {
  const { server, select } = app({ type: "board", source: "local_implicit", userId: "local-board", companyIds: [companyId], isInstanceAdmin: true });
  const response = await request(server).post(`/companies/${companyId}/coding/33333333-3333-4333-8333-333333333333/repair-settings`).send({ enabled: true, confirm: true, headSha: "a".repeat(40), routineId: "44444444-4444-4444-8444-444444444444", expectedRoutineRevisionId: "55555555-5555-4555-8555-555555555555", maxAttempts: 2, maxDurationMinutes: 15, maxCostCents: 100 });
  expect(response.status).toBe(403); expect(select).not.toHaveBeenCalled();
});


it.each(["member", "foreign-owner", "agent"])("denies %s notification history and revision mutation before resources", async role => {
  const actor: Express.Request["actor"] = role === "agent"
    ? { type: "agent", source: "agent_jwt", companyId, agentId: "33333333-3333-4333-8333-333333333333" }
    : { type: "board", source: "session", userId: role, companyIds: [role === "member" ? companyId : "other"], memberships: [{ companyId: role === "member" ? companyId : "other", membershipRole: role === "member" ? "member" : "owner", status: "active" }] };
  const { server, select } = app(actor); const path = `/companies/${companyId}/notifications/endpoints/33333333-3333-4333-8333-333333333333/revisions`;
  expect((await request(server).get(path)).status).toBe(403);
  expect((await request(server).post(path).send({ expectedVersion: 1, name: "Unauthorized change", kind: "wecom_webhook", config: {}, secretRef: "44444444-4444-4444-8444-444444444444", secretVersion: 1 })).status).toBe(403);
  expect(select).not.toHaveBeenCalled();
});


it.each(["member", "foreign-owner", "agent"])("denies %s delivery observations before resources", async role => {
  const actor: Express.Request["actor"] = role === "agent"
    ? { type: "agent", source: "agent_jwt", companyId, agentId: "33333333-3333-4333-8333-333333333333" }
    : { type: "board", source: "session", userId: role, companyIds: [role === "member" ? companyId : "other"], memberships: [{ companyId: role === "member" ? companyId : "other", membershipRole: role === "member" ? "member" : "owner", status: "active" }] };
  const { server, select } = app(actor); const path = `/companies/${companyId}/notifications/deliveries/33333333-3333-4333-8333-333333333333/reviews`;
  expect((await request(server).get(path)).status).toBe(403);
  expect((await request(server).post(path).send({ requestId: "44444444-4444-4444-8444-444444444444", confirm: true, outcome: "unknown", evidence: "Permission fixture", expectedState: "indeterminate", expectedAttempt: 1 })).status).toBe(403);
  expect(select).not.toHaveBeenCalled();
});

it.each(["member", "foreign-owner", "agent"])("denies %s manual feedback imports and candidate reads", async role => {
  const actor: Express.Request["actor"] = role === "agent"
    ? { type: "agent", source: "agent_jwt", companyId, agentId: "33333333-3333-4333-8333-333333333333" }
    : { type: "board", source: "session", userId: role, companyIds: [role === "member" ? companyId : "other"], memberships: [{ companyId: role === "member" ? companyId : "other", membershipRole: role === "member" ? "member" : "owner", status: "active" }] };
  const { server, select } = app(actor), path = `/companies/${companyId}/feedback-inbox`;
  expect((await request(server).post(path).send({ sourceKind: "manual", sourceInstance: "fixture", externalId: "event-1", title: "Feedback", text: "data only", product: "app", occurredAt: "2026-10-26T00:00:00Z" })).status).toBe(403);
  expect((await request(server).get(`${path}/33333333-3333-4333-8333-333333333333/candidates`)).status).toBe(403);
  expect(select).not.toHaveBeenCalled();
});

it.each(["local_implicit", "board_key"] as const)("does not let %s promote feedback without a human browser session", async source => {
  const { server, select } = app({ type: "board", source, userId: "local-board", companyIds: [companyId], isInstanceAdmin: true });
  const response = await request(server).post(`/companies/${companyId}/feedback-inbox/33333333-3333-4333-8333-333333333333/promote`).send({ requestId: "44444444-4444-4444-8444-444444444444", confirm: true, title: "Reviewed feedback", reproduction: "Reproduce locally", expectedBehavior: "No crash", acceptanceCriteria: ["Regression passes"] });
  expect(response.status).toBe(403); expect(select).not.toHaveBeenCalled();
});

it("does not reveal a private confirmation receipt through a personal Board key", async () => {
  const { server, select } = app({ type: "board", source: "board_key", userId: "owner", companyIds: [companyId], isInstanceAdmin: true });
  expect((await request(server).get(`/companies/${companyId}/feedback-inbox/33333333-3333-4333-8333-333333333333/promotion`)).status).toBe(403);
  expect(select).not.toHaveBeenCalled();
});

it.each(["local_implicit", "board_key"] as const)("does not let %s request business-data review", async source => {
  const { server, select } = app({ type: "board", source, userId: "local-board", companyIds: [companyId], isInstanceAdmin: true });
  expect((await request(server).post(`/companies/${companyId}/data-operations/33333333-3333-4333-8333-333333333333/request-approval`).send({ confirm: true, expectedPreviewHash: "a".repeat(64), locale: "en" })).status).toBe(403);
  expect(select).not.toHaveBeenCalled();
});
