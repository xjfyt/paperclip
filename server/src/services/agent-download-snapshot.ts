import fs from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { protectNewPrivatePath } from "@paperclipai/shared/private-filesystem-permissions";
import { logger } from "../middleware/logger.js";

export interface AgentDownloadFile {
  handle: fs.FileHandle;
  size: number;
  identity: BigIntStats;
}

function unchanged(actual: BigIntStats, expected: BigIntStats) {
  return actual.isFile() && actual.nlink === 1n && actual.dev === expected.dev &&
    actual.ino === expected.ino && actual.size === expected.size &&
    actual.mtimeNs === expected.mtimeNs && actual.ctimeNs === expected.ctimeNs;
}

// The caller holds the agent row lock. On Windows release the source handle
// before returning so an editor can atomically replace the original file.
// Disk and the transfer buffer are bounded by the already checked file size.
export async function snapshotAgentDownload(file: AgentDownloadFile) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "paperclip-agent-download-"));
  let snapshot: fs.FileHandle | undefined;
  try {
    protectNewPrivatePath(directory);
    snapshot = await fs.open(path.join(directory, "bytes"), "wx+", 0o600);
    const before = await file.handle.stat({ bigint: true });
    if (before.size !== BigInt(file.size) || !unchanged(before, file.identity)) {
      throw new Error("Agent download changed while taking a snapshot");
    }
    const buffer = Buffer.alloc(64 * 1024);
    for (let offset = 0; offset < file.size;) {
      const { bytesRead } = await file.handle.read(buffer, 0, Math.min(buffer.length, file.size - offset), offset);
      if (!bytesRead) throw new Error("Agent download changed while taking a snapshot");
      for (let written = 0; written < bytesRead;) {
        const result = await snapshot.write(buffer, written, bytesRead - written, offset + written);
        if (!result.bytesWritten) throw new Error("Agent download snapshot could not be written");
        written += result.bytesWritten;
      }
      offset += bytesRead;
    }
    if (!unchanged(await file.handle.stat({ bigint: true }), before)) {
      throw new Error("Agent download changed while taking a snapshot");
    }
    await file.handle.close();
    return { handle: snapshot, size: file.size, directory };
  } catch (error) {
    // A failed close must not skip directory cleanup or replace the copy error.
    const failures: unknown[] = [];
    await snapshot?.close().catch(failure => { failures.push(failure); });
    await fs.rm(directory, { recursive: true, force: true }).catch(failure => { failures.push(failure); });
    if (failures.length) throw new AggregateError([error, ...failures], "Agent download snapshot and cleanup failed", { cause: error });
    throw error;
  }
}

export function agentDownloadStream(file: { handle: fs.FileHandle; size: number; directory?: string }) {
  if (file.size === 0) throw new Error("Empty downloads must close their handle before creating a stream");
  const stream: Readable = file.handle.createReadStream({ start: 0, end: file.size - 1 });
  if (file.directory) {
    const directory = file.directory;
    stream.once("close", () => {
      void fs.rm(directory, { recursive: true, force: true }).catch(error =>
        logger.warn({ err: error }, "Agent download snapshot cleanup failed"));
    });
  }
  return stream;
}
