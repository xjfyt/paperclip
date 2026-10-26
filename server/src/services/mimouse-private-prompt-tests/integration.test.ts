import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, appendFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, agents, authSessions, authUsers, companies, companyMemberships, companySkills, companySkillVersions,
  mimouseEvaluationDatasets, issueCreateIdempotencyKeys, heartbeatRuns, heartbeatRunEvents, issues, agentWakeupRequests, createDb, type Db,
  ensurePostgresDatabase, applyPendingMigrations, instanceSettings, environments } from "@paperclipai/db";
import { mimousePrivatePromptTests as tests } from "@paperclipai/db/schema/mimouse_private_prompt_tests";

vi.mock("../../adapters/plugin-loader.js", () => ({ buildExternalAdapters: async () => [] }));
const processBoundary = vi.hoisted(() => ({ inputs: [] as string[], calls: 0, hold: false, notifySpawn: null as null | (() => void) }));
vi.mock("@paperclipai/adapter-utils/execution-target", async original => {
  const actual = await original<typeof import("@paperclipai/adapter-utils/execution-target")>();
  return { ...actual, runAdapterExecutionTargetProcess: async (runId: string, target: unknown, command: string, args: string[], options: any) => {
    if (command !== "claude" || target !== null || !args.includes("--bare") || options.inheritEnv !== false ||
        Object.keys(options.env).some(key => !["HOME", "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY"].includes(key)) ||
        options.env.ANTHROPIC_API_KEY !== "fixture-not-a-real-key") throw Error("Unexpected process boundary; real CLI forbidden");
    processBoundary.calls++; processBoundary.inputs.push(options.stdin);
    const { runChildProcess } = await import("@paperclipai/adapter-utils/server-utils");
    // The only provider-boundary process is this no-network Node fixture. It
    // echoes stdin to test leak protection, but never launches any CLI/account.
    return runChildProcess(runId, process.execPath, ["-e", `
      let body='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>body+=chunk);
      process.stdin.on('end',()=>{if(${processBoundary.hold}){setInterval(()=>{},1000);return;}process.stderr.write(body);process.stdout.write(JSON.stringify({type:'result',subtype:'success',result:body,is_error:false,usage:{input_tokens:1,output_tokens:1}})+'\\n');});
    `], { ...options, timeoutSec: 10, graceSec: 1, onSpawn: async (meta: unknown) => { await options.onSpawn(meta); processBoundary.notifySpawn?.(); } });
  } };
});
import { getServerAdapter, privatePromptTestImplementation, registerServerAdapter } from "../../adapters/registry.js";
import { snapshotFile } from "../skill-snapshot.js";
import * as issueModule from "../issues.js";
import { assertPrivatePromptEarlyBinding, privatePromptTestService } from "./service.js";
import { privateConfigDigest, privatePromptHash } from "./profile.js";
import { promptRegistryService } from "../mimouse-prompt-registry/service.js";
import { secretService } from "../secrets.js";
import { heartbeatService } from "../heartbeat.js";
import { drainHeartbeatRunsToQuiescence } from "../../__tests__/helpers/drain-heartbeat-runs.js";

