import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, writeFile, appendFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ownedCaseWorkScope } from "../../__tests__/helpers/owned-case-work.js";
import { and, eq, sql } from "drizzle-orm";
import { activityLog, agents, authSessions, authUsers, companies, companyMemberships, companySkills, companySkillVersions,
  mimouseEvaluationDatasets, issueCreateIdempotencyKeys, heartbeatRuns, heartbeatRunEvents, issues, agentWakeupRequests, createDb, type Db,
  ensurePostgresDatabase, applyPendingMigrations, inspectMigrations, reconcilePendingMigrationHistory, instanceSettings, environments,
  loadEmbeddedPostgres, loadWithoutEmbeddedPostgresExitHooks } from "@paperclipai/db";
import { mimousePrivatePromptTests as tests } from "@paperclipai/db/schema/mimouse_private_prompt_tests";

// Only catalog discovery is scoped to the historical checkpoint. SQL reads and
// the production per-file executor remain real; no migration file is rewritten.
const migrationCatalog = vi.hoisted(() => ({ checkpoint: null as null | {
  directory: string; journalPath: string; journal: string; files: Set<string>;
} }));
vi.mock("node:fs/promises", async original => {
  const fs = await original<typeof import("node:fs/promises")>();
  const { fileURLToPath } = await import("node:url");
  const { resolve } = await import("node:path");
  const pathName = (path: unknown) => path instanceof URL ? resolve(fileURLToPath(path)) : typeof path === "string" ? resolve(path) : null;
  return { ...fs,
    readFile: (async (...args: Parameters<typeof fs.readFile>) => {
      const checkpoint = migrationCatalog.checkpoint;
      if (checkpoint && pathName(args[0]) === checkpoint.journalPath) {
        if (args[1] !== "utf8") throw Error("Unexpected historical journal read options");
        return checkpoint.journal;
      }
      return fs.readFile(...args);
    }) as typeof fs.readFile,
    readdir: (async (...args: Parameters<typeof fs.readdir>) => {
      const checkpoint = migrationCatalog.checkpoint;
      if (checkpoint && pathName(args[0]) === checkpoint.directory) {
        const options = args[1] as { withFileTypes?: boolean; recursive?: boolean; encoding?: string | null } | string | null | undefined;
        if (!options || typeof options !== "object" || options.withFileTypes !== true || options.recursive ||
            (options.encoding !== undefined && options.encoding !== "utf8")) throw Error("Unexpected historical catalog read options");
        const entries = await fs.readdir(checkpoint.directory, { withFileTypes: true });
        return entries.filter(entry => !entry.isFile() || !entry.name.endsWith(".sql") || checkpoint.files.has(entry.name));
      }
      return fs.readdir(...args);
    }) as typeof fs.readdir,
  };
});
vi.mock("../../adapters/plugin-loader.js", () => ({ buildExternalAdapters: async () => [] }));
const harnessGate = vi.hoisted(() => ({ beforeCreate: null as null | (() => Promise<void>) }));
vi.mock("../issues.js", async original => {
  const actual = await original<typeof import("../issues.js")>();
  return { ...actual, issueService: (...args: Parameters<typeof actual.issueService>) => {
    const service = actual.issueService(...args);
    return { ...service, create: async (...input: Parameters<typeof service.create>) => {
      // Only pause scheduling; the real issue transaction and database remain
      // intact so PostgreSQL observes the production lock order.
      await harnessGate.beforeCreate?.();
      return service.create(...input);
    } };
  } };
});
const processBoundary = vi.hoisted(() => ({ inputs: [] as string[], calls: 0, ordinaryCalls: 0, ordinaryAllowed: false, hold: false, releasePath: null as string | null, notifySpawn: null as null | (() => void) }));
const privateCaseWork = ownedCaseWorkScope();
let privateCaseResources: { releases: Promise<void>[]; restore: Array<() => void> } | null = null;
function runOwnedPrivateCase(body: () => Promise<void>) {
  return privateCaseWork.run(async () => {
    const resources = { releases: [] as Promise<void>[], restore: [] as Array<() => void> };
    privateCaseResources = resources;
    privateCaseWork.current().finally(async () => {
      // Body/child promises have settled, including late gates. Do not restore
      // shared fixture state until the actual controller work also stops.
      if (heartbeat && db) await drainHeartbeatRunsToQuiescence(db, heartbeat);
      const releases = await Promise.allSettled(resources.releases);
      const failure = releases.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      for (const restore of resources.restore) restore();
    });
    await body();
  });
}
function privateCaseSignal() { return privateCaseWork.current().signal(); }
function trackPrivateCase<T>(work: Promise<T>) { return privateCaseWork.current().track(work); }
function restorePrivateCase(restore: () => void) {
  if (!privateCaseResources) throw Error("Private fixture restoration registered outside its owned case");
  privateCaseResources.restore.push(restore);
}
function holdPrivateFixtureChild() {
  if (!privateCaseResources) throw Error("Private child registered outside its owned case");
  const ownedReleasePath = join(home, `release-${randomUUID()}`);
  const closing = privateCaseSignal(), ready = privateCaseSignal();
  // Normal bodies release this real file in finally. If Vitest stops waiting,
  // close opens the signal BEFORE joining this release task and the body.
  privateCaseResources.releases.push(trackPrivateCase(closing.promise.then(() => writeFile(ownedReleasePath, "release"))));
  processBoundary.hold = true; processBoundary.releasePath = ownedReleasePath; processBoundary.notifySpawn = ready.resolve;
  restorePrivateCase(() => {
    if (processBoundary.releasePath === ownedReleasePath) {
      processBoundary.hold = false; processBoundary.releasePath = null; processBoundary.notifySpawn = null;
    }
  });
  return { ownedReleasePath, spawned: ready.promise };
}
beforeEach(() => privateCaseWork.assertIdle());
afterEach(async () => { await privateCaseWork.drain(); privateCaseResources = null; });
vi.mock("@paperclipai/adapter-utils/execution-target", async original => {
  const actual = await original<typeof import("@paperclipai/adapter-utils/execution-target")>();
  return { ...actual, runAdapterExecutionTargetProcess: async (runId: string, target: unknown, command: string, args: string[], options: any) => {
    if (!args.includes("--bare")) {
      if (!processBoundary.ordinaryAllowed || command !== "claude" || (target as { kind?: string })?.kind !== "local" ||
        !options.requireSpawnReceipt || args.includes("--resume") || options.env.ANTHROPIC_API_KEY !== "fixture-not-a-real-key") throw Error("Unexpected ordinary provider boundary; real CLI forbidden");
      processBoundary.ordinaryCalls++;
      const script = `let body='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>body+=d);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({type:'result',subtype:'success',session_id:'11111111-1111-4111-8111-111111111111',result:body,is_error:false,usage:{input_tokens:1,output_tokens:1},total_cost_usd:0})+'\\n'));`;
      // Actual adapter target wrapper + strict spawn receipt, only an inert Node child.
      return actual.runAdapterExecutionTargetProcess(runId, null, process.execPath, ["-e", script], options);
    }
    if (command !== "claude" || target !== null || !args.includes("--bare") || options.inheritEnv !== false ||
        Object.keys(options.env).some(key => !["HOME", "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY"].includes(key)) ||
        options.env.ANTHROPIC_API_KEY !== "fixture-not-a-real-key") throw Error("Unexpected process boundary; real CLI forbidden");
    processBoundary.calls++; processBoundary.inputs.push(options.stdin);
    const model = args[args.indexOf("--model") + 1];
    const costUsd = model === "claude-haiku-4-5" ? 0.00125 : 0.0025;
    const { runChildProcess } = await import("@paperclipai/adapter-utils/server-utils");
    // The only provider-boundary process is this no-network Node fixture. It
    // echoes stdin to test leak protection, but never launches any CLI/account.
    return runChildProcess(runId, process.execPath, ["-e", `
      let body='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>body+=chunk);
      process.stdin.on('end',()=>{const finish=()=>{process.stderr.write(body);process.stdout.write(JSON.stringify({type:'result',subtype:'success',result:body,is_error:false,total_cost_usd:${costUsd},modelUsage:{[${JSON.stringify(model)}]:{inputTokens:1,cacheReadInputTokens:0,cacheCreationInputTokens:0,outputTokens:1,costUSD:${costUsd}}},usage:{input_tokens:1,output_tokens:1}})+'\\n');};if(${processBoundary.hold}){const release=${JSON.stringify(processBoundary.releasePath)};const timer=setInterval(()=>{if(release&&require('node:fs').existsSync(release)){clearInterval(timer);finish();}},20);return;}finish();});
    `], { ...options, timeoutSec: 10, graceSec: 1, onSpawn: async (meta: unknown) => { await options.onSpawn(meta); processBoundary.notifySpawn?.(); } });
  } };
});
import { getServerAdapter, privatePromptTestImplementation, registerServerAdapter } from "../../adapters/registry.js";
import { privatePromptHttpFixture } from "./http-fixture.js";
import { snapshotFile } from "../skill-snapshot.js";
import { companySkillService } from "../company-skills.js";
import { runtimeSkillCacheRoot } from "../runtime-skill-cache.js";
import { resolvePaperclipInstanceRoot } from "../../home-paths.js";
import { protectNewPrivatePath } from "@paperclipai/shared/private-filesystem-permissions";
import * as issueModule from "../issues.js";
import { assertPrivatePromptEarlyBinding, privatePromptTestService as rawPrivatePromptTestService } from "./service.js";
import { privateConfigDigest, privatePromptHash } from "./profile.js";
import { promptRegistryService } from "../mimouse-prompt-registry/service.js";
import { secretService } from "../secrets.js";
import { heartbeatService } from "../heartbeat.js";
import { drainHeartbeatRunsToQuiescence } from "../../__tests__/helpers/drain-heartbeat-runs.js";

