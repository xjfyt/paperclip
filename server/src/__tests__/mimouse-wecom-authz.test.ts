import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import type { Request, Response, NextFunction } from "express";
import { mimouseWecomRoutes } from "../routes/mimouse-wecom.js";
const calls = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), setEnabled: vi.fn(), update: vi.fn() }));
vi.mock("../services/mimouse-wecom.js", () => ({ wecomFeedbackService: () => calls }));
vi.mock("../services/activity-log.js", () => ({ logActivity: vi.fn() }));
const companyId = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
const admin: Request["actor"] = { type: "board", source: "session", userId: "admin", companyIds: [companyId],
  memberships: [{ companyId, membershipRole: "admin", status: "active" }] };
const handlers = () => mimouseWecomRoutes({} as Db).stack.filter(layer => layer.route).map(layer =>
  layer.route!.stack[0].handle as unknown as (req: Request, res: Response, next: NextFunction) => Promise<void>);
beforeEach(() => { for (const call of Object.values(calls)) call.mockClear(); });
it.each(["member", "foreign-owner", "agent", "inactive-admin"])("denies %s before any service call, without a server", async role => {
  const actor: Request["actor"] = role === "agent"
    ? { type: "agent", source: "agent_jwt", companyId, agentId: id }
    : { type: "board", source: "session", userId: role, companyIds: [role === "foreign-owner" ? "other" : companyId],
      memberships: [{ companyId: role === "foreign-owner" ? "other" : companyId,
        membershipRole: role === "member" ? "member" : "admin", status: role === "inactive-admin" ? "suspended" : "active" }] };
  expect(handlers()).toHaveLength(4);
  for (const handler of handlers()) {
    await expect(handler({ actor, params: { companyId, id }, body: {} } as unknown as Request, {} as Response, vi.fn())).rejects.toMatchObject({ status: 403 });
  }
  for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
});
it.each([{}, { enabled: true }, { enabled: true, confirm: false }, { enabled: true, confirm: true, url: "wss://example.com" }])(
  "requires explicit enable confirmation and rejects extra configuration: %j", async body => {
    await expect(handlers()[2]({ actor: admin, params: { companyId, id }, body } as unknown as Request,
      {} as Response, vi.fn())).rejects.toBeDefined();
    expect(calls.setEnabled).not.toHaveBeenCalled();
  });
it("passes only company scope, id, enabled and actor to administrative service", async () => {
  calls.setEnabled.mockResolvedValue({ id, enabled: false });
  const json = vi.fn();
  await handlers()[2]({ actor: admin, params: { companyId, id }, body: { enabled: false, confirm: true } } as unknown as Request,
    { json } as unknown as Response, vi.fn());
  expect(calls.setEnabled).toHaveBeenCalledWith(companyId, id, false, expect.objectContaining({ actorId: "admin" }));
  expect(json).toHaveBeenCalledWith({ id, enabled: false });
});
it("saving validates only a pinned config and never enables it", async () => {
  const config = { transport: "long_connection", botId: "bot-test", product: "test-product",
    allowedGroupIds: ["group-test"], allowedDirectSenderIds: [],
    secret: { secretId: "44444444-4444-4444-8444-444444444444", version: 1 } };
  calls.create.mockResolvedValue({ id, enabled: false });
  const json = vi.fn(), status = vi.fn().mockReturnValue({ json });
  await handlers()[1]({ actor: { ...admin, isInstanceAdmin: true }, params: { companyId }, body: config } as unknown as Request,
    { status } as unknown as Response, vi.fn());
  expect(status).toHaveBeenCalledWith(201);
  expect(calls.create).toHaveBeenCalledWith(companyId, config, expect.objectContaining({ actorId: "admin" }));
  expect(calls.setEnabled).not.toHaveBeenCalled();
  expect(calls.update).not.toHaveBeenCalled();
});

it("company administrators cannot reserve globally unique bot identities", async () => {
  await expect(handlers()[1]({ actor: admin, params: { companyId }, body: { botId: "known-other-bot", secret: "dummy" } } as unknown as Request,
    {} as Response, vi.fn())).rejects.toMatchObject({ status: 403 });
  expect(calls.create).not.toHaveBeenCalled();
});
