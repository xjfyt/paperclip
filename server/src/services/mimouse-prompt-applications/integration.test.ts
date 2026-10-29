import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, appendFile, rm, mkdir, access } from "node:fs/promises";
import { protectNewPrivatePath } from "@paperclipai/shared/private-filesystem-permissions";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, agents, authSessions, authUsers, companies, companyMemberships, companySkills, companySkillVersions, costEvents,
  createDb, ensurePostgresDatabase, applyPendingMigrations, environments, heartbeatRuns, heartbeatRunEvents, issues, agentWakeupRequests,
  mimousePrompts, mimousePromptRevisions, mimouseEvaluationDatasets, principalPermissionGrants, loadEmbeddedPostgres, loadWithoutEmbeddedPostgresExitHooks, type Db } from "@paperclipai/db";
import { mimousePrivatePromptTests } from "@paperclipai/db/schema/mimouse_private_prompt_tests";
import { mimousePromptApplications, mimousePromptApplicationHeads, mimousePromptApplicationDispatches, mimousePromptApplicationReceipts } from "@paperclipai/db/schema/mimouse_prompt_applications";
vi.mock("../../adapters/plugin-loader.js", () => ({ buildExternalAdapters: async () => [] }));
const boundary = vi.hoisted(() => ({ inputs: [] as string[], settle: null as (() => Promise<void>) | null, beforeSpawn: null as (() => Promise<void>) | null }));
vi.mock("@paperclipai/adapter-utils/execution-target", async original => {
  const actual = await original<typeof import("@paperclipai/adapter-utils/execution-target")>();
  return { ...actual, runAdapterExecutionTargetProcess: async (runId: string, target: any, command: string, args: string[], options: any) => {
    if (command !== "claude" || target?.kind !== "local" || !options.requireSpawnReceipt || args.includes("--resume") || args.includes("--bare")) throw Error("Real CLI/model/unsupported lane forbidden in fixture");
    const script = `let body='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>body+=d);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({type:'result',subtype:'success',result:body,is_error:false,usage:{input_tokens:1,output_tokens:1},total_cost_usd:0})+'\\n'));`;
    await boundary.beforeSpawn?.();
    // Only this inert Node child is permitted at the actual provider boundary.
    const result = await actual.runAdapterExecutionTargetProcess(runId, null, process.execPath, ["-e", script], options);
    boundary.inputs.push(options.stdin); await boundary.settle?.(); return result;
  } };
});
import * as executionModule from "./execution.js";
import * as targetModule from "./target.js";
import { promptApplicationService } from "./service.js";
import { environmentService } from "../environments.js";
import { agentExecutionsHaveStopped } from "../agent-execution-stop.js";
import { approveStoppedFixture, type ApprovalFixtureTrace } from "./__tests__/approve-stopped-fixture.js";
import { findPromptApplicationCandidate, preparePromptApplicationExecution } from "./execution.js";
import { applicationAttemptStopped } from "./recovery.js";
import { authorizePrivatePrompt } from "../mimouse-private-prompt-tests/service.js";
import { comparisonFixture } from "../mimouse-private-prompt-tests/comparison-fixture.js";
import { secretService } from "../secrets.js";
import { heartbeatService } from "../heartbeat.js";
import { drainHeartbeatRunsToQuiescence } from "../../__tests__/helpers/drain-heartbeat-runs.js";
import { getServerAdapter } from "../../adapters/registry.js";
import { resolveDefaultAgentWorkspaceDir } from "../../home-paths.js";
import { legacyControllerClaim } from "../legacy-controller-lease.js";
import type { HeartbeatRuntimeExecutionInput } from "../heartbeat/runtime-execution.js";
let pgPid = 0;
let home: string, db: Db, pg: { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
let actor: { companyId: string; userId: string; sessionId: string }, target: typeof agents.$inferSelect, environmentId: string;
let service: ReturnType<typeof promptApplicationService>, heartbeat: ReturnType<typeof heartbeatService>;
const e = comparisonFixture(), keyValue = "fixture-not-a-real-provider-key", fixed = new Date("2020-01-01T00:00:00Z");
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "paperclip-prompt-application-"));
  protectNewPrivatePath(home);
  await writeFile(join(home, ".owned-test"), "controlled-prompt-disposable-v1");
  vi.stubEnv("PAPERCLIP_HOME", home); vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY_FILE", join(home, "master.key")); vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", "");
  vi.stubEnv("PAPERCLIP_PROMPT_APPLICATIONS_ENABLED", "true"); vi.stubEnv("PAPERCLIP_TELEMETRY_DISABLED", "1"); vi.stubEnv("DO_NOT_TRACK", "1");
  vi.stubEnv("PAPERCLIP_DISABLE_CWD_ENV_FILE", "true"); vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("DATABASE_MIGRATION_URL", "");
  for (const key of ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_BEDROCK_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"]) vi.stubEnv(key, "");
  await mkdir(join(home, "bin")); await writeFile(join(home, "bin", process.platform === "win32" ? "claude.cmd" : "claude"), "#!/bin/sh\n# Inert hash-only fixture. Must never execute.\nexit 97\n", { mode: 0o700 });
  vi.stubEnv("PATH", `${join(home, "bin")}${delimiter}${process.env.PATH}`);
  for (const name of Object.keys(process.env).filter(k => /^(LD_|DYLD_|NODE_OPTIONS$|NODE_PATH$|BASH_ENV$|ENV$)/i.test(k))) vi.stubEnv(name, "");
  vi.stubGlobal("fetch", vi.fn(async () => { throw Error("Network forbidden in controlled prompt fixture"); }));
  const port = await new Promise<number>((accept, reject) => { const socket = createServer(); socket.once("error", reject); socket.listen(0, "127.0.0.1", () => {
    const address = socket.address(); if (!address || typeof address === "string") return reject(Error("Missing loopback port")); socket.close(error => error ? reject(error) : accept(address.port)); }); });
  const dataDir = join(home, "db");
  if (!resolve(home).startsWith(join(tmpdir(), "paperclip-prompt-application-")) || await readFile(join(home, ".owned-test"), "utf8") !== "controlled-prompt-disposable-v1") throw Error("Missing owned fixture boundary");
  for (const name of ["PG_VERSION", "postmaster.pid"]) if (await access(join(dataDir, name)).then(() => true, () => false)) throw Error("Refusing pre-existing PostgreSQL state");
  const { default: EmbeddedPostgres } = await loadWithoutEmbeddedPostgresExitHooks(loadEmbeddedPostgres);
  pg = new EmbeddedPostgres({ databaseDir: join(home, "db"), user: "paperclip", password: "paperclip", port, persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"], onLog: () => {}, onError: () => {} });
  await pg.initialise(); await appendFile(join(home, "db", "postgresql.conf"), "\nunix_socket_directories = ''\nlisten_addresses = '127.0.0.1'\n"); await pg.start();
  pgPid = Number((await readFile(join(home, "db", "postmaster.pid"), "utf8")).split("\n")[0]);
  if (!Number.isSafeInteger(pgPid) || pgPid <= 1) throw Error("Owned PostgreSQL PID unavailable");
  await ensurePostgresDatabase(`postgres://paperclip:paperclip@127.0.0.1:${port}/postgres`, "paperclip");
  const url = `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`; await applyPendingMigrations(url); db = createDb(url);
  expect(resolve(String((await db.execute(sql`show data_directory`))[0].data_directory))).toBe(resolve(join(home, "db")));
  actor = e.actor; const now = new Date();
  await db.insert(authUsers).values({ id: actor.userId, name: "Controlled fixture", email: "controlled@example.invalid", createdAt: now, updatedAt: now });
  await db.insert(authSessions).values({ id: actor.sessionId, userId: actor.userId, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000), createdAt: now, updatedAt: now });
  await db.insert(companies).values({ id: actor.companyId, name: "Controlled fixture", issuePrefix: "PCA", defaultResponsibleUserId: actor.userId });
  await db.insert(companyMemberships).values({ companyId: actor.companyId, principalType: "user", principalId: actor.userId, membershipRole: "owner", status: "active" });
  await db.insert(principalPermissionGrants).values({ companyId: actor.companyId, principalType: "user", principalId: actor.userId, permissionKey: "agents:configure", scope: null });
  await db.insert(agents).values({ id: e.tests[0].agentId, companyId: actor.companyId, name: "Historical private harness", role: "engineer", adapterType: "process", status: "idle" });
  await db.insert(companySkills).values({ id: e.version.companySkillId, companyId: actor.companyId, key: "controlled", slug: "controlled", name: "Controlled", markdown: "Synthetic history only" });
  await db.insert(companySkillVersions).values({ ...e.version, revisionNumber: 1 });
  await db.insert(mimousePrompts).values({ id: e.promptId, companyId: actor.companyId, promptKey: "controlled" });
  for (const r of e.revisions) await db.insert(mimousePromptRevisions).values({ ...r, requestId: randomUUID(), requestDigest: "fixture", actorUserId: actor.userId });
  await db.insert(mimouseEvaluationDatasets).values({ ...e.dataset, requestId: randomUUID(), requestDigest: "fixture", name: "Fixed", actorId: actor.userId });
  for (const issue of e.issues) await db.insert(issues).values({ ...issue, title: "Synthetic private historical evidence", status: "done" });
  for (const t of e.tests) await db.insert(agentWakeupRequests).values({ id: t.wakeupRequestId!, companyId: actor.companyId, agentId: t.agentId, source: "on_demand", status: "completed", runId: t.heartbeatRunId });
  for (const run of e.runs) await db.insert(heartbeatRuns).values(run);
  await db.insert(mimousePrivatePromptTests).values(e.tests);
  for (const t of e.tests) await db.insert(costEvents).values({ companyId: actor.companyId, agentId: t.agentId, issueId: t.issueId, heartbeatRunId: t.heartbeatRunId,
    provider: "fixture", model: "fixture", costCents: 0.125, billingType: "api", costStatus: "reported", occurredAt: now });
  const local = (await db.select().from(environments).where(eq(environments.driver, "local")))[0] ?? (await db.insert(environments).values({ name: "Owned local fixture", driver: "local", status: "active" }).returning())[0];
  environmentId = local.id;
  const secret = await secretService(db).create(actor.companyId, { name: "Fixture API key", provider: "local_encrypted", value: keyValue }, { userId: actor.userId });
  [target] = await db.insert(agents).values({ companyId: actor.companyId, name: "Ordinary fixture", role: "engineer", status: "idle", adapterType: "claude_local", defaultEnvironmentId: local.id,
    adapterConfig: { engine: "cli", model: "claude-fixture", cwd: home, promptTemplate: "Ordinary template for {{agent.name}}.", dangerouslySkipPermissions: false,
      env: { ANTHROPIC_API_KEY: { type: "secret_ref", secretId: secret.id, version: 1 } } } }).returning();
  await secretService(db).createBinding({ companyId: actor.companyId, secretId: secret.id, targetType: "agent", targetId: target.id, configPath: "env.ANTHROPIC_API_KEY", versionSelector: 1 });
  await mkdir(resolveDefaultAgentWorkspaceDir(target.id), { recursive: true });
  service = promptApplicationService(db); heartbeat = heartbeatService(db);
}, 90000);
afterAll(async () => { boundary.beforeSpawn = null; boundary.settle = null;
  await heartbeat?.drainActiveRunExecutions(); await (db as any)?.$client?.end(); await pg?.stop();
  if (home && await readFile(join(home, ".owned-test"), "utf8") === "controlled-prompt-disposable-v1") {
    if (await access(join(home, "db", "postmaster.pid")).then(() => true, () => false)) throw Error("Preserving fixture: postmaster PID file remains");
    if (pgPid) { let stopped = false; try { process.kill(pgPid, 0); } catch (error) { stopped = (error as NodeJS.ErrnoException).code === "ESRCH"; }
      if (!stopped) throw Error("Preserving fixture: owned PostgreSQL process is not confirmed stopped"); }
    await rm(home, { recursive: true, force: true });
  }
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); }, 30000);
const approval = (item: any, requestId = randomUUID()) => ({ requestId, expectedGeneration: item.expectedGeneration, approvalDigest: item.approvalDigest,
  confirmOrdinaryVisibility: true as const, confirmBareComparisonNotToolQuality: true as const, confirmNewTasksOnly: true as const, confirmNoAutomaticRun: true as const });
