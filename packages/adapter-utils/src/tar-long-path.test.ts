import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { createTarballFromDirectory, extractTarballToDirectory } from "./sandbox-managed-runtime.js";

it("archives a real directory beyond the Windows legacy path limit without a self entry", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-tar-long-"));
  const source = path.join(root, "segment".repeat(20), "nested".repeat(20));
  try {
    expect(source.length).toBeGreaterThan(260);
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, "payload.txt"), "unchanged owned fixture\n");
    const archive = path.join(root, "archive.tar");
    await createTarballFromDirectory({ localDir: source, archivePath: archive });
    const { stdout } = await promisify(execFile)("tar", ["-tf", archive]);
    expect(stdout.replaceAll("\r\n", "\n")).toBe("payload.txt\n");
    const extracted = await promisify(execFile)("tar", ["-xOf", archive, "payload.txt"]);
    expect(extracted.stdout).toBe("unchanged owned fixture\n");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// Inspect the real uncompressed tar bytes: Windows bsdtar also corrupts some
// UTF-8 names when listing/extracting GNU archives, so it cannot be our oracle.
async function tarMembers(archive: string) {
  const bytes = await fs.readFile(archive);
  const members = new Map<string, { kind: string; target: string; body: Buffer }>();
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start: number, length: number) => header.subarray(start, start + length).toString("utf8").split("\0")[0]!;
    const prefix = text(257, 6) === "ustar" ? text(345, 155) : "";
    const name = `${prefix ? `${prefix}/` : ""}${text(0, 100)}`;
    const size = Number.parseInt(text(124, 12).trim() || "0", 8);
    expect(Number.isSafeInteger(size) && size >= 0).toBe(true);
    expect(offset + 512 + size).toBeLessThanOrEqual(bytes.length);
    const kind = text(156, 1);
    // PAX extension headers are archive metadata, not workspace members.
    if (kind !== "x" && kind !== "g") {
      members.set(name, { kind, target: text(157, 100), body: bytes.subarray(offset + 512, offset + 512 + size) });
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return members;
}
afterEach(() => vi.unstubAllEnvs());

it("preserves UTF-8 NUL entry names, exclusions and symlinks beyond the legacy path limit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-tar-unicode-"));
  const source = path.join(root, "segment".repeat(20), "nested".repeat(20));
  const payloads = new Map([
    ["雪-💾.txt", Buffer.from([0, 255, 128, 10])],
    ["--odd 雪.txt", Buffer.from("dash-prefixed name is data\n")],
    ["nested/原稿.txt", Buffer.from("original nested bytes\n")],
  ]);
  try {
    expect(source.length).toBeGreaterThan(260);
    await fs.mkdir(path.join(source, "nested"), { recursive: true });
    await fs.mkdir(path.join(source, ".git"));
    for (const [name, bytes] of payloads) await fs.writeFile(path.join(source, name), bytes);
    await fs.writeFile(path.join(source, ".git", "private"), "excluded git metadata");
    await fs.writeFile(path.join(source, "excluded.txt"), "explicitly excluded");
    await fs.writeFile(path.join(source, "._resource"), "excluded resource fork");
    await fs.symlink("雪-💾.txt", path.join(source, "unicode-link"));
    const archive = path.join(root, "archive with spaces.tar");
    await createTarballFromDirectory({ localDir: source, archivePath: archive, exclude: [".git", "excluded.txt"] });
    const members = await tarMembers(archive);
    expect(new Set(members.keys())).toEqual(new Set([...payloads.keys(), "nested/", "unicode-link"]));
    expect([...members.keys()].some((name) => name === "." || name.startsWith("./"))).toBe(false);
    for (const [name, body] of payloads) expect(members.get(name)?.body).toEqual(body);
    expect(members.get("unicode-link")).toMatchObject({ kind: "2", target: "雪-💾.txt" });
    const output = path.join(root, "extracted");
    await extractTarballToDirectory({ archivePath: archive, localDir: output });
    for (const [name, body] of payloads) expect(await fs.readFile(path.join(output, name))).toEqual(body);
    expect((await fs.lstat(path.join(output, "unicode-link"))).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(path.join(output, "unicode-link"))).toBe("雪-💾.txt");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it("follows Unicode symlinks only when explicitly requested", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-tar-follow-"));
  try {
    const source = path.join(root, "source");
    await fs.mkdir(source);
    const body = Buffer.from("unmodified Unicode link target\n");
    await fs.writeFile(path.join(source, "雪-💾.txt"), body);
    await fs.symlink("雪-💾.txt", path.join(source, "unicode-link"));
    const archive = path.join(root, "archive.tar");
    await createTarballFromDirectory({ localDir: source, archivePath: archive, followSymlinks: true });
    const members = await tarMembers(archive);
    expect(new Set(members.keys())).toEqual(new Set(["雪-💾.txt", "unicode-link"]));
    expect(["", "0", "1"]).toContain(members.get("unicode-link")?.kind);
    const output = path.join(root, "extracted");
    await extractTarballToDirectory({ archivePath: archive, localDir: output });
    expect((await fs.lstat(path.join(output, "unicode-link"))).isSymbolicLink()).toBe(false);
    expect(await fs.readFile(path.join(output, "unicode-link"))).toEqual(body);
    expect(await fs.readFile(path.join(output, "雪-💾.txt"))).toEqual(body);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it.runIf(process.platform === "win32")("requires GNU tar explicitly instead of falling back to Windows bsdtar", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-tar-unavailable-"));
  try {
    const source = path.join(root, "source");
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, "雪-💾.txt"), "must never be silently renamed");
    const archive = path.join(root, "archive.tar");
    vi.stubEnv("PATH", path.join(process.env.SystemRoot ?? "C:\Windows", "System32"));
    for (const key of ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]) vi.stubEnv(key, path.join(root, "absent-installation"));
    await expect(createTarballFromDirectory({ localDir: source, archivePath: archive }))
      .rejects.toThrow("windows_workspace_archive_requires_gnu_tar");
    await expect(fs.stat(archive)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(source, "雪-💾.txt"), "utf8")).toBe("must never be silently renamed");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
