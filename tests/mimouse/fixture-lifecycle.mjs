import { readFile, realpath, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import net from "node:net";
import path from "node:path";
import { createHash } from "node:crypto";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const same = (a, b) => process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}
async function exists(file) { try { await access(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
export async function staticUiSnapshot(directory) {
  const html = await readFile(path.join(directory, "index.html"), "utf8");
  const entryRefs = [...html.matchAll(/\b(?:src|href)="(\/assets\/[^"?#]+)(?:[?#][^"]*)?"/g)].map(match => match[1]);
  if (!html.includes('id="root"') || !entryRefs.some(file => file.endsWith(".js"))) throw Error("Build the static application UI before starting the fixture");
  const files = new Set(["index.html", ...entryRefs.map(file => file.slice(1))]);
  const manifestFile = path.join(directory, ".vite/manifest.json");
  if (await exists(manifestFile)) {
    files.add(".vite/manifest.json");
    for (const record of Object.values(JSON.parse(await readFile(manifestFile, "utf8")))) {
      for (const file of [record.file, ...(record.css ?? []), ...(record.assets ?? [])]) if (typeof file === "string") files.add(file);
    }
  }
  const digest = createHash("sha256");
  for (const file of [...files].sort()) {
    const absolute = path.resolve(directory, file);
    if (!absolute.startsWith(path.resolve(directory) + path.sep)) throw Error("Static UI asset reference escapes its build directory");
    digest.update(file); digest.update("\0"); digest.update(await readFile(absolute)); digest.update("\0");
  }
  return { sha256: digest.digest("hex"), entryRefs };
}
export async function validateFixtureHome(home) {
  if (!home || !path.isAbsolute(home)) throw Error("Absolute disposable fixture home required");
  if (!same(await realpath(home), home)) throw Error("Fixture home alias is not permitted");
  if ((await readFile(path.join(home, ".mimouse-test-fixture"), "utf8")).trim() !== "paperclip-mimouse-disposable-fixture-v1") throw Error("Disposable fixture marker required");
  for (const name of ["instances/default/config.json", "instances/default/.env"]) if (await exists(path.join(home, name))) throw Error("Fixture config or dotenv is not permitted");
  const directory = path.join(home, "instances/default/db");
  if (!same(await realpath(directory), directory)) throw Error("Fixture database alias is not permitted");
  if (!await exists(path.join(directory, "PG_VERSION"))) throw Error("Initialize a new disposable fixture database first");
  return { home: await realpath(home), directory: await realpath(directory) };
}
export async function assertPostgresOwner(fixture, expectedPid) {
  const checked = await validateFixtureHome(fixture.home);
  if (!same(checked.directory, fixture.directory)) throw Error("Fixture database identity changed");
  const lines = (await readFile(path.join(fixture.directory, "postmaster.pid"), "utf8")).split(/\r?\n/);
  const pid = Number(lines[0]), port = Number(lines[3]);
  if (!Number.isSafeInteger(pid) || pid <= 0 || (expectedPid !== undefined && pid !== expectedPid)) throw Error("Fixture PostgreSQL PID changed; refusing shutdown");
  if (!same(await realpath(lines[1]), fixture.directory) || port !== 54329) throw Error("Fixture PostgreSQL directory/port mismatch; refusing shutdown");
  return pid;
}
export function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once("connect", () => finish(true)); socket.once("error", () => finish(false)); socket.setTimeout(500, () => finish(false));
  });
}
async function waitFor(check, timeoutMs, message) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) { if (await check()) return; await sleep(100); }
  throw Error(message);
}
export async function startFixtureServer() {
  const fixture = await validateFixtureHome(process.env.PAPERCLIP_MIMOUSE_TEST_HOME);
  const uiDirectory = path.join(root, "ui/dist"), uiSnapshot = await staticUiSnapshot(uiDirectory);
  if (await exists(path.join(fixture.directory, "postmaster.pid"))) throw Error("Existing PostgreSQL owner record; refusing to adopt or remove it");
  if (await portOpen(3100) || await portOpen(54329)) throw Error("Fixture ports are in use; refusing to adopt an existing instance");
  const requireDb = createRequire(new URL("../../packages/db/package.json", import.meta.url));
  const embeddedUrl = pathToFileURL(requireDb.resolve("embedded-postgres"));
  const { default: binaries } = await import(new URL("./binary.js", embeddedUrl).href);
  const { postgres } = await binaries();
  const pgctl = path.join(path.dirname(postgres), process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
  const requireEmbedded = createRequire(embeddedUrl);
  const { Client } = requireEmbedded("pg");
  const pglog = path.join(fixture.home, "fixture-postgres.log");
  let postgresPid;
  let child;
  let childExit;
  let childClosed = false;
  let shutdown;
  async function withVerifiedDatabase(work) {
    await assertPostgresOwner(fixture, postgresPid);
    const admin = new Client({ connectionString: "postgres://paperclip:paperclip@127.0.0.1:54329/postgres", connectionTimeoutMillis: 5_000, query_timeout: 5_000 });
    try {
      await admin.connect();
      const observed = await admin.query("SHOW data_directory");
      if (!same(await realpath(observed.rows[0].data_directory), fixture.directory)) throw Error("Live fixture PostgreSQL data_directory mismatch");
      return await work(admin);
    } finally { await admin.end(); }
  }
  const stop = () => shutdown ??= (async () => {
    let uiFailure;
    try { if ((await staticUiSnapshot(uiDirectory)).sha256 !== uiSnapshot.sha256) throw Error("Static UI build changed during this fixture run"); }
    catch (error) { uiFailure = error; }
    let serverFailure;
    if (child && !childClosed) {
      if (child.connected) child.send({ type: "mimouse-fixture-shutdown" });
      try { await waitFor(() => childClosed, 30_000, "Fixture HTTP process did not shut down cooperatively"); }
      catch (error) { serverFailure = error; }
    }
    // Never stop a database while its app might still hold/use it. Fail closed
    // with the marked fixture preserved if cooperative shutdown was incomplete.
    if (serverFailure) throw serverFailure;
    if (postgresPid !== undefined) {
      await withVerifiedDatabase(async () => {});
      await exec(pgctl, ["-D", fixture.directory, "-m", "fast", "-w", "-t", "30", "stop"], { timeout: 35_000, windowsHide: true });
      await waitFor(async () => !await exists(path.join(fixture.directory, "postmaster.pid")) && !await portOpen(54329) && !processAlive(postgresPid), 5_000, "Fixture PostgreSQL did not fully exit");
      console.log("MiMouse fixture PostgreSQL stopped; owned PID exited, PID file removed normally and port 54329 released.");
    }
    if (await portOpen(3100)) throw Error("Fixture HTTP port remains in use after its child exited");
    if (childExit && childExit.code !== 0) throw Error(`Fixture HTTP process exited ${childExit.code ?? childExit.signal}`);
    if (uiFailure) throw uiFailure;
  })();
  try {
    await exec(pgctl, ["-D", fixture.directory, "-l", pglog, "-o", "-p 54329 -h 127.0.0.1", "-w", "-t", "30", "start"], { timeout: 35_000, windowsHide: true });
    postgresPid = await assertPostgresOwner(fixture);
    await withVerifiedDatabase(async admin => {
      const databases = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'paperclip'");
      if (!databases.rowCount) {
        console.log("Creating the disposable fixture database (bounded 120-second local template copy).");
        await admin.query({ text: "CREATE DATABASE paperclip", query_timeout: 120_000 });
      }
    });
    const env = { ...process.env, PORT: "3100", DATABASE_URL: "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip", DATABASE_MIGRATION_URL: "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip",
      PAPERCLIP_OPEN_ON_LISTEN: "false", PAPERCLIP_BIND: "loopback", PAPERCLIP_DEPLOYMENT_MODE: process.env.PAPERCLIP_MIMOUSE_TEST_AUTHENTICATED === "true" ? "authenticated" : "local_trusted", PAPERCLIP_UI_DEV_MIDDLEWARE: "false", PAPERCLIP_MIGRATION_AUTO_APPLY: "true" };
    delete env.NO_COLOR; delete env.FORCE_COLOR;
    console.log("Starting the isolated fixture HTTP child.");
    child = spawn(process.execPath, ["--import", "tsx", path.join(root, "tests/mimouse/fixture-server.mjs")], { cwd: path.join(root, "server"), env, shell: false, windowsHide: true, stdio: ["ignore", "inherit", "inherit", "ipc"] });
    child.once("exit", (code, signal) => { childExit = { code, signal }; childClosed = true; });
    let ready = false;
    child.on("message", message => { if (message?.type === "mimouse-fixture-ready" && message.pid === child.pid && message.port === 3100) ready = true; });
    child.once("error", error => { childExit = { code: 1, signal: null, error: error.message }; childClosed = true; });
    await waitFor(async () => {
      if (childClosed) throw Error(`Fixture server exited during startup: ${JSON.stringify(childExit)}`);
      return ready;
    }, 120_000, "Fixture server readiness timeout");
    if ((await staticUiSnapshot(uiDirectory)).sha256 !== uiSnapshot.sha256) throw Error("Static UI build changed during fixture startup");
    const uiResponse = await fetch("http://127.0.0.1:3100/", { signal: AbortSignal.timeout(5_000) });
    const servedHtml = await uiResponse.text();
    if (!uiResponse.ok || !uiResponse.headers.get("content-type")?.includes("text/html") || !servedHtml.includes('id="root"') || !uiSnapshot.entryRefs.every(file => servedHtml.includes(file))) throw Error("Fixture server did not serve the expected static application UI");
    console.log(`MiMouse fixture static UI snapshot: ${uiSnapshot.sha256}`);
    console.log(`MiMouse fixture owns PostgreSQL PID ${postgresPid} and HTTP child PID ${child.pid}.`);
    return stop;
  } catch (error) {
    try { await stop(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Fixture startup and cleanup failed; inspect the preserved marked fixture"); }
    throw error;
  }
}
