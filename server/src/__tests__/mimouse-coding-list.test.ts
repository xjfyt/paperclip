import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler, type Request } from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { issues, mimouseCodingDeliveries as deliveries } from "@paperclipai/db";
import { ZodError } from "zod";
import { codingListGate, codingListQuerySchema, listCodingDeliveries } from "../services/mimouse-coding/delivery-list.js";
import { reviewBinding } from "../services/mimouse-coding/diff-review.js";
import { mimouseCodingRoutes } from "../routes/mimouse-coding.js";
import { HttpError } from "../errors.js";
import { createBuildObservationFixture, type BuildObservationFixture } from "./helpers/mimouse-build-observation-fixture.js";
import type { AuthorizationActor } from "../services/authorization.js";
import { normalizeCodingOrigin } from "@paperclipai/shared/mimouse-coding-summary";

let f: BuildObservationFixture, original: typeof deliveries.$inferSelect;
let actor: AuthorizationActor; let hiddenIssue: string, hiddenDelivery: string;
const second = "10000000-0000-4000-8000-000000000002", third = "10000000-0000-4000-8000-000000000001";
const otherOrigin = "10000000-0000-4000-8000-000000000003";
const query = (value: unknown = {}) => codingListQuerySchema.parse(value);
const list = (value: unknown = {}, identity = actor) => listCodingDeliveries(f.db, f.actor.companyId, identity, query(value));
beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw Error("Real network forbidden"); }));
  vi.stubEnv("PAPERCLIP_TELEMETRY_DISABLED", "1"); vi.stubEnv("DO_NOT_TRACK", "1");
  f = await createBuildObservationFixture();
  [original] = await f.db.select().from(deliveries).where(eq(deliveries.id, f.deliveryId));
  actor = { type: "board", source: "session", userId: f.actor.userId, companyIds: [f.actor.companyId],
    memberships: [{ companyId: f.actor.companyId, membershipRole: "owner", status: "active" }] };
  await f.db.update(deliveries).set({ createdAt: sql`'2026-10-28T12:00:00.123999Z'::timestamptz` }).where(eq(deliveries.id, f.deliveryId));
  await f.db.insert(deliveries).values([
    { ...original, id: second, headSha: "c".repeat(40), gitlabOrigin: original.gitlabOrigin + "/", createdAt: sql`'2026-10-28T12:00:00.123998Z'::timestamptz` },
    { ...original, id: third, headSha: "d".repeat(40), createdAt: sql`'2026-10-28T12:00:00.123998Z'::timestamptz` },
    { ...original, id: otherOrigin, headSha: "e".repeat(40), gitlabOrigin: "https://another.example.test", createdAt: sql`'2026-10-28T12:00:00.123997Z'::timestamptz` },
  ]);
  const [hidden] = await f.db.insert(issues).values({ companyId: f.actor.companyId, title: "Never disclose this private task", visibility: "private", createdByUserId: "different-user" }).returning();
  hiddenIssue = hidden.id;
  const hiddenRows = Array.from({ length: 105 }, (_, i) => ({ ...original, id: randomUUID(), issueId: hidden.id, headSha: i.toString(16).padStart(40, "0"), createdAt: sql`'2026-10-28T12:00:01Z'::timestamptz` }));
  hiddenDelivery = hiddenRows[0].id; await f.db.insert(deliveries).values(hiddenRows);
}, 120000);
afterAll(async () => { await f?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); }, 30000);

