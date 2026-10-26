import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createFixtureDb } from "./fixture-db.js";
import { activityLog, companySecrets, companySecretVersions, userSecretDefinitions, mimouseFeedbackInbox as inbox } from "../../packages/db/src/index.js";
import { mimouseLangfusePulls as pulls } from "../../packages/db/src/schema/mimouse_langfuse.js";
import { langfuseFeedbackService } from "../../server/src/services/mimouse-langfuse.js";
import type { LangfuseTransport } from "../../server/src/services/mimouse-langfuse/protocol.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq, and } = await import(require.resolve("drizzle-orm"));
const actor = { actorType: "system" as const, actorId: "langfuse-disposable-fixture" };
const observation = (id = "observation-1") => ({ id, traceId: "trace-1", projectId: "fixture-project", startTime: "2026-10-01T12:00:00Z", name: "Fixture observation", statusMessage: "password=fixture-secret user@example.invalid", version: "1.0", release: "a".repeat(40) });
const response = (ids = ["observation-1"], cursor: string | null = null) => new Response(JSON.stringify({ data: ids.map(observation), meta: { cursor } }));
async function fixture(request: APIRequestContext) {
  const db = await createFixtureDb();
  try {
    const company = await (await request.post("/api/companies", { data: { name: `Langfuse fixture ${randomUUID()}` } })).json();
    const refs = [];
    for (const key of ["public", "secret"]) {
      const [secret] = await db.insert(companySecrets).values({ companyId: company.id, name: key, key, provider: "local_encrypted" }).returning();
      await db.insert(companySecretVersions).values({ secretId: secret.id, version: 1, material: {}, valueSha256: "a".repeat(64), fingerprintSha256: "a".repeat(64) });
      refs.push({ secretId: secret.id, version: 1 });
    }
    const config = { origin: "https://langfuse.invalid", projectId: "fixture-project", product: "Fixture product", from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z", api: "observations_v2" as const, publicKey: refs[0], secretKey: refs[1] };
    // No socket, HTTP request or DNS resolution: response objects are in-memory.
    const service = (transport: LangfuseTransport = async () => response()) => langfuseFeedbackService(db, { transport,
      resolveSecret: async (companyId, secretId, version) => {
        expect(companyId).toBe(company.id); expect(version).toBe(1);
        return secretId === refs[0].secretId ? "pk-fixture-only" : "sk-fixture-only";
      } });
    const create = () => service().create(company.id, { requestId: randomUUID(), config }, actor);
    const state = async (id: string) => (await db.select().from(pulls).where(eq(pulls.id, id)))[0];
    return { db, companyId: company.id as string, config, service, create, state, path: `/api/companies/${company.id}/feedback-langfuse/pulls`,
      cleanup: () => db.$client.end({ timeout: 1 }) };
  } catch (error) { await db.$client.end({ timeout: 1 }); throw error; }
}

test("API create retries converge, reject changed intent, audit exactly once and isolate companies", async ({ request }) => {
  const f = await fixture(request);
  try {
    const input = { requestId: randomUUID(), config: f.config };
    const results = await Promise.all([request.post(f.path, { data: input }), request.post(f.path, { data: input })]);
    expect(results.map(row => row.status())).toEqual([201, 201]);
    const [a, b] = await Promise.all(results.map(row => row.json())); expect(a.id).toBe(b.id);
    expect(JSON.stringify(a)).not.toMatch(/secretId|cursor|pk-fixture|sk-fixture/);
    expect((await request.post(f.path, { data: { ...input, config: { ...f.config, product: "changed" } } })).status()).toBe(409);
    expect(await f.db.select().from(activityLog).where(and(eq(activityLog.entityId, a.id), eq(activityLog.action, "feedback.langfuse.created")))).toHaveLength(1);
    const other = await fixture(request);
    try {
      expect((await request.post(`${other.path}/${a.id}/pull`, { data: {} })).status()).toBe(404);
      expect((await request.post(`${other.path}/${a.id}/restart`, { data: { confirm: true } })).status()).toBe(404);
      expect((await request.post(other.path, { data: input })).status()).toBe(422);
    } finally { await other.cleanup(); }
  } finally { await f.cleanup(); }
});

test("durable pagination resumes after service recreation, replay dedups and inbox source mode stays truthful", async ({ request }) => {
  const f = await fixture(request);
  try {
    const job = await f.create();
    await f.service(async () => response(["observation-1"], "cursor-1")).pull(f.companyId, job.id, actor);
    expect(await f.state(job.id)).toMatchObject({ cursor: "cursor-1", pages: 1, imported: 1, completed: false });
    await f.service(async url => { expect(url.searchParams.get("cursor")).toBe("cursor-1"); return response(["observation-2"]); }).pull(f.companyId, job.id, actor);
    expect(await f.state(job.id)).toMatchObject({ cursor: null, pages: 2, imported: 2, completed: true });
    const noFetch = f.service(async () => { throw Error("completed job must not fetch"); });
    await noFetch.pull(f.companyId, job.id, actor);
    await f.service().restart(f.companyId, job.id, actor);
    await f.service(async () => response(["observation-1", "observation-2"])).pull(f.companyId, job.id, actor);
    const rows = await f.db.select().from(inbox).where(eq(inbox.companyId, f.companyId)); expect(rows).toHaveLength(2);
    expect(rows.every(row => row.ingestionMode === "provider_fetch")).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/fixture-secret|user@example/);
    const listed = await (await request.get(`/api/companies/${f.companyId}/feedback-inbox`)).json();
    expect(listed.items[0]).toMatchObject({ ingestionMode: "provider_fetch", sourceTrust: { disposition: "quarantined" } });
    expect((await f.state(job.id)).imported).toBe(2);
  } finally { await f.cleanup(); }
});