// Legacy scenario helper now explicitly performs the two separate authorized steps.
// Production exposes no one-step dispatch API.
function privatePromptTestService(...args: Parameters<typeof rawPrivatePromptTestService>) {
  const service = rawPrivatePromptTestService(...args);
  return { ...service, create: async (identity: Parameters<typeof service.prepare>[0], prompt: string, raw: any) => {
    const { confirmRestrictedProfile, confirmExecution, confirmPossibleCharges, ...preparation } = raw;
    const ticket = await service.prepare(identity, prompt, preparation);
    return service.execute(identity, prompt, ticket.item.id, { approvalDigest: ticket.item.approvalDigest,
      executionProfile: raw.executionProfile, confirmRestrictedProfile, confirmExecution, confirmPossibleCharges });
  } };
}
let pgLog: string;
function recordPg(message: unknown) { appendFileSync(pgLog, `${String(message)}\n`); }
let db: Db, pg: { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> }, home: string, dataDir: string, pid: number;
let actor: { companyId: string; userId: string; sessionId: string };
let input: any, promptId: string, heartbeat: ReturnType<typeof heartbeatService>;
const marker = "PRIVATE_PROMPT_LEAK_SENTINEL_9c4d73b1";
const literal = "  PRIVATE_PROMPT_LEAK_SENTINEL_9c4d73b1 私有原文🧪\r\n{{agent.name}}\n<script>inert</script>  ";
const checkpointTag = "0357_deep_nehzno";
// Resolve alongside the imported executor, including linked-worktree installs.
const migrationsRoot = new URL("./migrations/", pathToFileURL(createRequire(import.meta.url).resolve("@paperclipai/db/client")));
async function verifyMigrationCheckpointAndUpgrade(connectionString: string) {
  const journalPath = fileURLToPath(new URL("meta/_journal.json", migrationsRoot));
  const fullJournalText = await readFile(journalPath, "utf8");
  const fullJournal = JSON.parse(fullJournalText) as { entries: Array<{ tag: string }> };
  const checkpointIndex = fullJournal.entries.findIndex(entry => entry.tag === checkpointTag);
  expect(checkpointIndex).toBeGreaterThanOrEqual(0);
  expect(fullJournal.entries.filter(entry => entry.tag === checkpointTag)).toHaveLength(1);
  const entries = fullJournal.entries.slice(0, checkpointIndex + 1);
  const historicalFiles = entries.map(entry => `${entry.tag}.sql`).sort();
  const allFiles = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith(".sql")).map(entry => entry.name).sort();
  expect(allFiles).toEqual(fullJournal.entries.map(entry => `${entry.tag}.sql`).sort());
  recordPg(`migration historical checkpoint: ${checkpointTag}; ${historicalFiles.length}/${allFiles.length} catalog files, not the current full chain`);
  migrationCatalog.checkpoint = { directory: resolve(fileURLToPath(migrationsRoot)), journalPath,
    journal: JSON.stringify({ ...fullJournal, entries }), files: new Set(historicalFiles) };
  try {
    await applyPendingMigrations(connectionString);
    const historical = await inspectMigrations(connectionString);
    expect(historical.status).toBe("upToDate");
    expect([...historical.availableMigrations].sort()).toEqual(historicalFiles);
    expect([...historical.appliedMigrations].sort()).toEqual(historicalFiles);
    await verifyHistoricalMigrationAtomicity(connectionString);
  } finally {
    // Also restore discovery on a failed assertion, before fixture teardown.
    migrationCatalog.checkpoint = null;
  }
  expect(await readFile(journalPath, "utf8")).toBe(fullJournalText);
  const upgrade = await inspectMigrations(connectionString);
  const laterFiles = allFiles.filter(file => !historicalFiles.includes(file));
  expect([...upgrade.availableMigrations].sort()).toEqual(allFiles);
  expect(upgrade.status).toBe(laterFiles.length ? "needsMigrations" : "upToDate");
  if (upgrade.status === "needsMigrations") expect([...upgrade.pendingMigrations].sort()).toEqual(laterFiles);
  await applyPendingMigrations(connectionString);
  const current = await inspectMigrations(connectionString);
  expect(current.status).toBe("upToDate");
  expect([...current.availableMigrations].sort()).toEqual(allFiles);
  expect([...current.appliedMigrations].sort()).toEqual(allFiles);
  expect(current.journalEntryCount).toBe(allFiles.length);
  recordPg(`migration full catalog restored: applied ${laterFiles.join(", ") || "no later files"}; all ${allFiles.length} migrations current before service scenarios`);
}
/** Only the just-created, marked, empty owned database may exercise this rollback.
 * Never accepts an arbitrary database or drops objects with CASCADE. */
