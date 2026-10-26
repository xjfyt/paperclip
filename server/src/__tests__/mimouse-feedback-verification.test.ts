import { expect, it, vi, beforeEach } from "vitest";
import type { Db } from "@paperclipai/db";
import { feedbackVerificationConfirmSchema } from "@paperclipai/shared/mimouse-feedback-verification";
import { feedbackVerificationService, verificationCheck } from "../services/mimouse-feedback-verification.js";
const deps = vi.hoisted(() => ({ access: vi.fn(async () => true), audit: vi.fn(async () => undefined) }));
vi.mock("../services/authorization.js", () => ({ canActorReadIssuePrivacy: deps.access }));
vi.mock("../services/activity-log.js", () => ({ logActivity: deps.audit, publishActivity: vi.fn() }));
const uid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const companyId = uid(1), feedbackId = uid(2), issueId = uid(3), actor = "reviewer", beforeSha = "a".repeat(40), afterSha = "b".repeat(40);
const source = { id: feedbackId, companyId, sourceKind: "application_log", ingestionMode: "manual_import", sourceInstance: "fixture", externalId: "event-1", product: "Editor", softwareVersion: "1", commitSha: beforeSha, traceId: "trace-1", contentDigest: "a".repeat(64), redactionVersion: 1, status: "candidate", occurredAt: new Date("2026-01-01"), redacted: false, body: "PRIVATE_BODY", title: "PRIVATE_TITLE", sourceUrl: "https://private.invalid/?token=secret" };
const promotion = { companyId, feedbackId, issueId, requestId: uid(4), actorUserId: actor, review: { reproduction: "PRIVATE_REPRODUCTION" } };
const issue = { id: issueId, companyId, visibility: "private" };
const check = { commitSha: beforeSha, command: "PRIVATE_COMMAND --token=secret", logRef: "/private/log?token=secret", startedAt: "2026-01-01T01:00:00Z", finishedAt: "2026-01-01T01:01:00Z", status: "failed", exitCode: 1 };
const before = { id: uid(5), companyId, issueId, workspaceId: uid(7), projectId: 1, gitlabOrigin: "https://private.invalid", baseSha: "c".repeat(40), headSha: beforeSha, evidence: [check] };
const after = { ...before, id: uid(6), baseSha: beforeSha, headSha: afterSha, evidence: [{ ...check, commitSha: afterSha, startedAt: "2026-01-01T02:00:00Z", finishedAt: "2026-01-01T02:01:00Z", status: "passed", exitCode: 0 }] };
const selection = { reproduction: { deliveryId: before.id, checkIndex: 0 }, regression: { deliveryId: after.id, checkIndex: 0 } };
function database(selects: unknown[][]) {
  const inserts: Record<string, unknown>[] = [], locks: string[] = [];
  const tx = { execute: vi.fn(async () => undefined), select: vi.fn(() => {
    const result = selects.shift(); if (!result) throw Error("Unexpected select");
    const chain = { from: () => chain, where: () => chain, orderBy: () => chain, limit: () => Promise.resolve(result),
      for: (mode: string) => { locks.push(mode); return Promise.resolve(result); }, then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result).then(resolve) }; return chain;
  }), insert: vi.fn(() => ({ values: (value: Record<string, unknown>) => { inserts.push(value); return { returning: async () => [{ ...value, id: uid(9), createdAt: new Date("2026-01-02") }] }; } })) };
  return { db: { transaction: async (cb: (value: typeof tx) => unknown) => cb(tx) } as unknown as Db, inserts, tx, locks };
}
const authority = () => [[{ status: "active" }], [{ status: "active", membershipRole: "admin" }]];
const context = () => [...authority(), [source], [promotion], [issue]];
async function preview() { return feedbackVerificationService(database([...context(), [before], [after]]).db).preview(companyId, feedbackId, actor, selection); }
async function request() { return { ...selection, requestId: uid(8), previewDigest: (await preview()).previewDigest, confirmReproduction: true as const, confirmFix: true as const, confirmComparableEnvironment: true as const }; }
beforeEach(() => { deps.access.mockReset().mockResolvedValue(true); deps.audit.mockClear(); });
it("previews server references only, with no claim of execution or confirmation", async () => {
  const p = await preview(); expect(p).toMatchObject({ assessment: "awaiting_human_attestation", snapshot: { machineVerification: "reference_integrity_only", environment: "not_machine_verified", executionStarted: false, issueStatusChanged: false, source: { trust: "quarantined", commitSha: beforeSha }, reproduction: { provenance: "operator_supplied", exitCode: 1 }, regression: { commitSha: afterSha, exitCode: 0 } } });
  for (const secret of ["PRIVATE_", "token=", "/private/", "https://", '"command":', '"logRef":']) expect(JSON.stringify(p)).not.toContain(secret);
  expect(deps.audit).not.toHaveBeenCalled();
});
it("freezes multiple historical human attestations without rewriting the task and locks the evidence", async () => {
  const body = await request(), fake = database([...context(), [], [before], [after]]);
  const result = await feedbackVerificationService(fake.db).confirm(companyId, feedbackId, actor, body);
  expect(result).toMatchObject({ assessment: "human_attested", historical: true, requestId: body.requestId, actorUserId: actor });
  expect(fake.inserts).toHaveLength(1); expect(fake.inserts[0].previewDigest).toBe(body.previewDigest);
  expect(fake.locks).toEqual(Array(7).fill("share")); expect(fake.tx.execute).toHaveBeenCalledOnce();
  expect(deps.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entityType: "issue", entityId: issueId, details: null }), expect.anything());
  expect(JSON.stringify(fake.inserts)).not.toContain("PRIVATE_");
  const next = database([...context(), [], [before], [after]]);
  await feedbackVerificationService(next.db).confirm(companyId, feedbackId, actor, { ...body, requestId: uid(10) });
  expect(next.inserts).toHaveLength(1);
});
it("rejects stale evidence or replaced source, promotion, actor and check log before inserting", async () => {
  const body = await request();
  const changes = [
    [...authority(), [{ ...source, body: "replacement" }], [promotion], [issue], [], [before], [after]],
    [...authority(), [{ ...source, contentDigest: "replacement" }], [promotion], [issue], [], [before], [after]],
    [...authority(), [source], [{ ...promotion, review: { reproduction: "changed" } }], [issue], [], [before], [after]],
    [...context(), [], [before], [{ ...after, evidence: [{ ...after.evidence[0], logRef: "different" }] }]],
  ];
  for (const rows of changes) { const fake = database(rows); await expect(feedbackVerificationService(fake.db).confirm(companyId, feedbackId, actor, body)).rejects.toThrow("changed"); expect(fake.inserts).toHaveLength(0); }
  const otherActor = database([...context(), [], [before], [after]]);
  await expect(feedbackVerificationService(otherActor.db).confirm(companyId, feedbackId, "other-reviewer", body)).rejects.toThrow("changed");
});
it("replays only the same actor/request/payload after rechecking current authority and private task access", async () => {
  const body = await request(), original = database([...context(), [], [before], [after]]);
  await feedbackVerificationService(original.db).confirm(companyId, feedbackId, actor, body);
  const prior = { ...original.inserts[0], id: uid(9), createdAt: new Date("2026-01-02") };
  const replay = database([...context(), [prior]]);
  expect((await feedbackVerificationService(replay.db).confirm(companyId, feedbackId, actor, body)).id).toBe(uid(9)); expect(replay.inserts).toHaveLength(0);
  for (const patch of [{ previewDigest: "f".repeat(64) }, { regression: { ...selection.regression, checkIndex: 1 } }]) {
    const fake = database([...context(), [prior]]); await expect(feedbackVerificationService(fake.db).confirm(companyId, feedbackId, actor, { ...body, ...patch })).rejects.toThrow("different confirmation"); expect(fake.inserts).toHaveLength(0);
  }
  deps.access.mockResolvedValue(false);
  const revoked = database([...context(), [prior]]);
  await expect(feedbackVerificationService(revoked.db).confirm(companyId, feedbackId, actor, body)).rejects.toThrow("not accessible"); expect(revoked.inserts).toHaveLength(0);
});
it("fails closed for company/member suspension and cross-company/private-task evidence", async () => {
  const body = await request();
  for (const rows of [ [[{ status: "paused" }], [{ status: "active", membershipRole: "admin" }]], [[{ status: "active" }], [{ status: "suspended", membershipRole: "admin" }]], [[{ status: "active" }], [{ status: "active", membershipRole: "member" }]] ]) {
    const fake = database(rows); await expect(feedbackVerificationService(fake.db).confirm(companyId, feedbackId, actor, body)).rejects.toThrow("active company owner"); expect(fake.inserts).toHaveLength(0);
  }
  for (const patch of [{ companyId: uid(20) }, { issueId: uid(20) }, { id: uid(20) }]) {
    const fake = database([...context(), [{ ...before, ...patch }]]);
    await expect(feedbackVerificationService(fake.db).preview(companyId, feedbackId, actor, selection)).rejects.toThrow("not accessible");
  }
  deps.access.mockResolvedValue(false);
  await expect(preview()).rejects.toThrow("not accessible");
});
it("requires a real full source SHA, different fix commit, recorded ancestry, exact command and chronological checks", async () => {
  for (const patch of [{ baseSha: "d".repeat(40) }, { headSha: beforeSha }, { workspaceId: uid(20) }, { projectId: 2 }, { gitlabOrigin: "https://other.invalid" },
    { evidence: [{ ...after.evidence[0], command: "different" }] }, { evidence: [{ ...after.evidence[0], startedAt: check.startedAt, finishedAt: check.finishedAt }] }]) {
    const fake = database([...context(), [before], [{ ...after, ...patch }]]);
    await expect(feedbackVerificationService(fake.db).preview(companyId, feedbackId, actor, selection)).rejects.toThrow();
  }
  for (const patch of [{ commitSha: null }, { commitSha: "main" }, { commitSha: "d".repeat(40) }, { redactionVersion: 2 }]) {
    const fake = database([...authority(), [{ ...source, ...patch }], [promotion], [issue], [before], [after]]);
    await expect(feedbackVerificationService(fake.db).preview(companyId, feedbackId, actor, selection)).rejects.toThrow();
  }
});
it("does not turn caller status strings, malformed dates, blocked checks or nonzero passes into evidence", async () => {
  for (const patch of [{ status: "passed" }, { status: "blocked" }, { exitCode: null }, { finishedAt: "2025-01-01T00:00:00Z" }, { finishedAt: "2999-01-01T00:00:00Z" }, { commitSha: "main" }, { logRef: " " }, { command: " " }]) expect(verificationCheck({ ...before, evidence: [{ ...check, ...patch }] } as never, 0)).toBeNull();
  const body = await request();
  for (const patch of [{ confirmReproduction: false }, { confirmFix: false }, { confirmComparableEnvironment: false }, { machineVerified: true }, { status: "passed" }, { reproduction: { ...body.reproduction, commitSha: beforeSha } }]) expect(feedbackVerificationConfirmSchema.safeParse({ ...body, ...patch }).success).toBe(false);
});
it("returns only bounded private options/history and does not read log references", async () => {
  const fake = database([...context(), [before, after]]), result = await feedbackVerificationService(fake.db).options(companyId, feedbackId, actor);
  expect(result.checks).toHaveLength(2); expect(result.scanLimit).toBe(50); expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  const empty = database([...context(), []]); expect(await feedbackVerificationService(empty.db).history(companyId, feedbackId, actor)).toEqual({ items: [], hasMore: false });
  deps.access.mockResolvedValue(false); await expect(feedbackVerificationService(database(context()).db).history(companyId, feedbackId, actor)).rejects.toThrow("not accessible");
});
it("checks authority after waiting for the idempotency lock and again before insert/replay", async () => {
  const body = await request();
  const waitRevoked = database([...context(), [], [before], [after]]);
  waitRevoked.tx.execute.mockImplementation(async () => { deps.access.mockResolvedValue(false); });
  await expect(feedbackVerificationService(waitRevoked.db).confirm(companyId, feedbackId, actor, body)).rejects.toThrow("not accessible");
  expect(waitRevoked.inserts).toHaveLength(0);
  deps.access.mockReset().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const revokedDuringReview = database([...context(), [], [before], [after]]);
  await expect(feedbackVerificationService(revokedDuringReview.db).confirm(companyId, feedbackId, actor, body)).rejects.toThrow("not accessible");
  expect(revokedDuringReview.inserts).toHaveLength(0);
  deps.access.mockReset().mockResolvedValue(true);
  const original = database([...context(), [], [before], [after]]);
  await feedbackVerificationService(original.db).confirm(companyId, feedbackId, actor, body);
  const prior = { ...original.inserts[0], id: uid(9), createdAt: new Date("2026-01-02") };
  deps.access.mockReset().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(feedbackVerificationService(database([...context(), [prior]]).db).confirm(companyId, feedbackId, actor, body)).rejects.toThrow("not accessible");
});
it("serializes same-request confirmations and replays one immutable receipt (simulated advisory lock)", async () => {
  const body = await request(); let stored: Record<string, unknown> | undefined, tail = Promise.resolve(); let inserts = 0;
  const db = { transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
    let release = () => {}, step = 0;
    const tx = {
      execute: async () => { const previous = tail; tail = new Promise<void>(resolve => { release = resolve; }); await previous; },
      select: () => {
        const current = step++;
        const rows = current < 5 ? context()[current] : current === 5 ? stored ? [stored] : [] : current === 6 ? [before] : [after];
        const chain = { from: () => chain, where: () => chain, for: async () => rows, then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) }; return chain;
      },
      insert: () => ({ values: (value: Record<string, unknown>) => ({ returning: async () => { inserts++; stored = { ...value, id: uid(9), createdAt: new Date("2026-01-02") }; return [stored]; } }) }),
    };
    try { return await callback(tx); } finally { release(); }
  } } as unknown as Db;
  const service = feedbackVerificationService(db);
  const [first, second] = await Promise.all([service.confirm(companyId, feedbackId, actor, body), service.confirm(companyId, feedbackId, actor, body)]);
  expect(first.id).toBe(second.id); expect(inserts).toBe(1);
  await expect(service.confirm(companyId, feedbackId, actor, { ...body, previewDigest: "0".repeat(64) })).rejects.toThrow("different confirmation");
  expect(inserts).toBe(1);
});
