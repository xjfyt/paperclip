import { createHash, randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, authUsers, authSessions, companies, companyMemberships, companySecrets, mimouseCodingBuildObservationRequests as requests, mimouseCodingBuildObservationReceipts as receipts,
  mimouseCodingDeliveries as deliveries } from "@paperclipai/db";
import { startMimouseBuildObservationSchema } from "../../../packages/shared/src/mimouse-build-observations.js";
import { mimouseCodingBuildObservationRequests as branchRequests } from "../../../packages/db/src/schema/mimouse_coding_build_observations.js";
import { startMimouseBuildObservationSchema as resolvedSchema } from "@paperclipai/shared";
import type { StartMimouseBuildObservationInput } from "@paperclipai/shared";
import { buildObservationService } from "../services/mimouse-coding/build-observation-service.js";
import { mimouseBuildObservationRoutes } from "../routes/mimouse-build-observations.js";
import { ZodError } from "zod";
import { HttpError } from "../errors.js";
import { createBuildObservationFixture, type BuildObservationFixture } from "./helpers/mimouse-build-observation-fixture.js";
import type { GitlabBuildObservationTransport } from "../services/mimouse-coding/gitlab-build-observation-contract.js";

let f: BuildObservationFixture; let original: typeof deliveries.$inferSelect;
let service: ReturnType<typeof buildObservationService>; let calls = 0; let resolutions = 0;
let hook: ((call: number) => Promise<void>) | undefined;
const transport: GitlabBuildObservationTransport = async (url, init) => {
  expect(init.method).toBe("GET"); expect(init.redirect).toBe("manual");
  expect(new Headers(init.headers).get("PRIVATE-TOKEN")).toBe(f.token);
  calls++; await hook?.(calls);
  const pipeline = { id: 9, project_id: 42, sha: f.headSha, status: "success" };
  if (url.endsWith("/jobs/17")) return Response.json({ id: 17, pipeline, commit: { id: f.headSha }, status: "success", erased_at: null, artifacts_expire_at: null });
  if (url.endsWith("/pipelines/9")) return Response.json(pipeline);
  if (url.endsWith("/artifacts/dist/app.bin")) return new Response(f.artifactBytes);
  if (url.endsWith("/artifacts/provenance.json")) return new Response("unsigned fixture, not a trusted provenance");
  throw Error("unexpected_fixture_endpoint");
};
const resolver = async () => { resolutions++; return f.secretValue; };
beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw Error("Real network forbidden"); }));
  vi.stubEnv("PAPERCLIP_TELEMETRY_DISABLED", "1"); vi.stubEnv("DO_NOT_TRACK", "1");
  expect(requests).toBe(branchRequests); expect(resolvedSchema).toBe(startMimouseBuildObservationSchema);
  f = await createBuildObservationFixture();
  [original] = await f.db.select().from(deliveries).where(eq(deliveries.id, f.deliveryId));
  service = buildObservationService(f.db, { loadConfig: f.loadConfig, transport, resolveSecret: resolver });
}, 120000);
afterAll(async () => { await f?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); }, 30000);
beforeEach(async () => {
  calls = 0; resolutions = 0; hook = undefined;
  await f.db.delete(requests).where(eq(requests.companyId, f.actor.companyId));
  await f.db.delete(activityLog).where(eq(activityLog.companyId, f.actor.companyId));
  await f.db.update(companies).set({ status: "active" }).where(eq(companies.id, f.actor.companyId));
  await f.mutate.delivery(original); await f.mutate.member({ status: "active", membershipRole: "owner" });
  await f.mutate.session({ expiresAt: new Date(Date.now() + 3600000) });
  await f.mutate.issue({ visibility: "open", responsibleUserId: f.actor.userId, createdByUserId: f.actor.userId, assigneeUserId: null });
  await f.mutate.secret({ status: "active", latestVersion: 1 }); await f.mutate.version({ status: "current", revokedAt: null,
    valueSha256: createHash("sha256").update(f.secretValue).digest("hex") });
  await f.writeProfiles([f.profile]);
});
async function input(requestId = randomUUID()): Promise<StartMimouseBuildObservationInput> {
  const context = await service.context(f.actor, f.deliveryId); const profile = context.profiles[0]; expect(profile).toBeDefined();
  return { requestId, profileId: profile.id, expectedBinding: profile.expectedBinding, jobId: 17 };
}
async function saved() { return f.db.select().from(receipts).where(eq(receipts.companyId, f.actor.companyId)); }
it("persists exact bytes with immutable blocked admission; replay and reads do not refresh or repeat I/O", async () => {
  const body = await input(); const first = await service.start(f.actor, f.deliveryId, body);
  expect(first.state).toBe("terminal"); expect(first.receipt).toMatchObject({ status: "observed", admission: "blocked",
    result: { artifact: { sizeBytes: f.artifactBytes.length }, provenance: { status: "not_checked" }, otherFacts: { c3: "blocked", controllerObservation: "blocked" } } });
  expect(calls).toBe(6); expect(resolutions).toBe(1);
  const replay = await service.start(f.actor, f.deliveryId, body);
  expect((await service.currentRequest(f.actor, f.deliveryId)).request).toEqual(first);
  expect(first.input).toEqual(body);
  expect(replay).toEqual(first); expect(await service.get(f.actor, f.deliveryId, body.requestId)).toEqual(first);
  expect((await service.history(f.actor, f.deliveryId)).receipts).toHaveLength(1); expect(calls).toBe(6); expect(resolutions).toBe(1);
  expect(await f.db.select().from(activityLog).where(eq(activityLog.action, "coding.build_observation.recorded"))).toHaveLength(1);
  expect(JSON.stringify(first)).not.toContain(f.token); expect(JSON.stringify(first)).not.toContain("unsigned fixture");
  const [delivery] = await f.db.select().from(deliveries).where(eq(deliveries.id, f.deliveryId)); expect(delivery).toEqual(original);
  await expect(f.db.update(receipts).set({ diagnostic: "rewrite" }).where(eq(receipts.requestId, body.requestId))).rejects.toThrow();
});
it("keeps terminal replay historical after configuration/manifest change and feature disable", async () => {
  const body = await input(); const first = await service.start(f.actor, f.deliveryId, body);
  await f.mutate.delivery({ headSha: "c".repeat(40) });
  const replay = await service.start(f.actor, f.deliveryId, body);
  expect(replay.receipt?.observedAt).toBe(first.receipt?.observedAt); expect(replay.receipt?.currentness.status).toBe("unknown");
  const disabled = buildObservationService(f.db, { loadConfig: async () => ({ enabled: false, diagnostic: "disabled" }), transport, resolveSecret: resolver });
  expect((await disabled.start(f.actor, f.deliveryId, body)).receipt?.createdAt).toBe(first.receipt?.createdAt);
  expect(calls).toBe(6); expect(resolutions).toBe(1);
});
it("requires current persisted session, role, company and privacy; a forged cached actor does not help", async () => {
  const body = await input(); await f.mutate.session({ expiresAt: new Date(0) });
  await expect(service.start(f.actor, f.deliveryId, body)).rejects.toThrow("observation_access_denied");
  await f.mutate.session({ expiresAt: new Date(Date.now() + 3600000) }); await f.mutate.member({ membershipRole: "member" });
  await expect(service.context(f.actor, f.deliveryId)).rejects.toThrow("observation_access_denied");
  await f.mutate.member({ membershipRole: "owner" });
  await f.mutate.issue({ visibility: "private", responsibleUserId: null, createdByUserId: "another-user", assigneeUserId: null });
  await expect(service.start(f.actor, f.deliveryId, body)).rejects.toThrow("observation_access_denied");
  await expect(service.context({ ...f.actor, companyId: randomUUID() }, f.deliveryId)).rejects.toThrow("observation_access_denied");
  expect(calls).toBe(0); expect(resolutions).toBe(0); expect(await saved()).toHaveLength(0);
});
it.each(["session", "member", "privacy"] as const)("discards fetched facts and withholds response when %s is revoked during HTTP", async kind => {
  const body = await input(); hook = async call => {
    if (call !== 3) return;
    if (kind === "session") await f.mutate.session({ expiresAt: new Date(0) });
    if (kind === "member") await f.mutate.member({ status: "suspended" });
    if (kind === "privacy") await f.mutate.issue({ visibility: "private", responsibleUserId: null, createdByUserId: "another-user", assigneeUserId: null });
  };
  await expect(service.start(f.actor, f.deliveryId, body)).rejects.toThrow("observation_access_denied");
  expect(calls).toBe(3); const [receipt] = await saved(); expect(receipt.result.artifact).toBeUndefined();
  expect(receipt.status).toBe("blocked"); expect(receipt.diagnostic).toBe("observation_access_denied");
  await expect(service.get(f.actor, f.deliveryId, body.requestId)).rejects.toThrow("observation_access_denied");
});
it.each(["head", "manifest", "pipeline", "config", "secret"] as const)("checks %s again before dispatch and final CAS", async kind => {
  const body = await input(); hook = async call => {
    if (call !== 6) return;
    if (kind === "head") await f.mutate.delivery({ headSha: "c".repeat(40) });
    if (kind === "manifest") await f.mutate.delivery({ artifactManifest: { ...original.artifactManifest, version: "changed" } });
    if (kind === "pipeline") await f.mutate.delivery({ pipelineId: 10 });
    if (kind === "config") await f.writeProfiles([{ ...f.profile, subjectName: "different.bin" }]);
    if (kind === "secret") await f.mutate.version({ revokedAt: new Date() });
  };
  await expect(service.start(f.actor, f.deliveryId, body)).rejects.toThrow(/observation_(identity_unavailable|context_changed|credential_unavailable)/);
  expect((await saved())[0].result.artifact).toBeUndefined(); expect((await saved())[0].admission).toBe("blocked");
});
it("uses the exact pinned secret version and ignores lastResolvedAt/updatedAt side effects", async () => {
  const body = await input(); const pinned = buildObservationService(f.db, { loadConfig: f.loadConfig, transport,
    resolveSecret: async (companyId, secretId, version) => {
      expect([companyId, secretId, version]).toEqual([f.actor.companyId, f.secretId, 1]);
      await f.mutate.secret({ updatedAt: new Date(), lastResolvedAt: new Date() }); return f.secretValue;
    } });
  expect((await pinned.start(f.actor, f.deliveryId, body)).receipt?.status).toBe("observed");
});
it("rejects resolver bytes that disagree with the pinned value hash before any HTTP", async () => {
  const invalid = buildObservationService(f.db, { loadConfig: f.loadConfig, transport, resolveSecret: async () => "other-secret-never-disclose" });
  await expect(invalid.start(f.actor, f.deliveryId, await input())).rejects.toThrow("observation_credential_changed");
  expect(calls).toBe(0); expect(JSON.stringify(await saved())).not.toContain("other-secret");
});
it("serializes duplicates without holding DB locks over HTTP and rejects request-ID changes", async () => {
  const body = await input(); let release: () => void = () => undefined; let entered: () => void = () => undefined;
  const ready = new Promise<void>(resolve => { entered = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; });
  hook = async call => { if (call === 1) { entered(); await wait; } };
  const first = service.start(f.actor, f.deliveryId, body); await Promise.race([ready, first.then(() => undefined)]);
  try {
    expect((await service.start(f.actor, f.deliveryId, body)).state).toBe("running");
    expect((await service.currentRequest(f.actor, f.deliveryId)).request?.input).toEqual(body);
    await expect(service.start(f.actor, f.deliveryId, { ...body, jobId: 18 })).rejects.toThrow("observation_request_conflict");
    await expect(service.start(f.actor, f.deliveryId, { ...body, requestId: randomUUID() })).rejects.toThrow("observation_company_busy");
    await f.mutate.secret({ lastResolvedAt: new Date() }); // Would block if HTTP held secret locks.
  } finally { release(); }
  expect((await first).receipt?.status).toBe("observed"); expect(calls).toBe(6); expect(resolutions).toBe(1);
});
it("recovers expired leases with one fenced retry; late original cannot append or refresh", async () => {
  const body = await input(); let release: () => void = () => undefined; let entered: () => void = () => undefined;
  const ready = new Promise<void>(resolve => { entered = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; });
  hook = async call => { if (call === 1) { entered(); await wait; } };
  const first = service.start(f.actor, f.deliveryId, body).catch((error: unknown) => error); await Promise.race([ready, first.then(value => { if (value instanceof Error) throw value; })]);
  await f.db.update(requests).set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` }).where(eq(requests.requestId, body.requestId));
  expect((await service.get(f.actor, f.deliveryId, body.requestId)).state).toBe("retryable");
  const second = await service.start(f.actor, f.deliveryId, body); release();
  expect(await first).toBeInstanceOf(HttpError); expect(second.attemptCount).toBe(2); expect(await saved()).toHaveLength(1);
  expect((await service.get(f.actor, f.deliveryId, body.requestId)).receipt?.id).toBe(second.receipt?.id);
});
it("enforces DB-clock company quota, disabled zero-I/O and bounded historical freshness", async () => {
  const disabled = buildObservationService(f.db, { loadConfig: async () => ({ enabled: false, diagnostic: "disabled" }), transport, resolveSecret: resolver });
  const body = await input(); await expect(disabled.start(f.actor, f.deliveryId, body)).rejects.toThrow("observation_disabled");
  expect(calls).toBe(0); expect(resolutions).toBe(0);
  await service.start(f.actor, f.deliveryId, body);
  const [row] = await f.db.select().from(requests).where(eq(requests.requestId, body.requestId));
  for (let i = 0; i < 9; i++) await f.db.insert(requests).values({ ...row, id: randomUUID(), requestId: randomUUID() });
  await expect(service.start(f.actor, f.deliveryId, { ...body, requestId: randomUUID() })).rejects.toThrow("observation_company_rate_limited");
  await f.writeProfiles([{ ...f.profile, maxObservationAgeSeconds: 1 }]);
  const read = await service.get(f.actor, f.deliveryId, body.requestId); expect(read.receipt?.currentness.status).toBe("stale");
  expect(calls).toBe(6); expect(resolutions).toBe(1);
});
it("mounts real session-checked API without credentials/policy inputs or cached admin bypass", async () => {
  let source: "session" | "local_implicit" = "session";
  const app = express(); app.use(express.json()); app.use((req, _res, next) => {
    req.actor = { type: "board", source, userId: f.actor.userId, sessionId: f.actor.sessionId, isInstanceAdmin: true }; next();
  });
  app.use(mimouseBuildObservationRoutes(f.db, { loadConfig: f.loadConfig, transport, resolveSecret: resolver }));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    res.status(error instanceof HttpError ? error.status : error instanceof ZodError ? 400 : 500).json({ error: error instanceof HttpError ? error.message : "internal_error" });
  }; app.use(errors);
  const url = `/companies/${f.actor.companyId}/coding/${f.deliveryId}/build-observations`;
  expect((await request(app).get(`${url}/context`)).headers["cache-control"]).toBe("no-store");
  const body = await input(); expect((await request(app).post(url).send({ ...body, token: "client-secret" })).status).toBe(400);
  expect((await request(app).post(url).send(body)).status).toBe(200);
  expect((await request(app).get(`${url}/requests/${body.requestId}`)).status).toBe(200);
  expect((await request(app).get(`${url}/requests/current`)).status).toBe(200);
  expect((await request(app).post(`${url}/requests/${body.requestId}/close-unknown`).send(body)).status).toBe(400);
  expect((await request(app).post(`${url}/requests/${randomUUID()}/close-unknown`).send({ ...body, confirmClose: true })).status).toBe(400);
  expect((await request(app).post(`${url}/requests/${body.requestId}/close-unknown`).send({ ...body, confirmClose: true, token: "forbidden" })).status).toBe(400);
  expect((await request(app).post(`${url}/requests/${body.requestId}/close-unknown`).send({ ...body, confirmClose: true })).status).toBe(200);
  source = "local_implicit"; expect((await request(app).get(url)).status).toBe(403);
  source = "session"; await f.mutate.session({ expiresAt: new Date(0) }); expect((await request(app).get(url)).status).toBe(403);
  expect(calls).toBe(6); expect(resolutions).toBe(1);
});

it.each(['{"token":"one","token":"two"}', '{"other":"x"}', 'not json', '{"token":"bad\\nheader"}'])("rejects malformed persisted secret JSON without HTTP: %s", async secretValue => {
  await f.mutate.version({ valueSha256: createHash("sha256").update(secretValue).digest("hex") });
  const invalid = buildObservationService(f.db, { loadConfig: f.loadConfig, transport, resolveSecret: async () => secretValue });
  await expect(invalid.start(f.actor, f.deliveryId, await input())).rejects.toThrow("observation_secret_invalid");
  expect(calls).toBe(0); expect((await saved())[0].result.artifact).toBeUndefined();
});
it("enforces company/delivery foreign keys and allows receipt cleanup to cascade", async () => {
  const body = await input(); await service.start(f.actor, f.deliveryId, body);
  const [row] = await f.db.select().from(requests).where(eq(requests.requestId, body.requestId));
  await expect(f.db.insert(requests).values({ ...row, id: randomUUID(), requestId: randomUUID(), companyId: randomUUID() })).rejects.toThrow();
  const [receipt] = await saved();
  await expect(f.db.insert(receipts).values({ ...receipt, id: randomUUID(), deliveryId: randomUUID() })).rejects.toThrow();
  await f.db.transaction(async tx => {
    await tx.delete(deliveries).where(eq(deliveries.id, f.deliveryId));
    expect(await tx.select().from(requests).where(eq(requests.companyId, f.actor.companyId))).toHaveLength(0);
    expect(await tx.select().from(receipts).where(eq(receipts.companyId, f.actor.companyId))).toHaveLength(0);
    await tx.insert(deliveries).values(original);
  });
});

it("documents the pre-existing secret-first company cleanup FK debt without changing it", async () => {
  let failure: unknown;
  try { await f.db.delete(companySecrets).where(eq(companySecrets.companyId, f.actor.companyId)); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ cause: { code: "23503", constraint_name: "mimouse_coding_deliveries_secret_ref_company_secrets_id_fk" } });
});

it("recovers only the current authenticated actor's latest request without outbound I/O", async () => {
  const body = await input(); const result = await service.start(f.actor, f.deliveryId, body);
  const other = { ...f.actor, userId: randomUUID(), sessionId: randomUUID() }; const now = new Date();
  await f.db.insert(authUsers).values({ id: other.userId, name: "Other fixture owner", email: `${other.userId}@example.invalid`, createdAt: now, updatedAt: now });
  await f.db.insert(authSessions).values({ id: other.sessionId, userId: other.userId, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000), createdAt: now, updatedAt: now });
  await f.db.insert(companyMemberships).values({ companyId: other.companyId, principalType: "user", principalId: other.userId, membershipRole: "owner", status: "active" });
  expect(await service.currentRequest(other, f.deliveryId)).toEqual({ request: null });
  await expect(service.get(other, f.deliveryId, body.requestId)).rejects.toThrow("observation_request_not_found");
  expect((await service.currentRequest(f.actor, f.deliveryId)).request).toEqual(result);
  expect(calls).toBe(6); expect(resolutions).toBe(1);
});

it("a durable close wins before delayed reservation and blocks the original POST without HTTP", async () => {
  const body = await input(); const alternate = { ...f.actor, sessionId: randomUUID() }; const now = new Date();
  await f.db.insert(authSessions).values({ id: alternate.sessionId, userId: alternate.userId, token: randomUUID(),
    expiresAt: new Date(Date.now() + 3600000), createdAt: now, updatedAt: now });
  let release: () => void = () => undefined; let entered: () => void = () => undefined;
  const ready = new Promise<void>(resolve => { entered = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; });
  const held = f.db.transaction(async tx => {
    await tx.select().from(authSessions).where(eq(authSessions.id, f.actor.sessionId)).for("update"); entered(); await wait;
  }); await ready;
  const late = service.start(f.actor, f.deliveryId, body);
  let closed: Awaited<ReturnType<typeof service.closeUnknown>>;
  try { closed = await service.closeUnknown(alternate, f.deliveryId, { ...body, confirmClose: true }); }
  finally { release(); await held; }
  const result = await late; expect(result.receipt?.id).toBe(closed.receipt?.id);
  expect(result.receipt?.diagnostic).toBe("observation_closed_unconfirmed"); expect(result.receipt?.result.artifact).toBeUndefined();
  expect(calls).toBe(0); expect(resolutions).toBe(0);
  const replay = await service.closeUnknown(f.actor, f.deliveryId, { ...body, confirmClose: true });
  expect(replay.receipt?.id).toBe(closed.receipt?.id);
  expect(await f.db.select().from(activityLog).where(eq(activityLog.companyId, f.actor.companyId))).toHaveLength(1);
});
it("cannot close an unexpired execution; closing a completed request never rewrites its receipt", async () => {
  const body = await input(); let release: () => void = () => undefined; let entered: () => void = () => undefined;
  const ready = new Promise<void>(resolve => { entered = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; });
  hook = async call => { if (call === 1) { entered(); await wait; } };
  const running = service.start(f.actor, f.deliveryId, body); await Promise.race([ready, running.then(() => undefined)]);
  try { await expect(service.closeUnknown(f.actor, f.deliveryId, { ...body, confirmClose: true })).rejects.toThrow("observation_request_in_progress"); }
  finally { release(); }
  const result = await running; const closed = await service.closeUnknown(f.actor, f.deliveryId, { ...body, confirmClose: true });
  expect(closed).toEqual(result); expect(await saved()).toHaveLength(1); expect(calls).toBe(6);
  expect(await f.db.select().from(activityLog).where(eq(activityLog.companyId, f.actor.companyId))).toHaveLength(1);
});
it("closing an expired lease fences late finalization and cannot be overwritten", async () => {
  const body = await input(); let release: () => void = () => undefined; let entered: () => void = () => undefined;
  const ready = new Promise<void>(resolve => { entered = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; });
  hook = async call => { if (call === 6) { entered(); await wait; } };
  const running = service.start(f.actor, f.deliveryId, body).catch((error: unknown) => error);
  await Promise.race([ready, running.then(value => { if (value instanceof Error) throw value; })]);
  await f.db.update(requests).set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` }).where(eq(requests.requestId, body.requestId));
  const before = await service.get(f.actor, f.deliveryId, body.requestId); expect(before.state).toBe("retryable"); expect(await saved()).toHaveLength(0);
  const closed = await service.closeUnknown(f.actor, f.deliveryId, { ...body, confirmClose: true }); release();
  expect(await running).toBeInstanceOf(HttpError); expect((await saved())[0].id).toBe(closed.receipt?.id);
  expect((await saved())[0].result.artifact).toBeUndefined(); expect(await saved()).toHaveLength(1);
  expect((await service.start(f.actor, f.deliveryId, body)).receipt?.id).toBe(closed.receipt?.id); expect(calls).toBe(6);
});
it("can close with feature disabled, changed configuration and paused company without enabling egress", async () => {
  const body = await input(); await f.db.update(companies).set({ status: "paused" }).where(eq(companies.id, f.actor.companyId));
  const disabled = buildObservationService(f.db, { loadConfig: async () => ({ enabled: false, diagnostic: "config_invalid" }), transport, resolveSecret: resolver });
  await expect(disabled.get(f.actor, f.deliveryId, body.requestId)).rejects.toThrow("observation_request_not_found");
  expect(await disabled.currentRequest(f.actor, f.deliveryId)).toEqual({ request: null }); expect(await saved()).toHaveLength(0);
  await expect(disabled.start(f.actor, f.deliveryId, body)).rejects.toThrow("observation_access_denied");
  const closed = await disabled.closeUnknown(f.actor, f.deliveryId, { ...body, confirmClose: true }); expect(closed.state).toBe("terminal");
  expect(closed.receipt?.currentness.status).toBe("unknown");
  await f.db.update(companies).set({ status: "active" }).where(eq(companies.id, f.actor.companyId));
  expect((await disabled.start(f.actor, f.deliveryId, body)).receipt?.id).toBe(closed.receipt?.id);
  expect(calls).toBe(0); expect(resolutions).toBe(0);
});
it("binds negative markers to exact actor/body and keeps closure within DB-clock quota", async () => {
  const body = await input(); const first = await service.closeUnknown(f.actor, f.deliveryId, { ...body, confirmClose: true });
  await expect(service.closeUnknown(f.actor, f.deliveryId, { ...body, jobId: 18, confirmClose: true })).rejects.toThrow("observation_request_conflict");
  await expect(service.closeUnknown({ ...f.actor, userId: "different-user" }, f.deliveryId, { ...body, confirmClose: true })).rejects.toThrow("observation_access_denied");
  for (let i = 0; i < 9; i++) await service.closeUnknown(f.actor, f.deliveryId, { ...body, requestId: randomUUID(), confirmClose: true });
  await expect(service.closeUnknown(f.actor, f.deliveryId, { ...body, requestId: randomUUID(), confirmClose: true })).rejects.toThrow("observation_company_rate_limited");
  expect((await service.closeUnknown(f.actor, f.deliveryId, { ...body, confirmClose: true })).receipt?.id).toBe(first.receipt?.id);
  expect(await f.db.select().from(activityLog).where(eq(activityLog.companyId, f.actor.companyId))).toHaveLength(10);
  expect(calls).toBe(0); expect(resolutions).toBe(0);
});