async function verifyHistoricalMigrationAtomicity(connectionString: string) {
  const fileName = `${checkpointTag}.sql`;
  const markerValue = await readFile(join(home, ".private-prompt-test-fixture"), "utf8");
  const directory = await db.execute(sql`show data_directory`);
  if (markerValue !== "paperclip-private-prompt-disposable-v1" || resolve(String(directory[0].data_directory)) !== resolve(dataDir)) {
    throw Error("Refusing migration rollback outside the owned fixture");
  }
  expect(migrationCatalog.checkpoint).not.toBeNull();
  const journal = JSON.parse(await readFile(new URL("meta/_journal.json", migrationsRoot), "utf8"));
  expect(journal.entries.at(-1)?.tag).toBe(checkpointTag);
  const migration = await readFile(new URL(fileName, migrationsRoot), "utf8");
  const hash = createHash("sha256").update(migration).digest("hex");
  expect(await db.select().from(tests)).toHaveLength(0);
  expect(await db.select().from(agentWakeupRequests)).toHaveLength(0);
  const historyBefore = await db.execute(sql`select id, hash, created_at from drizzle.__drizzle_migrations order by created_at, id`);
  const latest = historyBefore.at(-1)!;
  expect(latest.hash).toBe(hash);
  expect(historyBefore.filter(row => row.hash === hash)).toHaveLength(1);
  recordPg(`migration atomicity: reverting only owned empty ${fileName}, journal id=${latest.id}`);
  await db.transaction(async tx => {
    await tx.execute(sql`drop index public.agent_wakeup_requests_private_prompt_test_uq`);
    await tx.execute(sql`drop table public.mimouse_private_prompt_tests`);
    const deleted = await tx.execute(sql`delete from drizzle.__drizzle_migrations where id = ${latest.id} and hash = ${hash} returning id`);
    expect(deleted).toHaveLength(1);
  });
  const [fixtureCompany] = await db.insert(companies).values({ name: "Owned 0357 atomicity fixture", issuePrefix: "MAT" }).returning();
  const [fixtureAgent] = await db.insert(agents).values({ companyId: fixtureCompany.id, name: "Migration only, never executed", role: "engineer", adapterType: "process", status: "idle" }).returning();
  const key = `private-prompt-test:migration-fixture-${randomUUID()}`;
  const inserted = await db.insert(agentWakeupRequests).values(["skipped", "failed"].map(status => ({
    companyId: fixtureCompany.id, agentId: fixtureAgent.id, source: "on_demand", status, idempotencyKey: key,
    reason: "owned_migration_duplicate_fixture",
  }))).returning();
  const pending = await inspectMigrations(connectionString);
  expect(pending.status).toBe("needsMigrations");
  if (pending.status !== "needsMigrations") throw Error("0357 unexpectedly skipped before failure test");
  expect(pending.pendingMigrations).toEqual([fileName]);
  await expect(applyPendingMigrations(connectionString)).rejects.toMatchObject({ code: "23505" });
  const objectsAfterFailure = await db.execute(sql`select to_regclass('public.mimouse_private_prompt_tests') as private_table,
    to_regclass('public.agent_wakeup_requests_private_prompt_test_uq') as wake_index`);
  expect(objectsAfterFailure[0]).toMatchObject({ private_table: null, wake_index: null });
  const historyAfter = await db.execute(sql`select id, hash, created_at from drizzle.__drizzle_migrations order by created_at, id`);
  expect([...historyAfter]).toEqual([...historyBefore].filter(row => row.id !== latest.id));
  expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, fixtureCompany.id)).orderBy(agentWakeupRequests.id))
    .toEqual([...inserted].sort((a, b) => a.id.localeCompare(b.id)));
  const reconciled = await reconcilePendingMigrationHistory(connectionString);
  expect(reconciled.repairedMigrations).toEqual([]); expect(reconciled.remainingMigrations).toEqual([fileName]);
  expect((await db.execute(sql`select count(*)::int as count from drizzle.__drizzle_migrations where hash = ${hash}`))[0].count).toBe(0);
  recordPg("migration atomicity: duplicate fence failed with 23505; whole file and journal rolled back; fixture rows retained");
  // Remove only this test's two rows and their exact fixture parents. No broad cleanup.
  for (const row of inserted) await db.delete(agentWakeupRequests).where(and(eq(agentWakeupRequests.id, row.id), eq(agentWakeupRequests.companyId, fixtureCompany.id)));
  await db.delete(agents).where(and(eq(agents.id, fixtureAgent.id), eq(agents.companyId, fixtureCompany.id)));
  await db.delete(companies).where(eq(companies.id, fixtureCompany.id));
  await applyPendingMigrations(connectionString);
  expect((await inspectMigrations(connectionString)).status).toBe("upToDate");
  expect((await db.execute(sql`select count(*)::int as count from drizzle.__drizzle_migrations where hash = ${hash}`))[0].count).toBe(1);
  recordPg("migration atomicity: exact duplicate fixtures removed; real 0357 reapplied and journaled once");
}
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "paperclip-private-prompt-home-"));
  protectNewPrivatePath(home);
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
  const { default: EmbeddedPostgres } = await loadWithoutEmbeddedPostgresExitHooks(loadEmbeddedPostgres);
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
  db = createDb(connectionString);
  const directory = await db.execute(sql`show data_directory`);
  if (resolve(String(directory[0].data_directory)) !== resolve(dataDir)) throw Error("Owned database mismatch");
  await verifyMigrationCheckpointAndUpgrade(connectionString);
  // Historical 0357 rollback was checked before any later objects existed;
  // service scenarios now use the complete, current normal migration chain.
  // Never execute the historical SQL review proposal as fixture-only DDL.
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
  // A failed bounded drain keeps its raw bodies/resources owned. Never close
  // their database or restore their environment underneath still-live work.
  await privateCaseWork.drain();
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
  } finally {
    if (safeCleanup) {
      vi.unstubAllEnvs(); vi.unstubAllGlobals();
      if (home) await rm(home, { recursive: true, force: true });
    }
  }
}, 60000);
it("installs the real 0357 all-status unique fence and enforced private status constraint", async () => {
  const indexes = await db.execute(sql`select i.indisunique, i.indisvalid, i.indisready, pg_get_expr(i.indpred, i.indrelid) as predicate
    from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'agent_wakeup_requests_private_prompt_test_uq'`);
  expect(indexes).toHaveLength(1);
  expect(indexes[0]).toMatchObject({ indisunique: true, indisvalid: true, indisready: true });
  expect(String(indexes[0].predicate)).toContain("private-prompt-test:%"); expect(String(indexes[0].predicate)).not.toContain("status");
  const constraints = await db.execute(sql`select convalidated, pg_get_constraintdef(oid) as definition from pg_constraint
    where conrelid = 'public.mimouse_private_prompt_tests'::regclass and conname = 'mimouse_private_prompt_test_state'`);
  expect(constraints).toHaveLength(1); expect(constraints[0].convalidated).toBe(true);
  expect(String(constraints[0].definition)).toContain("awaiting_confirmation");
  const id = randomUUID();
  let violation: any;
  try {
    await db.insert(tests).values({ id, companyId: actor.companyId, promptId, revisionId: input.revisionId,
      requestId: randomUUID(), requestDigest: "migration-status-fixture", revisionHash: "fixture", actorUserId: actor.userId,
      actorSessionId: actor.sessionId, agentId: input.agentId, datasetId: input.datasetId, datasetHash: "fixture", caseId: input.caseId,
      skillVersionId: input.skillVersionId, configDigest: "fixture", skillVersionHash: "fixture", secretValueHash: "fixture",
      status: "not_a_private_test_status" as never });
  } catch (error) { violation = (error as { cause?: unknown }).cause ?? error; }
  expect(violation).toMatchObject({ code: "23514", constraint_name: "mimouse_private_prompt_test_state" });
  expect(await db.select().from(tests).where(eq(tests.id, id))).toHaveLength(0);
});
it("retains missing-source evaluation history and its cache while deleting only same-company unused orphans", async () => {
  const [version] = await db.select().from(companySkillVersions).where(eq(companySkillVersions.id, input.skillVersionId));
  const [skill] = await db.select().from(companySkills).where(eq(companySkills.id, version.companySkillId));
  const cache = runtimeSkillCacheRoot(join(resolvePaperclipInstanceRoot(), "skills", actor.companyId), skill.id);
  await mkdir(cache, { recursive: true });
  await writeFile(join(cache, "history-sentinel"), "derived cache for retained history");
  const [orphan] = await db.insert(companySkills).values({ companyId: actor.companyId, key: "unused-orphan", slug: "unused-orphan", name: "Unused orphan", markdown: "Unused" }).returning();
  const [otherCompany] = await db.insert(companies).values({ name: "Unrelated retention fixture", issuePrefix: `RET${randomUUID().slice(0, 5).toUpperCase()}` }).returning();
  const [foreign] = await db.insert(companySkills).values({ companyId: otherCompany.id, key: "foreign-orphan", slug: "foreign-orphan", name: "Foreign orphan", markdown: "Foreign" }).returning();
  let failure: { code?: string; constraint_name?: string } | undefined;
  try { await companySkillService(db).list(actor.companyId); }
  catch (error) { failure = (error as { cause?: typeof failure }).cause ?? error as typeof failure; }
  expect(failure, JSON.stringify(failure ? { code: failure.code, constraint: failure.constraint_name } : null)).toBeUndefined();
  const [retained] = await db.select().from(companySkills).where(eq(companySkills.id, skill.id));
  expect(retained.metadata).toHaveProperty("missingSource.reason", "local_source_missing");
  expect(await db.select().from(companySkillVersions).where(eq(companySkillVersions.id, version.id))).toEqual([version]);
  expect(await db.select().from(mimouseEvaluationDatasets).where(eq(mimouseEvaluationDatasets.id, input.datasetId))).toHaveLength(1);
  expect(await readFile(join(cache, "history-sentinel"), "utf8")).toBe("derived cache for retained history");
  expect(await db.select().from(companySkills).where(eq(companySkills.id, orphan.id))).toEqual([]);
  expect(await db.select().from(companySkills).where(eq(companySkills.id, foreign.id))).toEqual([foreign]);
});

