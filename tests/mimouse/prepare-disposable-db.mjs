/** Initialize a NEW, marked test cluster without starting it. Does not delete
 * locks, reuse a running process, change auth or disable ownership guards. */
import { createRequire } from "node:module";
import { access, appendFile, readFile } from "node:fs/promises";
import path from "node:path";
const home = process.env.PAPERCLIP_MIMOUSE_TEST_HOME;
if (!home || !path.isAbsolute(home)) throw Error("Absolute disposable fixture home required");
if ((await readFile(path.join(home, ".mimouse-test-fixture"), "utf8")).trim() !== "paperclip-mimouse-disposable-fixture-v1") throw Error("Disposable fixture marker required");
for (const file of ["instances/default/config.json", "instances/default/.env", "instances/default/db/PG_VERSION", "instances/default/db/postmaster.pid"]) {
  try { await access(path.join(home, file)); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
  throw Error(`Refusing to overwrite existing fixture state: ${file}`);
}
const require = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const { default: EmbeddedPostgres } = await import(require.resolve("embedded-postgres"));
const databaseDir = path.join(home, "instances/default/db");
const pg = new EmbeddedPostgres({ databaseDir, user: "paperclip", password: "paperclip", port: 54329, persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"], onLog: () => {}, onError: () => {} });
await pg.initialise();
await appendFile(path.join(databaseDir, "postgresql.conf"), "\n# Disposable test cluster uses loopback TCP, not unavailable Unix sockets.\nunix_socket_directories = ''\n");
console.log("Disposable database initialized; no server started.");
