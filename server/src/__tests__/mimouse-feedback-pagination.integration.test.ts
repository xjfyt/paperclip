import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { companies, createDb, mimouseFeedbackInbox as inbox } from "@paperclipai/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { feedbackInboxService } from "../services/mimouse-feedback.js";

let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
beforeAll(async () => {
  temporary = await startEmbeddedPostgresTestDatabase("feedback-pagination-");
  db = createDb(temporary.connectionString);
}, 90_000);
afterAll(async () => { await temporary?.cleanup(); });

it("traverses microsecond batches without skips or duplicates after newer insertion", async () => {
  const companyId = randomUUID(), otherCompanyId = randomUUID();
  await db.insert(companies).values([{ id: companyId, name: "Pagination", issuePrefix: "FPG" }, { id: otherCompanyId, name: "Other", issuePrefix: "FPO" }]);
  const service = feedbackInboxService(db);
  async function insert(index: number, timestamp: string, patch: Partial<typeof inbox.$inferInsert> = {}) {
    const [row] = await db.insert(inbox).values({ companyId, sourceKind: "application_log", sourceInstance: "fixture", externalId: String(index),
      contentDigest: String(index), candidateKey: "fixture", title: "Failure", body: "TypeError: failure\n    at save (app.js:1:2)",
      product: "Editor", softwareVersion: "1", occurredAt: new Date("2026-10-26T00:00:00Z"), actorId: "fixture", redacted: true,
      createdAt: sql`${timestamp}::timestamptz`, ...patch }).returning();
    return row;
  }
  // 55 rows share a non-zero microsecond timestamp (typical one-transaction batch).
  const rows = [];
  for (let i = 0; i < 55; i++) rows.push(await insert(i, "2026-10-26T00:00:00.000654Z"));
  // A distinct microsecond value in the same JS millisecond must not be skipped.
  rows.push(await insert(55, "2026-10-26T00:00:00.000321Z"));
  const source = await insert(56, "2026-10-26T00:00:00.000999Z");
  const foreign = await insert(57, "2026-10-26T00:00:00.000654Z", { companyId: otherCompanyId });
  const differentVersion = await insert(58, "2026-10-26T00:00:00.000654Z", { softwareVersion: "2" });
  const differentProduct = await insert(59, "2026-10-26T00:00:00.000654Z", { product: "Other" });
  const firstList = await service.list(companyId, 50);
  const firstEvidence = await service.evidence(companyId, source.id);
  expect(firstList.nextBeforeId).not.toBeNull(); expect(firstEvidence.nextBeforeId).not.toBeNull();
  const newer = await insert(60, "2026-10-26T00:00:01.000001Z");
  const listed = firstList.items.map(item => item.id);
  let cursor = firstList.nextBeforeId;
  while (cursor) { const page = await service.list(companyId, 50, cursor); listed.push(...page.items.map(item => item.id)); cursor = page.nextBeforeId; }
  expect(listed).toHaveLength(new Set(listed).size);
  expect([...listed].sort()).toEqual([...rows.map(row => row.id), source.id, differentVersion.id, differentProduct.id].sort());
  const matched = firstEvidence.items.map(item => item.feedbackId);
  cursor = firstEvidence.nextBeforeId;
  while (cursor) { const page = await service.evidence(companyId, source.id, cursor); matched.push(...page.items.map(item => item.feedbackId)); cursor = page.nextBeforeId; }
  expect(matched).toHaveLength(new Set(matched).size);
  expect([...matched].sort()).toEqual(rows.map(row => row.id).sort());
  expect(matched).not.toContain(newer.id);
  await expect(service.list(companyId, 50, foreign.id)).rejects.toThrow("Feedback candidate not found");
  await expect(service.evidence(companyId, source.id, differentVersion.id)).rejects.toThrow("Feedback evidence cursor not found");
  await expect(service.evidence(companyId, source.id, differentProduct.id)).rejects.toThrow("Feedback evidence cursor not found");
  await db.delete(inbox).where(and(eq(inbox.companyId, companyId), eq(inbox.id, firstEvidence.nextBeforeId!)));
  await expect(service.evidence(companyId, source.id, firstEvidence.nextBeforeId!)).rejects.toThrow("Feedback candidate not found");
  await expect(service.list(companyId, 50, firstEvidence.nextBeforeId!)).rejects.toThrow("Feedback candidate not found");
});
