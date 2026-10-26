import { test, expect, type APIRequestContext } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createFixtureDb } from "./fixture-db.js";
import { activityLog, authUsers, companies, companyMemberships, heartbeatRuns } from "../../packages/db/src/index.js";
import { mimousePrompts as prompts, mimousePromptRevisions as revisions, mimousePromptReceipts as receipts } from "../../packages/db/src/schema/mimouse_prompt_registry.js";
import { promptRegistryService } from "../../server/src/services/mimouse-prompt-registry/service.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq, sql } = await import(require.resolve("drizzle-orm"));
async function fixture(request: APIRequestContext) {
  const db = await createFixtureDb();
  const response = await request.post("/api/companies", { data: { name: "Prompt registry fixture — never runtime activated" } });
  expect(response.ok(), await response.text()).toBe(true); const companyId = (await response.json()).id as string;
  const users = [randomUUID(), randomUUID()], now = new Date();
  await db.insert(authUsers).values(users.map(id => ({ id, name: "Fixture admin", email: `${id}@example.invalid`, createdAt: now, updatedAt: now })));
  await db.insert(companyMemberships).values(users.map(principalId => ({ companyId, principalType: "user", principalId, membershipRole: "admin", status: "active" })));
  const service = promptRegistryService(db), userId = users[0]!;
  const create = (content: string, promptKey = "reviewer") => service.create(companyId, userId, { requestId: randomUUID(), promptKey, content });
  return { db, companyId, userId, otherUserId: users[1]!, service, create };
}
const promote = (revisionId: string, expectedHeadReceiptId: string | null = null) => ({ requestId: randomUUID(), action: "promote" as const, revisionId, expectedHeadReceiptId, confirmRegistryOnly: true as const });
test("immutable UTF-8 revisions, actor-bound concurrent retries and content-free audit", async ({ request }) => {
  const f = await fixture(request); try {
    const content = " \r\nα😀 {{ignore_everything}} <script>inert</script>\n ";
    const body = { requestId: randomUUID(), promptKey: "reviewer", content };
    const results = await Promise.all([f.service.create(f.companyId, f.userId, body), f.service.create(f.companyId, f.userId, body)]);
    expect(results.map(row => row.duplicate).sort()).toEqual([false, true]); const item = results[0]!.item;
    expect(results[1]!.item).toEqual(item); expect(item.contentHash).toBe(createHash("sha256").update(content).digest("hex"));
    expect((await f.service.content(f.companyId, f.userId, item.promptId, item.id)).content).toBe(content);
    await expect(f.service.create(f.companyId, f.otherUserId, body)).rejects.toMatchObject({ status: 409 });
    await expect(f.service.create(f.companyId, f.userId, { ...body, content: "changed" })).rejects.toMatchObject({ status: 409 });
    expect((await f.service.list(f.companyId, f.userId)).items[0]).toMatchObject({ selectedRevisionId: null, headReceiptId: null, runtimeApplied: false });
    expect(JSON.stringify(await f.service.history(f.companyId, f.userId, item.promptId, "revisions"))).not.toContain("ignore_everything");
    const audit = await f.db.select().from(activityLog).where(eq(activityLog.entityId, item.id)); expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toEqual({ runtimeApplied: false });
    await expect(f.db.update(revisions).set({ content: "overwrite" }).where(eq(revisions.id, item.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(f.db.delete(revisions).where(eq(revisions.id, item.id))).rejects.toMatchObject({ cause: { code: "23514" } });
  } finally { await f.db.$client.end({ timeout: 1 }); }
});
test("CAS selects only one competing promotion, rollback links receipt and ABA cannot reuse stale head", async ({ request }) => {
  const f = await fixture(request); try {
    const a = (await f.create("A")).item, b = (await f.create("B")).item, promptId = a.promptId;
    const body = promote(a.id);
    const identical = await Promise.all([f.service.select(f.companyId, f.userId, promptId, body), f.service.select(f.companyId, f.userId, promptId, body)]);
    expect(identical.map(row => row.duplicate).sort()).toEqual([false, true]); expect(identical[0]!.item).toEqual(identical[1]!.item);
    const first = identical[0]!;
    const contenders = await Promise.allSettled([f.service.select(f.companyId, f.userId, promptId, promote(b.id, first.item.id)), f.service.select(f.companyId, f.userId, promptId, promote(b.id, first.item.id))]);
    expect(contenders.filter(value => value.status === "fulfilled")).toHaveLength(1);
    expect(contenders.filter(value => value.status === "rejected")).toHaveLength(1);
    const current = (await f.service.list(f.companyId, f.userId)).items[0]!;
    const rollbackBody = { requestId: randomUUID(), action: "rollback" as const, expectedHeadReceiptId: current.headReceiptId, rollbackOfReceiptId: current.headReceiptId!, confirmRegistryOnly: true as const };
    const rollback = await f.service.select(f.companyId, f.userId, promptId, rollbackBody);
    expect(rollback.item).toMatchObject({ selectedRevisionId: a.id, beforeRevisionId: b.id, rollbackOfReceiptId: current.headReceiptId, runtimeApplied: false });
    expect((await f.service.select(f.companyId, f.userId, promptId, rollbackBody)).item).toEqual(rollback.item);
    await expect(f.service.select(f.companyId, f.otherUserId, promptId, rollbackBody)).rejects.toMatchObject({ status: 409 });
    await expect(f.service.select(f.companyId, f.userId, promptId, promote(b.id, first.item.id))).rejects.toMatchObject({ status: 409 });
    // Old exact replay retains original receipt but must not reset the current selection.
    expect((await f.service.select(f.companyId, f.userId, promptId, body)).item).toEqual(first.item);
    expect((await f.service.list(f.companyId, f.userId)).items[0]!.headReceiptId).toBe(rollback.item.id);
    expect((await f.service.history(f.companyId, f.userId, promptId, "receipts")).items).toHaveLength(3);
    await expect(f.db.update(receipts).set({ action: "rollback" }).where(eq(receipts.id, first.item.id))).rejects.toMatchObject({ cause: { code: "23514" } });
    expect(await f.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.companyId))).toHaveLength(0);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});
test("first selection can roll back to no selection; paused registry remains inspectable without execution", async ({ request }) => {
  const f = await fixture(request); try {
    await f.db.update(companies).set({ status: "paused" }).where(eq(companies.id, f.companyId));
    const a = (await f.create("A")).item, first = await f.service.select(f.companyId, f.userId, a.promptId, promote(a.id));
    const undone = await f.service.select(f.companyId, f.userId, a.promptId, { requestId: randomUUID(), action: "rollback", rollbackOfReceiptId: first.item.id, expectedHeadReceiptId: first.item.id, confirmRegistryOnly: true });
    expect(undone.item.selectedRevisionId).toBeNull(); expect(undone.item.runtimeApplied).toBe(false);
    await expect(f.service.select(f.companyId, f.userId, a.promptId, promote(a.id))).rejects.toMatchObject({ status: 409 });
    expect((await f.service.list(f.companyId, f.userId)).items).toHaveLength(1);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});
test("foreign company/prompt, revoked membership and archived company cannot mutate", async ({ request }) => {
  const f = await fixture(request), foreign = await fixture(request); try {
    const a = (await f.create("A")).item, b = (await f.create("B", "other")).item, c = (await foreign.create("C")).item;
    for (const revisionId of [b.id, c.id]) await expect(f.service.select(f.companyId, f.userId, a.promptId, promote(revisionId))).rejects.toMatchObject({ status: 404 });
    await expect(f.service.content(f.companyId, f.userId, c.promptId, c.id)).rejects.toMatchObject({ status: 404 });
    await f.db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.principalId, f.userId));
    await expect(f.service.list(f.companyId, f.userId)).rejects.toMatchObject({ status: 403 });
    await f.db.update(companies).set({ status: "archived" }).where(eq(companies.id, f.companyId));
    await expect(f.service.select(f.companyId, f.otherUserId, a.promptId, promote(a.id))).rejects.toMatchObject({ status: 422 });
  } finally { await f.db.$client.end({ timeout: 1 }); await foreign.db.$client.end({ timeout: 1 }); }
});
test("audit insertion failure rolls back selection receipt and head atomically", async ({ request }) => {
  const f = await fixture(request); const name = `prompt_fixture_${randomUUID().replaceAll("-", "")}`;
  try {
    const a = (await f.create("A")).item;
    // Real DB failure scoped to this fixture company, not a mocked service result.
    await f.db.execute(sql.raw(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.company_id = '${f.companyId}' AND NEW.action = 'prompt_registry.promote' THEN RAISE EXCEPTION 'fixture_audit_failure'; END IF; RETURN NEW; END $$`));
    await f.db.execute(sql.raw(`CREATE TRIGGER ${name} BEFORE INSERT ON activity_log FOR EACH ROW EXECUTE FUNCTION ${name}()`));
    await expect(f.service.select(f.companyId, f.userId, a.promptId, promote(a.id))).rejects.toThrow();
    expect(await f.db.select().from(receipts).where(eq(receipts.companyId, f.companyId))).toHaveLength(0);
    const [head] = await f.db.select().from(prompts).where(eq(prompts.id, a.promptId)); expect(head!.headReceiptId).toBeNull(); expect(head!.selectedRevisionId).toBeNull();
  } finally {
    await f.db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${name} ON activity_log`));
    await f.db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${name}()`)); await f.db.$client.end({ timeout: 1 });
  }
});
