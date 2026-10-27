import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db, agents, heartbeatRuns } from "@paperclipai/db";
import { createHeartbeatRetries, type HeartbeatRetryDependencies } from "../services/heartbeat/retries.js";
const gate = vi.hoisted(() => vi.fn());
vi.mock("../services/mimouse-coding/repair-deadline.js", () => ({
  codingRepairRetryAdmissionBlock: gate,
  isDedicatedCodingRepairRun: (run: { contextSnapshot?: Record<string, unknown> }) => typeof run.contextSnapshot?.codingRepairAttemptId === "string",
}));
vi.mock("../services/legacy-execution-recovery.js", () => ({ legacyExecutionNeedsReconciliationWithEvidence: async () => false }));

describe("repair retry transaction admission wiring", () => {
  beforeEach(() => gate.mockReset());
  it.each(["initial", "final"])("blocks the %s gate before inserting a wake or successor", async phase => {
    const lock = vi.fn(async () => []); const insert = vi.fn(() => { throw Error("unexpected insert"); });
    const chain = { where: () => chain, limit: async () => [] };
    const tx = { execute: lock, select: () => ({ from: () => chain }), insert };
    const db = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) } as Db;
    gate.mockImplementation(async () => {
      expect(lock).toHaveBeenCalled();
      return phase === "initial" || gate.mock.calls.length > 1 ? "coding_repair_deadline_elapsed" : null;
    });
    const run = { id: "run", companyId: "company", agentId: "agent", scopeKind: "issue", issueId: "issue", status: "failed", scheduledRetryAttempt: 0,
      contextSnapshot: { issueId: "issue", codingRepairAttemptId: "attempt" } } as typeof heartbeatRuns.$inferSelect;
    const deps = { getAgentInvokability: async () => ({ invokable: true }), resolveSessionBeforeForWakeup: async () => null,
      resolveResponsibleUserIdForRunContext: async () => "owner", appendRunEvent: vi.fn(async () => {}) } as unknown as HeartbeatRetryDependencies;
    const outcome = await createHeartbeatRetries(db, deps).scheduleBoundedRetryForRun(run, { adapterType: "process" } as typeof agents.$inferSelect, { delayMs: 1 });
    expect(outcome).toMatchObject({ outcome: "not_scheduled", errorCode: "coding_repair_retry_blocked" });
    expect(gate).toHaveBeenCalledTimes(phase === "initial" ? 1 : 2); expect(insert).not.toHaveBeenCalled();
  });
});