it("rechecks history admitted after preflight under the existing company and skill locks", async () => {
  const [skill] = await db.insert(companySkills).values({ companyId: actor.companyId, key: "late-history", slug: "late-history", name: "Late history", markdown: "Retain snapshot" }).returning();
  const [version] = await db.insert(companySkillVersions).values({ companyId: actor.companyId, companySkillId: skill.id, revisionNumber: 1,
    fileInventory: [snapshotFile("SKILL.md", "skill", Buffer.from(skill.markdown))] }).returning();
  const cache = runtimeSkillCacheRoot(join(resolvePaperclipInstanceRoot(), "skills", actor.companyId), skill.id);
  await mkdir(cache, { recursive: true }); await writeFile(join(cache, "derived"), "rebuildable");
  let inserted = false;
  const service = companySkillService(db, { beforeReconcilePersist: async (id) => {
    if (id !== skill.id || inserted) return;
    inserted = true;
    const cases = [{ id: randomUUID(), input: "Fixed late history", expected: "Fixed" }];
    await db.insert(mimouseEvaluationDatasets).values({ companyId: actor.companyId, skillId: skill.id, requestId: randomUUID(), requestDigest: "late-history",
      name: "Late history", cases, datasetHash: privateConfigDigest(cases), actorId: actor.userId });
  } });
  await service.list(actor.companyId);
  expect(inserted).toBe(true);
  const [retained] = await db.select().from(companySkills).where(eq(companySkills.id, skill.id));
  expect(retained.metadata).toHaveProperty("missingSource.reason", "local_source_missing");
  expect(await db.select().from(companySkillVersions).where(eq(companySkillVersions.id, version.id))).toEqual([version]);
  expect(await db.select().from(mimouseEvaluationDatasets).where(eq(mimouseEvaluationDatasets.skillId, skill.id))).toHaveLength(1);
  // The existing cache-lock API removes derived cache before entering SQL.
  // Late history keeps its authoritative snapshot, and may rebuild this cache.
  await expect(access(cache)).rejects.toMatchObject({ code: "ENOENT" });
});

