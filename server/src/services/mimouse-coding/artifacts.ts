import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
export async function artifactManifest(input: { project: string; version: string; commitSha: string; root: string; artifacts: Array<{ path: string; platform: "windows" | "macos" | "linux"; arch: "x86_64" | "arm64"; buildJob: string; testStatus: "passed" | "failed" | "not_run"; signatureStatus: "verified" | "unsigned" | "unknown" }> }) {
  if (!/^[a-f0-9]{40}$/.test(input.commitSha)) throw Error("invalid_commit_sha");
  const root = await realpath(input.root); const artifacts = [];
  for (const artifact of input.artifacts) {
    if (path.isAbsolute(artifact.path)) throw Error("artifact_requires_relative_path");
    const file = await realpath(path.resolve(root, artifact.path));
    if (!file.startsWith(root + path.sep)) throw Error("artifact_outside_workspace");
    const metadata = await stat(file); if (!metadata.isFile()) throw Error("artifact_not_file");
    const hash = createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk);
    const after = await stat(file);
    if (after.ino !== metadata.ino || after.size !== metadata.size || after.mtimeMs !== metadata.mtimeMs) throw Error("artifact_changed_while_hashing");
    artifacts.push({ ...artifact, fileName: path.basename(file), sizeBytes: metadata.size, sha256: hash.digest("hex"), location: artifact.path });
  }
  return { schemaVersion: 1, project: input.project, version: input.version, commitSha: input.commitSha, artifacts, uploaded: false, productionReleased: false };
}
