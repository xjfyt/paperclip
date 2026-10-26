import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createFixtureDb } from "./fixture-db.js";
import { approvals, authUsers, companyMemberships, mimouseOperationPreviews as previews } from "../../packages/db/src/index.js";
import { operationPreviewService } from "../../server/src/services/mimouse-operations/service.js";
import { approvalResolutionRecords } from "../../server/src/lib/approval-records.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq } = await import(require.resolve("drizzle-orm"));
function body() { return { requestId: randomUUID(), period: "2026-10", timeZone: "Asia/Shanghai", sourceInstance: "manual-import", targetInstance: "not-connected",
  mapping: [{ sourceField: "amount", targetField: "amount" }], sourceRecords: [{ sourceId: "source-a", targetId: "row-a", occurredAt: "2026-09-30T16:00:00Z", values: { amount: "123.40" } }, { sourceId: "outside", targetId: "outside", occurredAt: "2026-09-30T15:59:59Z", values: { amount: "999.00" } }],
  targetRecords: [{ targetId: "row-a", version: "declared-etag", values: { amount: "100.00", privateField: "not-for-approval-payload" } }] }; }
async function company(request: APIRequestContext) { return (await (await request.post("/api/companies", { data: { name: "Operation preview fixture" } })).json()).id as string; }
test("monthly dry-run is persisted and concurrent retries cannot replace approved input identity", async ({ request }) => {
  const id = await company(request), path = `/api/companies/${id}/data-operations`, input = body();
  const responses = await Promise.all([request.post(path, { data: input }), request.post(path, { data: input })]);
  expect(responses.map(r => r.status()).sort()).toEqual([200, 201]);
  const [first, second] = await Promise.all(responses.map(r => r.json())); expect(first.item.id).toBe(second.item.id);
  expect(first.item.preview).toMatchObject({ evidenceMode: "imported_snapshot", mode: "dry_run", timeZone: "Asia/Shanghai", externalWrites: 0, counts: { update: 1, excluded: 1, insert: 0, noop: 0 } });
  expect(first.item.preview.excluded[0]).toMatchObject({ observedPeriod: "2026-09", occurredAt: "2026-09-30T15:59:59Z" });
  expect(first.item.preview.operations[0].after.amount).toBe("123.40"); expect(first.item.preview.operations[0].after.privateField).toBe("not-for-approval-payload");
  expect((await request.post(path, { data: { ...input, period: "2026-11" } })).status()).toBe(409);
  const otherId = await company(request);
  expect((await request.get(`/api/companies/${otherId}/data-operations/${first.item.id}`)).status()).toBe(404);
  expect((await request.get(`/api/companies/${otherId}/data-operations?beforeId=${first.item.id}`)).status()).toBe(404);
  const state = await (await request.get(`${path}/${first.item.id}/readiness`)).json();
  expect(state).toMatchObject({ mode: "dry_run_only", writesSupported: false, externalWrites: 0 }); expect(state.blockers).toContain("write_adapter_not_implemented");
  expect((await request.post(`${path}/${first.item.id}/apply`, { data: { confirm: true } })).status()).toBe(404);
});
test("preview rejects unsafe fields, client company scope, decimal floats and invalid timezones", async ({ request }) => {
  const id = await company(request), path = `/api/companies/${id}/data-operations`, input = body();
  for (const patch of [{ companyId: id }, { execute: true }, { mapping: [{ sourceField: "amount", targetField: "password" }] }, { sourceRecords: [{ ...input.sourceRecords[0], values: { amount: 1.23 } }] }]) expect((await request.post(path, { data: { ...input, ...patch } })).status()).toBe(400);
  expect((await request.post(path, { data: { ...input, timeZone: "Not/AZone" } })).status()).toBe(422);
  expect((await request.get(path)).ok()).toBe(true);
});
test("human review reuses core approvals exactly once without exposing row data or enabling writes", async ({ request }) => {
  const companyId = await company(request), db = await createFixtureDb(), actor = randomUUID();
  try {
    await db.insert(authUsers).values({ id: actor, name: "Data reviewer", email: `${actor}@fixture.invalid`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: actor, membershipRole: "owner", status: "active" });
    const service = operationPreviewService(db), item = (await service.create(companyId, body(), actor)).item;
    const confirmation = { confirm: true as const, expectedPreviewHash: item.preview.previewHash, locale: "zh-CN" as const };
    const [a, b] = await Promise.all([service.requestApproval(companyId, item.id, actor, confirmation), service.requestApproval(companyId, item.id, actor, confirmation)]);
    expect(a).toEqual(b); expect(a.externalWrites).toBe(0);
    const rows = await db.select().from(approvals).where(eq(approvals.companyId, companyId)); expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("request_board_approval"); expect(rows[0].payload).toMatchObject({ mimouseDataPreview: { id: item.id, previewHash: item.preview.previewHash, mode: "dry_run_only" } });
    expect(JSON.stringify(rows[0].payload)).not.toMatch(/not-for-approval-payload|123\.40|declared-etag/);
    expect(rows[0].payload.nextActionOnApproval).toContain("不触发真实写入");
    await approvalResolutionRecords(db).resolveApproval(a.approvalId, "approved", actor, "Fixture review only");
    const state = await service.readiness(companyId, item.id); expect(state.approval?.status).toBe("approved"); expect(state.blockers).toEqual(["write_adapter_not_implemented"]); expect(state.externalWrites).toBe(0);
    await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.principalId, actor));
    expect((await service.readiness(companyId, item.id)).blockers).toContain("approver_authority_unavailable");
    await expect(service.requestApproval(companyId, item.id, actor, confirmation)).rejects.toThrow("active company administrator");
  } finally { await db.$client.end({ timeout: 1 }); }
});
test("changed approval payload or stale preview hash cannot authorize a data plan", async ({ request }) => {
  const companyId = await company(request), db = await createFixtureDb(), actor = randomUUID();
  try {
    await db.insert(authUsers).values({ id: actor, name: "Data reviewer", email: `${actor}@fixture.invalid`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: actor, membershipRole: "admin", status: "active" });
    const service = operationPreviewService(db), item = (await service.create(companyId, body(), actor)).item;
    await expect(service.requestApproval(companyId, item.id, actor, { confirm: true, expectedPreviewHash: "0".repeat(64), locale: "en" })).rejects.toThrow("stale");
    const approval = await service.requestApproval(companyId, item.id, actor, { confirm: true, expectedPreviewHash: item.preview.previewHash, locale: "en" });
    await db.update(approvals).set({ payload: { mimouseDataPreview: { id: item.id, previewHash: item.preview.previewHash }, title: "Changed purpose" } }).where(eq(approvals.id, approval.approvalId));
    expect((await service.readiness(companyId, item.id)).blockers).toContain("approval_binding_changed");
    await expect(service.requestApproval(companyId, item.id, actor, { confirm: true, expectedPreviewHash: item.preview.previewHash, locale: "en" })).rejects.toThrow("Bound approval changed");
    expect(await db.select().from(previews).where(eq(previews.companyId, companyId))).toHaveLength(1);
    await expect(db.update(previews).set({ approvalPayloadHash: null }).where(eq(previews.id, item.id))).rejects.toMatchObject({ cause: { code: "23514" } });
  } finally { await db.$client.end({ timeout: 1 }); }
});