test("a second-row persistence failure rolls back first row, cursor and page audit", async ({ request }) => {
  const f = await fixture(request), name = `lf_fixture_${randomUUID().replaceAll("-", "")}`;
  try {
    const job = await f.create();
    // Internal UUID identifiers only; constraint affects this disposable company.
    await f.db.$client.unsafe(`ALTER TABLE mimouse_feedback_inbox ADD CONSTRAINT ${name} CHECK (company_id <> '${f.companyId}'::uuid OR external_id NOT LIKE '%:fail-db')`);
    try {
      await expect(f.service(async () => response(["first-in-page", "fail-db"], "next")).pull(f.companyId, job.id, actor)).rejects.toThrow();
      expect(await f.db.select().from(inbox).where(eq(inbox.companyId, f.companyId))).toHaveLength(0);
      expect(await f.state(job.id)).toMatchObject({ cursor: null, pages: 0, imported: 0 });
      expect(await f.db.select().from(activityLog).where(and(eq(activityLog.entityId, job.id), eq(activityLog.action, "feedback.langfuse.page_read")))).toHaveLength(0);
    } finally { await f.db.$client.unsafe(`ALTER TABLE mimouse_feedback_inbox DROP CONSTRAINT ${name}`); }
    await f.service().pull(f.companyId, job.id, actor); expect((await f.state(job.id)).pages).toBe(1);
  } finally { await f.cleanup(); }
});

test("audit failure rolls back create and restart, retry can safely recover", async ({ request }) => {
  const f = await fixture(request), name = `lf_fixture_${randomUUID().replaceAll("-", "")}`, input = { requestId: randomUUID(), config: f.config };
  try {
    await f.db.$client.unsafe(`ALTER TABLE activity_log ADD CONSTRAINT ${name} CHECK (company_id <> '${f.companyId}'::uuid OR entity_type <> 'langfuse_pull')`);
    try { await expect(f.service().create(f.companyId, input, actor)).rejects.toThrow(); expect(await f.service().list(f.companyId)).toHaveLength(0); }
    finally { await f.db.$client.unsafe(`ALTER TABLE activity_log DROP CONSTRAINT ${name}`); }
    const job = await f.service().create(f.companyId, input, actor);
    await f.service(async () => response(["observation-1"], "saved-cursor")).pull(f.companyId, job.id, actor);
    await f.db.$client.unsafe(`ALTER TABLE activity_log ADD CONSTRAINT ${name} CHECK (company_id <> '${f.companyId}'::uuid OR action <> 'feedback.langfuse.restarted')`);
    try { await expect(f.service().restart(f.companyId, job.id, actor)).rejects.toThrow(); expect(await f.state(job.id)).toMatchObject({ cursor: "saved-cursor", pages: 1 }); }
    finally { await f.db.$client.unsafe(`ALTER TABLE activity_log DROP CONSTRAINT ${name}`); }
  } finally { await f.cleanup(); }
});

