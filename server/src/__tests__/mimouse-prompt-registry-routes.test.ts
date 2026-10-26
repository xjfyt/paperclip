import express from "express";
import request from "supertest";
import { expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import { mimousePromptRegistryRoutes } from "../routes/mimouse-prompt-registry.js";
import { isSecretSensitiveHttpRequest } from "../middleware/http-log-policy.js";
import { createPromptRevisionSchema, selectPromptRevisionSchema } from "@paperclipai/shared/mimouse-prompt-registry";
import { HttpError } from "../errors.js";
const calls = vi.hoisted(() => ({ list: vi.fn(async () => ({ items: [] })), create: vi.fn(), select: vi.fn(), history: vi.fn(), content: vi.fn() }));
vi.mock("../services/mimouse-prompt-registry/service.js", () => ({ promptRegistryService: () => calls }));
const companyId = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
const body = { requestId: id, promptKey: "reviewer", content: " \n<script>not executed</script>\n " };
const selection = { requestId: id, action: "promote", revisionId: id, expectedHeadReceiptId: null, confirmRegistryOnly: true };
const owner = { type: "board", source: "session", userId: "owner", companyIds: [companyId], memberships: [{ companyId, membershipRole: "owner", status: "active" }] } as Express.Request["actor"];
function app(actor: Express.Request["actor"]) {
  const server = express(); server.use(express.json()); server.use((req, _res, next) => { req.actor = actor; next(); });
  server.use(mimousePromptRegistryRoutes({} as Db));
  server.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error instanceof HttpError ? error.status : 400).json({ error: error instanceof Error ? error.message : "denied" }));
  return server;
}
const root = `/companies/${companyId}/prompt-registry`;
it.each(["local_implicit", "board_key", "cloud_tenant", "mcp_oauth"] as const)("%s cannot read or select registry even as instance admin", async source => {
  calls.list.mockClear(); calls.create.mockClear(); calls.select.mockClear(); const server = app({ ...owner, source, isInstanceAdmin: true });
  expect((await request(server).get(root)).status).toBe(403);
  expect((await request(server).post(`${root}/revisions`).send(body)).status).toBe(403);
  expect((await request(server).post(`${root}/${id}/selections`).send(selection)).status).toBe(403);
  expect(calls.list).not.toHaveBeenCalled(); expect(calls.create).not.toHaveBeenCalled(); expect(calls.select).not.toHaveBeenCalled();
});
it.each(["member", "foreign", "suspended", "agent"])("denies %s", async role => {
  const actor: Express.Request["actor"] = role === "agent" ? { type: "agent", source: "agent_jwt", companyId, agentId: id } : { ...owner, companyIds: role === "foreign" ? [id] : [companyId], memberships: [{ companyId, membershipRole: role === "member" ? "member" : "owner", status: role === "suspended" ? "suspended" : "active" }] };
  expect((await request(app(actor)).get(root)).status).toBe(403);
});
it("does not normalize content, accepts inert instructions and rejects activation/forged fields", () => {
  expect(createPromptRevisionSchema.parse(body).content).toBe(body.content);
  for (const content of ["\0", "\uD800", "a".repeat(64001)]) expect(createPromptRevisionSchema.safeParse({ ...body, content }).success).toBe(false);
  for (const patch of [{ runtimeApplied: true }, { reportId: id }, { confirmRegistryOnly: false }, { actorUserId: "forged" }]) expect(selectPromptRevisionSchema.safeParse({ ...selection, ...patch }).success).toBe(false);
  expect(selectPromptRevisionSchema.safeParse({ ...selection, expectedHeadReceiptId: undefined }).success).toBe(false);
});
it("scrubs driver errors, disables caching and protects all private log variants", async () => {
  calls.create.mockRejectedValueOnce(Error(`SQL secret ${body.content}`));
  const response = await request(app(owner)).post(`${root}/revisions`).send(body);
  expect(response.status).toBe(422); expect(response.body.error).toBe("prompt_registry_operation_failed");
  expect(response.headers["cache-control"]).toBe("no-store");
  for (const method of ["POST", "GET", "DELETE", "OPTIONS"]) for (const url of [`/api${root}`, `/API${root.toUpperCase()}/unknown?secret=x`, `https://host/api${root}/revisions`]) expect(isSecretSensitiveHttpRequest(method, url)).toBe(true);
});
it("returns receipt without claiming runtime activation; has no execute/update/delete API", async () => {
  calls.select.mockResolvedValueOnce({ item: { id, runtimeApplied: false }, duplicate: false });
  expect((await request(app(owner)).post(`${root}/${id}/selections`).send(selection)).body.item.runtimeApplied).toBe(false);
  expect((await request(app(owner)).post(`${root}/${id}/execute`).send(selection)).status).toBe(404);
  expect((await request(app(owner)).patch(`${root}/${id}/revisions/${id}`).send(body)).status).toBe(404);
  expect((await request(app(owner)).delete(`${root}/${id}/revisions/${id}`)).status).toBe(404);
});