describe("authorized SQL keyset pages", () => {
  it("filters more than one page of hidden rows before limit, keeping native microseconds and ID ties", async () => {
    let after: string | undefined; const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const page = await list({ limit: "1", ...(after ? { after } : {}) });
      expect(page.deliveries).toHaveLength(1); expect(page.projectSummary.deliveryCount).toBe(1);
      ids.push(page.deliveries[0].id); after = page.pagination.nextCursor ?? undefined;
      expect(page.pagination.hasMore).toBe(i < 3);
      expect(JSON.stringify(page)).not.toContain(hiddenIssue); expect(JSON.stringify(page)).not.toContain(hiddenDelivery);
      expect(JSON.stringify(page)).not.toContain(original.secretRef);
    }
    expect(ids).toEqual([f.deliveryId, second, third, otherOrigin]); expect(after).toBeUndefined();
  });
  it("keeps pagination stable when an older delivery is updated", async () => {
    await f.db.update(deliveries).set({ updatedAt: new Date() }).where(eq(deliveries.id, third));
    expect((await list()).deliveries.map(row => row.id)).toEqual([f.deliveryId, second, third, otherOrigin]);
  });
  it("summarizes only this authorized page and separates equal project IDs across origins", async () => {
    const page = await list({ limit: "2" });
    expect(page.projectSummary).toMatchObject({ scope: "authorized_delivery_page", deliveryCount: 2,
      projects: [{ gitlabOrigin: original.gitlabOrigin, projectId: 42, deliveryCount: 2, trustedBuildTargetCount: 0, uploadStatus: "blocked", readyForRelease: false }] });
    const all = await list(); expect(all.projectSummary.projects).toHaveLength(2);
    expect(all.projectSummary.projects.map(row => row.deliveryCount)).toEqual([3, 1]);
    expect(all.deliveries.every(row => row.buildMatrix.targets.length === 6 && row.buildMatrix.targets.every(target => target.status === "blocked") && row.buildMatrix.upload.status === "blocked")).toBe(true);
  });
  it("accepts trailing-slash origin filters without modifying historical identity, secrets or evidence", async () => {
    const page = await list({ gitlabOrigin: original.gitlabOrigin + "/", projectId: "42" });
    expect(page.deliveries.map(row => row.id)).toEqual([f.deliveryId, second, third]);
    expect(page.deliveries[1].gitlabOrigin).toBe(original.gitlabOrigin + "/");
    const [row] = await f.db.select().from(deliveries).where(eq(deliveries.id, second));
    expect(row.secretRef).toBe(original.secretRef); expect(row.remoteEvidence).toEqual(original.remoteEvidence);
    expect((await list({ issueId: f.issueId })).deliveries).toHaveLength(4);
  });
  it("rejects hidden, deleted, foreign-company and differently filtered cursors identically", async () => {
    for (const after of [hiddenDelivery, randomUUID()]) await expect(list({ after })).rejects.toMatchObject({ status: 404, message: "Coding cursor not found" });
    await expect(list({ after: otherOrigin, gitlabOrigin: original.gitlabOrigin, projectId: "42" })).rejects.toMatchObject({ status: 404 });
    await expect(list({ after: f.deliveryId, issueId: hiddenIssue })).rejects.toMatchObject({ status: 404 });
    await expect(listCodingDeliveries(f.db, randomUUID(), actor, query({ after: f.deliveryId }))).rejects.toMatchObject({ status: 404 });
    await f.db.insert(deliveries).values({ ...original, id: randomUUID(), headSha: "f".repeat(40) });
    const [deleted] = await f.db.delete(deliveries).where(and(eq(deliveries.issueId, f.issueId), eq(deliveries.headSha, "f".repeat(40)))).returning();
    await expect(list({ after: deleted.id })).rejects.toMatchObject({ status: 404 });
  });
  it("preserves strict private-task checks for local and instance admins even with privacy mode disabled", async () => {
    vi.stubEnv("PAPERCLIP_ISSUE_PRIVACY_MODE", "off");
    try {
      for (const identity of [{ ...actor, isInstanceAdmin: true }, { type: "board" as const, source: "local_implicit" as const }]) {
        expect((await list({}, identity)).deliveries.map(row => row.id)).toEqual([f.deliveryId, second, third, otherOrigin]);
        await expect(list({ after: hiddenDelivery }, identity)).rejects.toMatchObject({ status: 404 });
      }
    } finally { vi.stubEnv("PAPERCLIP_ISSUE_PRIVACY_MODE", "enforce"); }
  });
  it("rechecks cursor readability after a grant owner loses private-task access", async () => {
    await f.mutate.issue({ visibility: "private", createdByUserId: "different-user", responsibleUserId: null });
    try { await expect(list({ after: f.deliveryId })).rejects.toMatchObject({ status: 404 }); expect((await list()).deliveries).toEqual([]); }
    finally { await f.mutate.issue({ visibility: "open", createdByUserId: f.actor.userId, responsibleUserId: f.actor.userId }); }
  });
});

