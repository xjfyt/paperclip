/** Test support only: no caller in production and no import-time I/O. */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import { applyPendingMigrations, authSessions, authUsers, closeRegisteredClients, companies, companyMemberships,
  companySecrets, companySecretVersions, createDb, ensurePostgresDatabase, executionWorkspaces, issues,
  loadEmbeddedPostgres, loadWithoutEmbeddedPostgresExitHooks, mimouseCodingDeliveries, projects, type Db } from "@paperclipai/db";
import { loadBuildObservationConfig, type BuildObservationProfile } from "../../services/mimouse-coding/build-observation-config.js";

const token = "fixture-gitlab-token-not-real";
const secretValue = JSON.stringify({ token });
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const exists = (file: string) => access(file).then(() => true, () => false);
const exec = promisify(execFile);
const require = createRequire(import.meta.url);
async function availablePort(): Promise<number> {
  return new Promise((accept, reject) => {
    const socket = createServer(); socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (!address || typeof address === "string") { socket.close(() => reject(Error("fixture_port_unavailable"))); return; }
      socket.close(error => error ? reject(error) : accept(address.port));
    });
  });
}
function processStopped(pid: number): boolean {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error instanceof Error && "code" in error && error.code === "ESRCH"; }
}

/** Creates a disposable real PostgreSQL/session fixture only when a permitted
 * integration test explicitly calls it. All provider credentials are inert. */
