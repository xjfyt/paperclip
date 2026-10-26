import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const excluded = new Set(["node_modules", ".git", "dist-preview", "storybook-static", "test-results", "playwright-report", "target", ".cache", "coverage"]);
// Include resources (even Markdown) within runtime trees. Progress docs are not inputs.
const inputTrees = ["ui", "packages", "external-adapters", "server", "cli", "scripts", "patches", "tests", "skills", "integrations"];
const json = value => JSON.stringify(value);
const equal = (a, b) => json(a) === json(b);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function requireThat(condition, message) { if (!condition) throw new Error(message); }
function filesIn(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (excluded.has(entry.name) || entry.name.endsWith(".tsbuildinfo")) return [];
    const item = path.join(directory, entry.name);
    // Never silently omit a symlinked source/resource tree from verification.
    requireThat(!entry.isSymbolicLink(), `Unsupported input symlink: ${item}`);
    return entry.isDirectory() ? filesIn(item) : entry.isFile() ? [item] : [];
  }).sort();
}
function digestFiles(root, files) {
  const hash = createHash("sha256");
  for (const item of files) {
    hash.update(path.relative(root, item)); hash.update("\0");
    hash.update(fs.readFileSync(item)); hash.update("\0");
  }
  return hash.digest("hex");
}
export function snapshot(root) {
  const ui = path.join(root, "ui");
  const files = filesIn(ui).filter(file => !path.relative(ui, file).split(path.sep).includes("dist")).filter(file => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)).map(file => path.relative(ui, file));
  requireThat(files.length > 0, "No UI test files found; refusing an empty success");
  const inputs = inputTrees.flatMap(tree => filesIn(path.join(root, tree)));
  // Some UI contracts read executable fixtures stored under doc/plans.
  for (const tree of ["doc", "docs", "design", "announcements", "releases", "tools", "docker"]) {
    inputs.push(...filesIn(path.join(root, tree)).filter(item => !/\.(?:md|mdx|txt)$/i.test(item)));
  }
  // Root manifests, lockfiles, dot configuration, and build/test config (not prose).
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && !/\.(?:md|txt)$/i.test(entry.name)) inputs.push(path.join(root, entry.name));
  }
  inputs.sort();
  return {
    fileCount: files.length, batchCount: Math.ceil(files.length / 10),
    sourceSha256: digestFiles(ui, filesIn(path.join(ui, "src"))),
    verificationInputs: { policy: "runtime-trees-v2", sha256: digestFiles(root, inputs), files: inputs.map(item => path.relative(root, item)) },
    batches: Array.from({ length: Math.ceil(files.length / 10) }, (_, index) => files.slice(index * 10, index * 10 + 10)),
  };
}
export function parseArgs(args, count) {
  if (args.length === 1 && args[0] === "--list") return { mode: "list" };
  if (args[0] === "--aggregate") {
    requireThat(args.length > 1 && args.slice(1).every(arg => !arg.startsWith("--")), "Usage: --aggregate manifest.json [manifest.json ...]");
    return { mode: "aggregate", manifests: args.slice(1) };
  }
  if (!args.length) return { mode: "run", first: 1, last: count };
  requireThat(args.length === 2 && args[0] === "--batches" && /^\d+:\d+$/.test(args[1]), "Usage: [--list | --batches FIRST:LAST | --aggregate manifest.json ...]");
  const [first, last] = args[1].split(":").map(Number);
  requireThat(Number.isSafeInteger(first) && first >= 1 && last >= first && last <= count, `Batch range must be within 1:${count}`);
  return { mode: "run", first, last };
}
function runnerIdentity(root) {
  const cli = path.join(root, "node_modules/vitest/vitest.mjs");
  return { kind: "direct-vitest", node: process.version, platform: process.platform, arch: process.arch,
    version: JSON.parse(fs.readFileSync(path.join(root, "node_modules/vitest/package.json"))).version,
    cliSha256: sha(fs.readFileSync(cli)),
    command: ["node", "node_modules/vitest/vitest.mjs", "run", "--maxWorkers=1", "--pool=forks", "--reporter=json", "--outputFile=<batch-report>", "<batch-files>"],
    timeoutMs: 300000 };
}
function atomicSave(file, value) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(`${file}.tmp`, file);
}
function evidenceDir(root, prefix) {
  const parent = path.join(root, "test-results", "mimouse-ui");
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}-`));
}
export function validateReport(report, batch, ui) {
  requireThat(report.success === true && report.numFailedTests === 0 && report.numFailedTestSuites === 0, "Vitest reported failure");
  requireThat(report.numPendingTests === 0 && (report.numTodoTests ?? 0) === 0, "Skipped/pending/todo tests are not passing evidence");
  requireThat(Array.isArray(report.testResults), "Missing Vitest file results");
  const actual = report.testResults.map(result => path.relative(ui, result.name)).sort();
  requireThat(equal(actual, [...batch].sort()), "Vitest report file inventory mismatch");
  let assertions = 0;
  for (const result of report.testResults) {
    requireThat(result.status === "passed" && result.assertionResults?.length > 0, "Empty or non-passing test file");
    requireThat(result.assertionResults.every(assertion => assertion.status === "passed"), "Non-passing assertion (including skip/todo)");
    assertions += result.assertionResults.length;
  }
  requireThat(report.numTotalTests === assertions && report.numPassedTests === assertions, "Vitest assertion totals mismatch");
  return { files: actual.length, tests: assertions };
}
export function runRange(root, inventory, options) {
  const output = evidenceDir(root, "run");
  const file = path.join(output, "manifest.json");
  const runner = runnerIdentity(root);
  const manifest = { schemaVersion: 2, status: "running", startedAt: new Date().toISOString(),
    ...inventory, runner, range: { first: options.first, last: options.last }, results: [], sourceUnchanged: null };
  atomicSave(file, manifest);
  console.log(`Evidence: ${file}`);
  for (let index = options.first; index <= options.last; index++) {
    const batch = inventory.batches[index - 1];
    const before = snapshot(root).verificationInputs.sha256;
    const record = { index, files: batch, status: "running", startedAt: new Date().toISOString(), beforeSha256: before,
      log: `${String(index).padStart(3, "0")}.log`, report: `${String(index).padStart(3, "0")}.json` };
    manifest.results.push(record); atomicSave(file, manifest);
    if (before !== inventory.verificationInputs.sha256) { record.error = "Verification inputs changed before batch"; record.status = "failed"; atomicSave(file, manifest); break; }
    const reportPath = path.join(output, record.report);
    const fd = fs.openSync(path.join(output, record.log), "wx");
    let result;
    try {
      result = spawnSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--maxWorkers=1", "--pool=forks", "--reporter=json", `--outputFile=${reportPath}`, ...batch],
        { cwd: path.join(root, "ui"), stdio: ["ignore", fd, fd], timeout: runner.timeoutMs, killSignal: "SIGKILL" });
    } finally { fs.closeSync(fd); }
    record.exitCode = result.status;
    record.signal = result.signal ?? null;
    record.processError = result.error?.code ?? null;
    record.finishedAt = new Date().toISOString();
    record.afterSha256 = snapshot(root).verificationInputs.sha256;
    record.logSha256 = sha(fs.readFileSync(path.join(output, record.log)));
    record.status = "failed";
    try {
      requireThat(result.status === 0 && !result.signal && !result.error, "Test process did not exit successfully");
      requireThat(record.afterSha256 === before, "Verification inputs changed during batch");
      requireThat(equal(runnerIdentity(root), runner), "Runner changed during batch");
      record.runnerUnchanged = true;
      const bytes = fs.readFileSync(reportPath);
      record.reportSha256 = sha(bytes);
      record.counts = validateReport(JSON.parse(bytes), batch, path.join(root, "ui"));
      record.status = "passed";
    } catch (error) { record.error = error.message; }
    atomicSave(file, manifest);
    console.log(`UI batch ${index}/${inventory.batchCount}: ${record.status} (${record.log})`);
    if (record.status !== "passed") break;
  }
  manifest.sourceUnchanged = snapshot(root).verificationInputs.sha256 === inventory.verificationInputs.sha256;
  manifest.finishedAt = new Date().toISOString();
  manifest.status = manifest.sourceUnchanged && equal(runnerIdentity(root), runner) && manifest.results.length === options.last - options.first + 1 && manifest.results.every(result => result.status === "passed") ? "passed" : "failed";
  atomicSave(file, manifest);
  return { manifest, file };
}
export function aggregate(root, inventory, paths) {
  const runner = runnerIdentity(root);
  const seen = new Set(); let tests = 0;
  const evidence = [];
  for (const filename of paths) {
    const absolute = path.resolve(filename); const bytes = fs.readFileSync(absolute);
    const manifest = JSON.parse(bytes);
    requireThat(manifest.schemaVersion === 2, "Only native v2 manifests are accepted (no v1 conversion)");
    requireThat(manifest.status === "passed" && manifest.sourceUnchanged === true && manifest.finishedAt, "Incomplete or failed manifest");
    requireThat(equal(manifest.verificationInputs, inventory.verificationInputs) && manifest.sourceSha256 === inventory.sourceSha256, "Verification inputs differ from current checkout");
    requireThat(equal(manifest.runner, runner), "Runner identity/command differs");
    requireThat(equal(manifest.batches, inventory.batches) && manifest.fileCount === inventory.fileCount && manifest.batchCount === inventory.batchCount, "Inventory differs");
    const { first, last } = manifest.range ?? {};
    requireThat(Number.isInteger(first) && Number.isInteger(last) && first >= 1 && last >= first && last <= inventory.batchCount, "Invalid manifest range");
    requireThat(manifest.results?.length === last - first + 1, "Incomplete range");
    for (const [offset, result] of manifest.results.entries()) {
      const index = first + offset;
      requireThat(result.index === index && !seen.has(index), "Duplicate or out-of-order batch");
      requireThat(equal(result.files, inventory.batches[index - 1]), "Batch file inventory mismatch");
      requireThat(result.status === "passed" && result.exitCode === 0 && result.signal === null && result.processError === null && result.finishedAt, "Incomplete or failed batch");
      requireThat(result.runnerUnchanged === true && result.beforeSha256 === inventory.verificationInputs.sha256 && result.afterSha256 === inventory.verificationInputs.sha256, "Batch source drift");
      for (const field of ["report", "log"]) {
        requireThat(typeof result[field] === "string" && path.basename(result[field]) === result[field], "Invalid evidence path");
        requireThat(sha(fs.readFileSync(path.join(path.dirname(absolute), result[field]))) === result[`${field}Sha256`], `Changed ${field} evidence`);
      }
      const counts = validateReport(JSON.parse(fs.readFileSync(path.join(path.dirname(absolute), result.report))), result.files, path.join(root, "ui"));
      requireThat(equal(counts, result.counts), "Report totals differ");
      tests += counts.tests; seen.add(index);
    }
    evidence.push({ manifest: absolute, sha256: sha(bytes) });
  }
  requireThat(seen.size === inventory.batchCount, `Missing coverage: ${seen.size}/${inventory.batchCount} batches`);
  requireThat(equal(snapshot(root).verificationInputs, inventory.verificationInputs) && equal(runnerIdentity(root), runner), "Inputs changed during aggregation");
  const output = evidenceDir(root, "aggregate");
  const result = { schemaVersion: 2, status: "passed", kind: "aggregate-coverage-not-uninterrupted-run", finishedAt: new Date().toISOString(),
    verificationInputs: inventory.verificationInputs, runner, fileCount: inventory.fileCount, batchCount: seen.size, tests, evidence };
  atomicSave(path.join(output, "aggregate.json"), result);
  return { result, output };
}
export function main(args = process.argv.slice(2), root = defaultRoot) {
  const inventory = snapshot(root);
  const options = parseArgs(args, inventory.batchCount);
  if (options.mode === "list") { console.log(JSON.stringify(inventory, null, 2)); return 0; }
  if (options.mode === "aggregate") {
    const { result, output } = aggregate(root, inventory, options.manifests);
    console.log(`Aggregate coverage passed: ${result.fileCount} files, ${result.tests} tests. Evidence: ${output}`); return 0;
  }
  return runRange(root, inventory, options).manifest.status === "passed" ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