let pgLog: string;
function recordPg(message: unknown) { appendFileSync(pgLog, `${String(message)}\n`); }
let db: Db, pg: { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> }, home: string, dataDir: string, pid: number;
let actor: { companyId: string; userId: string; sessionId: string };
let input: any, promptId: string, heartbeat: ReturnType<typeof heartbeatService>;
const marker = "PRIVATE_PROMPT_LEAK_SENTINEL_9c4d73b1";
const literal = "  PRIVATE_PROMPT_LEAK_SENTINEL_9c4d73b1 私有原文🧪\r\n{{agent.name}}\n<script>inert</script>  ";
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "paperclip-private-prompt-home-"));
  pgLog = `${home}-postgres.log`; recordPg(`owned fixture ${home}`);
  await writeFile(join(home, ".private-prompt-test-fixture"), "paperclip-private-prompt-disposable-v1");
  vi.stubEnv("PAPERCLIP_HOME", home); vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY_FILE", join(home, "master.key"));
  vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", ""); vi.stubEnv("PAPERCLIP_PRIVATE_PROMPT_TESTS_ENABLED", "true");
  vi.stubEnv("PAPERCLIP_DISABLE_CWD_ENV_FILE", "true"); vi.stubEnv("DATABASE_URL", ""); vi.stubEnv("DATABASE_MIGRATION_URL", "");
  vi.stubEnv("PAPERCLIP_TEST_POSTGRES_TEMPLATE", "0"); vi.stubEnv("PAPERCLIP_TELEMETRY_DISABLED", "1"); vi.stubEnv("DO_NOT_TRACK", "1");
  vi.stubGlobal("fetch", vi.fn(async () => { throw Error("Network forbidden in private prompt fixture"); }));
  console.log("private-prompt fixture: starting new owned PostgreSQL cluster");
  dataDir = join(home, "db");
  if (!resolve(dataDir).startsWith(join(tmpdir(), "paperclip-private-prompt-home-"))) throw Error("Disposable database path mismatch");
  if ((await readFile(join(home, ".private-prompt-test-fixture"), "utf8")) !== "paperclip-private-prompt-disposable-v1") throw Error("Missing owned fixture marker");
  for (const filename of ["PG_VERSION", "postmaster.pid"]) {
    const exists = await access(join(dataDir, filename)).then(() => true, () => false);
    if (exists) throw Error("Refusing existing PostgreSQL state");
  }
  const port = await new Promise<number>((accept, reject) => {
    const socket = createServer(); socket.once("error", reject); socket.listen(0, "127.0.0.1", () => {
      const address = socket.address(); if (!address || typeof address === "string") return reject(Error("No loopback port"));
      socket.close(error => error ? reject(error) : accept(address.port));
    });
  });
  const require = createRequire(new URL("../../../../packages/db/package.json", import.meta.url));
  const { default: EmbeddedPostgres } = await import(require.resolve("embedded-postgres"));
  pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "paperclip", password: "paperclip", port, persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"], onLog: recordPg, onError: recordPg });
  await pg.initialise();
  // Same supported TCP-only adaptation as tests/mimouse/prepare-disposable-db.mjs.
  // Only the newly marked cluster changes; auth and ownership rules are untouched.
  await appendFile(join(dataDir, "postgresql.conf"), "\n# Private disposable fixture only\nunix_socket_directories = ''\nlisten_addresses = '127.0.0.1'\n");
  await pg.start();
  pid = Number((await readFile(join(dataDir, "postmaster.pid"), "utf8")).split("\n")[0]);
  const connectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
  console.log(`private-prompt fixture: owned data_directory=${dataDir} pid=${pid} port=${port}`);
  await ensurePostgresDatabase(`postgres://paperclip:paperclip@127.0.0.1:${port}/postgres`, "paperclip");
  await applyPendingMigrations(connectionString);
  db = createDb(connectionString);
  const directory = await db.execute(sql`show data_directory`);
  if (resolve(String(directory[0].data_directory)) !== resolve(dataDir)) throw Error("Owned database mismatch");
  await db.execute(sql.raw(await readFile(new URL("../../../../doc/integration/private-prompt-tests.sql", import.meta.url), "utf8")));
  const userId = randomUUID(), sessionId = randomUUID(), now = new Date();
  await db.insert(authUsers).values({ id: userId, name: "Private fixture", email: `${userId}@example.invalid`, createdAt: now, updatedAt: now });
  await db.insert(authSessions).values({ id: sessionId, token: randomUUID(), userId, expiresAt: new Date(Date.now()+3600000), createdAt: now, updatedAt: now });
  const [company] = await db.insert(companies).values({ name: "Private fixture", issuePrefix: "PVT", defaultResponsibleUserId: userId }).returning();
  actor = { companyId: company.id, userId, sessionId };
  await db.insert(companyMemberships).values({ companyId: company.id, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
  const secret = await secretService(db).create(company.id, { name: "Private fixture provider", provider: "local_encrypted", value: "fixture-not-a-real-key" }, { userId });
  const [agent] = await db.insert(agents).values({ companyId: company.id, name: "Private fixture", role: "engineer", status: "idle", adapterType: "claude_local",
    adapterConfig: { engine: "cli", model: "claude-sonnet-4-5", cwd: home, env: { ANTHROPIC_API_KEY: { type: "secret_ref", secretId: secret.id, version: 1 } } } }).returning();
  await secretService(db).createBinding({ companyId: company.id, secretId: secret.id, targetType: "agent", targetId: agent.id, configPath: "env.ANTHROPIC_API_KEY", versionSelector: 1 });
  const [skill] = await db.insert(companySkills).values({ companyId: company.id, key: "private-fixture", slug: "private-fixture", name: "Private fixture", markdown: "Return the fixed case as text." }).returning();
  const [version] = await db.insert(companySkillVersions).values({ companyId: company.id, companySkillId: skill.id, revisionNumber: 1, fileInventory: [snapshotFile("SKILL.md", "skill", Buffer.from(skill.markdown, "utf8"))] }).returning();
  const cases = [{ id: randomUUID(), input: "Answer the fixed case.", expected: "EXPECTED_ANSWER_NOT_SENT_382e6b" }];
  const [dataset] = await db.insert(mimouseEvaluationDatasets).values({ companyId: company.id, skillId: skill.id, requestId: randomUUID(), requestDigest: "fixture", name: "Fixed", cases, datasetHash: privateConfigDigest(cases), actorId: userId }).returning();
  const revision = await promptRegistryService(db).create(company.id, userId, { requestId: randomUUID(), promptKey: "private_fixture", content: literal });
  promptId = revision.item.promptId;
  input = { requestId: randomUUID(), revisionId: revision.item.id, expectedHeadReceiptId: null, agentId: agent.id,
    datasetId: dataset.id, caseId: cases[0].id, skillVersionId: version.id, executionProfile: "claude_cli_bare_api_key_v1",
    confirmExecution: true, confirmPossibleCharges: true, confirmRestrictedProfile: true };
  heartbeat = heartbeatService(db, { runtimeEnv: {} });
}, 180000);
afterAll(async () => {
  let safeCleanup = false;
  try {
    if (heartbeat && db) await drainHeartbeatRunsToQuiescence(db, heartbeat);
    await db?.$client.end(); if (pg) await pg.stop();
    if (dataDir) {
      const stillHasPid = await access(join(dataDir, "postmaster.pid")).then(() => true, () => false);
      let alive = false; try { process.kill(pid, 0); alive = true; } catch {}
      recordPg(`shutdown verified pidFile=${stillHasPid} processAlive=${alive}`);
      console.log(`private-prompt fixture: log=${pgLog} shutdown verified pidFile=${stillHasPid} processAlive=${alive}`);
      expect(stillHasPid).toBe(false); expect(alive).toBe(false);
      safeCleanup = !stillHasPid && !alive;
    }
  } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); if (home && safeCleanup) await rm(home, { recursive: true, force: true }); }
}, 60000);
it("creates one intent/wake, dispatches exact stdin, and reads bounded output only through private result", async () => {
  const service = privatePromptTestService(db, heartbeat.wakeup);
  const [first, duplicate] = await Promise.all([service.create(actor, promptId, input), service.create(actor, promptId, input)]);
  expect(first.item.id).toBe(duplicate.item.id);
  await drainHeartbeatRunsToQuiescence(db, heartbeat);
  const detail = await service.detail(actor, promptId, first.item.id);
  expect(detail.item.status, JSON.stringify({ item: detail.item, runs: await db.select({ status: heartbeatRuns.status, error: heartbeatRuns.error }).from(heartbeatRuns) })).toBe("completed");
  expect(detail.privateResult?.summary).toContain(literal);
  expect(processBoundary.calls).toBe(1);
  expect(detail.item.prepared?.promptHash).toBe(privatePromptHash(processBoundary.inputs[0]));
  expect(processBoundary.inputs[0]).not.toContain("EXPECTED_ANSWER_NOT_SENT_382e6b");
  expect(processBoundary.inputs[0]).toContain(`\n${literal}\n</private-prompt-revision>`);
  expect(await db.select().from(tests)).toHaveLength(1);
  expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.idempotencyKey, `private-prompt-test:${first.item.id}`))).toHaveLength(1);
  for (const table of [issues, heartbeatRuns, heartbeatRunEvents, activityLog]) {
    expect(JSON.stringify(await db.select().from(table))).not.toContain(marker);
  }
  const replay = await service.create(actor, promptId, input);
  expect(replay.item.id).toBe(first.item.id); expect(processBoundary.calls).toBe(1);
  await expect(heartbeat.wakeup(input.agentId, { idempotencyKey: `private-prompt-test:${first.item.id}`, contextSnapshot: { issueId: first.item.issueId } })).rejects.toThrow("private_prompt_wake_authority_required");
  await expect(service.create(actor, promptId, { ...input, caseId: randomUUID() })).rejects.toThrow("private_prompt_request_conflict");
}, 90000);
it("rejects same-name external adapter wrappers without trusting their claimed capability", () => {
  const builtin = getServerAdapter("claude_local");
  expect(privatePromptTestImplementation(builtin)).not.toBeNull();
  try {
    registerServerAdapter({ ...builtin, execute: async context => builtin.execute(context) });
    expect(privatePromptTestImplementation(getServerAdapter("claude_local"))).toBeNull();
    expect(privatePromptTestImplementation(builtin)).toBeNull();
    expect(privatePromptTestImplementation(getServerAdapter("unknown-private-fixture"))).toBeNull();
  } finally { registerServerAdapter(builtin); }
  expect(privatePromptTestImplementation(builtin)).not.toBeNull();
});
it("rejects runtime routing overlays before creating a paid intent", async () => {
  await db.update(agents).set({ runtimeConfig: { aiConnection: { connectionId: randomUUID() } } }).where(eq(agents.id, input.agentId));
  await expect(privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, { ...input, requestId: randomUUID() })).rejects.toThrow("private_prompt_runtime_overlay_unsupported");
  await db.update(agents).set({ runtimeConfig: {} }).where(eq(agents.id, input.agentId));
});
it("rejects cross-company agents and mismatched fixed resource references before dispatch", async () => {
  const before = processBoundary.calls;
  const [otherCompany] = await db.insert(companies).values({ name: "Other private fixture", issuePrefix: "OPV" }).returning();
  const [otherAgent] = await db.insert(agents).values({ companyId: otherCompany.id, name: "Foreign", role: "engineer", status: "idle", adapterType: "claude_local" }).returning();
  for (const patch of [{ agentId: otherAgent.id }, { caseId: randomUUID() }, { skillVersionId: randomUUID() }, { datasetId: randomUUID() }, { revisionId: randomUUID() }]) {
    await expect(privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, { ...input, ...patch, requestId: randomUUID() })).rejects.toThrow();
  }
  expect(processBoundary.calls).toBe(before);
});
it("refuses an idempotency collision with an open or foreign-owned harness", async () => {
  const request = { ...input, requestId: randomUUID() };
  const original = issueModule.issueService;
  const interrupted = vi.spyOn(issueModule, "issueService").mockImplementationOnce((...args) => ({
    ...original(...args), create: async () => { throw Error("fixture interruption before harness"); },
  }));
  await expect(privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, request)).rejects.toThrow("fixture interruption");
  interrupted.mockRestore();
  const [intent] = await db.select().from(tests).where(eq(tests.requestId, request.requestId));
  expect(intent.status).toBe("pending_harness");
  const [collision] = await db.insert(issues).values({ companyId: actor.companyId, title: "Not a private test", visibility: "open", status: "todo" }).returning();
  await db.insert(issueCreateIdempotencyKeys).values({ companyId: actor.companyId, issueId: collision.id, idempotencyKey: `private-prompt-test:${intent.id}` });
  await expect(privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, request)).rejects.toThrow("private_prompt_harness_binding_denied");
  expect((await db.select().from(tests).where(eq(tests.id, intent.id)))[0].issueId).toBeNull();
  expect(processBoundary.calls).toBe(1);
});
it("converges an unadmitted reserved wake to failed on list and never retries it", async () => {
  const request = { ...input, requestId: randomUUID() };
  const refused = vi.fn(async (agentId: string, opts: any) => {
    await db.insert(agentWakeupRequests).values({ companyId: actor.companyId, agentId, source: "on_demand", status: "skipped", idempotencyKey: opts.idempotencyKey });
  });
  const service = privatePromptTestService(db, refused);
  const created = await service.create(actor, promptId, request);
  expect(created.item.status).toBe("failed");
  expect((await service.list(actor, promptId)).items.find(row => row.id === created.item.id)?.errorCode).toBe("private_prompt_wake_not_admitted");
  await service.create(actor, promptId, request); expect(refused).toHaveBeenCalledTimes(1); expect(processBoundary.calls).toBe(1);
});
it("rejects changed local source, disabled targets, and env/config overlays without dispatch", async () => {
  const [settings] = await db.select().from(instanceSettings);
  const [local] = await db.select().from(environments).where(eq(environments.id, settings.defaultEnvironmentId!));
  const request = { ...input, requestId: randomUUID() };
  await privatePromptTestService(db, async () => null).create(actor, promptId, request);
  const before = processBoundary.calls;
  try {
    // Same target through a different approval source is still configuration drift.
    await db.update(agents).set({ defaultEnvironmentId: local.id }).where(eq(agents.id, input.agentId));
    await expect(privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, request)).rejects.toThrow();
    await db.update(agents).set({ defaultEnvironmentId: null }).where(eq(agents.id, input.agentId));
    for (const patch of [{ status: "disabled" }, { envVars: { UNAPPROVED: "fixture" } }, { config: { cwd: "/tmp" } }]) {
      await db.update(environments).set(patch).where(eq(environments.id, local.id));
      await expect(privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, request)).rejects.toThrow();
      await db.update(environments).set({ status: local.status, config: local.config, envVars: local.envVars }).where(eq(environments.id, local.id));
    }
    await db.update(instanceSettings).set({ defaultEnvironmentId: null });
    await expect(privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, request)).rejects.toThrow();
    expect(processBoundary.calls).toBe(before);
  } finally {
    await db.update(agents).set({ defaultEnvironmentId: null }).where(eq(agents.id, input.agentId));
    await db.update(instanceSettings).set({ defaultEnvironmentId: local.id });
    await db.update(environments).set({ status: local.status, config: local.config, envVars: local.envVars }).where(eq(environments.id, local.id));
  }
});
it("fails closed when the prepared witness cannot persist and never replays that attempt", async () => {
  const before = processBoundary.calls;
  await db.execute(sql.raw(`CREATE FUNCTION private_fixture_deny_prepared() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'prepared' THEN RAISE EXCEPTION 'fixture witness unavailable'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER private_fixture_prepared BEFORE UPDATE ON mimouse_private_prompt_tests FOR EACH ROW EXECUTE FUNCTION private_fixture_deny_prepared();`));
  const request = { ...input, requestId: randomUUID() };
  let id: string;
  try {
    const created = await privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, request); id = created.item.id;
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    const detail = await privatePromptTestService(db).detail(actor, promptId, id);
    expect(detail.item.status).toBe("unknown"); expect(detail.item.prepared).toBeNull();
    expect(processBoundary.calls).toBe(before);
    await privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, request);
    expect(processBoundary.calls).toBe(before);
  } finally {
    await db.execute(sql.raw("DROP TRIGGER private_fixture_prepared ON mimouse_private_prompt_tests; DROP FUNCTION private_fixture_deny_prepared();"));
    await db.update(agents).set({ status: "idle" }).where(eq(agents.id, input.agentId));
  }
});
it("keeps a spawned-but-unpersisted receipt unknown and refuses another attempt", async () => {
  const before = processBoundary.calls;
  await db.execute(sql.raw(`CREATE FUNCTION private_fixture_deny_spawned() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'spawned' THEN RAISE EXCEPTION 'fixture spawn receipt unavailable'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER private_fixture_spawned BEFORE UPDATE ON mimouse_private_prompt_tests FOR EACH ROW EXECUTE FUNCTION private_fixture_deny_spawned();`));
  const request = { ...input, requestId: randomUUID() };
  try {
    const created = await privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, request);
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    const detail = await privatePromptTestService(db).detail(actor, promptId, created.item.id);
    expect(detail.item.status).toBe("unknown"); expect(detail.item.prepared).not.toBeNull();
    expect(detail.item.spawnedAt).toBeNull(); expect(detail.privateResult).toBeNull();
    expect(processBoundary.calls).toBe(before + 1);
    await privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, request);
    expect(processBoundary.calls).toBe(before + 1);
    for (const table of [issues, heartbeatRuns, heartbeatRunEvents, activityLog]) expect(JSON.stringify(await db.select().from(table))).not.toContain(marker);
  } finally {
    await db.execute(sql.raw("DROP TRIGGER private_fixture_spawned ON mimouse_private_prompt_tests; DROP FUNCTION private_fixture_deny_spawned();"));
    await db.update(agents).set({ status: "idle" }).where(eq(agents.id, input.agentId));
  }
});
it("cancels a real fixture child and never replays the cancelled provider-unknown attempt", async () => {
  const before = processBoundary.calls;
  const spawned = new Promise<void>(accept => { processBoundary.notifySpawn = accept; });
  processBoundary.hold = true;
  const request = { ...input, requestId: randomUUID() };
  try {
    const created = await privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, request);
    await spawned;
    const [row] = await db.select().from(tests).where(eq(tests.id, created.item.id));
    await heartbeat.cancelRun(row.heartbeatRunId!, "fixture_user_cancel");
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    const detail = await privatePromptTestService(db).detail(actor, promptId, row.id);
    expect(detail.item.status).toBe("unknown"); expect(detail.item.prepared).not.toBeNull();
    expect(processBoundary.calls).toBe(before + 1);
    await privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, request);
    expect(processBoundary.calls).toBe(before + 1);
  } finally {
    processBoundary.hold = false; processBoundary.notifySpawn = null;
    await db.update(agents).set({ status: "idle" }).where(eq(agents.id, input.agentId));
  }
});
it("reconciles a persisted spawned receipt after terminal run recovery without replay", async () => {
  const [row] = await db.select().from(tests).where(eq(tests.requestId, input.requestId));
  const before = processBoundary.calls;
  // Model the durable crash window after spawned, before private completion.
  await db.update(tests).set({ status: "spawned", privateResult: null }).where(eq(tests.id, row.id));
  await db.update(heartbeatRuns).set({ status: "failed", error: "fixture_restart_recovery" }).where(eq(heartbeatRuns.id, row.heartbeatRunId!));
  const freshService = privatePromptTestService(db, heartbeatService(db, { runtimeEnv: {} }).wakeup);
  expect((await freshService.list(actor, promptId)).items.find(item => item.id === row.id)?.status).toBe("unknown");
  await freshService.create(actor, promptId, input);
  expect(processBoundary.calls).toBe(before);
});
it("protects private bindings when disabled while leaving an ordinary migrated issue unbound", async () => {
  const [ordinary] = await db.insert(issues).values({ companyId: actor.companyId, title: "Ordinary historical issue", visibility: "open" }).returning();
  const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, input.agentId));
  vi.stubEnv("PAPERCLIP_PRIVATE_PROMPT_TESTS_ENABLED", "false");
  try {
    expect(await assertPrivatePromptEarlyBinding(db, run, ordinary.id)).toBeNull();
    const [privateRun] = await db.select().from(tests).where(eq(tests.requestId, input.requestId));
    await expect(heartbeat.wakeup(input.agentId, { contextSnapshot: { issueId: privateRun.issueId } })).rejects.toThrow("private_prompt_generic_wake_denied");
    expect((await privatePromptTestService(db).detail(actor, promptId, privateRun.id)).item.id).toBe(privateRun.id);
  } finally { vi.stubEnv("PAPERCLIP_PRIVATE_PROMPT_TESTS_ENABLED", "true"); }
});
it("denies another active administrator and a revoked original administrator", async () => {
  const before = processBoundary.calls;
  const userId = randomUUID(), sessionId = randomUUID(), now = new Date();
  await db.insert(authUsers).values({ id: userId, name: "Other admin", email: `${userId}@example.invalid`, createdAt: now, updatedAt: now });
  await db.insert(authSessions).values({ id: sessionId, token: randomUUID(), userId, expiresAt: new Date(Date.now()+3600000), createdAt: now, updatedAt: now });
  await db.insert(companyMemberships).values({ companyId: actor.companyId, principalType: "user", principalId: userId, membershipRole: "admin", status: "active" });
  const [privateRun] = await db.select().from(tests).where(eq(tests.requestId, input.requestId));
  await expect(privatePromptTestService(db).detail({ ...actor, userId, sessionId }, promptId, privateRun.id)).rejects.toThrow("private_prompt_test_not_found");
  const [row] = await db.select().from(tests);
  await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, actor.companyId), eq(companyMemberships.principalId, actor.userId)));
  await expect(privatePromptTestService(db).detail(actor, promptId, row.id)).rejects.toThrow("private_prompt_active_session_administrator_required");
  expect(processBoundary.calls).toBe(before);
});