export async function createBuildObservationFixture() {
  const temporaryRoot = resolve(tmpdir());
  const home = await mkdtemp(join(temporaryRoot, "paperclip-build-observation-"));
  const marker = `build-observation-disposable-v1:${randomUUID()}`;
  const markerFile = join(home, ".owned-test"), dataDir = join(home, "db"), pidFile = join(dataDir, "postmaster.pid");
  await writeFile(markerFile, marker, { mode: 0o600, flag: "wx" });
  let db: Db | undefined, pg: Awaited<ReturnType<typeof loadEmbeddedPostgres>>["default"]["prototype"] | undefined;
  let databaseUrl: string | undefined, pid: number | undefined, startupAttempted = false, closed = false;
  async function owned() {
    if (dirname(resolve(home)) !== temporaryRoot || !basename(home).startsWith("paperclip-build-observation-")
      || await readFile(markerFile, "utf8") !== marker) {
      throw Error("fixture_ownership_unconfirmed");
    }
  }
  async function readOwnedPid() {
    const parts = (await readFile(pidFile, "utf8")).split("\n");
    const candidate = Number(parts[0]);
    if (!Number.isSafeInteger(candidate) || candidate <= 1 || resolve(parts[1] ?? "") !== resolve(dataDir)
      || (pid !== undefined && pid !== candidate)) throw Error("fixture_postgres_ownership_unconfirmed");
    pid = candidate;
  }
  async function close() {
    if (closed) return;
    await owned();
    if (await exists(pidFile)) await readOwnedPid();
    if (databaseUrl) await closeRegisteredClients(databaseUrl);
    if (startupAttempted && pg) {
      if (process.platform === "win32" && await exists(pidFile)) {
        // The wrapper uses taskkill /f on Windows, leaving postmaster.pid and
        // failing this fixture's clean-stop proof. Use its own bundled pg_ctl
        // to shut down the already verified, disposable cluster gracefully.
        const dbRequire = createRequire(require.resolve("@paperclipai/db"));
        const embeddedRequire = createRequire(dbRequire.resolve("embedded-postgres"));
        const { pg_ctl: pgCtl } = embeddedRequire("@embedded-postgres/windows-x64") as { pg_ctl: string };
        await exec(pgCtl, ["-D", dataDir, "-m", "fast", "-w", "-t", "15", "stop"], {
          timeout: 20_000, maxBuffer: 65_536, windowsHide: true,
        });
      } else await pg.stop();
    }
    if (await exists(pidFile) || (pid !== undefined && !processStopped(pid))) {
      throw Error("fixture_preserved_postgres_not_confirmed_stopped");
    }
    await owned(); await rm(home, { recursive: true, force: true }); closed = true;
  }
  try {
    await owned();
    if (await exists(join(dataDir, "PG_VERSION")) || await exists(pidFile)) throw Error("fixture_existing_postgres_refused");
    const port = await availablePort();
    const { default: EmbeddedPostgres } = await loadWithoutEmbeddedPostgresExitHooks(loadEmbeddedPostgres);
    pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "paperclip", password: "paperclip", port, persistent: true,
      initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
      postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "unix_socket_directories="],
      onLog: () => {}, onError: () => {} });
    await pg.initialise(); startupAttempted = true; await pg.start(); await readOwnedPid();
    await ensurePostgresDatabase(`postgres://paperclip:paperclip@127.0.0.1:${port}/postgres`, "paperclip");
    databaseUrl = `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
    await applyPendingMigrations(databaseUrl);
    db = createDb(databaseUrl, { maxConnections: 4, applicationName: "mimouse-build-observation-fixture" });
    const currentDb = db;
    const [directory] = await currentDb.execute<{ data_directory: string }>(sql`show data_directory`);
    if (!directory || resolve(directory.data_directory) !== resolve(dataDir)) throw Error("fixture_database_directory_mismatch");
    const actor = { companyId: randomUUID(), userId: randomUUID(), sessionId: randomUUID() };
    const issueId = randomUUID(), projectId = randomUUID(), workspaceId = randomUUID(), deliveryId = randomUUID(), secretId = randomUUID();
    const now = new Date(), headSha = "a".repeat(40), artifactBytes = Buffer.from("inert observation artifact fixture\n");
    await currentDb.insert(authUsers).values({ id: actor.userId, name: "Build observation fixture", email: `${actor.userId}@example.invalid`, createdAt: now, updatedAt: now });
    await currentDb.insert(authSessions).values({ id: actor.sessionId, userId: actor.userId, token: randomUUID(),
      expiresAt: sql`clock_timestamp() + interval '1 hour'`, createdAt: now, updatedAt: now });
    await currentDb.insert(companies).values({ id: actor.companyId, name: "Build observation fixture", issuePrefix: "BOF", defaultResponsibleUserId: actor.userId });
    await currentDb.insert(companyMemberships).values({ companyId: actor.companyId, principalType: "user", principalId: actor.userId, membershipRole: "owner", status: "active" });
    await currentDb.insert(projects).values({ id: projectId, companyId: actor.companyId, name: "Observation fixture project" });
    await mkdir(join(home, "workspace"));
    await currentDb.insert(executionWorkspaces).values({ id: workspaceId, companyId: actor.companyId, projectId,
      name: "Inert fixture workspace", mode: "isolated", strategyType: "git_worktree", cwd: join(home, "workspace"),
      repoUrl: "https://gitlab.example.test/acme/app.git", branchName: "fixture/source" });
    await currentDb.insert(issues).values({ id: issueId, companyId: actor.companyId, projectId, title: "Fixture delivery",
      executionWorkspaceId: workspaceId, createdByUserId: actor.userId, responsibleUserId: actor.userId });
    await currentDb.insert(companySecrets).values({ id: secretId, companyId: actor.companyId, key: "build-observation-fixture",
      name: "Inert build observation fixture", provider: "local_encrypted", scope: "company", status: "active", latestVersion: 1 });
    // Deliberately not usable encrypted material. Tests inject the exact inert
    // token resolver; production secret resolution cannot consume this fixture.
    await currentDb.insert(companySecretVersions).values({ secretId, version: 1, status: "current",
      material: { fixtureOnly: true }, valueSha256: digest(secretValue), fingerprintSha256: digest(secretValue) });
    await currentDb.insert(mimouseCodingDeliveries).values({ id: deliveryId, companyId: actor.companyId, issueId, workspaceId,
      gitlabOrigin: "https://gitlab.example.test", projectId: 42, secretRef: secretId, baseSha: "b".repeat(40), headSha,
      sourceBranch: "fixture/source", targetBranch: "main", pipelineId: 9,
      artifactManifest: { schemaVersion: 1, project: "42", version: "fixture-v1", commitSha: headSha, uploaded: false,
        productionReleased: false, artifacts: [{ path: "dist/app.bin", location: "dist/app.bin", fileName: "app.bin",
          platform: "linux", arch: "x86_64", buildJob: "fixture-build", testStatus: "not_run", signatureStatus: "unknown",
          sizeBytes: artifactBytes.byteLength, sha256: digest(artifactBytes) }] } });
    const profile: BuildObservationProfile = { id: "linux-fixture", companyId: actor.companyId, manifestPath: "dist/app.bin",
      subjectName: "app.bin", maxObservationAgeSeconds: 3600, provenancePolicy: null,
      observer: { schemaVersion: 1, enabled: true, companyId: actor.companyId, origin: "https://gitlab.example.test",
        allowedOrigins: ["https://gitlab.example.test"], projectId: 42, sourceUri: "git+https://gitlab.example.test/acme/app.git",
        artifactPath: "dist/app.bin", provenancePath: "provenance.json", invocationMapping: null, totalTimeoutMs: 30_000 } };
    const configFile = join(home, "operator.json");
    const loadConfig = () => loadBuildObservationConfig({ enabled: true, filePath: configFile });
    async function writeProfiles(profiles: BuildObservationProfile[]) {
      await owned(); await writeFile(configFile, JSON.stringify({ schemaVersion: 1, profiles }), { mode: 0o600 });
      return loadConfig();
    }
    const config = await writeProfiles([profile]);
    if (!config.enabled) throw Error("fixture_operator_configuration_invalid");
    const mutate = {
      session: (patch: Partial<typeof authSessions.$inferInsert>) => currentDb.update(authSessions).set(patch).where(eq(authSessions.id, actor.sessionId)),
      member: (patch: Partial<typeof companyMemberships.$inferInsert>) => currentDb.update(companyMemberships).set(patch).where(and(
        eq(companyMemberships.companyId, actor.companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, actor.userId))),
      issue: (patch: Partial<typeof issues.$inferInsert>) => currentDb.update(issues).set(patch).where(eq(issues.id, issueId)),
      delivery: (patch: Partial<typeof mimouseCodingDeliveries.$inferInsert>) => currentDb.update(mimouseCodingDeliveries).set(patch).where(eq(mimouseCodingDeliveries.id, deliveryId)),
      secret: (patch: Partial<typeof companySecrets.$inferInsert>) => currentDb.update(companySecrets).set(patch).where(eq(companySecrets.id, secretId)),
      version: (patch: Partial<typeof companySecretVersions.$inferInsert>) => currentDb.update(companySecretVersions).set(patch).where(and(
        eq(companySecretVersions.secretId, secretId), eq(companySecretVersions.version, 1))),
    };
    return { db: currentDb, actor, deliveryId, issueId, projectId, workspaceId, secretId, headSha, profile, config,
      artifactBytes, token, secretValue, configFile, loadConfig, writeProfiles, mutate, close };
  } catch (error) {
    try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "fixture_setup_failed_preserved"); }
    throw error;
  }
}
export type BuildObservationFixture = Awaited<ReturnType<typeof createBuildObservationFixture>>;
