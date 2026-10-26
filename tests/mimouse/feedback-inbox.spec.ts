import { test, expect, type APIRequestContext } from "@playwright/test";
import { createFixtureDb } from "./fixture-db.js";
import { mimouseFeedbackInbox } from "../../packages/db/src/index.js";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq } = await import(require.resolve("drizzle-orm"));
const input = { sourceKind: "manual", sourceInstance: "fixture", externalId: "event-1", title: "Crash on save", text: "password=fixture-secret contact user@example.invalid", product: "App", softwareVersion: "1.0", traceId: "trace-123", occurredAt: "2026-10-26T00:00:00Z" };
async function company(request: APIRequestContext) {
  return (await (await request.post("/api/companies", { data: { name: `Feedback fixture ${Date.now()}` } })).json()).id as string;
}
test("feedback import persists sanitized data and exactly deduplicates concurrent source events", async ({ request }) => {
  const id = await company(request), path = `/api/companies/${id}/feedback-inbox`;
  const responses = await Promise.all([request.post(path, { data: input }), request.post(path, { data: input })]);
  expect(responses.map(r => r.status()).sort()).toEqual([200, 201]);
  const [a, b] = await Promise.all(responses.map(r => r.json())); expect(a.item.id).toBe(b.item.id);
  expect(a.item).toMatchObject({ ingestionMode: "manual_import", status: "candidate", redacted: true });
  expect(JSON.stringify(a)).not.toMatch(/fixture-secret|user@example|contentDigest|candidateKey/);
  const db = await createFixtureDb();
  try { const rows = await db.select().from(mimouseFeedbackInbox).where(eq(mimouseFeedbackInbox.companyId, id));
    expect(rows).toHaveLength(1); expect(JSON.stringify(rows)).not.toMatch(/fixture-secret|user@example/);
  } finally { await db.$client.end({ timeout: 1 }); }
  expect((await request.post(path, { data: { ...input, text: "password=changed-secret" } })).status()).toBe(409);
  const stored = await (await request.get(`${path}/${a.item.id}`)).json(); expect(stored.text).toBe(a.item.text);
});
test("feedback identities and candidates stay company/source/product/version scoped", async ({ request }) => {
  const first = await company(request), second = await company(request), path = `/api/companies/${first}/feedback-inbox`;
  const a = await (await request.post(path, { data: input })).json();
  const b = await (await request.post(`/api/companies/${second}/feedback-inbox`, { data: input })).json();
  expect(a.item.id).not.toBe(b.item.id);
  expect((await request.get(`${path}/${b.item.id}`)).status()).toBe(404);
  expect((await request.get(`${path}/${b.item.id}/candidates`)).status()).toBe(404);
  expect((await request.get(`${path}?beforeId=${b.item.id}`)).status()).toBe(404);
  const same = await (await request.post(path, { data: { ...input, sourceInstance: "second-source", title: "CRASH  on save", text: "new evidence" } })).json();
  await request.post(path, { data: { ...input, externalId: "other-version", softwareVersion: "2.0" } });
  await request.post(path, { data: { ...input, externalId: "other-product", product: "Different App" } });
  const candidates = await (await request.get(`${path}/${a.item.id}/candidates`)).json();
  expect(candidates.autoMerged).toBe(false); expect(candidates.items.map((x: { id: string }) => x.id)).toEqual([same.item.id]);
  expect(candidates.method).toBe("same_product_version_normalized_title");
});
test("feedback pagination is stable and no import accepts execution or trust flags", async ({ request }) => {
  const id = await company(request), path = `/api/companies/${id}/feedback-inbox`;
  for (let i = 0; i < 3; i++) expect((await request.post(path, { data: { ...input, externalId: `event-${i}` } })).status()).toBe(201);
  const first = await (await request.get(`${path}?limit=2`)).json(); expect(first.items).toHaveLength(2); expect(first.nextBeforeId).toBeTruthy();
  const second = await (await request.get(`${path}?limit=2&beforeId=${first.nextBeforeId}`)).json(); expect(second.items).toHaveLength(1); expect(second.nextBeforeId).toBeNull();
  expect(new Set([...first.items, ...second.items].map(x => x.id)).size).toBe(3);
  expect((await request.post(path, { data: { ...input, trusted: true, execute: true } })).status()).toBe(400);
  expect((await request.get(`${path}/not-an-id`)).status()).toBe(404);
  expect((await request.get(`${path}?limit=1000`)).status()).toBe(400);
});
