import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { companies, createDb, type Db } from "@paperclipai/db";
import { companies as branchCompanies } from "../../../packages/db/src/schema/companies.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { seedCompanyDeletionGraph } from "./helpers/company-deletion-fixture.js";
import { beginCompanyDeletionContext } from "../services/company-deletion-context.js";
import { mimouseCompanyDeletion } from "../services/mimouse-company-deletion.js";
import { agentLifecycleCompanyDeletion } from "../modules/agent-lifecycle/company-deletion.js";
import { deleteCompany } from "../services/company-deletion.js";

// The real purge adapter runs against already-terminated synthetic agents.
// No provider process, lifecycle worker or external cleanup is invoked here.
vi.mock("../services/agent-lifecycle.js", () => ({
  createAgentLifecycle: () => ({ terminateAgent: vi.fn(async () => {}) }),
  scheduleAgentLifecycle: vi.fn(async () => {}),
}));

const guarded = [
  ["capability_evidence", "P0001", "Capability evidence is append-only"],
  ["mimouse_prompt_revisions", "23514", "prompt_history_immutable"],
  ["mimouse_prompt_receipts", "23514", "prompt_history_immutable"],
  ["cost_routing_policies", "P0001", "Cost routing preview history is append-only"],
  ["cost_routing_previews", "P0001", "Cost routing preview history is append-only"],
  ["mimouse_feedback_verifications", "23514", "review_history_immutable"],
  ["mimouse_prompt_applications", "23514", "review_history_immutable"],
  ["mimouse_prompt_application_receipts", "23514", "review_history_immutable"],
] as const;
let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>, db: Db;
let target: Awaited<ReturnType<typeof seedCompanyDeletionGraph>>, neighbor: typeof target;
let original: Awaited<ReturnType<typeof target.snapshot>>, neighborOriginal: typeof original;
let globalOriginal: unknown;

async function globals() {
  return db.execute(sql`select (select jsonb_agg(to_jsonb(t)) from mimouse_notification_rate_limits t) as limits,
    (select jsonb_agg(to_jsonb(t)) from mimouse_auth_revocations t) as revocations`);
}
async function rejectsPg(action: Promise<unknown>, code: string, message?: string) {
  const error: unknown = await action.then(() => null, reason => reason);
  expect(error).not.toBeNull();
  let cause = error;
  while (cause && typeof cause === "object" && "cause" in cause && cause.cause) cause = cause.cause;
  expect(cause).toMatchObject({ code });
  if (message) expect(cause).toMatchObject({ message: expect.stringContaining(message) });
}
async function contextDidNotLeak() {
  const [state] = await db.execute<{ company: string | null; xid: string | null }>(sql`select
    nullif(current_setting('paperclip.company_delete_id', true), '') as company,
    nullif(current_setting('paperclip.company_delete_xid', true), '') as xid`);
  expect(state).toEqual({ company: null, xid: null });
}

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw Error("Real network forbidden in deletion fixture"); }));
  vi.stubEnv("PAPERCLIP_TELEMETRY_DISABLED", "1"); vi.stubEnv("DO_NOT_TRACK", "1");
  // Reject accidentally resolving the main worktree through shared node_modules.
  expect(companies).toBe(branchCompanies);
  temporary = await startEmbeddedPostgresTestDatabase("company-permanent-delete-");
  db = createDb(temporary.connectionString, { maxConnections: 1 });
  const [migration] = await db.execute<{ present: boolean }>(sql`select
    to_regprocedure('public.paperclip_company_delete_matches(uuid)') is not null as present`);
  expect(migration.present).toBe(true);
  target = await seedCompanyDeletionGraph(db, "DEL");
  neighbor = await seedCompanyDeletionGraph(db, "KEEP");
  await db.execute(sql`insert into mimouse_notification_rate_limits (target_key) values ('synthetic-global-target')`);
  await db.execute(sql`insert into mimouse_auth_revocations
    (request_id, target_user_id, actor_user_id, reason, cutoff_at, sessions_revoked, board_keys_revoked)
    values (${randomUUID()}, 'synthetic-user', 'synthetic-owner', 'administrative', now(), 0, 0)`);
  original = await target.snapshot(); neighborOriginal = await neighbor.snapshot(); globalOriginal = await globals();
}, 120000);
afterAll(async () => { await temporary?.cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); }, 30000);

