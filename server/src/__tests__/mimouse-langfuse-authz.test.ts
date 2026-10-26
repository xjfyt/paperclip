import { expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
import type { Request, Response, NextFunction } from "express";
import { mimouseLangfuseRoutes } from "../routes/mimouse-langfuse.js";
const calls = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), pull: vi.fn(), restart: vi.fn() }));
vi.mock("../services/mimouse-langfuse.js", () => ({ langfuseFeedbackService: () => calls }));
vi.mock("../services/activity-log.js", () => ({ logActivity: vi.fn() }));
const companyId = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
it.each(["member", "foreign-owner", "agent"])("denies %s before any service call, without opening a server", async role => {
  for (const call of Object.values(calls)) call.mockClear();
  const actor: Request["actor"] = role === "agent"
    ? { type: "agent", source: "agent_jwt", companyId, agentId: id }
    : { type: "board", source: "session", userId: role, companyIds: [role === "member" ? companyId : "other"], memberships: [{ companyId: role === "member" ? companyId : "other", membershipRole: role === "member" ? "member" : "owner", status: "active" }] };
  const router = mimouseLangfuseRoutes({} as Db);
  const routes = router.stack.filter(layer => layer.route);
  expect(routes).toHaveLength(4);
  for (const layer of routes) {
    const handler = layer.route!.stack[0].handle as unknown as (req: Request, res: Response, next: NextFunction) => Promise<void>;
    await expect(handler({ actor, params: { companyId, id }, body: {} } as unknown as Request, {} as Response, vi.fn())).rejects.toMatchObject({ status: 403 });
  }
  for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
});
