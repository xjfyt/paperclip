import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Worker } from "node:worker_threads";

type WorktreePortRegistry = {
  version: 1;
  configPaths: string[];
};

const WORKTREE_PORT_REGISTRY_FILE = "worktree-port-reservations.json";
const WORKTREE_PORT_REGISTRY_LOCK_DIR = ".worktree-port-reservations.lock";
const WORKTREE_PORT_REGISTRY_LOCK_OWNER_FILE = "owner.json";
const WORKTREE_PORT_REGISTRY_LOCK_OWNER_BACKUP_FILE = "owner.backup.json";
const WORKTREE_PORT_REGISTRY_LOCK_STALE_MS = 5_000;
const WORKTREE_PORT_REGISTRY_LOCK_TIMEOUT_MS = 10_000;
const WORKTREE_PORT_REGISTRY_LOCK_HEARTBEAT_MS = 1_000;
const WORKTREE_PORT_REGISTRY_LOCK_PROBE_TIMEOUT_MS = 500;
const sleepSyncBuffer = new Int32Array(new SharedArrayBuffer(4));

type RegistryLockOwner = {
  version: 1;
  pid: number;
  processIdentity: string;
  probePort: number;
  token: string;
};

type RegistryEntryIdentity = { dev: bigint; ino: bigint };
type RegistryLockOwnership = {
  directory: RegistryEntryIdentity;
  entries: Map<string, RegistryEntryIdentity>;
};

type RegistryLockLease = {
  ownership: RegistryLockOwnership;
  token: string;
  worker: Worker;
  control: Int32Array;
  probePort: number;
};

const REGISTRY_LOCK_HEARTBEAT_SOURCE = `
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { parentPort, workerData } = require("node:worker_threads");
const control = new Int32Array(workerData.control);
function touchOwnedLock() {
  let sawDifferentOwner = false;
  for (const ownerFile of workerData.ownerFiles) {
    try {
      const owner = JSON.parse(fs.readFileSync(path.join(workerData.lockPath, ownerFile), "utf8"));
      if (owner.token === workerData.token) {
        try {
          const now = new Date();
          fs.utimesSync(workerData.lockPath, now, now);
          return "refreshed";
        } catch {
          return "retry";
        }
      }
      sawDifferentOwner = true;
    } catch {
      // The redundant owner file may still be readable.
    }
  }
  return sawDifferentOwner ? "lost" : "retry";
}
let finished = false;
let timer;
function complete() {
  Atomics.store(control, 0, 2);
  Atomics.notify(control, 0);
}
function finish() {
  if (finished) return;
  finished = true;
  if (timer) clearInterval(timer);
  server.close(complete);
  setTimeout(complete, 250).unref();
}
const server = net.createServer((socket) => {
  socket.setEncoding("utf8");
  socket.setTimeout(workerData.probeTimeoutMs, () => socket.destroy());
  socket.once("data", (candidate) => {
    socket.end(candidate === workerData.token ? "owned" : "denied");
  });
});
parentPort.once("message", finish);
server.once("error", () => {
  Atomics.store(control, 0, -1);
  Atomics.notify(control, 0);
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    Atomics.store(control, 0, -1);
    Atomics.notify(control, 0);
    return;
  }
  Atomics.store(control, 2, address.port);
  Atomics.store(control, 0, 1);
  Atomics.notify(control, 0);
  touchOwnedLock();
  timer = setInterval(() => {
    if (Atomics.load(control, 1) !== 0 || touchOwnedLock() === "lost") finish();
  }, workerData.heartbeatMs);
});
`;

const REGISTRY_LOCK_PROBE_SOURCE = `
const net = require("node:net");
const { workerData } = require("node:worker_threads");
const control = new Int32Array(workerData.control);
let finished = false;
function finish(result) {
  if (finished) return;
  finished = true;
  Atomics.store(control, 0, result);
  Atomics.notify(control, 0);
  process.exit(0);
}
const socket = net.createConnection({ host: "127.0.0.1", port: workerData.port });
socket.setEncoding("utf8");
socket.setTimeout(workerData.timeoutMs, () => finish(2));
socket.once("connect", () => socket.write(workerData.token));
socket.once("data", (response) => finish(response === "owned" ? 1 : 2));
socket.once("error", () => finish(2));
socket.once("close", () => finish(2));
`;