it("creates one intent/wake, dispatches exact stdin, and reads bounded output only through private result", () => runOwnedPrivateCase(async () => {
  const service = privatePromptTestService(db, heartbeat.wakeup);
  const [first, duplicate] = await Promise.all([service.create(actor, promptId, input), service.create(actor, promptId, input)]);
  expect(first.item.id).toBe(duplicate.item.id);
  await drainHeartbeatRunsToQuiescence(db, heartbeat);
  const detail = await service.detail(actor, promptId, first.item.id);
  expect(detail.item.status, JSON.stringify({ item: detail.item, runs: await db.select({ status: heartbeatRuns.status, error: heartbeatRuns.error }).from(heartbeatRuns) })).toBe("completed");
  expect(detail.privateResult?.summary).toContain(literal);
  expect((await db.select().from(issues).where(eq(issues.id, first.item.issueId!)))[0].status).toBe("done");
  expect((await db.select().from(agents).where(eq(agents.id, input.agentId)))[0].status).toBe("idle");
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
}), 90000);
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
it("rejects runtime routing overlays before creating a paid intent", () => runOwnedPrivateCase(async () => {
  await db.update(agents).set({ runtimeConfig: { aiConnection: { connectionId: randomUUID() } } }).where(eq(agents.id, input.agentId));
  try {
    await expect(privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, { ...input, requestId: randomUUID() })).rejects.toThrow("private_prompt_runtime_overlay_unsupported");
  } finally { await db.update(agents).set({ runtimeConfig: {} }).where(eq(agents.id, input.agentId)); }
}));
it("rejects cross-company agents and mismatched fixed resource references before dispatch", async () => {
  const before = processBoundary.calls;
  const [otherCompany] = await db.insert(companies).values({ name: "Other private fixture", issuePrefix: "OPV" }).returning();
  const [otherAgent] = await db.insert(agents).values({ companyId: otherCompany.id, name: "Foreign", role: "engineer", status: "idle", adapterType: "claude_local" }).returning();
  for (const patch of [{ agentId: otherAgent.id }, { caseId: randomUUID() }, { skillVersionId: randomUUID() }, { datasetId: randomUUID() }, { revisionId: randomUUID() }]) {
    await expect(privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, { ...input, ...patch, requestId: randomUUID() })).rejects.toThrow();
  }
  expect(processBoundary.calls).toBe(before);
});
it("refuses an idempotency collision with an open or foreign-owned harness", () => runOwnedPrivateCase(async () => {
  const request = { ...input, requestId: randomUUID() };
  const original = issueModule.issueService;
  const interrupted = vi.spyOn(issueModule, "issueService").mockImplementationOnce((...args) => ({
    ...original(...args), create: async () => { throw Error("fixture interruption before harness"); },
  }));
  restorePrivateCase(() => { interrupted.mockRestore(); });
  await expect(privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, request)).rejects.toThrow("fixture interruption");
  interrupted.mockRestore();
  const [intent] = await db.select().from(tests).where(eq(tests.requestId, request.requestId));
  expect(intent.status).toBe("pending_harness");
  const [collision] = await db.insert(issues).values({ companyId: actor.companyId, title: "Not a private test", visibility: "open", status: "todo" }).returning();
  await db.insert(issueCreateIdempotencyKeys).values({ companyId: actor.companyId, issueId: collision.id, idempotencyKey: `private-prompt-test:${intent.id}` });
  await expect(privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, request)).rejects.toThrow("private_prompt_harness_binding_denied");
  expect((await db.select().from(tests).where(eq(tests.id, intent.id)))[0].issueId).toBeNull();
  expect(processBoundary.calls).toBe(1);
}));
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
it("advances two distinct private intents then an ordinary approved wake on the same idle agent", () => runOwnedPrivateCase(async () => {
  const before = processBoundary.calls;
  const ids: string[] = [];
  for (let index = 0; index < 2; index++) {
    const created = await privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, { ...input, requestId: randomUUID() });
    ids.push(created.item.id);
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    expect((await privatePromptTestService(db).detail(actor, promptId, created.item.id)).item.status).toBe("completed");
    expect((await db.select().from(issues).where(eq(issues.id, created.item.issueId!)))[0].status).toBe("done");
    expect((await db.select().from(agents).where(eq(agents.id, input.agentId)))[0].status).toBe("idle");
  }
  expect(new Set(ids).size).toBe(2); expect(processBoundary.calls).toBe(before + 2);
  const [agent] = await db.select().from(agents).where(eq(agents.id, input.agentId));
  // Separate explicit fixture authorization for an ordinary no-network process;
  // no Claude CLI, provider account, or private capability is used here.
  await db.update(agents).set({ adapterType: "process", adapterConfig: {
    command: process.execPath, args: ["-e", "process.stdout.write('ordinary fixture complete')"], cwd: home,
  } }).where(eq(agents.id, agent.id));
  try {
    const run = await heartbeat.wakeup(agent.id, { source: "on_demand", triggerDetail: "manual", reason: "fixture_approved_ordinary",
      requestedByActorType: "user", requestedByActorId: actor.userId });
    expect(run).not.toBeNull();
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    const [ordinary] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run!.id));
    expect(ordinary.status, ordinary.error ?? "ordinary successor").toBe("succeeded");
    expect((await db.select().from(agents).where(eq(agents.id, agent.id)))[0].status).toBe("idle");
  } finally {
    await db.update(agents).set({ adapterType: agent.adapterType, adapterConfig: agent.adapterConfig }).where(eq(agents.id, agent.id));
  }
}));
it("drains an ordinary approved wake already queued behind a running private child", () => runOwnedPrivateCase(async () => {
  const { ownedReleasePath, spawned } = holdPrivateFixtureChild();
  const [agent] = await db.select().from(agents).where(eq(agents.id, input.agentId));
  try {
    await db.update(agents).set({ runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } } }).where(eq(agents.id, agent.id));
    const created = await privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, { ...input, requestId: randomUUID() });
    await spawned;
    // The private provider process has already spawned under its approved profile.
    // The operator now approves a different ordinary local fixture configuration.
    await db.update(agents).set({ adapterType: "process", adapterConfig: {
      command: process.execPath, args: ["-e", "process.stdout.write('queued ordinary fixture complete')"], cwd: home,
    } }).where(eq(agents.id, agent.id));
    const successor = await heartbeat.wakeup(agent.id, { source: "on_demand", triggerDetail: "manual", reason: "fixture_approved_queued",
      requestedByActorType: "user", requestedByActorId: actor.userId });
    expect(successor).not.toBeNull();
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, successor!.id)))[0].status).toBe("queued");
    await writeFile(ownedReleasePath, "release");
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    expect((await privatePromptTestService(db).detail(actor, promptId, created.item.id)).item.status).toBe("completed");
    expect((await db.select().from(issues).where(eq(issues.id, created.item.issueId!)))[0].status).toBe("done");
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, successor!.id)))[0].status).toBe("succeeded");
    expect((await db.select().from(agents).where(eq(agents.id, agent.id)))[0].status).toBe("idle");
  } finally {
    await writeFile(ownedReleasePath, "release");
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    const unfinished = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
      eq(heartbeatRuns.companyId, actor.companyId), eq(heartbeatRuns.agentId, agent.id),
      sql`${heartbeatRuns.status} in ('queued', 'running')`,
    )).limit(1);
    if (unfinished.length) throw Error("Owned ordinary wake still has an unfinished run after cleanup drain");
    processBoundary.hold = false; processBoundary.releasePath = null; processBoundary.notifySpawn = null;
    await db.update(agents).set({ adapterType: agent.adapterType, adapterConfig: agent.adapterConfig, runtimeConfig: agent.runtimeConfig }).where(eq(agents.id, agent.id));
  }
}));
it.each(["cancelled", "reassigned"])("does not overwrite a user %s harness while its child finishes", change => runOwnedPrivateCase(async () => {
  const { ownedReleasePath, spawned } = holdPrivateFixtureChild();
  try {
    const created = await privatePromptTestService(db, heartbeat.wakeup).create(actor, promptId, { ...input, requestId: randomUUID() });
    await spawned;
    let replacementId: string | null = null;
    if (change === "reassigned") {
      const [replacement] = await db.insert(agents).values({ companyId: actor.companyId, name: "Replacement fixture", role: "engineer", adapterType: "process", status: "idle" }).returning();
      replacementId = replacement.id;
    }
    await issueModule.issueService(db).update(created.item.issueId!, {
      ...(change === "cancelled" ? { status: "cancelled" } : { assigneeAgentId: replacementId }),
      companyGuard: actor.companyId, actorUserId: actor.userId,
    });
    await writeFile(ownedReleasePath, "release");
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    const [issue] = await db.select().from(issues).where(eq(issues.id, created.item.issueId!));
    expect(issue.status).not.toBe("done");
    if (change === "cancelled") expect(issue.status).toBe("cancelled");
    else expect(issue.assigneeAgentId).toBe(replacementId);
    expect((await db.select().from(agents).where(eq(agents.id, input.agentId)))[0].status).toBe("idle");
  } finally {
    await writeFile(ownedReleasePath, "release");
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    processBoundary.hold = false; processBoundary.releasePath = null; processBoundary.notifySpawn = null;
  }
}));
it("rejects changed local source, disabled targets, and env/config overlays without dispatch", () => runOwnedPrivateCase(async () => {
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
}));
it("fails closed when the prepared witness cannot persist and never replays that attempt", () => runOwnedPrivateCase(async () => {
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
}));
it("keeps a spawned-but-unpersisted receipt unknown and refuses another attempt", () => runOwnedPrivateCase(async () => {
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
}));
it("cancels a real fixture child and never replays the cancelled provider-unknown attempt", () => runOwnedPrivateCase(async () => {
  const before = processBoundary.calls;
  const { ownedReleasePath, spawned } = holdPrivateFixtureChild();
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
    await writeFile(ownedReleasePath, "release");
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    processBoundary.hold = false; processBoundary.releasePath = null; processBoundary.notifySpawn = null;
    await db.update(agents).set({ status: "idle" }).where(eq(agents.id, input.agentId));
  }
}));
it("reconciles a persisted spawned receipt after terminal run recovery without replay", () => runOwnedPrivateCase(async () => {
  const [row] = await db.select().from(tests).where(eq(tests.requestId, input.requestId));
  const before = processBoundary.calls;
  // Model the durable crash window after spawned, before private completion.
  await db.update(tests).set({ status: "spawned", privateResult: null }).where(eq(tests.id, row.id));
  await db.update(heartbeatRuns).set({ status: "failed", error: "fixture_restart_recovery" }).where(eq(heartbeatRuns.id, row.heartbeatRunId!));
  const freshService = privatePromptTestService(db, heartbeatService(db, { runtimeEnv: {} }).wakeup);
  expect((await freshService.list(actor, promptId)).items.find(item => item.id === row.id)?.status).toBe("unknown");
  await freshService.create(actor, promptId, input);
  expect(processBoundary.calls).toBe(before);
}));
it("protects private bindings when disabled while leaving an ordinary migrated issue unbound", () => runOwnedPrivateCase(async () => {
  const [ordinary] = await db.insert(issues).values({ companyId: actor.companyId, title: "Ordinary historical issue", visibility: "open" }).returning();
  const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.agentId, input.agentId));
  vi.stubEnv("PAPERCLIP_PRIVATE_PROMPT_TESTS_ENABLED", "false");
  try {
    expect(await assertPrivatePromptEarlyBinding(db, run, ordinary.id)).toBeNull();
    const [privateRun] = await db.select().from(tests).where(eq(tests.requestId, input.requestId));
    await expect(heartbeat.wakeup(input.agentId, { contextSnapshot: { issueId: privateRun.issueId } })).rejects.toThrow("private_prompt_generic_wake_denied");
    expect((await privatePromptTestService(db).detail(actor, promptId, privateRun.id)).item.id).toBe(privateRun.id);
  } finally { vi.stubEnv("PAPERCLIP_PRIVATE_PROMPT_TESTS_ENABLED", "true"); }
}));
function preparationInput(requestId = randomUUID()) {
  const { confirmRestrictedProfile, confirmExecution, confirmPossibleCharges, ...preparation } = input;
  return { ...preparation, requestId };
}
function confirmation(approvalDigest: string) {
  return { approvalDigest, executionProfile: "claude_cli_bare_api_key_v1" as const,
    confirmRestrictedProfile: true as const, confirmExecution: true as const, confirmPossibleCharges: true as const };
}
/** Scheduling instrumentation only: all builders, SQL, rows, transactions,
 * authorization and provider-boundary processes execute unchanged. */
