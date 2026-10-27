import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Db } from "@paperclipai/db";
import { deleteAgentDependencies } from "../services/agent-deletion.js";
import { purgeAgent } from "../modules/agent-lifecycle/adapters/deletion.js";
import type { LifecycleEffects } from "../modules/agent-lifecycle/adapters/effects.js";

const { cancelPendingForDeletedAddressee, getById, normalizeAgentRow } = vi.hoisted(() => ({
  cancelPendingForDeletedAddressee: vi.fn(), getById: vi.fn(), normalizeAgentRow: vi.fn(),
}));
vi.mock("../services/issue-thread-interactions.js", () => ({
  issueThreadInteractionService: () => ({ cancelPendingForDeletedAddressee }),
}));
vi.mock("../lib/agent-records.js", () => ({
  agentRecordQueries: () => ({ getById, normalizeAgentRow }),
}));

const companyId = "00000000-0000-4000-8000-000000000001";
const otherCompanyId = "00000000-0000-4000-8000-000000000002";
const agentId = "00000000-0000-4000-8000-000000000003";
const otherAgentId = "00000000-0000-4000-8000-000000000004";
const dialect = new PgDialect();
type Table = Parameters<typeof getTableName>[0];
type Binding = { companyId: string; selectedAgentId: string; state: string; runId: string | null };
const routingCondition = '("runtime_routing_bindings"."company_id" = $1 and "runtime_routing_bindings"."selected_agent_id" = $2)';

// The real lifecycle purge and dependency service run only against mocks. This
// verifies control flow and SQL predicates, not real PG locks or FK enforcement.
function fixture(options: {
  bindings?: Binding[];
  decisionHold?: boolean;
  lifecycleState?: string;
  lookupError?: Error;
} = {}) {
  const agent = { id: agentId, companyId, lifecycleState: options.lifecycleState ?? "terminated", metadata: {} };
  const events: string[] = [];
  const reads: { table: string; sql: string; params: unknown[]; limit?: number }[] = [];
  const bindings = options.bindings ?? [];
  getById.mockResolvedValue(agent);
  normalizeAgentRow.mockImplementation(value => value);
  cancelPendingForDeletedAddressee.mockImplementation(async () => { events.push("cancel-interactions"); });
  const tx = {
    select: vi.fn(() => ({
      from(table: Table) {
        return {
          where(condition: SQL) {
            const { sql, params } = dialect.sqlToQuery(condition);
            const tableName = getTableName(table);
            const read = { table: tableName, sql, params };
            return {
              async for(mode: string) {
                reads.push(read);
                events.push(`lock:${tableName}:${mode}`);
                return [agent];
              },
              async limit(limit: number) {
                reads.push({ ...read, limit });
                events.push(`read:${tableName}`);
                if (tableName === "budget_reservations") return options.decisionHold ? [{ id: "hold" }] : [];
                if (tableName === "runtime_routing_bindings") {
                  if (options.lookupError) throw options.lookupError;
                  expect(sql).toBe(routingCondition);
                  expect(params).toEqual([companyId, agentId]);
                  return bindings.filter(binding => binding.companyId === params[0] && binding.selectedAgentId === params[1]).slice(0, limit);
                }
                throw new Error(`Unexpected read: ${tableName}`);
              },
            };
          },
        };
      },
    })),
    update: vi.fn((table: Table) => ({
      set: () => ({ where: async () => { events.push(`update:${getTableName(table)}`); } }),
    })),
    delete: vi.fn((table: Table) => ({
      where: () => {
        const execute = async () => { events.push(`delete:${getTableName(table)}`); return [agent]; };
        return {
          returning: execute,
          then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) {
            return execute().then(resolve, reject);
          },
        };
      },
    })),
  };
  const db = {} as Db;
  const transaction = vi.fn(async (_db: Db, scope: string, work: (tx: Db) => Promise<unknown>) => {
    expect(scope).toBe(companyId);
    events.push("transaction:start");
    try {
      const result = await work(tx as unknown as Db);
      events.push("transaction:commit");
      return result;
    } catch (error) {
      events.push("transaction:rollback");
      throw error;
    }
  });
  const effects = { transaction, deleteDependencies: deleteAgentDependencies } as unknown as LifecycleEffects;
  return { remove: () => purgeAgent(db, effects, agentId), tx, agent, events, reads, transaction, bindings };
}

