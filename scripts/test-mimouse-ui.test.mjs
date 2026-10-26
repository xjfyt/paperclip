import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { snapshot, parseArgs, runRange, aggregate, validateReport } from "./test-mimouse-ui.mjs";

function fixture(t, mode = "pass") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mimouse-ui-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, contents) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), contents);
  };
  for (let i = 0; i < 11; i++) write(`ui/src/${String(i).padStart(2, "0")}.test.ts`, "// controlled test fixture\n");
  write("ui/vitest.config.ts", "// config\n");
  write("packages/shared/src/index.ts", "export const shared = 1;\n");
  write("packages/adapters/example/src/index.ts", "export const adapter = 1;\n");
  write("scripts/test-mimouse-ui.mjs", "// fixture runner source\n");
  write("package.json", "{}"); write("pnpm-lock.yaml", "lockfileVersion: 9\n");
  write("patches/example.patch", "patch\n");
  write("ui/public/fonts/NOTICE.md", "asset notice\n");
  write("doc/plans/chat-adapters/generate-wireframes-v8.mjs", "// executed fixture\n");
  write("node_modules/vitest/package.json", JSON.stringify({ version: "controlled-fixture", type: "module" }));
  write("node_modules/vitest/vitest.mjs", `
import fs from 'node:fs'; import path from 'node:path';
const mode = ${JSON.stringify(mode)};
const args = process.argv.slice(2); const output = args.find(arg => arg.startsWith('--outputFile=')).slice(13);
const files = args.filter(arg => arg.endsWith('.test.ts'));
if (mode === 'exit') process.exit(3);
if (mode === 'drift') fs.appendFileSync('src/00.test.ts', '// drift');
const testResults = files.map(file => ({ name: path.resolve(file), status: 'passed', assertionResults: [{ status: mode === 'skip' ? 'pending' : 'passed' }] }));
if (mode === 'omit') testResults.pop();
const report = { success: true, numFailedTests: 0, numFailedTestSuites: 0, numPendingTests: mode === 'skip' ? files.length : 0, numTodoTests: 0, numTotalTests: files.length, numPassedTests: files.length, testResults };
if (mode !== 'missing') fs.writeFileSync(output, JSON.stringify(report));
`);
  return { root, write, inventory: snapshot(root) };
}
const ranges = root => {
  const inventory = snapshot(root);
  return [runRange(root, inventory, { first: 1, last: 1 }), runRange(root, inventory, { first: 2, last: 2 })];
};
function rewrite(file, change) { const data = JSON.parse(fs.readFileSync(file)); change(data); fs.writeFileSync(file, JSON.stringify(data)); }

