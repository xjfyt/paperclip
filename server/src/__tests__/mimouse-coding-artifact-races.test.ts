import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Hooks surround real OS file operations, not fake file contents/stat receipts.
// The legacy stream hook also makes the descriptor regression fail on old code.
const race = vi.hoisted(() => ({ beforeOpen: undefined as (() => Promise<void>) | undefined,
  beforeRead: undefined as (() => Promise<void>) | undefined, afterRead: undefined as (() => void) | undefined }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, createReadStream: (file: string) => {
    // The regression uses synchronous renames, before the stream opens its fd.
    void race.beforeRead?.(); race.beforeRead = undefined;
    const stream = actual.createReadStream(file);
    stream.once("end", () => { race.afterRead?.(); race.afterRead = undefined; });
    return stream;
  } };
});
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    await race.beforeOpen?.(); race.beforeOpen = undefined;
    const handle = await actual.open(...args); const read = handle.read.bind(handle);
    handle.read = new Proxy(read, { async apply(target, receiver, args) {
      await race.beforeRead?.(); race.beforeRead = undefined;
      const result = await Reflect.apply(target, receiver, args); race.afterRead?.(); race.afterRead = undefined;
      return result;
    } });
    return handle;
  } };
});
import { artifactManifest } from "../services/mimouse-coding/artifacts.js";
const temporaryRoots: string[] = [];
async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "coding-artifact-race-")); temporaryRoots.push(parent);
  const root = path.join(parent, "workspace"); await mkdir(root);
  const file = path.join(root, "app.bin"); await writeFile(file, "original");
  const input = { root, project: "fixture", version: "test", commitSha: "a".repeat(40), artifacts: [{ path: "app.bin", platform: "linux" as const, arch: "x86_64" as const, buildJob: "fixture", testStatus: "not_run" as const, signatureStatus: "unknown" as const }] };
  return { parent, root, file, input };
}
afterEach(async () => {
  race.beforeOpen = race.beforeRead = race.afterRead = undefined;
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
describe("artifact descriptor and path integrity", () => {
  it("hashes a stable file and permits a stable in-root symlink", async () => {
    const f = await fixture(); await symlink("app.bin", path.join(f.root, "link")); f.input.artifacts[0].path = "link";
    const result = await artifactManifest(f.input);
    expect(result.artifacts[0]).toMatchObject({ sha256: createHash("sha256").update("original").digest("hex"), sizeBytes: 8, location: "link" });
    expect(result).toMatchObject({ uploaded: false, productionReleased: false });
  });
  it("never attributes replacement bytes to the restored original inode", async () => {
    const f = await fixture(); const held = path.join(f.root, "held"); const replacement = path.join(f.root, "replacement");
    await writeFile(replacement, "replaced");
    race.beforeRead = async () => { renameSync(f.file, held); renameSync(replacement, f.file); };
    race.afterRead = () => { renameSync(f.file, replacement); renameSync(held, f.file); };
    const result = await artifactManifest(f.input).catch(error => {
      expect(String(error)).toContain("artifact_changed_while_hashing"); return null;
    });
    if (result) expect(result.artifacts[0].sha256).toBe(createHash("sha256").update("original").digest("hex"));
  });
  it("rejects a same-size in-place mutation even if the mtime is restored", async () => {
    const f = await fixture(); const { stat } = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const before = await stat(f.file);
    race.beforeRead = async () => { await writeFile(f.file, "modified"); await utimes(f.file, before.atime, before.mtime); };
    await expect(artifactManifest(f.input)).rejects.toThrow("artifact_changed_while_hashing");
  });
  it("rejects a path replaced after the descriptor is opened", async () => {
    const f = await fixture();
    race.beforeRead = async () => { await rename(f.file, path.join(f.root, "held")); await writeFile(f.file, "replaced"); };
    await expect(artifactManifest(f.input)).rejects.toThrow("artifact_changed_while_hashing");
  });
  it("rejects an escaping symlink", async () => {
    const f = await fixture(); await writeFile(path.join(f.parent, "outside"), "outside");
    await symlink("../outside", path.join(f.root, "escape")); f.input.artifacts[0].path = "escape";
    await expect(artifactManifest(f.input)).rejects.toThrow("artifact_outside_workspace");
  });
  it.skipIf(process.platform === "win32")("rejects a last-component symlink swapped in before open", async () => {
    const f = await fixture();
    race.beforeOpen = async () => { await rename(f.file, path.join(f.root, "held")); await symlink("held", f.file); };
    await expect(artifactManifest(f.input)).rejects.toThrow();
  });
  it.skipIf(process.platform === "win32")("does not hang when a FIFO replaces the file before open", async () => {
    const f = await fixture();
    race.beforeOpen = async () => { await rename(f.file, path.join(f.root, "held")); execFileSync("mkfifo", [f.file]); };
    await expect(artifactManifest(f.input)).rejects.toThrow("artifact_not_file");
  });
});