it("keeps all eight immutable UPDATE/DELETE guards and deferred completion constraints", async () => {
  const triggers = await db.execute<{ table_name: string; tgdeferrable: boolean; tginitdeferred: boolean }>(sql`
    select c.relname as table_name, t.tgdeferrable, t.tginitdeferred
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where t.tgfoid = 'public.paperclip_company_delete_complete()'::regprocedure order by c.relname`);
  expect(triggers.map(row => row.table_name)).toEqual(guarded.map(row => row[0]).sort());
  expect(triggers.every(row => row.tgdeferrable && row.tginitdeferred)).toBe(true);
  for (const [table, code, message] of guarded) {
    const name = sql.identifier(table);
    await rejectsPg(db.execute(sql`update ${name} set company_id = company_id where company_id = ${target.companyId}`), code, message);
    await rejectsPg(db.execute(sql`delete from ${name} where company_id = ${target.companyId}`), code, message);
    await rejectsPg(db.transaction(async tx => {
      await beginCompanyDeletionContext(tx, target.companyId);
      await tx.execute(sql`update ${name} set company_id = company_id where company_id = ${target.companyId}`);
    }), code, message);
  }
  expect(await target.snapshot()).toEqual(original); await contextDidNotLeak();
});

it("rejects wrong-company and stale-transaction contexts for every guarded table", async () => {
  const [old] = await db.execute<{ xid: string }>(sql`select txid_current()::text as xid`);
  for (const [table, code, message] of guarded) {
    await rejectsPg(db.transaction(async tx => {
      await beginCompanyDeletionContext(tx, neighbor.companyId);
      await tx.execute(sql`delete from ${sql.identifier(table)} where company_id = ${target.companyId}`);
    }), code, message);
    await rejectsPg(db.transaction(async tx => {
      await tx.execute(sql`select set_config('paperclip.company_delete_id', ${target.companyId}, true),
        set_config('paperclip.company_delete_xid', ${old.xid}, true)`);
      await tx.execute(sql`delete from ${sql.identifier(table)} where company_id = ${target.companyId}`);
    }), code, message);
  }
  expect(await target.snapshot()).toEqual(original);
  expect(await neighbor.snapshot()).toEqual(neighborOriginal); await contextDidNotLeak();
});

it("rejects context-only receipt deletion at commit and rolls back the complete participant", async () => {
  await rejectsPg(db.transaction(async tx => {
    await beginCompanyDeletionContext(tx, target.companyId.toUpperCase());
    await tx.execute(sql`delete from cost_routing_previews where company_id = ${target.companyId}`);
  }), "23514", "company_deletion_incomplete");
  await rejectsPg(db.transaction(async tx => {
    await beginCompanyDeletionContext(tx, target.companyId);
    await mimouseCompanyDeletion.deleteCompanyData(tx, target.companyId);
  }), "23514", "company_deletion_incomplete");
  expect(await target.snapshot()).toEqual(original); await contextDidNotLeak();
});

it("fails closed when deferred checks are flushed before company removal", async () => {
  await rejectsPg(db.transaction(async tx => {
    await beginCompanyDeletionContext(tx, target.companyId);
    await tx.execute(sql`delete from cost_routing_previews where company_id = ${target.companyId}`);
    await tx.execute(sql`set constraints all immediate`);
  }), "23514", "company_deletion_incomplete");
  expect(await target.snapshot()).toEqual(original); await contextDidNotLeak();
});

it("does not retain context after a successful transaction with no deletion", async () => {
  await db.transaction(tx => beginCompanyDeletionContext(tx, target.companyId));
  await contextDidNotLeak();
  await rejectsPg(db.execute(sql`delete from cost_routing_previews where company_id = ${target.companyId}`), "P0001");
});

it("rolls back the entire database purge when the final lifecycle participant rejects", async () => {
  const failure = Error("synthetic-final-purge-failure");
  const hook = vi.spyOn(agentLifecycleCompanyDeletion, "deleteCompanyData").mockRejectedValueOnce(failure);
  try { await expect(deleteCompany(db, target.companyId)).rejects.toBe(failure); } finally { hook.mockRestore(); }
  expect(await target.snapshot()).toEqual(original);
  expect(await neighbor.snapshot()).toEqual(neighborOriginal);
  expect(await globals()).toEqual(globalOriginal); await contextDidNotLeak();
});

it("deletes only the synthetic company graph, including 0360 cascades and runtime v2", async () => {
  expect(Object.values(original).every(rows => Array.isArray(rows) && rows.length > 0)).toBe(true);
  expect(target.tables.has("mimouse_coding_build_observation_requests")).toBe(true);
  expect(target.tables.has("mimouse_coding_build_observation_receipts")).toBe(true);
  await expect(deleteCompany(db, target.companyId.toUpperCase())).resolves.toMatchObject({ id: target.companyId });
  const empty = await target.snapshot();
  expect(Object.values(empty).every(rows => Array.isArray(rows) && rows.length === 0)).toBe(true);
  expect(await neighbor.snapshot()).toEqual(neighborOriginal);
  expect(await globals()).toEqual(globalOriginal); await contextDidNotLeak();
  await expect(deleteCompany(db, target.companyId)).resolves.toBeNull();
  // Ordinary evidence deletion is still rejected after a successful purge.
  await rejectsPg(db.execute(sql`delete from cost_routing_previews where company_id = ${neighbor.companyId}`), "P0001");
});