test("pinned secret scope, active state and revocation are enforced even with an injected transport", async ({ request }) => {
  const f = await fixture(request);
  try {
    await expect(f.service().create(f.companyId, { requestId: randomUUID(), config: { ...f.config, publicKey: { ...f.config.publicKey, version: 99 } } }, actor)).rejects.toMatchObject({ status: 422 });
    const job = await f.create();
    await f.db.update(companySecrets).set({ status: "disabled" }).where(eq(companySecrets.id, f.config.publicKey.secretId));
    await expect(f.service(async () => { throw Error("must not fetch inactive credential"); }).pull(f.companyId, job.id, actor)).rejects.toMatchObject({ status: 422 });
    await f.db.update(companySecrets).set({ status: "active" }).where(eq(companySecrets.id, f.config.publicKey.secretId));
    const [definition] = await f.db.insert(userSecretDefinitions).values({ companyId: f.companyId, key: "user-fixture", name: "User fixture" }).returning();
    await f.db.update(companySecrets).set({ scope: "user", ownerUserId: "fixture-human", userSecretDefinitionId: definition.id }).where(eq(companySecrets.id, f.config.publicKey.secretId));
    await expect(f.create()).rejects.toMatchObject({ status: 422 });
    await f.db.update(companySecrets).set({ scope: "company", ownerUserId: null, userSecretDefinitionId: null }).where(eq(companySecrets.id, f.config.publicKey.secretId));
    await expect(f.service(async () => {
      await f.db.update(companySecretVersions).set({ revokedAt: new Date() }).where(eq(companySecretVersions.secretId, f.config.secretKey.secretId));
      return response();
    }).pull(f.companyId, job.id, actor)).rejects.toMatchObject({ status: 422 });
    expect(await f.state(job.id)).toMatchObject({ cursor: null, pages: 0 });
    expect(await f.db.select().from(inbox).where(eq(inbox.companyId, f.companyId))).toHaveLength(0);
  } finally { await f.cleanup(); }
});

test("NOWAIT rejects a concurrent pull before network; cancel rolls back and retry recovers", async ({ request }) => {
  const f = await fixture(request);
  let release!: () => void;
  try {
    const job = await f.create(), abort = new AbortController();
    let entered!: () => void; const started = new Promise<void>(done => { entered = done; });
    const barrier = new Promise<void>(done => { release = done; });
    const first = f.service(async () => { entered(); await barrier; return response(); }).pull(f.companyId, job.id, actor, abort.signal);
    const rejected = expect(first).rejects.toMatchObject({ code: "cancelled" });
    await started;
    await expect(f.service(async () => { throw Error("concurrent fetch forbidden"); }).pull(f.companyId, job.id, actor)).rejects.toMatchObject({ status: 409 });
    abort.abort(); release(); await rejected;
    expect(await f.state(job.id)).toMatchObject({ pages: 0, cursor: null });
    await f.service().pull(f.companyId, job.id, actor); expect((await f.state(job.id)).pages).toBe(1);
  } finally { release?.(); await f.cleanup(); }
});

test("wrong-project responses and non-adjacent cursor cycles never advance state", async ({ request }) => {
  const f = await fixture(request);
  try {
    const job = await f.create();
    await expect(f.service(async () => new Response(JSON.stringify({ data: [{ ...observation(), projectId: "foreign-project" }], meta: { cursor: null } }))).pull(f.companyId, job.id, actor)).rejects.toMatchObject({ code: "invalid_response" });
    expect((await f.state(job.id)).pages).toBe(0);
    for (const cursor of ["first", "second"]) await f.service(async () => response([cursor], cursor)).pull(f.companyId, job.id, actor);
    await expect(f.service(async () => response(["third"], "first")).pull(f.companyId, job.id, actor)).rejects.toMatchObject({ status: 409 });
    expect(await f.state(job.id)).toMatchObject({ pages: 2, cursor: "second", imported: 2 });
    expect(await f.db.select().from(inbox).where(eq(inbox.companyId, f.companyId))).toHaveLength(2);
  } finally { await f.cleanup(); }
});
