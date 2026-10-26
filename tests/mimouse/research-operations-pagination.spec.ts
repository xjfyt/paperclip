import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createFixtureDb } from "./fixture-db.js";
import { researchCandidateService } from "../../server/src/services/mimouse-research/service.js";
import { operationPreviewService } from "../../server/src/services/mimouse-operations/service.js";
async function company(request: APIRequestContext) {
  return (await (await request.post("/api/companies", { data: { name: "Microsecond pagination fixture" } })).json()).id as string;
}
const kinds = ["research", "operations"] as const;
for (const kind of kinds) test(`${kind} keyset keeps microseconds, lower UUID ties and stable continuation after inserts`, async ({ request }) => {
  const companyId = await company(request), foreignCompanyId = await company(request), db = await createFixtureDb();
  try {
    const table = kind === "research" ? "mimouse_research_candidates" : "mimouse_operation_previews";
    const path = `/api/companies/${companyId}/${kind === "research" ? "research-candidates" : "data-operations"}`;
    const service = kind === "research" ? researchCandidateService(db) : operationPreviewService(db);
    let seedId: string;
    if (kind === "research") {
      seedId = (await researchCandidateService(db).create(companyId, { requestId: randomUUID(), title: "Pagination fixture", product: "Example",
        currentState: "Current", proposedState: "Reviewed", recommendation: "Review first",
        sources: [{ url: "https://example.invalid/pagination", retrievedAt: "2026-10-26T00:00:00Z", evidence: "Inert fixture, not retrieved" }] }, "fixture")).item.id;
    } else {
      seedId = (await operationPreviewService(db).create(companyId, { requestId: randomUUID(), period: "2026-10", timeZone: "UTC", sourceInstance: "fixture-source", targetInstance: "fixture-target",
        mapping: [{ sourceField: "amount", targetField: "amount" }], sourceRecords: [{ sourceId: "s", targetId: "t", occurredAt: "2026-10-01T00:00:00Z", values: { amount: "1.00" } }], targetRecords: [] }, "fixture")).item.id;
    }
    // The table/column strings below are fixed test constants, never request data.
    // Exact SQL timestamptz values deliberately avoid JS Date millisecond coercion.
    await db.$client.unsafe(`update ${table} set created_at = '2026-10-26T00:00:00.123456Z'::timestamptz where company_id = $1 and id = $2`, [companyId, seedId]);
    const columns = kind === "research" ? "request_digest, actor_id, evidence, evidence_hash" : "request_digest, actor_id, input_snapshot, preview, preview_hash";
    await db.$client.unsafe(`insert into ${table} (id, company_id, request_id, ${columns}, created_at)
      select gen_random_uuid(), $1, gen_random_uuid(), ${columns}, created_at from ${table} cross join generate_series(1,124)
      where company_id = $1 and id = $2`, [companyId, seedId]);
    const original = await db.$client.unsafe(`select id::text, created_at::text as exact_time from ${table} where company_id = $1 order by created_at desc, id desc`, [companyId]);
    const originalIds = original.map(row => row.id as string);
    expect(originalIds).toHaveLength(125); expect(original.every(row => String(row.exact_time).includes(".123456"))).toBe(true);
    const first = await service.list(companyId); // Production default page size is 50.
    expect(first.items).toHaveLength(50); expect(first.nextBeforeId).toBe(originalIds[49]);
    expect(first.items.map(row => row.id)).toEqual(originalIds.slice(0, 50));
    const insertAt = async (id: string, company: string, exactTime: string) => db.$client.unsafe(`insert into ${table} (id, company_id, request_id, ${columns}, created_at)
      select $1::uuid, $2::uuid, gen_random_uuid(), ${columns}, $3::timestamptz from ${table} where company_id = $4 and id = $5`, [id, company, exactTime, companyId, seedId]);
    const newerId = randomUUID(), olderId = randomUUID(), foreignId = randomUUID();
    await insertAt(newerId, companyId, "2026-10-26T00:00:00.123789Z");
    await insertAt(olderId, companyId, "2026-10-26T00:00:00.123123Z");
    await insertAt(foreignId, foreignCompanyId, "2026-10-26T00:00:00.123456Z");
    const seen = first.items.map(row => row.id); let cursor = first.nextBeforeId;
    const sizes = [first.items.length];
    while (cursor) {
      const page = await service.list(companyId, 50, cursor);
      expect(page.items.length).toBeLessThanOrEqual(50); sizes.push(page.items.length);
      for (const row of page.items) { expect(seen).not.toContain(row.id); seen.push(row.id); }
      expect(seen.length).toBeLessThanOrEqual(126); cursor = page.nextBeforeId;
    }
    expect(sizes).toEqual([50, 50, 26]);
    expect(seen).toEqual([...originalIds, olderId]); expect(seen).not.toContain(newerId); expect(seen).not.toContain(foreignId);
    expect((await service.list(companyId, 1)).items.map(row => row.id)).toEqual([newerId]);
    const complete = await db.$client.unsafe(`select id::text from ${table} where company_id = $1 order by created_at desc, id desc`, [companyId]);
    const fresh = []; let next: string | undefined;
    do {
      const page = await service.list(companyId, 100, next); fresh.push(...page.items.map(row => row.id)); next = page.nextBeforeId ?? undefined;
    } while (next);
    expect(fresh).toEqual(complete.map(row => row.id)); expect(new Set(fresh).size).toBe(127);
    await expect(service.list(companyId, 50, randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(service.list(companyId, 50, foreignId)).rejects.toMatchObject({ status: 404 });
    expect((await request.get(`${path}?beforeId=${foreignId}`)).status()).toBe(404);
    expect((await request.get(`${path}?beforeId=${randomUUID()}`)).status()).toBe(404);
    // Existing route contracts retain 1..100 limits and UUID validation.
    for (const query of ["limit=0", "limit=101", "beforeId=not-a-uuid"]) expect((await request.get(`${path}?${query}`)).status()).toBe(400);
    const response = await request.get(`${path}?limit=100`); expect(response.ok()).toBe(true); expect((await response.json()).items).toHaveLength(100);
  } finally { await db.$client.end({ timeout: 1 }); }
});