function scheduledPrivateDb(options: {
  afterTransaction?: (result: any) => Promise<void>;
  afterLock?: (table: unknown, strength: string, rows: any[]) => Promise<void>;
  errors: string[];
}): Db {
  const builder = (query: any, table?: unknown, strength?: string): any => new Proxy(query, {
    get(target, key) {
      if (key === "then") return (accept: any, reject: any) => Promise.resolve(target).then(async rows => {
        if (strength && options.afterLock) await options.afterLock(table, strength, rows as any[]);
        return rows;
      }).then(accept, reject);
      const value = Reflect.get(target, key);
      if (typeof value !== "function") return value;
      return (...args: any[]) => {
        const result = value.apply(target, args);
        return result && typeof result === "object" ? builder(result, key === "from" ? args[0] : table,
          key === "for" ? args[0] : strength) : result;
      };
    },
  });
  return new Proxy(db, {
    get(target, key) {
      if (key === "transaction") return async (callback: any, config: any) => {
        try {
          const result = await target.transaction(tx => callback(new Proxy(tx, {
            get(transaction, property) {
              if (property === "select") return (...args: any[]) => builder((transaction.select as any)(...args));
              const value = Reflect.get(transaction, property);
              return typeof value === "function" ? value.bind(transaction) : value;
            },
          })), config);
          await options.afterTransaction?.(result);
          return result;
        } catch (error) {
          let cause: any = error;
          while (cause) { if (typeof cause.code === "string") options.errors.push(cause.code); cause = cause.cause; }
          throw error;
        }
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
it.each(["queue", "early_binding", "claim", "prepare", "completion"])("orders stale harness retries against the real private %s transaction", phase => runOwnedPrivateCase(async () => {
  const before = processBoundary.calls;
  const errors: string[] = [];
  let wakeArgs: Parameters<typeof heartbeat.wakeup> | undefined;
  const service = rawPrivatePromptTestService(db, async (...args) => { wakeArgs = args; return null; });
  const ticket = await service.prepare(actor, promptId, preparationInput());
  const admitted = await service.execute(actor, promptId, ticket.item.id, confirmation(ticket.item.approvalDigest));
  expect(admitted.item.status).toBe("pending_wake"); expect(wakeArgs).toBeDefined();
  let snapshotReached = false, workerReached = false, duplicateSettled = false;
  const { promise: snapshotGate, resolve: releaseSnapshot } = privateCaseSignal();
  const { promise: workerGate, resolve: releaseWorker } = privateCaseSignal();
  let firstTransaction = true;
  const duplicateDb = scheduledPrivateDb({ errors, afterTransaction: async () => {
    if (!firstTransaction) return;
    firstTransaction = false; snapshotReached = true; await snapshotGate;
  } });
  const workerDb = scheduledPrivateDb({ errors, afterLock: async (table, strength, rows) => {
    if (workerReached || !rows.length) return;
    const row = rows[0];
    const selected = phase === "completion"
      ? table === issues && strength === "update" && row.id === admitted.item.issueId && processBoundary.calls > before
      : table === tests && row.id === ticket.item.id && (
        phase === "queue" ? strength === "update" && row.status === "pending_wake"
        : phase === "early_binding" ? strength === "share" && row.status === "queued"
        : strength === "update" && row.status === "queued" && (phase === "prepare" ? Boolean(row.attemptId) : !row.attemptId));
    if (selected) { workerReached = true; await workerGate; }
  } });
  const worker = heartbeatService(workerDb, { runtimeEnv: {} });
  const duplicate = trackPrivateCase(rawPrivatePromptTestService(duplicateDb, async () => null)
    .execute(actor, promptId, ticket.item.id, confirmation(ticket.item.approvalDigest)));
  const duplicateOutcome = duplicate.then(value => { duplicateSettled = true; return { value }; }, error => { duplicateSettled = true; return { error }; });
  let waking: Promise<unknown> | undefined;
  try {
    await vi.waitFor(() => expect(snapshotReached).toBe(true), { timeout: 10000 });
    // The request really read pending_wake before queueing. Resume it only
    // after the real worker/queue holds its production row lock.
    waking = trackPrivateCase(worker.wakeup(...wakeArgs!));
    waking.catch(() => {});
    await vi.waitFor(() => expect(workerReached).toBe(true), { timeout: 20000 });
    releaseSnapshot();
    await vi.waitFor(async () => {
      const waiting = await db.execute(sql`select query from pg_stat_activity where datname = current_database()
        and wait_event_type = 'Lock' and pid <> pg_backend_pid()`);
      expect(duplicateSettled).toBe(false);
      expect(waiting.some(row => /(?:companies|mimouse_private_prompt_tests)/.test(String(row.query)))).toBe(true);
    }, { timeout: 10000 });
    releaseWorker();
    const result = await duplicateOutcome;
    expect("error" in result ? result.error : null).toBeNull();
    await waking;
    await drainHeartbeatRunsToQuiescence(workerDb, worker);
    const completed = await service.detail(actor, promptId, ticket.item.id);
    expect(errors).not.toContain("40P01");
    expect(completed.item.status).toBe("completed");
    expect(processBoundary.calls).toBe(before + 1);
    expect(await db.select().from(issues).where(eq(issues.originId, ticket.item.id))).toHaveLength(1);
    expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.idempotencyKey, `private-prompt-test:${ticket.item.id}`))).toHaveLength(1);
    expect((await db.select().from(issues).where(eq(issues.id, admitted.item.issueId!)))[0].status).toBe("done");
    console.log(`private lock regression ${phase}: completed once; PostgreSQL deadlock codes=${JSON.stringify(errors)}`);
  } finally {
    releaseSnapshot(); releaseWorker();
    await duplicateOutcome;
    await waking?.catch(() => {});
    await drainHeartbeatRunsToQuiescence(workerDb, worker);
  }
}), 45000);
it("orders company and intent locks when a duplicate confirmation overlaps harness creation", () => runOwnedPrivateCase(async () => {
  const before = processBoundary.calls;
  const service = rawPrivatePromptTestService(db, async () => null);
  const ticket = await service.prepare(actor, promptId, preparationInput());
  const { promise: reached, resolve: entered } = privateCaseSignal();
  const { promise: gate, resolve: release } = privateCaseSignal();
  harnessGate.beforeCreate = async () => { harnessGate.beforeCreate = null; entered(); await gate; };
  const ownedHarnessHook = harnessGate.beforeCreate;
  restorePrivateCase(() => { if (harnessGate.beforeCreate === ownedHarnessHook) harnessGate.beforeCreate = null; });
  const first = trackPrivateCase(service.execute(actor, promptId, ticket.item.id, confirmation(ticket.item.approvalDigest)));
  let second: typeof first | undefined;
  try {
    await reached;
    second = trackPrivateCase(service.execute(actor, promptId, ticket.item.id, confirmation(ticket.item.approvalDigest)));
    await vi.waitFor(async () => {
      const waiting = await db.execute(sql`select query from pg_stat_activity where datname = current_database()
        and wait_event_type = 'Lock' and pid <> pg_backend_pid()`);
      expect(waiting.some(row => /(?:companies|mimouse_private_prompt_tests)/.test(String(row.query)))).toBe(true);
    }, { timeout: 10000 });
    release();
    const results = await Promise.all([first, second]);
    expect(results.map(result => result.item.id)).toEqual([ticket.item.id, ticket.item.id]);
    expect(new Set(results.map(result => result.item.issueId)).size).toBe(1);
    expect(results[0].item.issueId).not.toBeNull();
    expect(await db.select().from(issues).where(eq(issues.originId, ticket.item.id))).toHaveLength(1);
    expect(processBoundary.calls).toBe(before);
  } finally {
    harnessGate.beforeCreate = null;
    release();
    await Promise.allSettled(second ? [first, second] : [first]);
  }
}), 30000);
it("prepares metadata only and never resumes an existing ticket even after admission", async () => {
  const before = processBoundary.calls, wake = vi.fn(async () => null), service = rawPrivatePromptTestService(db, wake);
  const preparation = preparationInput();
  const [first, repeated] = await Promise.all([service.prepare(actor, promptId, preparation), service.prepare(actor, promptId, preparation)]);
  expect(first.item.id).toBe(repeated.item.id); expect(first.item.status).toBe("awaiting_confirmation");
  expect(first.item.requestId).toBe(preparation.requestId); expect(first.item.companyId).toBe(actor.companyId);
  expect(first.item.actorUserId).toBe(actor.userId); expect(first.item.headReceiptId).toBe(preparation.expectedHeadReceiptId);
  expect(first.item.issueId).toBeNull(); expect(wake).not.toHaveBeenCalled(); expect(processBoundary.calls).toBe(before);
  await expect(service.prepare(actor, promptId, input)).rejects.toThrow(); // Old combined body cannot dispatch.
  const admitted = await service.execute(actor, promptId, first.item.id, confirmation(first.item.approvalDigest));
  expect(admitted.item.status).toBe("pending_wake"); expect(wake).toHaveBeenCalledTimes(1);
  const after = await service.prepare(actor, promptId, preparation);
  expect(after.item.status).toBe("pending_wake"); expect(after.item.approvalDigest).toBe(first.item.approvalDigest);
  expect(wake).toHaveBeenCalledTimes(1); expect(processBoundary.calls).toBe(before);
});
it("rejects configuration drift and revoked authorization between prepare and execute", () => runOwnedPrivateCase(async () => {
  const service = rawPrivatePromptTestService(db, heartbeat.wakeup), before = processBoundary.calls;
  const ticket = await service.prepare(actor, promptId, preparationInput());
  const [agent] = await db.select().from(agents).where(eq(agents.id, input.agentId));
  try {
    await db.update(agents).set({ adapterConfig: { ...agent.adapterConfig, model: "claude-changed" } }).where(eq(agents.id, agent.id));
    await expect(service.execute(actor, promptId, ticket.item.id, confirmation(ticket.item.approvalDigest))).rejects.toThrow("private_prompt_approval_snapshot_changed");
    const frozen = (await service.detail(actor, promptId, ticket.item.id)).item;
    expect(frozen.approvalDigest).toBe(ticket.item.approvalDigest);
    expect(frozen.approvalSnapshot?.model).toBe(agent.adapterConfig.model);
    await db.update(agents).set({ adapterConfig: agent.adapterConfig }).where(eq(agents.id, agent.id));
    await db.update(companyMemberships).set({ status: "suspended" }).where(and(eq(companyMemberships.companyId, actor.companyId), eq(companyMemberships.principalId, actor.userId)));
    await expect(service.execute(actor, promptId, ticket.item.id, confirmation(ticket.item.approvalDigest))).rejects.toThrow("private_prompt_active_session_administrator_required");
  } finally {
    await db.update(agents).set({ adapterConfig: agent.adapterConfig }).where(eq(agents.id, agent.id));
    await db.update(companyMemberships).set({ status: "active" }).where(and(eq(companyMemberships.companyId, actor.companyId), eq(companyMemberships.principalId, actor.userId)));
  }
  const cancelled = await service.cancel(actor, promptId, ticket.item.id, { approvalDigest: ticket.item.approvalDigest });
  expect(cancelled.item.status).toBe("cancelled");
  expect((await service.execute(actor, promptId, ticket.item.id, confirmation(ticket.item.approvalDigest))).item.status).toBe("cancelled");
  expect(processBoundary.calls).toBe(before);
}));
it("serializes execute/cancel and keeps late execute and terminal replay on the same ticket", () => runOwnedPrivateCase(async () => {
  const service = rawPrivatePromptTestService(db, heartbeat.wakeup), before = processBoundary.calls;
  const ticket = await service.prepare(actor, promptId, preparationInput());
  await expect(service.execute(actor, promptId, ticket.item.id, confirmation("0".repeat(64)))).rejects.toThrow("private_prompt_approval_changed");
  const [execution, cancellation] = await Promise.all([
    trackPrivateCase(service.execute(actor, promptId, ticket.item.id, confirmation(ticket.item.approvalDigest))),
    trackPrivateCase(service.cancel(actor, promptId, ticket.item.id, { approvalDigest: ticket.item.approvalDigest })),
  ]);
  await drainHeartbeatRunsToQuiescence(db, heartbeat);
  const resolved = await service.detail(actor, promptId, ticket.item.id);
  expect(["completed", "cancelled"]).toContain(resolved.item.status);
  expect(resolved.item.approvalDigest).toBe(ticket.item.approvalDigest);
  if (cancellation.item.status === "cancelled") expect(execution.item.status).toBe("cancelled");
  expect(processBoundary.calls - before).toBe(resolved.item.status === "completed" ? 1 : 0);
  const count = processBoundary.calls;
  expect((await service.execute(actor, promptId, ticket.item.id, confirmation(ticket.item.approvalDigest))).item.status).toBe(resolved.item.status);
  expect(processBoundary.calls).toBe(count);
}));
it("keeps persisted approval summaries immutable and fails closed on tampering or historical null", async () => {
  const service = rawPrivatePromptTestService(db, heartbeat.wakeup), before = processBoundary.calls;
  const ticket = await service.prepare(actor, promptId, preparationInput());
  expect(ticket.item.approvalSnapshot?.model).toBe("claude-sonnet-4-5");
  expect(JSON.stringify(ticket.item.approvalSnapshot)).not.toContain("fixture-not-a-real-key");
  expect(JSON.stringify(ticket.item.approvalSnapshot)).not.toContain(marker);
  await db.update(tests).set({ approvalSnapshot: { ...ticket.item.approvalSnapshot!, model: "claude-tampered" } }).where(eq(tests.id, ticket.item.id));
  await expect(service.execute(actor, promptId, ticket.item.id, confirmation(ticket.item.approvalDigest))).rejects.toThrow("private_prompt_approval_changed");
  const tampered = await service.detail(actor, promptId, ticket.item.id);
  await expect(service.execute(actor, promptId, ticket.item.id, confirmation(tampered.item.approvalDigest))).rejects.toThrow("private_prompt_approval_snapshot_changed");
  await db.update(tests).set({ approvalSnapshot: { ...ticket.item.approvalSnapshot!, leaked: marker } as never }).where(eq(tests.id, ticket.item.id));
  const malformed = await service.detail(actor, promptId, ticket.item.id);
  expect(malformed.item.approvalSnapshot).toBeNull(); expect(JSON.stringify(malformed)).not.toContain(marker);
  await db.update(tests).set({ approvalSnapshot: null }).where(eq(tests.id, ticket.item.id));
  const history = await service.detail(actor, promptId, ticket.item.id);
  expect(history.item.approvalSnapshot).toBeNull();
  await expect(service.execute(actor, promptId, ticket.item.id, confirmation(history.item.approvalDigest))).rejects.toThrow("private_prompt_approval_snapshot_missing");
  expect(processBoundary.calls).toBe(before);
});
it("explicitly resumes the same admitted ticket after an interrupted harness creation", () => runOwnedPrivateCase(async () => {
  const service = rawPrivatePromptTestService(db, heartbeat.wakeup), before = processBoundary.calls;
  const ticket = await service.prepare(actor, promptId, preparationInput());
  const original = issueModule.issueService;
  const interruption = vi.spyOn(issueModule, "issueService").mockImplementationOnce((...args) => ({
    ...original(...args), create: async () => { throw Error("fixture interrupted after admission"); },
  }));
  await expect(service.execute(actor, promptId, ticket.item.id, confirmation(ticket.item.approvalDigest))).rejects.toThrow("fixture interrupted");
  interruption.mockRestore();
  expect((await service.detail(actor, promptId, ticket.item.id)).item.status).toBe("pending_harness");
  expect(processBoundary.calls).toBe(before);
  await service.execute(actor, promptId, ticket.item.id, confirmation(ticket.item.approvalDigest));
  await drainHeartbeatRunsToQuiescence(db, heartbeat);
  const completed = await service.detail(actor, promptId, ticket.item.id);
  expect(completed.item.status).toBe("completed"); expect(completed.item.approvalDigest).toBe(ticket.item.approvalDigest);
  expect(processBoundary.calls).toBe(before + 1);
  expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.idempotencyKey, `private-prompt-test:${ticket.item.id}`))).toHaveLength(1);
}));
it("enforces the actual loopback HTTP router and error middleware without a production login claim", () => runOwnedPrivateCase(async () => {
  const owner: Express.Request["actor"] = { type: "board", source: "session", userId: actor.userId, sessionId: actor.sessionId,
    companyIds: [actor.companyId], memberships: [{ companyId: actor.companyId, membershipRole: "owner", status: "active" }] };
  const memberId = randomUUID(), memberSession = randomUUID(), now = new Date();
  await db.insert(authUsers).values({ id: memberId, name: "HTTP member fixture", email: `${memberId}@example.invalid`, createdAt: now, updatedAt: now });
  await db.insert(authSessions).values({ id: memberSession, token: randomUUID(), userId: memberId, expiresAt: new Date(Date.now() + 3600000), createdAt: now, updatedAt: now });
  await db.insert(companyMemberships).values({ companyId: actor.companyId, principalType: "user", principalId: memberId, membershipRole: "member", status: "active" });
  const http = await privatePromptHttpFixture(db, { owner, noSession: { ...owner, sessionId: null },
    member: { ...owner, userId: memberId, sessionId: memberSession, memberships: [{ companyId: actor.companyId, membershipRole: "member", status: "active" }] } });
  const path = `/api/companies/${actor.companyId}/prompt-registry/${promptId}/tests`, before = processBoundary.calls;
  try {
    for (const role of ["anonymous", "noSession", "member"]) {
      const denied = await http.call("POST", path, preparationInput(), role);
      expect(denied.status).toBe(403); expect(denied.headers["cache-control"]).toBe("no-store");
    }
    expect((await http.call("POST", path, input)).status).toBe(400);
    const preparation = preparationInput(), prepared = await http.call("POST", path, preparation);
    expect(prepared.status).toBe(201); expect(prepared.headers["cache-control"]).toBe("no-store");
    expect(prepared.body.item.status).toBe("awaiting_confirmation"); expect(prepared.body.item.requestId).toBe(preparation.requestId);
    expect(prepared.body.item.approvalSnapshot.model).toBe("claude-sonnet-4-5");
    const replay = await http.call("POST", path, preparation);
    expect(replay.status).toBe(200); expect(replay.body.item).toEqual(prepared.body.item);
    expect(processBoundary.calls).toBe(before);
    const id = prepared.body.item.id, digest = prepared.body.item.approvalDigest;
    const executed = await http.call("POST", `${path}/${id}/execute`, confirmation(digest));
    expect(executed.status).toBe(200); expect(executed.body.item.approvalDigest).toBe(digest);
    await drainHeartbeatRunsToQuiescence(db, heartbeat);
    const detail = await http.call("GET", `${path}/${id}`);
    expect(detail.status).toBe(200); expect(detail.headers["cache-control"]).toBe("no-store");
    expect(detail.body.item.status).toBe("completed"); expect(detail.body.item.requestId).toBe(preparation.requestId);
    expect((await http.call("POST", `${path}/${id}/execute`, confirmation(digest))).body.item.status).toBe("completed");
    expect(processBoundary.calls).toBe(before + 1);
    const cancelTicket = await http.call("POST", path, preparationInput());
    const cancelPath = `${path}/${cancelTicket.body.item.id}`, cancelDigest = cancelTicket.body.item.approvalDigest;
    const cancelled = await http.call("POST", `${cancelPath}/cancel`, { approvalDigest: cancelDigest });
    expect(cancelled.status).toBe(200); expect(cancelled.body.item.status).toBe("cancelled");
    expect(cancelled.body.item.approvalDigest).toBe(cancelDigest);
    expect((await http.call("POST", `${cancelPath}/execute`, confirmation(cancelDigest))).body.item.status).toBe("cancelled");
    expect(processBoundary.calls).toBe(before + 1);
  } finally { await http.close(); }
}));
it("private historical comparison is scoped, sealed and read only", async () => {
  const before = processBoundary.calls;
  const { verifyPrivateHistoricalComparison } = await import("./__tests__/comparison-db-cases.js");
  await verifyPrivateHistoricalComparison(db);
  expect(processBoundary.calls).toBe(before);
});
it("produces own-agent routing proof through private execution and central accounting, never manual cost rows", () => runOwnedPrivateCase(async () => {
  const before = processBoundary.calls;
  const { verifyProducedRuntimeRoutingEvidence } = await import("../mimouse-cost-routing/__tests__/evidence-db-cases.js");
  const produced = await verifyProducedRuntimeRoutingEvidence(db, actor, heartbeat, input.agentId, input.skillVersionId);
  expect(processBoundary.calls).toBe(before + 4);
  await mkdir(join(home, "routing-bin")); await writeFile(join(home, "routing-bin", process.platform === "win32" ? "claude.cmd" : "claude"), "#!/bin/sh\n# Hash-only fixture, never execute.\nexit 97\n", { mode: 0o700 });
  vi.stubEnv("PATH", `${join(home, "routing-bin")}${delimiter}${process.env.PATH}`);
  for (const name of Object.keys(process.env).filter(k => /^(LD_|DYLD_|NODE_OPTIONS$|NODE_PATH$|BASH_ENV$|ENV$|ANTHROPIC_AUTH_TOKEN$|ANTHROPIC_BASE_URL$|CLAUDE_CODE_OAUTH_TOKEN$|CLAUDE_CODE_USE_)/i.test(k))) vi.stubEnv(name, "");
  vi.stubEnv("PAPERCLIP_PROMPT_APPLICATIONS_ENABLED", "true"); vi.stubEnv("PAPERCLIP_RUNTIME_COST_ROUTING_ENABLED", "true");
  const { resolveDefaultAgentWorkspaceDir } = await import("../../home-paths.js");
  // Private harness preparation may have initialized the selected agent's
  // managed home. Remove only that descendant of this marked disposable fixture
  // to exercise genuine ordinary workspace initialization, never pre-mkdir it.
  const selectedHome = resolve(resolveDefaultAgentWorkspaceDir(produced[1].reference.agentId));
  const selectedRelative = relative(resolve(home), selectedHome);
  if (!selectedRelative || selectedRelative === ".." || selectedRelative.startsWith(`..${sep}`) || isAbsolute(selectedRelative) ||
      await readFile(join(home, ".private-prompt-test-fixture"), "utf8") !== "paperclip-private-prompt-disposable-v1") throw Error("Refusing non-fixture workspace cleanup");
  await rm(selectedHome, { recursive: true, force: true });
  expect(await access(selectedHome).then(() => true, () => false)).toBe(false);
  const { verifyRuntimeRoutingDispatch } = await import("../mimouse-cost-routing/__tests__/runtime-db-cases.js");
  processBoundary.ordinaryAllowed = true;
  try {
    // Each fixed approval request now owns its real quiescence/admission
    // barrier; a one-time preflight cannot promise no late work will arrive.
    await heartbeat.drainActiveRunExecutions();
    await verifyRuntimeRoutingDispatch(db, actor, heartbeat, produced, () => processBoundary.ordinaryCalls);
  }
  catch (error) {
    const runs = await db.select({ id: heartbeatRuns.id, agentId: heartbeatRuns.agentId, status: heartbeatRuns.status,
      processPid: heartbeatRuns.processPid, processGroupId: heartbeatRuns.processGroupId, processStartedAt: heartbeatRuns.processStartedAt,
      controllerLeaseExpiresAt: heartbeatRuns.controllerLeaseExpiresAt, executionStage: heartbeatRuns.executionStage }).from(heartbeatRuns);
    const { readProcessStartedAt } = await import("../hot-restart.js");
    const observations = [];
    for (const run of runs.filter(row => produced.some(item => item.reference.agentId === row.agentId))) {
      let alive = false; try { if (run.processPid) { process.kill(run.processPid, 0); alive = true; } } catch {}
      observations.push({ ...run, alive, actualStartedAt: alive ? await readProcessStartedAt(run.processPid!).catch(e => String(e)) : null });
    }
    console.error("private routing stop diagnostics", JSON.stringify(observations));
    throw error;
  }
  finally { processBoundary.ordinaryAllowed = false; }
  expect(processBoundary.calls).toBe(before + 4); expect(processBoundary.ordinaryCalls).toBe(1);
}), 180000);
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