test("default/list/range parsing is strict and one-based", () => {
  assert.deepEqual(parseArgs([], 80), { mode: "run", first: 1, last: 80 });
  assert.equal(parseArgs(["--list"], 80).mode, "list");
  assert.deepEqual(parseArgs(["--batches", "76:80"], 80), { mode: "run", first: 76, last: 80 });
  for (const args of [["--batches", "0:1"], ["--batches", "2:1"], ["--batches", "1:81"], ["--batches", "NaN:1"], ["--batches"], ["--wat"], ["--list", "extra"], ["--aggregate"], ["--aggregate", "--list"]]) assert.throws(() => parseArgs(args, 80));
});
test("range executes only selected files; strict aggregation covers inventory once", t => {
  const { root, inventory } = fixture(t);
  const runs = ranges(root);
  assert.equal(runs[0].manifest.results.length, 1);
  assert.equal(runs[0].manifest.results[0].files.length, 10);
  assert.equal(runs[1].manifest.results[0].files.length, 1);
  const { result } = aggregate(root, inventory, runs.map(run => run.file));
  assert.equal(result.fileCount, 11); assert.equal(result.tests, 11);
  assert.equal(result.kind, "aggregate-coverage-not-uninterrupted-run");
  assert.throws(() => aggregate(root, inventory, [runs[0].file]), /Missing coverage/);
  assert.throws(() => aggregate(root, inventory, [runs[0].file, runs[0].file, runs[1].file]), /Duplicate/);
  assert.notEqual(runRange(root, inventory, { first: 2, last: 2 }).file, runs[1].file);
});
test("default full run remains valid full coverage", t => {
  const { root, inventory } = fixture(t);
  const run = runRange(root, inventory, parseArgs([], inventory.batchCount));
  assert.equal(aggregate(root, inventory, [run.file]).result.tests, 11);
});
for (const mode of ["exit", "drift", "skip", "omit", "missing"]) {
  test(`reject ${mode} without calling it passed`, t => {
    const { root, inventory } = fixture(t, mode);
    const run = runRange(root, inventory, { first: 1, last: 2 });
    assert.equal(run.manifest.status, "failed");
    assert.equal(run.manifest.results.length, 1);
    assert.equal(run.manifest.results[0].status, "failed");
    assert.throws(() => aggregate(root, snapshot(root), [run.file]), /Incomplete or failed/);
  });
}
test("incomplete manifests, old v1 evidence, and missing completed batches are rejected", t => {
  const { root, inventory } = fixture(t); const runs = ranges(root);
  const original = fs.readFileSync(runs[0].file);
  for (const change of [m => { m.status = "running"; delete m.finishedAt; }, m => { m.schemaVersion = 1; }, m => { m.results = []; }, m => { m.results[0].status = "running"; }, m => { m.results[0].exitCode = null; }]) {
    fs.writeFileSync(runs[0].file, original); rewrite(runs[0].file, change);
    assert.throws(() => aggregate(root, inventory, runs.map(run => run.file)));
  }
});
test("digest covers config, shared/adapter source, runner, lock, patches, and actual doc/public resources", t => {
  const { root, inventory } = fixture(t);
  for (const file of ["ui/vitest.config.ts", "packages/shared/src/index.ts", "packages/adapters/example/src/index.ts", "scripts/test-mimouse-ui.mjs", "package.json", "pnpm-lock.yaml", "patches/example.patch", "ui/public/fonts/NOTICE.md", "doc/plans/chat-adapters/generate-wireframes-v8.mjs"]) {
    const absolute = path.join(root, file); const original = fs.readFileSync(absolute);
    fs.appendFileSync(absolute, "\nchange");
    assert.notEqual(snapshot(root).verificationInputs.sha256, inventory.verificationInputs.sha256, file);
    fs.writeFileSync(absolute, original);
  }
  fs.writeFileSync(path.join(root, "doc/progress.md"), "unrelated progress\n");
  assert.equal(snapshot(root).verificationInputs.sha256, inventory.verificationInputs.sha256);
});
test("aggregation rejects source and runner/config drift between shards", t => {
  const { root, inventory } = fixture(t); const runs = ranges(root);
  fs.appendFileSync(path.join(root, "packages/shared/src/index.ts"), "// drift");
  assert.throws(() => aggregate(root, snapshot(root), runs.map(run => run.file)), /inputs differ/);
  rewrite(runs[1].file, m => { m.runner.node = "different"; });
  assert.throws(() => aggregate(root, inventory, runs.map(run => run.file)), /Runner identity/);
});
test("changed logs, report, inventories and batch source evidence are rejected", t => {
  const { root, inventory } = fixture(t); const runs = ranges(root);
  const original = fs.readFileSync(runs[0].file);
  for (const change of [m => { m.batches[0].pop(); }, m => { m.results[0].files = []; }, m => { m.results[0].afterSha256 = "other"; }, m => { m.results[0].counts.tests = 0; }, m => { m.results[0].report = "../escape.json"; }, m => { m.results[0].reportSha256 = "other"; }]) {
    fs.writeFileSync(runs[0].file, original); rewrite(runs[0].file, change);
    assert.throws(() => aggregate(root, inventory, runs.map(run => run.file)));
  }
  fs.writeFileSync(runs[0].file, original);
  fs.appendFileSync(path.join(path.dirname(runs[0].file), "001.log"), "changed");
  assert.throws(() => aggregate(root, inventory, runs.map(run => run.file)), /Changed log/);
});
test("empty inventory and symlinked input fail closed", t => {
  const { root } = fixture(t);
  fs.symlinkSync("00.test.ts", path.join(root, "ui/src/link.ts"));
  assert.throws(() => snapshot(root), /symlink/);
  fs.rmSync(path.join(root, "ui/src"), { recursive: true });
  assert.throws(() => snapshot(root), /No UI test/);
});
test("empty, skipped, todo and duplicate report results are not passing tests", () => {
  const report = { success: true, numFailedTests: 0, numFailedTestSuites: 0, numPendingTests: 0, numTodoTests: 0, numTotalTests: 1, numPassedTests: 1,
    testResults: [{ name: "/ui/a.test.ts", status: "passed", assertionResults: [{ status: "passed" }] }] };
  assert.deepEqual(validateReport(report, ["a.test.ts"], "/ui"), { files: 1, tests: 1 });
  for (const change of [r => { r.testResults[0].assertionResults = []; }, r => { r.testResults[0].assertionResults[0].status = "pending"; }, r => { r.numTodoTests = 1; }, r => { r.testResults.push(r.testResults[0]); }, r => { r.numTotalTests = 2; }]) {
    const clone = structuredClone(report); change(clone);
    assert.throws(() => validateReport(clone, ["a.test.ts"], "/ui"));
  }
});
