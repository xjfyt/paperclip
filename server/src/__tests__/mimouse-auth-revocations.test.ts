import { ZodError } from "zod";
import express from "express";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { mimouseAuthRevocationRoutes } from "../routes/mimouse-auth-revocations.js";
import { HttpError } from "../errors.js";
vi.unmock("http"); vi.unmock("node:http");
const mocks = vi.hoisted(() => ({ list: vi.fn(), revoke: vi.fn(), hidden: new Set<string>() }));
vi.mock("../services/mimouse-auth-revocations.js", () => ({ mimouseAuthRevocationService: () => mocks }));
vi.mock("../services/settings-visibility.js", () => ({ getHiddenSettings: () => mocks.hidden }));
function app(actor: Express.Request["actor"]) {
  const server = express(); server.use(express.json()); server.use((req, _res, next) => { req.actor = actor; next(); }); server.use(mimouseAuthRevocationRoutes({} as Db));
  server.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error instanceof ZodError ? 400 : error instanceof HttpError ? error.status : 500).json({ error: "denied" }); }); return server;
}
const path = "/admin/users/fixture/auth-revocations", input = { requestId: "11111111-1111-4111-8111-111111111111", confirmUserId: "fixture", reason: "offboarding" };
beforeEach(() => { mocks.hidden.clear(); mocks.list.mockReset().mockResolvedValue([]); mocks.revoke.mockReset().mockResolvedValue({ sessionsRevoked: 1 }); });
it.each(["local_implicit", "board_key", "cloud_tenant"] as const)("rejects non-session %s even with an admin flag", async source => {
  const server = app({ type: "board", source, userId: "admin", isInstanceAdmin: true });
  expect((await request(server).post(path).send(input)).status).toBe(403); expect((await request(server).get(path)).status).toBe(403); expect(mocks.revoke).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
});
it("honors hosting operator's hidden access management floor", async () => {
  mocks.hidden.add("instance.access"); const server = app({ type: "board", source: "session", userId: "admin" });
  expect((await request(server).post(path).send(input)).status).toBe(403); expect(mocks.revoke).not.toHaveBeenCalled();
});
it("passes session identity to authoritative service and disables caching", async () => {
  const server = app({ type: "board", source: "session", userId: "admin" });
  const result = await request(server).post(path).send(input); expect(result.status).toBe(200); expect(result.headers["cache-control"]).toContain("no-store"); expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith("admin", "fixture", input);
});
it("rejects incomplete, extra or caller-controlled cutoff parameters", async () => {
  const server = app({ type: "board", source: "session", userId: "admin" });
  for (const body of [{}, { ...input, cutoffAt: "2020-01-01" }, { ...input, reason: "arbitrary" }]) expect((await request(server).post(path).send(body)).status).toBe(400);
  expect(mocks.revoke).not.toHaveBeenCalled();
});
