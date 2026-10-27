import { expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";
vi.mock("../mimouse-private-prompt-tests/service.js", () => ({ authorizePrivatePrompt: vi.fn() }));
vi.mock("../mimouse-prompt-applications/target.js", () => ({ applicationDigest: vi.fn() }));
vi.mock("../heartbeat-run-events.js", () => ({ appendHeartbeatRunEvent: vi.fn() }));
vi.mock("../access.js", () => ({ accessService: vi.fn() }));
vi.mock("./candidates.js", () => ({ assertRuntimeRoutingSnapshots: vi.fn(), requireRuntimeCostRoutingEnabled: vi.fn(), snapshotRuntimeRoutingPool: vi.fn() }));
import { assertRuntimeRoutingCheckout } from "./execution.js";
const binding = { id: "binding", companyId: "company", issueId: "issue", selectedAgentId: "agent", runId: "run", state: "run_claimed",
  dispatchActorUserId: "owner", dispatchActorSessionId: "session", dispatchRequestId: "request" };
const running = { id: "run", companyId: "company", agentId: "agent", issueId: "issue", status: "running", runtimeMode: "legacy",
  retryOfRunId: null, scheduledRetryReason: null, nativeSessionId: null, nativeIssueId: null, contextSnapshot: {} };
function db(row: object | null, origin: string | null = "runtime_cost_routing", run: object | null = running) {
  const rows = [row ? [row] : [], [{ origin }], run ? [run] : []];
  return { select: () => ({ from: () => ({ where: async () => rows.shift() }) }) } as unknown as Db;
}
it.each(["run_claimed", "start_requested"])("allows exact persisted run checkout in %s without changing launch state", async state => {
  const row = { ...binding, state };
  await expect(assertRuntimeRoutingCheckout(db(row), "issue", "agent", "run")).resolves.toBeUndefined();
  expect(row.state).toBe(state);
});
it.each([
  { state: "bound" }, { state: "wake_pending" }, { runId: null }, { runId: "other-run" }, { selectedAgentId: "other-agent" },
  { dispatchActorUserId: null }, { dispatchActorUserId: "" }, { dispatchActorSessionId: null }, { dispatchActorSessionId: "" },
  { dispatchRequestId: null },
])("rejects incomplete or foreign durable checkout binding %j", async patch => {
  await expect(assertRuntimeRoutingCheckout(db({ ...binding, ...patch }), "issue", "agent", "run")).rejects.toThrow("runtime_routing_checkout_denied");
});
it.each([null, "other-run"])("rejects caller run identity %s", async runId => {
  await expect(assertRuntimeRoutingCheckout(db(binding), "issue", "agent", runId)).rejects.toThrow("runtime_routing_checkout_denied");
});
it.each([{ dispatchActorUserId: null }, { dispatchActorSessionId: null }, { dispatchRequestId: null }])("also rejects missing authority after the launch witness %j", async patch => {
  await expect(assertRuntimeRoutingCheckout(db({ ...binding, state: "start_requested", ...patch }), "issue", "agent", "run")).rejects.toThrow("runtime_routing_checkout_denied");
});
it("does not permit another agent or a missing controlled binding", async () => {
  await expect(assertRuntimeRoutingCheckout(db(binding), "issue", "other-agent", "run")).rejects.toThrow("runtime_routing_checkout_denied");
  await expect(assertRuntimeRoutingCheckout(db(null), "issue", "agent", "run")).rejects.toThrow("runtime_routing_binding_missing");
});
it("leaves ordinary unbound checkout unchanged", async () => {
  await expect(assertRuntimeRoutingCheckout(db(null, null), "issue", "agent", null)).resolves.toBeUndefined();
});
it.each([{ status: "queued" }, { status: "succeeded" }, { status: "failed" }, { status: "cancelled" }, { status: "timed_out" },
  { id: "other" }, { companyId: "foreign" }, { agentId: "other" }, { issueId: "other" }, { runtimeMode: "native" },
  { nativeSessionId: "session" }, { nativeIssueId: "issue" }, { retryOfRunId: "prior" }, { scheduledRetryReason: "transient_failure" },
  { contextSnapshot: { aiRouterSelection: {} } }, { contextSnapshot: { aiConnection: {} } }, { contextSnapshot: { routineId: "routine" } },
])("rejects stale or substituted persisted run %j in both checkout phases", async patch => {
  for (const state of ["run_claimed", "start_requested"]) {
    await expect(assertRuntimeRoutingCheckout(db({ ...binding, state }, "runtime_cost_routing", { ...running, ...patch }), "issue", "agent", "run")).rejects.toThrow("runtime_routing_checkout_denied");
  }
});
it("rejects a missing persisted run even if its binding ID is present", async () => {
  await expect(assertRuntimeRoutingCheckout(db(binding, "runtime_cost_routing", null), "issue", "agent", "run")).rejects.toThrow("runtime_routing_checkout_denied");
});
