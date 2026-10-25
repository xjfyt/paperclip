import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const ui = path.join(root, "ui");
const excluded = new Set(["node_modules", ".git", "dist", "dist-preview", "storybook-static", "test-results", "playwright-report"]);
function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (excluded.has(entry.name) || entry.isSymbolicLink()) return [];
    const item = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(item) : entry.isFile() ? [item] : [];
  }).sort();
}
function sourceHash() {
  const hash = createHash("sha256");
  for (const item of filesIn(path.join(ui, "src"))) { hash.update(path.relative(ui, item)); hash.update("\0"); hash.update(fs.readFileSync(item)); hash.update("\0"); }
  return hash.digest("hex");
}
const files = filesIn(ui).filter(file => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)).map(file => path.relative(ui, file));
if (files.length === 0) throw new Error("No UI test files found; refusing an empty success");
const batches = Array.from({ length: Math.ceil(files.length / 10) }, (_, index) => files.slice(index * 10, index * 10 + 10));
if (process.argv.includes("--list")) {
  console.log(JSON.stringify({ fileCount: files.length, batchCount: batches.length, sourceSha256: sourceHash(), batches }, null, 2));
} else {
  const output = path.join(root, "test-results", "mimouse-ui", new Date().toISOString().replace(/[:.]/g, "-") + `-${process.pid}`);
  fs.mkdirSync(output, { recursive: true });
  const manifest = { startedAt: new Date().toISOString(), sourceSha256: sourceHash(), files, batches: [], sourceUnchanged: null };
  const save = () => fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  save();
  for (const [index, batch] of batches.entries()) {
    const log = `${String(index + 1).padStart(3, "0")}.log`; const fd = fs.openSync(path.join(output, log), "w");
    let result;
    try { result = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["exec", "vitest", "run", "--maxWorkers=1", "--pool=forks", ...batch], { cwd: ui, stdio: ["ignore", fd, fd], timeout: 300000 }); }
    finally { fs.closeSync(fd); }
    const exitCode = result.status ?? (result.error?.code === "ETIMEDOUT" ? 124 : 1);
    manifest.batches.push({ index: index + 1, files: batch, exitCode, signal: result.signal ?? null, log }); save();
    console.log(`UI batch ${index + 1}/${batches.length}: ${exitCode === 0 ? "passed" : "failed"} (${log})`);
  }
  manifest.sourceUnchanged = sourceHash() === manifest.sourceSha256; save();
  console.log(`Evidence: ${path.relative(root, output)}`);
  process.exitCode = manifest.sourceUnchanged && manifest.batches.every(batch => batch.exitCode === 0) ? 0 : 1;
}
