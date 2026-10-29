import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, approvals, companies, mimouseFeedbackInbox as inbox, mimouseOperationPreviews as previews } from "@paperclipai/db";
import { createOperationPreviewSchema, feedbackImportSchema } from "@paperclipai/shared";
import { createBuildObservationFixture, type BuildObservationFixture } from "./helpers/mimouse-build-observation-fixture.js";
import { feedbackInboxService } from "../services/mimouse-feedback.js";
import { operationPreviewService } from "../services/mimouse-operations/service.js";
import { publishLiveEvent } from "../services/live-events.js";

vi.mock("../services/live-events.js", async importOriginal => ({
  ...await importOriginal<typeof import("../services/live-events.js")>(), publishLiveEvent: vi.fn(),
}));

let f: BuildObservationFixture;
beforeAll(async () => { f = await createBuildObservationFixture(); }, 120_000);
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
afterAll(async () => { await f?.close(); }, 30_000);

const feedbackInput = () => feedbackImportSchema.parse({ sourceKind: "manual", sourceInstance: "audit-fixture", externalId: randomUUID(),
  title: "Private customer title", text: "Private customer evidence", product: "Private product", occurredAt: "2026-10-01T00:00:00Z" });
const previewInput = () => createOperationPreviewSchema.parse({ requestId: randomUUID(), period: "2026-10", timeZone: "Asia/Shanghai",
  sourceInstance: "Private business source", targetInstance: "Private business target", mapping: [{ sourceField: "amount", targetField: "amount" }],
  sourceRecords: [{ sourceId: "Private record", targetId: "Private target", occurredAt: "2026-10-01T00:00:00Z", values: { amount: "123.40" } }], targetRecords: [] });
const audit = (action: string, entityId: string) => f.db.select().from(activityLog)
  .where(and(eq(activityLog.companyId, f.actor.companyId), eq(activityLog.action, action), eq(activityLog.entityId, entityId)));

it("commits one content-free feedback audit for concurrent imports and none for conflicts", async () => {
  const input = feedbackInput(), service = feedbackInboxService(f.db);
  const results = await Promise.all([service.import(f.actor.companyId, input, f.actor.userId), service.import(f.actor.companyId, input, f.actor.userId)]);
  expect(results.map(result => result.duplicate).sort()).toEqual([false, true]);
  const entityId = results[0].item.id;
  const rows = await audit("feedback.imported", entityId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ actorType: "user", actorId: f.actor.userId, entityType: "feedback", details: null });
  expect(JSON.stringify(rows)).not.toMatch(/Private|audit-fixture/);
  await expect(service.import(f.actor.companyId, { ...input, text: "Changed evidence" }, f.actor.userId)).rejects.toMatchObject({ status: 409 });
  expect(await audit("feedback.imported", entityId)).toHaveLength(1);
});

it("commits one content-free snapshot audit and preserves request/actor idempotency", async () => {
  const input = previewInput(), service = operationPreviewService(f.db);
  const results = await Promise.all([service.create(f.actor.companyId, input, f.actor.userId), service.create(f.actor.companyId, input, f.actor.userId)]);
  expect(results.map(result => result.duplicate).sort()).toEqual([false, true]);
  const entityId = results[0].item.id;
  const rows = await audit("data_operation.preview_created", entityId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ actorType: "user", actorId: f.actor.userId, entityType: "data_operation", details: null });
  expect(JSON.stringify(rows)).not.toMatch(/Private|123\.40/);
  await expect(service.create(f.actor.companyId, input, randomUUID())).rejects.toMatchObject({ status: 409 });
  expect(await audit("data_operation.preview_created", entityId)).toHaveLength(1);
});