function resolveRegistryLockPath(homeDir: string): string {
  fs.mkdirSync(homeDir, { recursive: true });
  return path.resolve(homeDir, WORKTREE_PORT_REGISTRY_LOCK_DIR);
}

function readRegistryLockOwner(lockPath: string): RegistryLockOwner | null {
  for (const ownerFile of [
    WORKTREE_PORT_REGISTRY_LOCK_OWNER_FILE,
    WORKTREE_PORT_REGISTRY_LOCK_OWNER_BACKUP_FILE,
  ]) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(lockPath, ownerFile), "utf8"),
      ) as Partial<RegistryLockOwner>;
      if (
        parsed.version === 1
        && Number.isInteger(parsed.pid)
        && (parsed.pid ?? 0) > 0
        && typeof parsed.processIdentity === "string"
        && parsed.processIdentity.length > 0
        && Number.isInteger(parsed.probePort)
        && (parsed.probePort ?? 0) > 0
        && (parsed.probePort ?? 0) <= 65_535
        && typeof parsed.token === "string"
        && parsed.token.length > 0
      ) {
        return parsed as RegistryLockOwner;
      }
    } catch {
      // Try the redundant owner record.
    }
  }
  return null;
}

function sameRegistryEntry(file: string, expected: RegistryEntryIdentity, directory: boolean): boolean {
  try {
    const current = fs.lstatSync(file, { bigint: true });
    return !current.isSymbolicLink() && (directory ? current.isDirectory() : current.isFile())
      && current.dev === expected.dev && current.ino === expected.ino;
  } catch { return false; }
}

function publishRegistryOwnerFile(lockPath: string, temporary: string, target: string, ownership: RegistryLockOwnership): void {
  const identity = ownership.entries.get(temporary)!;
  const previousTarget = ownership.entries.get(target);
  const targetIsOwnedOrAbsent = () => {
    if (previousTarget) return sameRegistryEntry(target, previousTarget, false);
    try { fs.lstatSync(target); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
  };
  const deadline = Date.now() + 1_000;
  while (true) {
    if (!sameRegistryEntry(lockPath, ownership.directory, true) || !sameRegistryEntry(temporary, identity, false)) {
      throw new Error("Worktree port reservation lock identity changed during owner publication");
    }
    if (!targetIsOwnedOrAbsent()) throw new Error("Worktree port reservation owner target identity changed during publication");
    try {
      fs.renameSync(temporary, target);
      ownership.entries.delete(temporary);
      ownership.entries.set(target, identity);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "") || Date.now() >= deadline) throw error;
      // NTFS readers which omit FILE_SHARE_DELETE can temporarily deny an
      // atomic rename. Retry the same complete, identity-checked file only;
      // never delete the destination or recalculate owner/payload bytes.
      Atomics.wait(sleepSyncBuffer, 0, 0, Math.min(25, deadline - Date.now()));
    }
  }
}

function writeRegistryLockOwner(lockPath: string, owner: RegistryLockOwner, ownership: RegistryLockOwnership): void {
  const contents = `${JSON.stringify(owner)}\n`;
  for (const ownerFile of [
    WORKTREE_PORT_REGISTRY_LOCK_OWNER_FILE,
    WORKTREE_PORT_REGISTRY_LOCK_OWNER_BACKUP_FILE,
  ]) {
    if (!sameRegistryEntry(lockPath, ownership.directory, true)) throw new Error("Worktree port reservation lock identity changed before owner write");
    const ownerPath = path.join(lockPath, ownerFile);
    const temporaryPath = `${ownerPath}.${owner.token}.tmp`;
    const descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    try {
      const identity = fs.fstatSync(descriptor, { bigint: true });
      ownership.entries.set(temporaryPath, identity);
      fs.writeFileSync(descriptor, contents);
    } finally { fs.closeSync(descriptor); }
    publishRegistryOwnerFile(lockPath, temporaryPath, ownerPath, ownership);
  }
}