function app(identity: AuthorizationActor = actor) {
  const app = express(); app.use((req, _res, next) => { req.actor = identity as Request["actor"]; next(); });
  app.use(mimouseCodingRoutes(f.db));
  app.use(((error, _req, res, _next) => res.status(error instanceof HttpError ? error.status : error instanceof ZodError ? 400 : 500).json({ error: error.message })) as ErrorRequestHandler);
  return app;
}
it("keeps the existing company/admin gate, validates queries and disables caching", async () => {
  const url = `/companies/${f.actor.companyId}/coding`;
  const ok = await request(app()).get(url); expect(ok.status).toBe(200); expect(ok.headers["cache-control"]).toBe("no-store");
  for (const suffix of ["?limit=0", "?limit=101", "?limit=1.5", "?after=invalid", "?projectId=42", "?gitlabOrigin=https://example.test&projectId=2147483648", "?gitlabOrigin=https://example.test", `?issueId=${f.issueId}&gitlabOrigin=https://example.test&projectId=42`]) {
    expect((await request(app()).get(url + suffix)).status).toBe(400);
  }
  expect((await request(app({ ...actor, memberships: [{ companyId: f.actor.companyId, membershipRole: "member", status: "active" }] })).get(url)).status).toBe(403);
  expect((await request(app({ type: "agent", agentId: randomUUID(), companyId: f.actor.companyId })).get(url)).status).toBe(403);
  expect((await request(app()).get(`/companies/${randomUUID()}/coding`)).status).toBe(403);
});

it("does not turn stale, future, absent, unknown or malformed evidence into a green list gate", () => {
  const now = Date.now(); const row = { ...original, reviewedSha: original.headSha, reviewerUserId: "fixture-reviewer",
    evidence: [{ commitSha: original.headSha, command: "fixture", exitCode: 0, startedAt: new Date(now - 2000).toISOString(), finishedAt: new Date(now - 1000).toISOString(), logRef: "fixture", status: "passed" }],
    remoteEvidence: { checkedAt: new Date(now).toISOString(), mr: { iid: 1, sha: original.headSha, state: "opened" }, pipeline: { id: 1, sha: original.headSha, status: "success" } } };
  row.reviewReceipt = { version: 1, reviewerUserId: row.reviewerUserId, binding: reviewBinding(row), headSha: row.headSha, digest: "d".repeat(64) };
  expect(codingListGate(row, now).readyForReleaseCandidate).toBe(true);
  for (const offset of [-60001, 1]) expect(codingListGate({ ...row, remoteEvidence: { ...row.remoteEvidence, checkedAt: new Date(now + offset).toISOString() } }, now).readyForReleaseCandidate).toBe(false);
  for (const remoteEvidence of [{}, { ...row.remoteEvidence, checkedAt: "unknown" }, { ...row.remoteEvidence, lastCode: "unknown" }, { ...row.remoteEvidence, pipeline: { ...row.remoteEvidence.pipeline, status: "unknown" } }]) {
    expect(codingListGate({ ...row, remoteEvidence }, now).readyForReleaseCandidate).toBe(false);
  }
  expect(codingListGate({ ...row, syncLastCode: "unknown" }, now).readyForReleaseCandidate).toBe(false);
  expect(codingListGate({ ...row, evidence: [{}] }, now).readyForReleaseCandidate).toBe(false);
  expect(codingListGate({ ...row, remoteEvidence: { ...row.remoteEvidence, checkedAt: new Date(now - 60000).toISOString() } }, now).readyForReleaseCandidate).toBe(true);
});
it("canonicalizes only bare http(s) origins", () => {
  expect(normalizeCodingOrigin("https://EXAMPLE.test/")).toBe("https://example.test");
  for (const input of ["file:///tmp", "https://user:password@example.test", "https://example.test/project", "https://example.test?x=1", "invalid"]) expect(normalizeCodingOrigin(input)).toBeNull();
});
