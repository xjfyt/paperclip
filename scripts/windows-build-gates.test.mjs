import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "paperclip-build-gates-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(dir, relative, text) {
  const target = path.join(dir, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
}
function copy(dir, relative) {
  const target = path.join(dir, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(root, relative), target);
}
function run(dir, script, args = []) {
  return spawnSync(process.execPath, [path.join(dir, script), ...args], {
    // Asset staging must work independently of the caller's cwd.
    cwd: os.tmpdir(), encoding: "utf8",
  });
}

for (const newline of ["\n", "\r\n"]) {
  test(`token gate honors documented allowlist with ${JSON.stringify(newline)} and still rejects new violations`, t => {
    const dir = fixture(t);
    const script = "scripts/check-token-gates.mjs";
    copy(dir, script);
    write(dir, "ui/src/index.css", ["/*", " * allow ui/src/components/Allowed.tsx — fixture exception", " */", ""].join(newline));
    write(dir, "ui/src/components/Allowed.tsx", 'export const color = "#ff0000";');
    write(dir, "ui/src/pages/Page.tsx", "export const Page = () => null;");
    const allowed = run(dir, script);
    assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
    assert.match(allowed.stdout, /Allowlist entries loaded:\s+1/);
    write(dir, "ui/src/pages/Page.tsx", 'export const Page = () => <div className="text-[#ff0000]" />;');
    const denied = run(dir, script);
    assert.equal(denied.status, 1, denied.stdout + denied.stderr);
    assert.match(denied.stdout, /ui\/src\/pages\/Page.tsx/);
  });
}

for (const script of ["scripts/sync-agent-palette-tokens.mjs", "scripts/sync-cliplab-character.mjs"]) {
  test(`${script} accepts CRLF but rejects content drift`, t => {
    const dir = fixture(t);
    copy(dir, script);
    const isPalette = script.includes("palette");
    const target = isPalette ? "packages/shared/src/cliplab/palette-tokens.ts" : "packages/shared/src/cliplab/character.ts";
    mkdirSync(path.dirname(path.join(dir, target)), { recursive: true });
    if (isPalette) {
      const colors = Array.from({ length: 18 }, (_, i) => {
        const name = `color-${String.fromCharCode(97 + i)}`;
        return `--agent-cap-v1-${name}-a: #123456;\n--agent-cap-v1-${name}-b: #abcdef;`;
      }).join("\n");
      write(dir, "ui/src/index.css", colors);
    } else {
      write(dir, "ui/src/assets/cliplab/onboarding.character.json", '{"name":"fixture"}');
    }
    const generated = run(dir, script);
    assert.equal(generated.status, 0, generated.stderr);
    const expected = readFileSync(path.join(dir, target), "utf8").replace(/\r\n/g, "\n");
    for (const newline of ["\n", "\r\n"]) {
      write(dir, target, expected.replace(/\n/g, newline));
      const checked = run(dir, script, ["--check"]);
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    }
    write(dir, target, expected + "// content drift\n");
    assert.equal(run(dir, script, ["--check"]).status, 1);
  });
}

test("shared asset staging preserves license and provenance bytes", t => {
  const dir = fixture(t);
  const script = "packages/shared/scripts/copy-build-assets.mjs";
  copy(dir, script);
  for (const name of ["LICENSE", "PROVENANCE.md"]) write(dir, `packages/shared/src/cliplab/${name}`, `${name}\r\nfixture\n`);
  const result = run(dir, script);
  assert.equal(result.status, 0, result.stderr);
  for (const name of ["LICENSE", "PROVENANCE.md"]) {
    assert.deepEqual(readFileSync(path.join(dir, `packages/shared/dist/cliplab/${name}`)), readFileSync(path.join(dir, `packages/shared/src/cliplab/${name}`)));
  }
});

test("server stages all asset trees, hidden files and runner output without deleting compiled code", t => {
  const dir = fixture(t);
  const script = "server/scripts/copy-build-assets.mjs";
  copy(dir, script);
  const trees = [
    ["server/src/onboarding-assets", "server/dist/onboarding-assets"],
    ["server/src/built-ins", "server/dist/built-ins"],
    ["server/src/services/scripts", "server/dist/services/scripts"],
    ["packages/paperclip-runner/dist", "server/dist/vendor/paperclip-runner"],
  ];
  for (const [source] of trees) write(dir, `${source}/nested/.fixture`, source);
  write(dir, "server/dist/index.js", "compiled code");
  const result = run(dir, script);
  assert.equal(result.status, 0, result.stderr);
  for (const [source, target] of trees) assert.equal(readFileSync(path.join(dir, target, "nested/.fixture"), "utf8"), source);
  assert.equal(readFileSync(path.join(dir, "server/dist/index.js"), "utf8"), "compiled code");
  assert.ok(existsSync(path.join(dir, "server/dist/vendor/paperclip-runner/nested/.fixture")));
});

test("DB staging replaces stale SQL and copies the journal without source snapshots", t => {
  const dir = fixture(t);
  const script = "packages/db/scripts/copy-migrations.mjs";
  copy(dir, script);
  write(dir, "packages/db/src/migrations/0001_test.sql", "select 1;\r\n");
  write(dir, "packages/db/src/migrations/meta/_journal.json", '{"entries":[]}');
  write(dir, "packages/db/src/migrations/meta/0001_snapshot.json", "{}");
  write(dir, "packages/db/dist/migrations/old.sql", "stale");
  write(dir, "packages/db/dist/index.js", "compiled code");
  const result = run(dir, script);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path.join(dir, "packages/db/dist/migrations/0001_test.sql"), "utf8"), "select 1;\r\n");
  assert.equal(readFileSync(path.join(dir, "packages/db/dist/migrations/meta/_journal.json"), "utf8"), '{"entries":[]}');
  assert.ok(!existsSync(path.join(dir, "packages/db/dist/migrations/old.sql")));
  assert.ok(!existsSync(path.join(dir, "packages/db/dist/migrations/meta/0001_snapshot.json")));
  assert.equal(readFileSync(path.join(dir, "packages/db/dist/index.js"), "utf8"), "compiled code");
});

test("stable runner launches the installed JS entry without a pnpm executable and preserves failure status", t => {
  const dir = fixture(t);
  for (const file of ["run-vitest-stable.mjs", "general-server-shard.mjs", "test-line-shard.mjs"]) copy(dir, `scripts/${file}`);
  mkdirSync(path.join(dir, "server/src/__tests__"), { recursive: true });
  mkdirSync(path.join(dir, "server/scripts"), { recursive: true });
  write(dir, "node_modules/vitest/package.json", JSON.stringify({ name: "vitest", type: "module", exports: { "./package.json": "./package.json" } }));
  write(dir, "node_modules/vitest/vitest.mjs", 'console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = 3;');
  const result = spawnSync(process.execPath, [path.join(dir, "scripts/run-vitest-stable.mjs"), "--mode", "general", "--group", "general-server"], {
    cwd: dir, encoding: "utf8", env: { ...process.env, PATH: "" },
  });
  assert.equal(result.status, 3, result.stdout + result.stderr);
  assert.match(result.stdout, /\["run","--exclude","\*\*\/dist\/\*\*","--project","@paperclipai\/server"/);
});
