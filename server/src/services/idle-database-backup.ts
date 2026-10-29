import { constants, createReadStream, promises as fs, type BigIntStats } from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { syncDirectory } from "../utils/sync-directory.js";

// The marker survives process replacement on persistent instance storage.
// It contains no credentials or tenant data, and never substitutes for a dump.
export const idleBackupWakeMarker = (directory: string) => path.join(directory, ".idle-backup-wake-required");

async function openRegularFileWithoutLinks(file: string, flags: number, mode?: number) {
  const before = await fs.lstat(file, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (before && (!before.isFile() || before.isSymbolicLink())) throw new Error("Idle backup path must be a regular file without links");
  const handle = await fs.open(file, flags | constants.O_NOFOLLOW, mode);
  try {
    const opened = await handle.stat({ bigint: true });
    const current = await fs.lstat(file, { bigint: true });
    if (!opened.isFile() || !current.isFile() || current.isSymbolicLink()
      || current.dev !== opened.dev || current.ino !== opened.ino
      || (before && (before.dev !== opened.dev || before.ino !== opened.ino))) throw new Error("Idle backup path changed while opening");
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

async function assertOpenedFileUnchanged(file: string, handle: Awaited<ReturnType<typeof fs.open>>, expected: BigIntStats) {
  const opened = await handle.stat({ bigint: true });
  const current = await fs.lstat(file, { bigint: true });
  if (!current.isFile() || current.isSymbolicLink() || current.dev !== opened.dev || current.ino !== opened.ino
    || opened.dev !== expected.dev || opened.ino !== expected.ino || opened.size !== expected.size
    || opened.mtimeNs !== expected.mtimeNs || opened.ctimeNs !== expected.ctimeNs) {
    throw new Error("Idle backup path or contents changed during verification");
  }
}

export async function markIdleBackupWakeRequired(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  const markerFile = idleBackupWakeMarker(directory);
  const marker = await openRegularFileWithoutLinks(markerFile, constants.O_WRONLY | constants.O_CREAT, 0o600);
  try {
    await marker.writeFile("Take a fresh database backup after this process restarts.\n");
    await marker.sync();
    const current = await fs.lstat(markerFile, { bigint: true });
    const opened = await marker.stat({ bigint: true });
    if (!current.isFile() || current.isSymbolicLink() || current.dev !== opened.dev || current.ino !== opened.ino) throw new Error("Idle backup marker changed during persistence");
  } finally { await marker.close(); }
  await syncDirectory(directory);
}

/** Read the entire archive to verify the gzip trailer, then persist its bytes
 * and directory entry before allowing compute to stop. The backup runner
 * retains its in-flight receipt until this function settles. */
export async function verifyIdleDatabaseBackup(backupFile: string): Promise<void> {
  // FlushFileBuffers requires a write-capable Windows handle. Opening it for
  // read/write does not truncate or change the archive's permissions/contents.
  const handle = await openRegularFileWithoutLinks(backupFile, process.platform === "win32" ? constants.O_RDWR : constants.O_RDONLY);
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || stat.size === 0n) throw new Error("Idle backup archive is empty or invalid");
    let bytes = 0;
    await pipeline(
      createReadStream(backupFile, { fd: handle.fd, autoClose: false }),
      createGunzip(),
      new Writable({ write(chunk, _encoding, done) { bytes += chunk.length; done(); } }),
    );
    if (bytes === 0) throw new Error("Idle backup archive contains no SQL");
    await assertOpenedFileUnchanged(backupFile, handle, stat);
    await handle.sync();
    await assertOpenedFileUnchanged(backupFile, handle, stat);
  } finally { await handle.close(); }
  await syncDirectory(path.dirname(backupFile));
}

export async function clearIdleBackupWakeRequired(directory: string): Promise<void> {
  await fs.unlink(idleBackupWakeMarker(directory)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await syncDirectory(directory);
}
