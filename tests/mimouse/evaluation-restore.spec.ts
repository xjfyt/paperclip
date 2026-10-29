import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createFixtureDb } from "./fixture-db.js";
import { agentConfigRevisions, agents, authUsers, companies, companyMemberships, companySkills, companySkillVersions, companySkillTestInputs, companySkillTestRuns, issues, heartbeatRuns, activityLog } from "../../packages/db/src/index.js";
import { mimouseEvaluationRestores as restores } from "../../packages/db/src/schema/mimouse_evaluation_restores.js";
import { companySkillService } from "../../server/src/services/company-skills.js";
import { agentService } from "../../server/src/services/agents.js";
import { evaluationService } from "../../server/src/services/mimouse-evaluation/service.js";
import { evaluationRestoreService } from "../../server/src/services/mimouse-evaluation/restore-service.js";
import { readRestoreTree, validateRestoreSnapshot } from "../../server/src/services/mimouse-evaluation/restore-files.js";
import { resolvePaperclipInstanceRoot } from "../../server/src/home-paths.js";
import { mimouseEvaluationRestoreRoutes } from "../../server/src/routes/mimouse-evaluation-restore.js";
import { HttpError } from "../../server/src/errors.js";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { eq, sql } = await import(require.resolve("drizzle-orm"));
const { writePaperclipSkillSyncPreference } = await import(require.resolve("@paperclipai/adapter-utils/server-utils"));
const express = require("express") as typeof import("express"), supertest = require("supertest") as typeof import("supertest");
function gate() { let release!: () => void, entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; }); return { ready, release, pause: async () => { entered(); await wait; } }; }
async function fixture(request: APIRequestContext) {
  const db = await createFixtureDb();
  // Verify BOTH DB identity and server path resolver before writing any files.
  expect(await fs.realpath(resolvePaperclipInstanceRoot())).toBe(await fs.realpath(path.join(process.env.PAPERCLIP_MIMOUSE_TEST_HOME!, "instances/default")));
  const response = await request.post("/api/companies", { data: { name: "Disposable managed restore — no execution" } });
  expect(response.ok(), await response.text()).toBe(true); const companyId = (await response.json()).id as string;
  const userId = randomUUID(), now = new Date();
  await db.insert(authUsers).values({ id: userId, name: "Fixture owner", email: `${userId}@example.invalid`, createdAt: now, updatedAt: now });
  await db.insert(companyMemberships).values({ companyId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
  const [agent] = await db.insert(agents).values({ companyId, name: "Paused non-executing fixture", status: "paused", adapterType: "process", adapterConfig: {}, runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } } }).returning();
  const skills = companySkillService(db), skill = await skills.createLocalSkill(companyId, { name: "Restore baseline", slug: `restore-${randomUUID()}`, markdown: "---\nname: Restore baseline\ndescription: Fixture only\n---\n# Baseline\n" }, { type: "user", userId });
  const directory = skill.sourceLocator!, root = path.dirname(directory);
  await fs.chmod(directory, 0o755); await fs.chmod(path.join(directory, "SKILL.md"), 0o644);
  await fs.writeFile(path.join(directory, "obsolete.txt"), "removed on activation\n", { mode: 0o644 });
  const baseline = await skills.createVersion(companyId, skill.id);
  const candidateFiles = [{ path: "SKILL.md", kind: "skill" as const, content: "---\nname: Restore candidate\ndescription: Fixture candidate\n---\n# Candidate\n" },
    { path: "assets/nested/deep/data.bin", kind: "asset" as const, content: "AP8B", encoding: "base64" as const },
    { path: "scripts/fixture.sh", kind: "script" as const, content: "#!/bin/sh\n# Fixture only; never executed.\n", executable: true }];
  const [candidate] = await db.insert(companySkillVersions).values({ companyId, companySkillId: skill.id, revisionNumber: baseline.revisionNumber + 1, fileInventory: candidateFiles }).returning();
  const [input] = await db.insert(companySkillTestInputs).values({ companyId, skillId: skill.id, name: "Recorded case", content: "case" }).returning();
  const harnesses = await db.insert(issues).values([baseline, candidate!].map(version => ({ companyId, title: `Recorded only ${version.id}`, status: "done", harnessKind: "skill_test" }))).returning();
  const runs = await db.insert(companySkillTestRuns).values([baseline, candidate!].map((version, i) => ({ companyId, skillId: skill.id, inputId: input!.id, inputSnapshot: "case", skillVersionId: version.id,
    agentId: agent!.id, agentConfigSnapshot: { adapterType: "process", model: "recorded-fixture" }, issueId: harnesses[i]!.id, status: "succeeded", outputSnapshot: i ? "pass" : "fail", templateBody: "No provider execution" }))).returning();
  const evaluation = evaluationService(db), dataset = await evaluation.createDataset(companyId, { requestId: randomUUID(), skillId: skill.id, name: "Restore regression", cases: [{ inputId: input!.id, expected: "pass" }] }, userId);
  const comparison = (await evaluation.compare(companyId, { requestId: randomUUID(), datasetId: dataset.item.id, baselineVersionId: baseline.id, candidateVersionId: candidate!.id, runIds: runs.map(run => run.id), maxCandidateCostCents: null }, userId)).item;
  expect(comparison.report.eligibleForHumanReview).toBe(true);
  // Explicit fixture setup, never a side effect of the production restore API.
  await db.update(companies).set({ status: "paused" }).where(eq(companies.id, companyId));
  const body = { requestId: randomUUID(), reportId: comparison.id, expectedReportHash: comparison.report.reportHash, expectedCurrentVersionId: baseline.id, action: "activate" as const, confirm: true as const };
  const service = evaluationRestoreService(db);
  const row = async () => (await db.select().from(companySkills).where(eq(companySkills.id, skill.id)))[0]!;
  const assertTree = async (files: typeof baseline.fileInventory) => expect(validateRestoreSnapshot((await readRestoreTree(root, directory))!)).toBe(validateRestoreSnapshot(files));
  const pending = async () => { await expect(evaluationRestoreService(db, { checkpoint: async phase => { if (phase === "journal_committed") throw Error("fixture interruption"); } }).create(companyId, userId, body)).rejects.toThrow("fixture interruption"); return (await service.list(companyId, userId))[0]!; };
  return { db, companyId, userId, agent: agent!, skills, skill, root, directory, baseline, candidate: candidate!, comparison, body, service, row, assertTree, pending };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const recover = (f: Fixture, receipt: Awaited<ReturnType<Fixture["pending"]>>, resolution: "apply" | "compensate") => f.service.recover(f.companyId, receipt.id, f.userId, { expectedOperationHash: receipt.operationHash, resolution, confirm: true });

test("managed activation and receipt-linked rollback restore actual inventory, modes, deletions and identity", async ({ request }) => {
  test.skip(process.platform === "win32", "Managed restore intentionally requires POSIX file identity and modes; Windows refusal is tested separately.");
  const f = await fixture(request); try {
    const result = await f.service.create(f.companyId, f.userId, f.body); expect(result.item.status).toBe("applied");
    await f.assertTree(f.candidate.fileInventory); expect((await f.row()).currentVersionId).toBe(f.candidate.id);
    expect((await fs.stat(path.join(f.directory, "scripts/fixture.sh"))).mode & 0o777).toBe(0o755);
    await expect(fs.stat(path.join(f.directory, "obsolete.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await f.service.create(f.companyId, f.userId, f.body)).duplicate).toBe(true);
    await expect(f.service.create(f.companyId, f.userId, { ...f.body, expectedReportHash: "0".repeat(64) })).rejects.toMatchObject({ status: 409 });
    const rollback = await f.service.create(f.companyId, f.userId, { ...f.body, requestId: randomUUID(), action: "rollback", rollbackOf: result.item.id, expectedCurrentVersionId: f.candidate.id });
    expect(rollback.item.status).toBe("applied"); await f.assertTree(f.baseline.fileInventory);
    expect((await f.row()).name).toBe("Restore baseline"); expect((await f.row()).currentVersionId).toBe(f.baseline.id);
    expect(await fs.stat(path.join(f.root, "__mimouse_restores__", result.item.id, "before"))).toBeTruthy();
    expect(await f.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.companyId))).toHaveLength(0);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});

for (const phase of ["before_moved", "before_database_commit"]) test(`durable recovery after ${phase}, including process replacement`, async ({ request }) => {
  test.skip(process.platform === "win32", "Managed restore is POSIX-only; this success/recovery scenario requires a supported filesystem.");
  const f = await fixture(request); try {
    const interrupted = await evaluationRestoreService(f.db, { checkpoint: async actual => { if (actual === phase) throw Error("fixture interruption"); } }).create(f.companyId, f.userId, f.body);
    expect(interrupted.item.status).toBe("prepared"); expect((await f.row()).metadata?.mimouseRestorePending).toBe(interrupted.item.id);
    await expect(f.skills.getById(f.companyId, f.skill.id)).rejects.toMatchObject({ status: 409 });
    await f.skills.listFull(f.companyId); expect(await f.row()).toBeTruthy();
    expect((await f.service.get(f.companyId, interrupted.item.id, f.userId)).status).toBe("prepared");
    const receipt = await recover(f, interrupted.item, phase === "before_moved" ? "compensate" : "apply");
    expect(receipt.status).toBe(phase === "before_moved" ? "compensated" : "applied");
    await f.assertTree(phase === "before_moved" ? f.baseline.fileInventory : f.candidate.fileInventory);
    expect((await f.row()).metadata?.mimouseRestorePending).toBeUndefined();
    expect((await f.db.select().from(activityLog).where(eq(activityLog.entityId, receipt.id))).filter(row => row.action === `evaluation.restore.${receipt.status}`)).toHaveLength(1);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});

for (const completed of [false, true]) for (const writer of ["audit", "version", "inventory"] as const) test(`${writer} started before restore cannot overwrite ${completed ? "completed activation" : "pending recovery"}`, async ({ request }) => {
  test.skip(process.platform === "win32", "Managed restore is POSIX-only; concurrency during successful restoration requires a supported filesystem.");
  const f = await fixture(request), pause = gate(); try {
    if (writer === "inventory") await f.db.update(companySkills).set({ fileInventory: [] }).where(eq(companySkills.id, f.skill.id));
    const skills = companySkillService(f.db, { beforeAuditPersist: writer === "audit" ? pause.pause : undefined, beforeVersionPersist: writer === "version" ? pause.pause : undefined,
      beforeReconcilePersist: writer === "inventory" ? async id => { if (id === f.skill.id) await pause.pause(); } : undefined });
    const pendingWriter = (writer === "audit" ? skills.auditSkill(f.companyId, f.skill.id) : writer === "version" ? skills.createVersion(f.companyId, f.skill.id) : skills.listFull(f.companyId)).then(value => ({ value }), error => ({ error }));
    await pause.ready;
    const receipt = completed ? (await f.service.create(f.companyId, f.userId, f.body)).item : await f.pending();
    pause.release(); const outcome = await pendingWriter;
    if (writer !== "inventory") expect("error" in outcome).toBe(true);
    const row = await f.row(); expect(row.currentVersionId).toBe(completed ? f.candidate.id : f.baseline.id);
    expect(row.metadata?.[completed ? "mimouseLastRestoreId" : "mimouseRestorePending"]).toBe(receipt.id);
    if (!completed) expect((await recover(f, receipt, "compensate")).status).toBe("compensated");
    else expect((await f.service.create(f.companyId, f.userId, { ...f.body, requestId: randomUUID(), action: "rollback", rollbackOf: receipt.id, expectedCurrentVersionId: f.candidate.id })).item.status).toBe("applied");
  } finally { pause.release(); await f.db.$client.end({ timeout: 1 }); }
});

test("attachment winning company lock prevents restore; pending direct assignment is rejected and detach permits recovery", async ({ request }) => {
  test.skip(process.platform === "win32", "Managed restore is POSIX-only; pending recovery is not created on Windows.");
  const f = await fixture(request), pause = gate(); try {
    const attached = writePaperclipSkillSyncPreference({}, [f.skill.key]);
    // Hold the same company lock as lifecycle configuration; restoration must
    // wait, then see the attachment that committed after its initial read.
    const attachment = f.db.transaction(async tx => { await tx.execute(sql`select id from companies where id=${f.companyId} for no key update`); await pause.pause(); await tx.update(agents).set({ adapterConfig: attached }).where(eq(agents.id, f.agent.id)); });
    await pause.ready; const creating = f.service.create(f.companyId, f.userId, f.body).then(value => ({ value }), error => ({ error }));
    pause.release(); await attachment; expect("error" in await creating).toBe(true);
    const agentSvc = agentService(f.db); await agentSvc.update(f.agent.id, { adapterConfig: {} });
    const [revision] = await f.db.insert(agentConfigRevisions).values({ companyId: f.companyId, agentId: f.agent.id,
      beforeConfig: {}, afterConfig: { name: f.agent.name, role: f.agent.role, adapterType: f.agent.adapterType, budgetMonthlyCents: f.agent.budgetMonthlyCents, adapterConfig: attached, runtimeConfig: f.agent.runtimeConfig } }).returning();
    const receipt = await f.pending();
    await expect(agentSvc.rollbackConfigRevision(f.agent.id, revision!.id, { userId: f.userId })).rejects.toMatchObject({ status: 409 });
    for (const reference of [f.skill.key, f.skill.id, f.skill.slug]) await expect(agentSvc.update(f.agent.id, { adapterConfig: writePaperclipSkillSyncPreference({}, [reference]) })).rejects.toMatchObject({ status: 409 });
    // Imported pre-existing bad attachment can still be detached; recovery never
    // assumes pending implies no references without checking actual usage.
    await f.db.update(agents).set({ adapterConfig: attached }).where(eq(agents.id, f.agent.id));
    // The sync route resolves its CURRENT references before removing them.
    // Resolution must remain readable; only final proposed config grants use.
    expect((await f.skills.resolveRequestedSkillEntries(f.companyId, [f.skill.key], { tolerateUnknownReferences: true })).resolved.map(entry => entry.key)).toContain(f.skill.key);
    await expect(recover(f, receipt, "apply")).rejects.toMatchObject({ status: 409 });
    await agentSvc.update(f.agent.id, { adapterConfig: {} }); expect((await recover(f, receipt, "compensate")).status).toBe("compensated");
  } finally { pause.release(); await f.db.$client.end({ timeout: 1 }); }
});

test("Windows restore reports unsupported and refuses API/filesystem mutation without receipts", async ({ request }) => {
  test.skip(process.platform !== "win32", "Exercises the real Windows platform refusal; POSIX recovery is tested separately.");
  const f = await fixture(request); try {
    const readiness = await f.service.readiness(f.companyId, f.comparison.id, f.userId);
    expect(readiness.blockers).toContain("restore_platform_unsupported");
    expect(readiness.filesystemVerified).toBe(false);
    const beforeNames = (await fs.readdir(f.root)).sort();
    const beforeFiles = (await fs.readdir(f.directory, { recursive: true })).sort();
    const beforeContents = await Promise.all(["SKILL.md", "obsolete.txt"].map(file => fs.readFile(path.join(f.directory, file))));
    const beforeAudit = await f.db.select().from(activityLog).where(eq(activityLog.companyId, f.companyId));
    await expect(readRestoreTree(f.root, f.directory)).rejects.toThrow("restore_platform_unsupported");
    // This route uses a declared fixture session actor, not a real SSO login.
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.actor = { type: "board", source: "session", userId: f.userId, companyIds: [f.companyId], memberships: [{ companyId: f.companyId, membershipRole: "owner", status: "active" }] } as Express.Request["actor"]; next(); });
    app.use(mimouseEvaluationRestoreRoutes(f.db));
    app.use((error: unknown, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => res.status(error instanceof HttpError ? error.status : 500).json({ error: error instanceof Error ? error.message : "unexpected" }));
    const denied = await supertest(app).post(`/companies/${f.companyId}/skill-evaluations/restores`).send(f.body);
    expect(denied.status).toBe(422); expect(denied.body.error).toBe("restore_platform_unsupported");
    expect((await fs.readdir(f.root)).sort()).toEqual(beforeNames);
    expect((await fs.readdir(f.directory, { recursive: true })).sort()).toEqual(beforeFiles);
    expect(await Promise.all(["SKILL.md", "obsolete.txt"].map(file => fs.readFile(path.join(f.directory, file))))).toEqual(beforeContents);
    expect((await f.row()).currentVersionId).toBe(f.baseline.id);
    expect((await f.row()).metadata?.mimouseRestorePending).toBeUndefined();
    expect(await f.db.select().from(restores).where(eq(restores.companyId, f.companyId))).toHaveLength(0);
    expect(await f.db.select().from(activityLog).where(eq(activityLog.companyId, f.companyId))).toEqual(beforeAudit);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});

test("paused company authenticated API remains reachable, rejects implicit authority and rechecks live membership", async ({ request }) => {
  const f = await fixture(request); try {
    function app(source: string) { const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.actor = { type: "board", source, userId: f.userId, companyIds: [f.companyId], memberships: [{ companyId: f.companyId, membershipRole: "owner", status: "active" }] } as Express.Request["actor"]; next(); }); app.use(mimouseEvaluationRestoreRoutes(f.db)); app.use((error: unknown, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => res.status(error instanceof HttpError ? error.status : 500).json({ error: "denied" })); return app; }
    const url = `/companies/${f.companyId}/skill-evaluations/restores`;
    expect((await supertest(app("local_implicit")).post(url).send(f.body)).status).toBe(403);
    expect((await supertest(app("session")).get(`${url}/readiness/${f.comparison.id}`)).status).toBe(200);
    await f.db.update(companyMemberships).set({ status: "inactive" }).where(eq(companyMemberships.principalId, f.userId));
    expect((await supertest(app("session")).post(url).send(f.body)).status).toBe(403);
    expect(await f.db.select().from(restores).where(eq(restores.companyId, f.companyId))).toHaveLength(0);
  } finally { await f.db.$client.end({ timeout: 1 }); }
});
