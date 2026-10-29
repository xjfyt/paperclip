import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink, unlink, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateFixtureHome, assertPostgresOwner, staticUiSnapshot } from "./fixture-lifecycle.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pclt-"));
  t.after(async () => {
    const canonical = await realpath(root);
    assert.equal(path.dirname(canonical).toLowerCase(), (await realpath(os.tmpdir())).toLowerCase());
    assert.ok(path.basename(canonical).startsWith("pclt-"));
    await rm(canonical, { recursive: true, force: true });
  });
  const directory = path.join(root, "instances/default/db");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(root, ".mimouse-test-fixture"), "paperclip-mimouse-disposable-fixture-v1\n");
  await writeFile(path.join(directory, "PG_VERSION"), "18\n");
  const owner = async (pid = 12345, dir = directory, port = 54329) => writeFile(path.join(directory, "postmaster.pid"), `${pid}\n${dir}\n1793286980\n${port}\n`);
  return { root, directory, owner };
}
test("fixture lifecycle requires an absolute marked canonical initialized home", async t => {
  const f = await fixture(t);
  const result = await validateFixtureHome(f.root);
  assert.equal(result.directory, await realpath(f.directory));
  await assert.rejects(validateFixtureHome("relative-home"), /Absolute disposable/);
  await writeFile(path.join(f.root, ".mimouse-test-fixture"), "not-our-fixture");
  await assert.rejects(validateFixtureHome(f.root), /marker required/);
});
for (const name of ["config.json", ".env"]) test(`fixture lifecycle refuses inherited ${name}`, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, "instances/default", name), "inert fixture");
  await assert.rejects(validateFixtureHome(f.root), /config or dotenv/);
});
test("fixture lifecycle refuses a database directory aliased to another home", async t => {
  const f = await fixture(t), other = await fixture(t);
  await unlink(path.join(f.directory, "PG_VERSION"));
  await rmdir(f.directory);
  await symlink(other.directory, f.directory, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(validateFixtureHome(f.root), /database alias/);
});
test("PostgreSQL shutdown ownership is bound to PID, data directory and fixed port", async t => {
  const f = await fixture(t), other = await fixture(t);
  const checked = await validateFixtureHome(f.root);
  await f.owner();
  assert.equal(await assertPostgresOwner(checked, 12345), 12345);
  const original = await readFile(path.join(f.directory, "postmaster.pid"), "utf8");
  await assert.rejects(assertPostgresOwner(checked, 9876), /PID changed/);
  assert.equal(await readFile(path.join(f.directory, "postmaster.pid"), "utf8"), original);
  await f.owner(12345, other.directory);
  await assert.rejects(assertPostgresOwner(checked, 12345), /directory\/port mismatch/);
  await f.owner(12345, f.directory, 54330);
  await assert.rejects(assertPostgresOwner(checked, 12345), /directory\/port mismatch/);
  await f.owner(0);
  await assert.rejects(assertPostgresOwner(checked), /PID changed/);
});
test("static UI startup guard requires the application index and every referenced asset", async t => {
  const f = await fixture(t), ui = path.join(f.root, "ui");
  await mkdir(path.join(ui, "assets"), { recursive: true });
  await assert.rejects(staticUiSnapshot(ui), { code: "ENOENT" });
  await writeFile(path.join(ui, "index.html"), '<div id="root"></div><script type="module" src="/assets/app.js"></script>');
  await assert.rejects(staticUiSnapshot(ui), { code: "ENOENT" });
  await writeFile(path.join(ui, "assets/app.js"), "export const ready = true;");
  const first = await staticUiSnapshot(ui);
  assert.deepEqual(first.entryRefs, ["/assets/app.js"]);
  assert.deepEqual(await staticUiSnapshot(ui), first);
  await writeFile(path.join(ui, "assets/app.js"), "export const ready = false;");
  assert.notEqual((await staticUiSnapshot(ui)).sha256, first.sha256);
});
test("static UI manifest dependencies are checked and cannot escape the build root", async t => {
  const f = await fixture(t), ui = path.join(f.root, "ui");
  await mkdir(path.join(ui, "assets"), { recursive: true }); await mkdir(path.join(ui, ".vite"));
  await writeFile(path.join(ui, "index.html"), '<div id="root"></div><script type="module" src="/assets/app.js"></script>');
  await writeFile(path.join(ui, "assets/app.js"), "export const ready = true;");
  const manifest = path.join(ui, ".vite/manifest.json");
  await writeFile(manifest, JSON.stringify({ main: { file: "assets/app.js", css: ["assets/missing.css"] } }));
  await assert.rejects(staticUiSnapshot(ui), { code: "ENOENT" });
  await writeFile(path.join(ui, "assets/missing.css"), "body {}");
  assert.match((await staticUiSnapshot(ui)).sha256, /^[a-f0-9]{64}$/);
  await writeFile(manifest, JSON.stringify({ main: { file: "../outside.js" } }));
  await assert.rejects(staticUiSnapshot(ui), /escapes its build directory/);
});
