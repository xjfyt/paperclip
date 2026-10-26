import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runChildProcess, runningProcesses, RequiredSpawnReceiptError } from "./server-utils.js";
import { runAdapterExecutionTargetProcess } from "./execution-target.js";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "prompt-spawn-receipt-")); roots.push(root);
  const marker = path.join(root, "stdin"), script = `const fs=require('node:fs');process.stdin.on('data',d=>fs.appendFileSync(${JSON.stringify(marker)},d));process.stdin.on('end',()=>{process.stdout.write(fs.readFileSync(${JSON.stringify(marker)}));});`;
  return { root, marker, script };
}
const literal = "  secret fixture only {{agent.name}}\r\n🧪  ";
for (const kind of ["reject", "throw", "timeout"] as const) it(`required ${kind} never writes stdin and waits for actual child stop`, async () => {
  const f = await fixture(); let pid = 0; const logError = vi.fn(), spawned = vi.fn(meta => {
    pid = meta.pid;
    if (kind === "throw") throw new Error(literal);
    return kind === "reject" ? Promise.reject(new Error(literal)) : new Promise<void>(() => {});
  });
  const runId = `required-${kind}`;
  await expect(runChildProcess(runId, process.execPath, ["-e", f.script], { cwd: f.root, env: {}, stdin: literal,
    timeoutSec: 0, graceSec: 0, requireSpawnReceipt: true, spawnReceiptTimeoutMs: 75, onSpawn: spawned,
    onLog: async () => {}, onLogError: logError })).rejects.toBeInstanceOf(RequiredSpawnReceiptError);
  expect(spawned).toHaveBeenCalledTimes(1); expect(logError).not.toHaveBeenCalled();
  await expect(readFile(f.marker)).rejects.toMatchObject({ code: "ENOENT" });
  expect(runningProcesses.has(runId)).toBe(false); expect(pid).toBeGreaterThan(0);
  expect(() => process.kill(pid, 0)).toThrow();
});
it("successful required receipt preserves exact stdin bytes", async () => {
  const f = await fixture(), spawn = vi.fn(async () => {});
  const result = await runChildProcess("required-success", process.execPath, ["-e", f.script], { cwd: f.root, env: {}, stdin: literal,
    timeoutSec: 2, graceSec: 0, requireSpawnReceipt: true, onSpawn: spawn, onLog: async () => {} });
  expect(result.exitCode).toBe(0); expect(result.stdout).toBe(literal); expect(await readFile(f.marker, "utf8")).toBe(literal); expect(spawn).toHaveBeenCalledTimes(1);
});
it("default nonfatal spawn metadata policy remains unchanged", async () => {
  const f = await fixture(), onLogError = vi.fn();
  const result = await runChildProcess("legacy-success", process.execPath, ["-e", f.script], { cwd: f.root, env: {}, stdin: literal,
    timeoutSec: 2, graceSec: 0, onSpawn: async () => { throw new Error("metadata failed"); }, onLog: async () => {}, onLogError });
  expect(result.exitCode).toBe(0); expect(result.stdout).toBe(literal); expect(onLogError).toHaveBeenCalledTimes(1);
});
it("a default no-stdin child can close while its optional receipt is pending", async () => {
  const f = await fixture();
  const result = await runChildProcess("optional-pending", process.execPath, ["-e", "process.exit(0)"], { cwd: f.root, env: {},
    timeoutSec: 2, graceSec: 0, onSpawn: () => new Promise<void>(() => {}), onLog: async () => {} });
  expect(result.exitCode).toBe(0);
});
it("local execution target reports confirmed stop even when strict receipt fails", async () => {
  const f = await fixture(), stopped = vi.fn();
  await expect(runAdapterExecutionTargetProcess("required-target", null, process.execPath, ["-e", f.script], { cwd: f.root, env: {}, stdin: literal,
    timeoutSec: 2, graceSec: 0, requireSpawnReceipt: true, onSpawn: async () => { throw new Error(literal); }, onLog: async () => {}, onProcessStopped: stopped }))
    .rejects.toThrow("required_spawn_receipt_failed");
  expect(stopped).toHaveBeenCalledTimes(1); await expect(readFile(f.marker)).rejects.toMatchObject({ code: "ENOENT" });
});
it("required receipts refuse missing callbacks before launching", async () => {
  const f = await fixture();
  await expect(runChildProcess("required-missing", process.execPath, ["-e", f.script], { cwd: f.root, env: {}, stdin: literal,
    timeoutSec: 2, graceSec: 0, requireSpawnReceipt: true, onLog: async () => {} })).rejects.toThrow("required_spawn_receipt_unsupported");
});