function removeOwnedRegistryLock(lockPath: string, ownership: RegistryLockOwnership): void {
  if (!sameRegistryEntry(lockPath, ownership.directory, true)) return;
  const entries = fs.readdirSync(lockPath).map(name => path.join(lockPath, name));
  // Retain any unexpected/replaced entry. Recursive cleanup would delete a
  // foreign temporary file even if the outer lock directory stayed the same.
  if (entries.some(file => !ownership.entries.has(file) || !sameRegistryEntry(file, ownership.entries.get(file)!, false))) return;
  for (const file of entries) {
    if (!sameRegistryEntry(lockPath, ownership.directory, true) || !sameRegistryEntry(file, ownership.entries.get(file)!, false)) return;
    fs.unlinkSync(file);
  }
  if (!sameRegistryEntry(lockPath, ownership.directory, true)) return;
  try { fs.rmdirSync(lockPath); }
  catch (error) {
    if (!["ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

function readProcessIdentity(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "linux") {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const commandEnd = stat.lastIndexOf(")");
      if (commandEnd < 0) return null;
      const fields = stat.slice(commandEnd + 1).trim().split(/\s+/);
      const startTicks = fields[19];
      if (!startTicks) return null;
      const bootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      return bootId ? `linux:${bootId}:${startTicks}` : null;
    } catch {
      return null;
    }
  }

  try {
    if (process.platform === "win32") {
      const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const ticks = execFileSync(powershell, [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks`,
      ], { encoding: "utf8", windowsHide: true, timeout: 10_000 }).trim();
      return ticks ? `win32:${ticks}` : null;
    }
    const startedAt = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim();
    return startedAt ? `${process.platform}:${startedAt}` : null;
  } catch {
    return null;
  }
}

function probeRegistryLockOwner(owner: RegistryLockOwner): boolean {
  const control = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(REGISTRY_LOCK_PROBE_SOURCE, {
    eval: true,
    execArgv: [],
    workerData: {
      control: control.buffer,
      port: owner.probePort,
      timeoutMs: WORKTREE_PORT_REGISTRY_LOCK_PROBE_TIMEOUT_MS,
      token: owner.token,
    },
  });
  Atomics.wait(control, 0, 0, WORKTREE_PORT_REGISTRY_LOCK_PROBE_TIMEOUT_MS + 250);
  const isOwner = Atomics.load(control, 0) === 1;
  void worker.terminate();
  return isOwner;
}

function removeStaleRegistryLock(lockPath: string): boolean {
  try {
    const ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (ageMs <= WORKTREE_PORT_REGISTRY_LOCK_STALE_MS) return false;
    const owner = readRegistryLockOwner(lockPath);
    if (owner && isProcessAlive(owner.pid)) {
      if (probeRegistryLockOwner(owner)) return false;
      const currentIdentity = readProcessIdentity(owner.pid);
      // A live PID with an unavailable identity is not proof of PID reuse.
      if (currentIdentity === null || owner.processIdentity === currentIdentity) return false;
    }
    const currentOwner = readRegistryLockOwner(lockPath);
    if (owner ? currentOwner?.token !== owner.token : currentOwner !== null) return false;
    const currentAgeMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (currentAgeMs <= WORKTREE_PORT_REGISTRY_LOCK_STALE_MS) return false;
    fs.rmSync(lockPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function startRegistryLockHeartbeat(lockPath: string, token: string, ownership: RegistryLockOwnership): RegistryLockLease {
  const control = new Int32Array(new SharedArrayBuffer(12));
  const worker = new Worker(REGISTRY_LOCK_HEARTBEAT_SOURCE, {
    eval: true,
    execArgv: [],
    workerData: {
      control: control.buffer,
      heartbeatMs: WORKTREE_PORT_REGISTRY_LOCK_HEARTBEAT_MS,
      lockPath,
      ownerFiles: [
        WORKTREE_PORT_REGISTRY_LOCK_OWNER_FILE,
        WORKTREE_PORT_REGISTRY_LOCK_OWNER_BACKUP_FILE,
      ],
      probeTimeoutMs: WORKTREE_PORT_REGISTRY_LOCK_PROBE_TIMEOUT_MS,
      token,
    },
  });
  Atomics.wait(control, 0, 0, 2_000);
  if (Atomics.load(control, 0) !== 1) {
    void worker.terminate();
    throw new Error(`Failed to start worktree port reservation lock heartbeat at ${lockPath}`);
  }
  const probePort = Atomics.load(control, 2);
  if (probePort <= 0) {
    void worker.terminate();
    throw new Error(`Failed to start worktree port reservation lock probe at ${lockPath}`);
  }
  return { token, worker, control, probePort, ownership };
}

function stopRegistryLockHeartbeat(lease: RegistryLockLease): void {
  Atomics.store(lease.control, 1, 1);
  Atomics.notify(lease.control, 1);
  lease.worker.postMessage("stop");
  if (Atomics.load(lease.control, 0) === 1) {
    Atomics.wait(lease.control, 0, 1, 2_000);
  }
  void lease.worker.terminate();
}

function acquireRegistryLock(lockPath: string, deadline: number): RegistryLockLease | null {
  try { fs.mkdirSync(lockPath); }
  catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (code !== "EEXIST") throw error;
    if (removeStaleRegistryLock(lockPath)) return null;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for worktree port reservation lock at ${lockPath}`);
    return null;
  }
  const directory = fs.lstatSync(lockPath, { bigint: true });
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Worktree port reservation lock is not a directory");
  const ownership: RegistryLockOwnership = { directory, entries: new Map() };
  const token = `${process.pid}-${randomUUID()}`;
  let lease: RegistryLockLease | null = null;
  try {
    const processIdentity = readProcessIdentity(process.pid);
    if (!processIdentity) throw new Error("Cannot determine worktree port reservation lock owner identity");
    const owner: RegistryLockOwner = { version: 1, pid: process.pid, processIdentity, probePort: 1, token };
    writeRegistryLockOwner(lockPath, owner, ownership);
    lease = startRegistryLockHeartbeat(lockPath, token, ownership);
    writeRegistryLockOwner(lockPath, { ...owner, probePort: lease.probePort }, ownership);
    return lease;
  } catch (error) {
    if (lease) stopRegistryLockHeartbeat(lease);
    try { removeOwnedRegistryLock(lockPath, ownership); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Worktree port reservation lock publication and owned cleanup failed");
    }
    throw error;
  }
}

function releaseRegistryLock(lockPath: string, lease: RegistryLockLease): void {
  stopRegistryLockHeartbeat(lease);
  if (!sameRegistryEntry(lockPath, lease.ownership.directory, true)) return;
  const owner = readRegistryLockOwner(lockPath);
  if (owner?.token !== lease.token) return;
  removeOwnedRegistryLock(lockPath, lease.ownership);
}

export function withWorktreePortRegistryLockSync<T>(homeDir: string, run: () => T): T {
  const lockPath = resolveRegistryLockPath(homeDir);
  const deadline = Date.now() + WORKTREE_PORT_REGISTRY_LOCK_TIMEOUT_MS;
  let lease: RegistryLockLease | null = null;

  while (!(lease = acquireRegistryLock(lockPath, deadline))) {
    Atomics.wait(sleepSyncBuffer, 0, 0, 25);
  }

  try {
    return run();
  } finally {
    releaseRegistryLock(lockPath, lease);
  }
}

export async function withWorktreePortRegistryLock<T>(
  homeDir: string,
  run: () => Promise<T>,
): Promise<T> {
  const lockPath = resolveRegistryLockPath(homeDir);
  const deadline = Date.now() + WORKTREE_PORT_REGISTRY_LOCK_TIMEOUT_MS;
  let lease: RegistryLockLease | null = null;

  while (!(lease = acquireRegistryLock(lockPath, deadline))) {
    await delay(25);
  }

  try {
    return await run();
  } finally {
    releaseRegistryLock(lockPath, lease);
  }
}

export function readWorktreePortRegistry(homeDir: string): Set<string> {
  const registryPath = path.resolve(homeDir, WORKTREE_PORT_REGISTRY_FILE);
  if (!fs.existsSync(registryPath)) return new Set();

  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8")) as Partial<WorktreePortRegistry>;
    if (parsed.version !== 1 || !Array.isArray(parsed.configPaths)) return new Set();
    return new Set(
      parsed.configPaths
        .filter((configPath): configPath is string => typeof configPath === "string" && configPath.length > 0)
        .map((configPath) => path.resolve(configPath)),
    );
  } catch {
    return new Set();
  }
}

export function writeWorktreePortRegistry(homeDir: string, configPaths: Iterable<string>): void {
  fs.mkdirSync(homeDir, { recursive: true });
  const registryPath = path.resolve(homeDir, WORKTREE_PORT_REGISTRY_FILE);
  const persistedPaths = Array.from(new Set(Array.from(configPaths, (configPath) => path.resolve(configPath))))
    .filter((configPath) => fs.existsSync(configPath))
    .sort();
  const registry: WorktreePortRegistry = {
    version: 1,
    configPaths: persistedPaths,
  };
  const temporaryPath = `${registryPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, registryPath);
}