it("audits an approval binding once, including the nested notification transaction path", async () => {
  vi.stubEnv("PAPERCLIP_NOTIFICATIONS_ENABLED", "true");
  const service = operationPreviewService(f.db), item = (await service.create(f.actor.companyId, previewInput(), f.actor.userId)).item;
  const confirmation = { confirm: true as const, expectedPreviewHash: item.preview.previewHash, locale: "en" as const };
  const results = await Promise.all([service.requestApproval(f.actor.companyId, item.id, f.actor.userId, confirmation), service.requestApproval(f.actor.companyId, item.id, f.actor.userId, confirmation)]);
  expect(results[0]).toEqual(results[1]);
  const rows = await audit("data_operation.approval_requested", item.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ actorType: "user", actorId: f.actor.userId, entityType: "data_operation", details: null });
  expect(JSON.stringify(rows)).not.toMatch(/Private|123\.40/);
  expect(await f.db.select().from(approvals).where(eq(approvals.id, results[0].approvalId))).toHaveLength(1);
  expect(await service.readiness(f.actor.companyId, item.id)).toMatchObject({ writesSupported: false, externalWrites: 0 });
});

it.each(["feedback", "preview", "approval"] as const)("rolls back %s writes and emits nothing when the audit insert fails", async kind => {
  vi.stubEnv("PAPERCLIP_NOTIFICATIONS_ENABLED", "true");
  const feedback = feedbackInput(), preview = previewInput(), feedbackService = feedbackInboxService(f.db), operationService = operationPreviewService(f.db);
  const item = kind === "approval" ? (await operationService.create(f.actor.companyId, preview, f.actor.userId)).item : null;
  const confirmation = { confirm: true as const, expectedPreviewHash: item?.preview.previewHash ?? "", locale: "en" as const };
  const run = () => kind === "feedback" ? feedbackService.import(f.actor.companyId, feedback, f.actor.userId)
    : kind === "preview" ? operationService.create(f.actor.companyId, preview, f.actor.userId)
    : operationService.requestApproval(f.actor.companyId, item!.id, f.actor.userId, confirmation);
  const approvalsBefore = await f.db.select({ id: approvals.id }).from(approvals).where(eq(approvals.companyId, f.actor.companyId));
  vi.clearAllMocks();
  // A real PostgreSQL failure proves the business write and audit share one
  // transaction. This trigger exists only in this newly marked disposable DB.
  await f.db.execute(sql`create function fixture_reject_import_audit() returns trigger language plpgsql as $$ begin raise exception 'fixture_audit_failed'; end; $$`);
  await f.db.execute(sql`create trigger fixture_reject_import_audit before insert on activity_log for each row execute function fixture_reject_import_audit()`);
  try {
    await expect(run()).rejects.toThrow();
    expect(publishLiveEvent).not.toHaveBeenCalled();
    expect(await f.db.select().from(inbox).where(eq(inbox.externalId, feedback.externalId))).toEqual([]);
    const stored = await f.db.select().from(previews).where(and(eq(previews.companyId, f.actor.companyId), eq(previews.requestId, preview.requestId)));
    if (kind === "approval") expect(stored[0]).toMatchObject({ approvalId: null, approvalPayloadHash: null });
    else expect(stored).toEqual([]);
    expect(await f.db.select({ id: approvals.id }).from(approvals).where(eq(approvals.companyId, f.actor.companyId))).toEqual(approvalsBefore);
  } finally {
    await f.db.execute(sql`drop trigger fixture_reject_import_audit on activity_log`);
    await f.db.execute(sql`drop function fixture_reject_import_audit()`);
  }
  // Failed writes reserve no permanent idempotency key or approval identity.
  await expect(run()).resolves.toBeDefined();
});

it("keeps identical imported source identities and their audits company-scoped", async () => {
  const companyId = randomUUID(), input = feedbackInput(), service = feedbackInboxService(f.db);
  await f.db.insert(companies).values({ id: companyId, name: "Other audit fixture", issuePrefix: "AOF" });
  const first = await service.import(f.actor.companyId, input, f.actor.userId), second = await service.import(companyId, input, f.actor.userId);
  expect(first.item.id).not.toBe(second.item.id);
  const rows = await f.db.select({ companyId: activityLog.companyId, entityId: activityLog.entityId }).from(activityLog)
    .where(and(eq(activityLog.action, "feedback.imported"), sql`${activityLog.entityId} in (${first.item.id}, ${second.item.id})`));
  expect(rows).toHaveLength(2);
  expect(rows).toEqual(expect.arrayContaining([{ companyId: f.actor.companyId, entityId: first.item.id }, { companyId, entityId: second.item.id }]));
});
