import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Db } from "@paperclipai/db";
import { deleteCompany } from "../services/company-deletion.js";

const { createAgentLifecycle, terminateAgent, scheduleAgentLifecycle, deleteCompanyData } = vi.hoisted(() => ({
  createAgentLifecycle: vi.fn(),
  terminateAgent: vi.fn(),
  scheduleAgentLifecycle: vi.fn(),
  deleteCompanyData: vi.fn(),
}));
vi.mock("../services/agent-lifecycle.js", () => ({ createAgentLifecycle, scheduleAgentLifecycle }));
vi.mock("../modules/agent-lifecycle/company-deletion.js", () => ({
  agentLifecycleCompanyDeletion: { deleteCompanyData },
}));

const companyId = "00000000-0000-4000-8000-000000000001";
const otherCompanyId = "00000000-0000-4000-8000-000000000002";
const agentId = "00000000-0000-4000-8000-000000000003";
const runId = "00000000-0000-4000-8000-000000000004";
const dialect = new PgDialect();
const routingTables = [
  "runtime_routing_bindings", "runtime_routing_heads", "runtime_routing_receipts", "runtime_routing_policies",
];
const ordinaryTables = [
  "finance_events", "decision_invocations", "cost_events", "budget_incidents", "budget_policies",
  "heartbeat_run_events", "heartbeat_run_events", "agent_task_sessions", "activity_log", "run_identity_contexts",
  "heartbeat_runs", "agent_wakeup_requests", "agent_api_keys", "agent_runtime_state", "issue_comments",
  "approval_comments", "approvals", "company_secrets", "join_requests", "invites", "principal_permission_grants",
  "company_memberships", "company_skills", "routine_runs", "routine_triggers", "routine_revisions", "routines",
  "issue_read_states", "documents", "issues", "company_logos", "assets", "goals", "projects", "companies",
];
type Table = Parameters<typeof getTableName>[0];
type Statement = { table: string; sql: string; params: unknown[] };
type RoutingRow = { table: string; companyId: string };

// No database client or lifecycle worker is created. The mock transaction stages
// routing rows solely to check scoping and rejection propagation, not PG behavior.
function fixture(options: { ordinary?: boolean; missingCompany?: boolean; failTable?: string } = {}) {
  const events: string[] = [];
  const deletions: Statement[] = [];
  const reads: Statement[] = [];
  const company = { id: companyId, name: "Delete only this company" };
  let rows: RoutingRow[] = routingTables.flatMap(table => [
    ...(options.ordinary ? [] : [{ table, companyId }]), { table, companyId: otherCompanyId },
  ]);
  const initialRows = [...rows];
  let staged = rows;
  const failure = new Error("Routing cleanup failed");
  const statement = (table: Table, condition: SQL): Statement => {
    const { sql, params } = dialect.sqlToQuery(condition);
    return { table: getTableName(table), sql, params };
  };
  const select = () => ({
    from(table: Table) {
      return {
        where(condition: SQL) {
          const read = statement(table, condition);
          reads.push(read);
          if (read.table === "companies") {
            return {
              for(mode: string) {
                events.push(`lock:${mode}`);
                return Promise.resolve(options.missingCompany ? [] : [{ id: companyId }]);
              },
            };
          }
          if (read.table === "agents") return Promise.resolve(options.missingCompany ? [] : [{ id: agentId }]);
          if (read.table === "heartbeat_runs") return Promise.resolve([{ id: runId }]);
          throw new Error(`Unexpected read: ${read.table}`);
        },
      };
    },
  });
  const tx = {
    select: vi.fn(select),
    delete: vi.fn((table: Table) => ({
      where(condition: SQL) {
        const deletion = statement(table, condition);
        const execute = async () => {
          deletions.push(deletion);
          events.push(`delete:${deletion.table}`);
          if (deletion.table === options.failTable) throw failure;
          if (routingTables.includes(deletion.table)) {
            // Reject any broad/incorrect predicate instead of assuming scope.
            expect(deletion.sql).toBe(`"${deletion.table}"."company_id" = $1`);
            expect(deletion.params).toEqual([companyId]);
            staged = staged.filter(row => row.table !== deletion.table || row.companyId !== deletion.params[0]);
          }
          return deletion.table === "companies" ? [company] : [];
        };
        return {
          returning: execute,
          then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) {
            return execute().then(resolve, reject);
          },
        };
      },
    })),
  };
  const transaction = vi.fn(async (callback: (handle: typeof tx) => Promise<unknown>) => {
    events.push("transaction:start");
    staged = [...rows];
    try {
      const result = await callback(tx);
      rows = staged;
      events.push("transaction:commit");
      return result;
    } catch (error) {
      events.push("transaction:rollback");
      throw error;
    }
  });
  const db = { select: vi.fn(select), transaction } as unknown as Db;
  createAgentLifecycle.mockReturnValue({ terminateAgent });
  terminateAgent.mockImplementation(async (id: string) => { events.push(`terminate:${id}`); });
  scheduleAgentLifecycle.mockImplementation(async (_db: Db, id: string) => { events.push(`schedule:${id}`); });
  deleteCompanyData.mockImplementation(async () => { events.push("delete:agent-lifecycle"); });
  return { db, tx, transaction, company, events, deletions, reads, failure, initialRows, routingRows: () => rows };
}

