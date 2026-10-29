import { constants, type BigIntStats } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

function sameFile(before: BigIntStats, after: BigIntStats) {
  return after.isFile() && before.dev === after.dev && before.ino === after.ino && before.size === after.size
    && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}

export async function artifactManifest(input: { project: string; version: string; commitSha: string; root: string; artifacts: Array<{ path: string; platform: "windows" | "macos" | "linux"; arch: "x86_64" | "arm64"; buildJob: string; testStatus: "passed" | "failed" | "not_run"; signatureStatus: "verified" | "unsigned" | "unknown" }> }) {
  if (!/^[a-f0-9]{40}$/.test(input.commitSha)) throw Error("invalid_commit_sha");
  const root = await realpath(input.root); const artifacts = [];
  for (const artifact of input.artifacts) {
    if (path.isAbsolute(artifact.path)) throw Error("artifact_requires_relative_path");
    const requested = path.resolve(root, artifact.path);
    const file = await realpath(requested);
    if (!file.startsWith(root + path.sep)) throw Error("artifact_outside_workspace");
    // Resolve stable in-root symlinks first, then refuse a last-component symlink
    // replacement. NONBLOCK prevents a FIFO swap from hanging before fstat.
    // This is not an atomic sandbox of every ancestor directory (no openat2).
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const metadata = await handle.stat({ bigint: true });
      if (!metadata.isFile()) throw Error("artifact_not_file");
      if (metadata.size > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("artifact_too_large");
      const hash = createHash("sha256"); const buffer = Buffer.alloc(64 * 1024); let bytes = 0n;
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        bytes += BigInt(bytesRead);
        if (bytes > metadata.size) throw Error("artifact_changed_while_hashing");
        hash.update(buffer.subarray(0, bytesRead));
      }
      const after = await handle.stat({ bigint: true });
      // Check both the descriptor and the caller's final path. A rename/symlink
      // swap must not return a digest attributed to a different current file.
      if (bytes !== metadata.size || !sameFile(metadata, after) || await realpath(requested) !== file
        || !sameFile(metadata, await stat(file, { bigint: true }))) throw Error("artifact_changed_while_hashing");
      artifacts.push({ ...artifact, fileName: path.basename(file), sizeBytes: Number(metadata.size), sha256: hash.digest("hex"), location: artifact.path });
    } finally { await handle.close(); }
  }
  return { schemaVersion: 1, project: input.project, version: input.version, commitSha: input.commitSha, artifacts, uploaded: false, productionReleased: false };
}