async function proposal() { const head = await service.head(actor, target.id); return service.prepare(actor, e.promptId, { requestId: randomUUID(), agentId: target.id,
  expectedGeneration: head.generation, comparison: e.input, approvalValidForMinutes: 60 }); }
async function issueRun(createdAt = new Date()) {
  const [issue] = await db.insert(issues).values({ companyId: actor.companyId, title: "Fresh ordinary fixture", assigneeAgentId: target.id, responsibleUserId: actor.userId, status: "todo", createdAt }).returning();
  const [run] = await db.insert(heartbeatRuns).values({ companyId: actor.companyId, agentId: target.id, issueId: issue.id, scopeKind: "issue", contextSnapshot: { issueId: issue.id },
    status: "running", runtimeMode: "legacy", ...legacyControllerClaim("legacy"), createdAt }).returning();
  await db.update(issues).set({ executionRunId: run.id }).where(eq(issues.id, issue.id)); return { issue, run };
}
function execution(run: typeof heartbeatRuns.$inferSelect, issueId: string, candidate: { id: string; generation: number }): HeartbeatRuntimeExecutionInput {
  return { run, agent: target, task: { issueId, context: { issueId, forceFreshSession: true }, executionContinuation: null },
    runtime: { adapter: getServerAdapter("claude_local"), nativeRuntimeResolution: { kind: "legacy" }, runtimeForAdapter: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: issueId } },
    workspace: { executionTarget: { kind: "local", environmentId }, executionWorkspace: { cwd: resolveDefaultAgentWorkspaceDir(target.id), baseCwd: resolveDefaultAgentWorkspaceDir(target.id), source: "agent_home", strategy: "project_primary", projectId: null, workspaceId: null, repoUrl: null, repoRef: null, branchName: null, worktreePath: null, created: false, branchCreatedByRuntime: false, warnings: [] }, remoteExecution: null },
    config: { runtimeConfig: { ...target.adapterConfig, env: { ANTHROPIC_API_KEY: keyValue } }, resolvedConfig: { ...target.adapterConfig, env: { ANTHROPIC_API_KEY: keyValue } }, configuredTaskEnvironment: { ANTHROPIC_API_KEY: keyValue } },
    session: { sessionConfigMetadata: { fingerprint: "fixture", version: 1 } }, control: { promptApplicationCandidate: candidate, executionControl: { controller: new AbortController() } } } as unknown as HeartbeatRuntimeExecutionInput;
}
async function finish(runId: string) { await db.update(heartbeatRuns).set({ status: "failed", controllerLeaseExpiresAt: null, executionStage: "settled", finishedAt: new Date() }).where(eq(heartbeatRuns.id, runId)); }
it("prepare and approval are immutable, idempotent, no-wake and do not mutate agent config", async () => {
  const before = await db.select().from(agentWakeupRequests), config = structuredClone(target.adapterConfig);
  const p = await proposal(), input = approval(p.item), result = await service.approve(actor, e.promptId, p.item.id, input);
  expect(result.receipt.generation).toBe(p.item.expectedGeneration + 1); expect(result.receipt.executionStarted).toBe(false);
  expect((await service.approve(actor, e.promptId, p.item.id, input)).receipt.id).toBe(result.receipt.id);
  expect((await service.request(actor, e.promptId, input.requestId)).receipt?.requestId).toBe(input.requestId);
  expect((await db.select().from(agents).where(eq(agents.id, target.id)))[0].adapterConfig).toEqual(config);
  expect(await db.select().from(agentWakeupRequests)).toEqual(before); expect(boundary.inputs).toHaveLength(0);
  expect(p.item.snapshot.completeContextCaptured).toBe(false); expect(p.item.snapshot.ordinaryToolsQualityProven).toBe(false);
  await expect(db.update(mimousePromptApplications).set({ reportHash: "0".repeat(64) }).where(eq(mimousePromptApplications.id, p.item.id))).rejects.toThrow();
  await service.rollback(actor, e.promptId, p.item.id, { requestId: randomUUID(), expectedGeneration: result.receipt.generation });
});
it("CAS admits only one simultaneous approval and closes stale request recovery without replay", async () => {
  const a = await proposal(), b = await proposal(), ia = approval(a.item), ib = approval(b.item);
  const results = await Promise.allSettled([service.approve(actor, e.promptId, a.item.id, ia), service.approve(actor, e.promptId, b.item.id, ib)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const win = results[0].status === "fulfilled" ? a : b, lose = win === a ? b : a, lostInput = win === a ? ib : ia;
  const proof = await service.request(actor, e.promptId, lostInput.requestId, { action: "approve", applicationId: lose.item.id, expectedGeneration: lostInput.expectedGeneration });
  expect(proof.closure).toMatchObject({ outcome: "not_applied_closed", reason: "generation_advanced", requestId: lostInput.requestId });
  await service.rollback(actor, e.promptId, win.item.id, { requestId: randomUUID(), expectedGeneration: (await service.head(actor, target.id)).generation });
});
it("an expired immutable proposal closes same-request uncertainty without applying", async () => {
  const p = await proposal(), original = (await db.select().from(mimousePromptApplications).where(eq(mimousePromptApplications.id, p.item.id)))[0];
  const expiredAt = new Date(Date.now() - 60000), id = randomUUID();
  const digest = targetModule.applicationDigest({ id, companyId: original.companyId, actorUserId: original.actorUserId, promptId: original.promptId,
    revisionId: original.revisionId, revisionHash: original.revisionHash, reportHash: original.reportHash, snapshot: original.snapshot,
    expectedGeneration: original.expectedGeneration, approvalExpiresAt: expiredAt.toISOString() });
  await db.insert(mimousePromptApplications).values({ ...original, id, requestId: randomUUID(), approvalDigest: digest,
    createdAt: new Date(Date.now() - 120000), approvalExpiresAt: expiredAt });
  const input = { ...approval(p.item), approvalDigest: digest };
  await expect(service.approve(actor, e.promptId, id, input)).rejects.toThrow("prompt_application_approval_expired");
  expect((await service.request(actor, e.promptId, input.requestId, { action: "approve", applicationId: id, expectedGeneration: input.expectedGeneration })).closure)
    .toMatchObject({ outcome: "not_applied_closed", reason: "approval_expired", requestId: input.requestId });
});
it("tasks created during approval validation are before the database cutover", async () => {
  const p = await proposal(), original = targetModule.resolvePromptApplicationTarget; let during: typeof issues.$inferSelect | undefined;
  const hook = vi.spyOn(targetModule, "resolvePromptApplicationTarget").mockImplementationOnce(async (...args) => {
    const snapshot = await original(...args);
    [during] = await db.insert(issues).values({ companyId: actor.companyId, title: "Created while approval validates", status: "todo", responsibleUserId: actor.userId }).returning();
    return snapshot;
  });
  let approved: Awaited<ReturnType<typeof service.approve>>;
  try { approved = await service.approve(actor, e.promptId, p.item.id, approval(p.item)); } finally { hook.mockRestore(); }
  await db.update(issues).set({ assigneeAgentId: target.id }).where(eq(issues.id, during!.id));
  const [run] = await db.insert(heartbeatRuns).values({ companyId: actor.companyId, agentId: target.id, issueId: during!.id, scopeKind: "issue", status: "running", runtimeMode: "legacy", ...legacyControllerClaim("legacy") }).returning();
  expect(await findPromptApplicationCandidate(db, run, during!.id)).toBeNull(); await finish(run.id);
  await service.rollback(actor, e.promptId, p.item.id, { requestId: randomUUID(), expectedGeneration: approved.receipt.generation });
});
it("old tasks and queued runs are excluded, new overlays fail closed", async () => {
  const p = await proposal(), approved = await service.approve(actor, e.promptId, p.item.id, approval(p.item));
  const old = await issueRun(fixed); expect(await findPromptApplicationCandidate(db, old.run, old.issue.id)).toBeNull(); await finish(old.run.id);
  const fresh = await issueRun(); expect(await findPromptApplicationCandidate(db, fresh.run, fresh.issue.id)).toEqual({ id: p.item.id, generation: approved.receipt.generation });
  await db.update(issues).set({ assigneeAdapterOverrides: { model: "different" } }).where(eq(issues.id, fresh.issue.id));
  await expect(findPromptApplicationCandidate(db, fresh.run, fresh.issue.id)).rejects.toThrow("prompt_application_task_or_runtime_overlay_unsupported"); await finish(fresh.run.id);
  await service.rollback(actor, e.promptId, p.item.id, { requestId: randomUUID(), expectedGeneration: approved.receipt.generation });
});
it("withdrawal before the required spawn witness blocks late literal input without claiming process stop", async () => {
  const p = await proposal(), approved = await service.approve(actor, e.promptId, p.item.id, approval(p.item)), fresh = await issueRun();
  const input = execution(fresh.run, fresh.issue.id, { id: p.item.id, generation: approved.receipt.generation });
  const capability = (await preparePromptApplicationExecution(db, input))!;
  await capability.prepare("ordinary prompt plus approved literal", { ANTHROPIC_API_KEY: keyValue }, home); await capability.beforeStart();
  await service.rollback(actor, e.promptId, p.item.id, { requestId: randomUUID(), expectedGeneration: approved.receipt.generation });
  await expect(capability.dispatched()).rejects.toThrow("prompt_application_dispatch_generation_changed");
  const [receipt] = await db.select().from(mimousePromptApplicationDispatches).where(eq(mimousePromptApplicationDispatches.runId, fresh.run.id)); expect(receipt.state).toBe("prepared");
  await finish(fresh.run.id);
  expect(await db.transaction(tx => applicationAttemptStopped(tx, actor.companyId, fresh.run.id))).toBe(false);
  const [next] = await db.insert(heartbeatRuns).values({ companyId: actor.companyId, agentId: target.id, issueId: fresh.issue.id, scopeKind: "issue", status: "queued", runtimeMode: "legacy" }).returning();
  await expect(findPromptApplicationCandidate(db, next, fresh.issue.id)).rejects.toThrow("prompt_application_previous_attempt_unresolved"); await finish(next.id);
});
it("a dispatched witness that wins before withdrawal remains historical and does not get relabeled un-applied", async () => {
  const p = await proposal(), approved = await service.approve(actor, e.promptId, p.item.id, approval(p.item)), fresh = await issueRun();
  const capability = (await preparePromptApplicationExecution(db, execution(fresh.run, fresh.issue.id, { id: p.item.id, generation: approved.receipt.generation })))!;
  await capability.prepare("fixed final prompt", { ANTHROPIC_API_KEY: keyValue }, home); await capability.beforeStart(); await capability.dispatched();
  await service.rollback(actor, e.promptId, p.item.id, { requestId: randomUUID(), expectedGeneration: approved.receipt.generation });
  expect((await db.select().from(mimousePromptApplicationDispatches).where(eq(mimousePromptApplicationDispatches.runId, fresh.run.id)))[0].state).toBe("dispatched");
  await capability.stopped(); await finish(fresh.run.id);
});
it("rejects a real late lease after a stopped preflight, then approves the unchanged request exactly once after genuine release", async () => {
  const p = await proposal(), fixedApproval = Object.freeze(approval(p.item));
  const leases = environmentService(db);
  const leaseDirectory = join(home, `late-approval-lease-${randomUUID()}`);
  let lease: Awaited<ReturnType<typeof leases.acquireLease>> | undefined;
  let released = false, preflight = false;
  const refusals: ApprovalFixtureTrace[] = [], attempts: string[] = [];
  const inputCount = boundary.inputs.length;
  try {
    const result = await approveStoppedFixture({ db, agentId: target.id, drain: () => heartbeat.drainActiveRunExecutions(),
      afterFirstPreflight: async () => {
        preflight = await agentExecutionsHaveStopped(db, [target.id]);
        expect(preflight).toBe(true);
        await mkdir(leaseDirectory);
        lease = await leases.acquireLease({ companyId: actor.companyId, environmentId, provider: "local", providerLeaseId: leaseDirectory,
          leasePolicy: "ephemeral", metadata: { agentId: target.id } });
        expect(await agentExecutionsHaveStopped(db, [target.id])).toBe(false);
      },
      approve: () => {
        attempts.push(JSON.stringify(fixedApproval));
        return service.approve(actor, e.promptId, p.item.id, fixedApproval);
      },
      afterRefusal: async trace => {
        refusals.push(trace);
        expect(trace.state.stopped).toBe(false);
        expect(trace.state.activeLeases.map(item => item.id)).toContain(lease!.id);
        expect(await db.select().from(mimousePromptApplicationReceipts).where(eq(mimousePromptApplicationReceipts.applicationId, p.item.id))).toEqual([]);
        expect((await service.head(actor, target.id)).generation).toBe(p.item.expectedGeneration);
        await rm(leaseDirectory, { recursive: true });
        await leases.releaseLease(lease!.id, "released", { cleanupStatus: "success" });
        released = true;
        expect(await agentExecutionsHaveStopped(db, [target.id])).toBe(true);
      },
    });
    expect(preflight).toBe(true);
    expect(refusals).toHaveLength(1);
    expect(attempts).toEqual([JSON.stringify(fixedApproval), JSON.stringify(fixedApproval)]);
    expect((await service.approve(actor, e.promptId, p.item.id, fixedApproval)).receipt.id).toBe(result.receipt.id);
    expect(await db.select().from(mimousePromptApplicationReceipts).where(eq(mimousePromptApplicationReceipts.applicationId, p.item.id))).toHaveLength(1);
    expect((await service.head(actor, target.id)).generation).toBe(p.item.expectedGeneration + 1);
    expect(boundary.inputs).toHaveLength(inputCount);
    await service.rollback(actor, e.promptId, p.item.id, { requestId: randomUUID(), expectedGeneration: result.receipt.generation });
  } finally {
    if (lease && !released) {
      await rm(leaseDirectory, { recursive: true, force: true });
      await leases.releaseLease(lease.id, "released", { cleanupStatus: "success" });
    }
  }
});

it("real heartbeat and ordinary Claude prompt assembly reach only the inert Node fixture", async () => {
  const p = await proposal(), approved = await service.approve(actor, e.promptId, p.item.id, approval(p.item));
  const [issue] = await db.insert(issues).values({ companyId: actor.companyId, title: "Actual ordinary runtime fixture", assigneeAgentId: target.id, responsibleUserId: actor.userId, status: "todo" }).returning();
  boundary.settle = async () => { await db.update(issues).set({ status: "done" }).where(eq(issues.id, issue.id)); };
  const before = boundary.inputs.length;
  await heartbeat.wakeup(target.id, { source: "on_demand", triggerDetail: "manual", reason: "issue_assigned", contextSnapshot: { issueId: issue.id }, requestedByActorType: "user", requestedByActorId: actor.userId });
  await drainHeartbeatRunsToQuiescence(db, heartbeat); boundary.settle = null;
  const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.issueId, issue.id));
  expect(runs.map(r => ({ status: r.status, error: r.error }))).toEqual([{ status: "succeeded", error: null }]);
  expect(boundary.inputs.length).toBe(before + 1); expect(boundary.inputs.at(-1)).toContain("Ordinary template for Ordinary fixture.");
  expect(boundary.inputs.at(-1)).toContain(e.revisions[1].content); expect(boundary.inputs.at(-1)).not.toMatch(/PRIVATE_INPUT_SENTINEL|PRIVATE_SKILL_SENTINEL|WRONG_TRIMMED_SUMMARY/);
  const [receipt] = await db.select().from(mimousePromptApplicationDispatches).where(eq(mimousePromptApplicationDispatches.runId, runs[0].id));
  expect(receipt.state).toBe("dispatched"); expect(receipt.promptHash).toMatch(/^[a-f0-9]{64}$/);
  await service.rollback(actor, e.promptId, p.item.id, { requestId: randomUUID(), expectedGeneration: approved.receipt.generation });
}, 90000);
it("claimed adapter drift after candidate admission fails once without an unbound retry", async () => {
  const p = await proposal(), approved = await service.approve(actor, e.promptId, p.item.id, approval(p.item));
  const [issue] = await db.insert(issues).values({ companyId: actor.companyId, title: "Claimed adapter drift", assigneeAgentId: target.id,
    responsibleUserId: actor.userId, status: "todo" }).returning();
  const before = boundary.inputs.length, original = executionModule.findPromptApplicationCandidate;
  const hook = vi.spyOn(executionModule, "findPromptApplicationCandidate").mockImplementationOnce(async (...args) => {
    const found = await original(...args);
    // Simulate a persisted claimed identity that disagrees with the loaded agent;
    // this must be checked after the durable candidate marker, before execution.
    args[1].runnerProfileJson = { adapterDispatch: { adapterType: "process" } };
    await db.update(heartbeatRuns).set({ runnerProfileJson: args[1].runnerProfileJson }).where(eq(heartbeatRuns.id, args[1].id));
    return found;
  });
  try {
    await heartbeat.wakeup(target.id, { source: "on_demand", triggerDetail: "manual", reason: "issue_assigned", contextSnapshot: { issueId: issue.id }, requestedByActorType: "user", requestedByActorId: actor.userId });
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
  } finally { hook.mockRestore(); }
  const runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.issueId, issue.id));
  expect(runs).toHaveLength(1); expect(runs[0]).toMatchObject({ status: "failed", errorCode: "prompt_application_blocked", scheduledRetryReason: null });
  expect(runs[0].error).toContain("Agent adapter changed during startup"); expect(boundary.inputs).toHaveLength(before);
  expect((await db.select().from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.runId, runs[0].id), eq(heartbeatRunEvents.eventType, "prompt_application.candidate"))))).toHaveLength(1);
  await service.rollback(actor, e.promptId, p.item.id, { requestId: randomUUID(), expectedGeneration: approved.receipt.generation });
}, 90000);
it("a rejected controlled candidate cannot auto-retry or become unbound after head withdrawal and controller recreation", async () => {
  const p = await proposal(), approved = await service.approve(actor, e.promptId, p.item.id, approval(p.item));
  const [issue] = await db.insert(issues).values({ companyId: actor.companyId, title: "Unsupported controlled override", assigneeAgentId: target.id,
    responsibleUserId: actor.userId, status: "todo", assigneeAdapterOverrides: { model: "not-the-approved-model" } }).returning();
  const before = boundary.inputs.length;
  const wake = { source: "on_demand" as const, triggerDetail: "manual" as const, reason: "issue_assigned", contextSnapshot: { issueId: issue.id }, requestedByActorType: "user" as const, requestedByActorId: actor.userId };
  await heartbeat.wakeup(target.id, wake); await drainHeartbeatRunsToQuiescence(db, heartbeat);
  let runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.issueId, issue.id));
  expect(runs).toHaveLength(1); expect(runs[0]).toMatchObject({ status: "failed", errorCode: "prompt_application_blocked", scheduledRetryReason: null });
  expect((await db.select().from(heartbeatRunEvents).where(and(eq(heartbeatRunEvents.runId, runs[0].id), eq(heartbeatRunEvents.eventType, "prompt_application.candidate"))))).toHaveLength(1);
  await service.rollback(actor, e.promptId, p.item.id, { requestId: randomUUID(), expectedGeneration: approved.receipt.generation });
  await db.update(issues).set({ assigneeAdapterOverrides: {} }).where(eq(issues.id, issue.id));
  // Fresh service/controller has no candidate memory; the database marker alone must block it.
  const recreated = heartbeatService(db); await recreated.wakeup(target.id, wake); await drainHeartbeatRunsToQuiescence(db, recreated);
  runs = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.issueId, issue.id));
  expect(runs).toHaveLength(2); expect(runs.every(r => r.status === "failed" && r.errorCode === "prompt_application_blocked")).toBe(true);
  expect(runs.some(r => r.error?.includes("prompt_application_failed_attempt_requires_new_task"))).toBe(true);
  expect(boundary.inputs).toHaveLength(before);
}, 90000);
it("a paused company can inspect and withdraw a future binding without allowing deployment or weakening identity checks", async () => {
  const p = await proposal(), approvedInput = approval(p.item), approved = await service.approve(actor, e.promptId, p.item.id, approvedInput);
  const pending = await proposal(), fresh = await issueRun();
  const capability = (await preparePromptApplicationExecution(db, execution(fresh.run, fresh.issue.id, { id: p.item.id, generation: approved.receipt.generation })))!;
  await capability.prepare("approved ordinary prompt", { ANTHROPIC_API_KEY: keyValue }, home);
  const beforeRuns = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).orderBy(heartbeatRuns.id), beforeWakes = await db.select().from(agentWakeupRequests), beforeInputs = boundary.inputs.length;
  const rollbackInput = { requestId: randomUUID(), expectedGeneration: approved.receipt.generation };
  const [session] = await db.select().from(authSessions).where(eq(authSessions.id, actor.sessionId));
  const [member] = await db.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, actor.companyId), eq(companyMemberships.principalId, actor.userId)));
  const [grant] = await db.select().from(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, actor.companyId), eq(principalPermissionGrants.principalId, actor.userId), eq(principalPermissionGrants.permissionKey, "agents:configure")));
  await db.update(companies).set({ status: "paused" }).where(eq(companies.id, actor.companyId));
  try {
    expect((await service.list(actor, e.promptId)).enabled).toBe(false);
    expect(await service.detail(actor, e.promptId, p.item.id)).toMatchObject({ enabled: false, item: { id: p.item.id, configured: true } });
    expect(await service.head(actor, target.id)).toMatchObject({ enabled: false, applicationId: p.item.id });
    expect(await service.request(actor, e.promptId, approvedInput.requestId)).toMatchObject({ enabled: false, receipt: { id: approved.receipt.id } });
    expect((await service.dispatches(actor, e.promptId, p.item.id)).items).toHaveLength(1);
    await expect(proposal()).rejects.toThrow("private_prompt_active_company_required");
    await expect(service.approve(actor, e.promptId, pending.item.id, approval(pending.item))).rejects.toThrow("private_prompt_active_company_required");
    await expect(db.transaction(tx => authorizePrivatePrompt(tx, actor))).rejects.toThrow("private_prompt_active_company_required");
    await expect(capability.beforeStart()).rejects.toThrow("prompt_application_approver_revoked");
    await expect(capability.dispatched()).rejects.toThrow("prompt_application_approver_revoked");

    await db.update(companies).set({ status: "archived" }).where(eq(companies.id, actor.companyId));
    await expect(service.list(actor, e.promptId)).rejects.toThrow("private_prompt_active_company_required");
    await expect(service.rollback(actor, e.promptId, p.item.id, rollbackInput)).rejects.toThrow("private_prompt_active_company_required");
    await db.update(companies).set({ status: "paused" }).where(eq(companies.id, actor.companyId));
    await db.update(authSessions).set({ expiresAt: fixed }).where(eq(authSessions.id, actor.sessionId));
    await expect(service.detail(actor, e.promptId, p.item.id)).rejects.toThrow("private_prompt_active_session_administrator_required");
    await expect(service.rollback(actor, e.promptId, p.item.id, rollbackInput)).rejects.toThrow("private_prompt_active_session_administrator_required");
    await db.update(authSessions).set({ expiresAt: session.expiresAt }).where(eq(authSessions.id, actor.sessionId));
    await db.update(companyMemberships).set({ status: "suspended" }).where(eq(companyMemberships.id, member.id));
    await expect(service.head(actor, target.id)).rejects.toThrow("private_prompt_active_session_administrator_required");
    await expect(service.rollback(actor, e.promptId, p.item.id, rollbackInput)).rejects.toThrow("private_prompt_active_session_administrator_required");
    await db.update(companyMemberships).set({ status: member.status }).where(eq(companyMemberships.id, member.id));
    await db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.id, grant.id));
    await expect(service.rollback(actor, e.promptId, p.item.id, rollbackInput)).rejects.toThrow("prompt_application_agent_configuration_denied");
    // Metadata still follows the pre-existing owner/admin read contract.
    expect((await service.list(actor, e.promptId)).enabled).toBe(false);
    await db.insert(principalPermissionGrants).values(grant);

    const withdrawn = await service.rollback(actor, e.promptId, p.item.id, rollbackInput);
    expect(withdrawn.receipt).toMatchObject({ action: "rollback", executionStarted: false });
    expect(await service.request(actor, e.promptId, rollbackInput.requestId)).toMatchObject({ enabled: false, receipt: { id: withdrawn.receipt.id } });
    expect((await service.head(actor, target.id)).applicationId).toBeNull();
    expect(await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).orderBy(heartbeatRuns.id)).toEqual(beforeRuns);
    expect(await db.select().from(agentWakeupRequests)).toEqual(beforeWakes); expect(boundary.inputs).toHaveLength(beforeInputs);
  } finally {
    await db.update(authSessions).set({ expiresAt: session.expiresAt }).where(eq(authSessions.id, actor.sessionId));
    await db.update(companyMemberships).set({ status: member.status }).where(eq(companyMemberships.id, member.id));
    await db.insert(principalPermissionGrants).values(grant).onConflictDoNothing();
    await db.update(companies).set({ status: "active" }).where(eq(companies.id, actor.companyId)); await finish(fresh.run.id);
  }
  expect(await service.head(actor, target.id)).toMatchObject({ enabled: true, applicationId: null });
}, 90000);
it("revoked configuration permission blocks prepare, while prior metadata stays readable", async () => {
  // Isolate the permission assertion from any preceding runtime failure.
  await db.update(agents).set({ status: "idle" }).where(eq(agents.id, target.id));
  await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.companyId, actor.companyId), eq(principalPermissionGrants.principalId, actor.userId), eq(principalPermissionGrants.permissionKey, "agents:configure")));
  await expect(proposal()).rejects.toThrow("prompt_application_agent_configuration_denied"); expect((await service.list(actor, e.promptId)).items.length).toBeGreaterThan(0);
  expect(JSON.stringify(await db.select().from(activityLog))).not.toMatch(/PRIVATE_INPUT_SENTINEL|PRIVATE_SKILL_SENTINEL|fixture-not-a-real-provider-key/);
});