beforeEach(() => { vi.resetAllMocks(); });

describe("company deletion runtime routing compatibility", () => {
  it.each([false, true])("keeps company scope and the ordinary cleanup path (ordinary=%s)", async ordinary => {
    const test = fixture({ ordinary });
    await expect(deleteCompany(test.db, companyId)).resolves.toBe(test.company);

    expect(createAgentLifecycle).toHaveBeenCalledExactlyOnceWith(test.db);
    expect(terminateAgent).toHaveBeenCalledExactlyOnceWith(agentId);
    expect(scheduleAgentLifecycle).toHaveBeenCalledExactlyOnceWith(test.db, agentId);
    expect(test.transaction).toHaveBeenCalledTimes(1);
    expect(test.events.slice(0, 4)).toEqual([
      `terminate:${agentId}`, `schedule:${agentId}`, "transaction:start", "lock:no key update",
    ]);
    expect(test.deletions.map(value => value.table)).toEqual([...routingTables, ...ordinaryTables]);
    expect(test.events.slice(-4)).toEqual([
      "delete:projects", "delete:agent-lifecycle", "delete:companies", "transaction:commit",
    ]);
    expect(deleteCompanyData).toHaveBeenCalledExactlyOnceWith(test.tx, companyId);
    expect(test.reads).toEqual([
      { table: "agents", sql: '"agents"."company_id" = $1', params: [companyId] },
      { table: "companies", sql: '"companies"."id" = $1', params: [companyId] },
      { table: "heartbeat_runs", sql: '"heartbeat_runs"."company_id" = $1', params: [companyId] },
    ]);
    for (const deletion of test.deletions) {
      if (deletion.table === "heartbeat_run_events" && deletion.params[0] === runId) {
        // Preserve the existing second pass for events of the scoped run IDs.
        expect(deletion.sql).toBe('"heartbeat_run_events"."run_id" in ($1)');
        expect(deletion.params).toEqual([runId]);
      } else {
        const column = deletion.table === "companies" ? "id" : "company_id";
        expect(deletion.sql).toBe(`"${deletion.table}"."${column}" = $1`);
        expect(deletion.params).toEqual([companyId]);
      }
    }
    expect(test.routingRows()).toEqual(routingTables.map(table => ({ table, companyId: otherCompanyId })));
  });

  it.each(routingTables)("propagates %s failure before ordinary cleanup and leaves rollback to the transaction", async failTable => {
    const test = fixture({ failTable });
    await expect(deleteCompany(test.db, companyId)).rejects.toBe(test.failure);
    expect(test.transaction).toHaveBeenCalledTimes(1);
    expect(test.deletions.map(value => value.table)).toEqual(routingTables.slice(0, routingTables.indexOf(failTable) + 1));
    expect(test.events.at(-1)).toBe("transaction:rollback");
    expect(test.events).not.toContain("transaction:commit");
    expect(deleteCompanyData).not.toHaveBeenCalled();
    expect(test.routingRows()).toEqual(test.initialRows);
  });

  it("keeps the missing-company no-op behind the existing company lock", async () => {
    const test = fixture({ missingCompany: true });
    await expect(deleteCompany(test.db, companyId)).resolves.toBeNull();
    expect(test.events).toEqual(["transaction:start", "lock:no key update", "transaction:commit"]);
    expect(test.tx.delete).not.toHaveBeenCalled();
    expect(deleteCompanyData).not.toHaveBeenCalled();
    expect(terminateAgent).not.toHaveBeenCalled();
    expect(scheduleAgentLifecycle).not.toHaveBeenCalled();
    expect(test.routingRows()).toEqual(test.initialRows);
  });

  it.each(["terminate", "schedule"])("does not enter deletion when lifecycle %s rejects", async step => {
    const test = fixture();
    const failure = new Error("Complete termination first");
    (step === "terminate" ? terminateAgent : scheduleAgentLifecycle).mockRejectedValueOnce(failure);
    await expect(deleteCompany(test.db, companyId)).rejects.toBe(failure);
    expect(test.transaction).not.toHaveBeenCalled();
    expect(test.tx.delete).not.toHaveBeenCalled();
    expect(deleteCompanyData).not.toHaveBeenCalled();
    if (step === "terminate") expect(scheduleAgentLifecycle).not.toHaveBeenCalled();
    expect(test.routingRows()).toEqual(test.initialRows);
  });

  it("keeps routing cleanup in the transaction when final lifecycle deletion rejects", async () => {
    const test = fixture();
    const failure = new Error("Complete termination first");
    deleteCompanyData.mockRejectedValueOnce(failure);
    await expect(deleteCompany(test.db, companyId)).rejects.toBe(failure);
    expect(test.deletions.map(value => value.table)).toEqual([...routingTables, ...ordinaryTables.slice(0, -1)]);
    expect(test.events.at(-1)).toBe("transaction:rollback");
    expect(test.routingRows()).toEqual(test.initialRows);
    expect(deleteCompanyData).toHaveBeenCalledExactlyOnceWith(test.tx, companyId);
  });
});