beforeEach(() => { vi.resetAllMocks(); });

describe("agent deletion runtime routing retention", () => {
  it.each(["bound", "wake_pending", "run_claimed", "start_requested"])("rejects retained %s evidence before any cleanup", async state => {
    const binding = { companyId, selectedAgentId: agentId, state, runId: ["bound", "wake_pending"].includes(state) ? null : "retained-run" };
    const test = fixture({ bindings: [binding] });
    await expect(test.remove()).rejects.toMatchObject({
      status: 409,
      message: "Agent cannot be deleted because runtime routing evidence still references it",
      details: { code: "agent_runtime_routing_evidence_retained" },
    });
    expect(test.events).toEqual([
      "transaction:start", "lock:agents:update", "read:budget_reservations", "read:runtime_routing_bindings", "transaction:rollback",
    ]);
    expect(test.reads.at(-1)).toEqual({ table: "runtime_routing_bindings", sql: routingCondition, params: [companyId, agentId], limit: 1 });
    expect(cancelPendingForDeletedAddressee).not.toHaveBeenCalled();
    expect(test.tx.update).not.toHaveBeenCalled();
    expect(test.tx.delete).not.toHaveBeenCalled();
    expect(test.bindings).toEqual([binding]);
    expect(normalizeAgentRow).not.toHaveBeenCalled();
  });

  it.each(["terminated", "rejected"])("keeps ordinary %s cleanup and ignores another company or agent's evidence", async lifecycleState => {
    const bindings = [
      { companyId: otherCompanyId, selectedAgentId: agentId, state: "bound", runId: null },
      { companyId, selectedAgentId: otherAgentId, state: "start_requested", runId: "other-run" },
    ];
    const test = fixture({ bindings, lifecycleState });
    await expect(test.remove()).resolves.toBe(test.agent);
    expect(cancelPendingForDeletedAddressee).toHaveBeenCalledExactlyOnceWith(companyId, agentId);
    expect(test.events).toEqual([
      "transaction:start", "lock:agents:update", "read:budget_reservations", "read:runtime_routing_bindings", "cancel-interactions",
      "update:agents", "update:issues", "delete:heartbeat_run_events", "delete:agent_task_sessions", "delete:activity_log",
      "delete:issue_execution_decisions", "delete:issue_comments", "delete:heartbeat_runs", "delete:agent_wakeup_requests",
      "delete:agent_api_keys", "delete:agent_runtime_state", "delete:principal_permission_grants", "delete:agents", "transaction:commit",
    ]);
    expect(test.bindings).toEqual(bindings);
    expect(normalizeAgentRow).toHaveBeenCalledExactlyOnceWith(test.agent);
  });

  it("preserves the existing decision accounting conflict before routing retention", async () => {
    const test = fixture({ decisionHold: true });
    await expect(test.remove()).rejects.toMatchObject({ status: 409, details: { code: "agent_decision_accounting_pending" } });
    expect(test.reads.map(read => read.table)).toEqual(["agents", "budget_reservations"]);
    expect(test.tx.update).not.toHaveBeenCalled();
    expect(test.tx.delete).not.toHaveBeenCalled();
    expect(cancelPendingForDeletedAddressee).not.toHaveBeenCalled();
  });

  it("preserves lifecycle termination gating before any dependency lookup", async () => {
    const test = fixture({ lifecycleState: "ready" });
    await expect(test.remove()).rejects.toThrow("Complete termination before deleting the agent");
    expect(test.events).toEqual(["transaction:start", "lock:agents:update", "transaction:rollback"]);
    expect(test.reads.map(read => read.table)).toEqual(["agents"]);
    expect(test.tx.update).not.toHaveBeenCalled();
    expect(test.tx.delete).not.toHaveBeenCalled();
  });

  it("propagates lookup failure without relabeling it as retention or beginning cleanup", async () => {
    const failure = new Error("Connection closed");
    const test = fixture({ lookupError: failure });
    await expect(test.remove()).rejects.toBe(failure);
    expect(test.events.at(-1)).toBe("transaction:rollback");
    expect(test.tx.update).not.toHaveBeenCalled();
    expect(test.tx.delete).not.toHaveBeenCalled();
    expect(cancelPendingForDeletedAddressee).not.toHaveBeenCalled();
  });
});
