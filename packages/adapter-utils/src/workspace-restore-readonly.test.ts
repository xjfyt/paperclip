import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { captureDirectorySnapshot, disposeDirectorySnapshot, mergeDirectoryWithBaseline } from "./workspace-restore-merge.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-readonly-restore-"));
  roots.push(root);
  const target = path.join(root, "target");
  const source = path.join(root, "source");
  const outside = path.join(root, "outside.txt");
  await fs.mkdir(target);
  await fs.mkdir(source);
  await fs.writeFile(outside, "outside must remain unchanged");
  const outsideStat = await fs.stat(outside);
  const baseline = await captureDirectorySnapshot(target, { exclude: [] });
  await fs.writeFile(path.join(target, "concurrent.txt"), "keep concurrent target bytes");
  const incoming = path.join(source, "readonly.txt");
  await fs.writeFile(incoming, "incoming read-only bytes");
  await fs.chmod(incoming, 0o444);
  return { root, target, source, outside, outsideStat, baseline, incoming };
}

it("restores real read-only source bytes without widening the final mode or writing outside the target", async () => {
  const data = await fixture();
  try {
    await mergeDirectoryWithBaseline({ baseline: data.baseline, sourceDir: data.source, targetDir: data.target });
    const restored = path.join(data.target, "readonly.txt");
    expect(await fs.readFile(restored, "utf8")).toBe("incoming read-only bytes");
    expect((await fs.stat(restored)).mode & 0o777).toBe(0o444);
    expect((await fs.stat(data.incoming)).mode & 0o777).toBe(0o444);
    expect(await fs.readFile(path.join(data.target, "concurrent.txt"), "utf8")).toBe("keep concurrent target bytes");
    expect((await fs.readdir(data.target)).sort()).toEqual(["concurrent.txt", "readonly.txt"]);
    expect(await fs.readFile(data.outside, "utf8")).toBe("outside must remain unchanged");
    expect((await fs.stat(data.outside)).mtimeMs).toBe(data.outsideStat.mtimeMs);
    expect((await fs.stat(data.outside)).mode).toBe(data.outsideStat.mode);
    if (process.platform === "win32" || process.getuid?.() !== 0) {
      await expect(fs.open(restored, "r+")).rejects.toMatchObject({ code: process.platform === "win32" ? "EPERM" : "EACCES" });
    }
  } finally { await disposeDirectorySnapshot(data.baseline); }
});

it("preserves the fsync failure, removes the read-only temp and leaves existing/outside bytes untouched", async () => {
  const data = await fixture();
  const failure = new Error("synthetic readonly flush failure");
  const originalOpen = fs.open.bind(fs);
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    if (typeof args[0] === "string" && path.basename(args[0]).startsWith(".paperclip-merge-")) {
      handle.sync = async () => { throw failure; };
    }
    return handle;
  });
  try {
    await expect(mergeDirectoryWithBaseline({ baseline: data.baseline, sourceDir: data.source, targetDir: data.target })).rejects.toBe(failure);
    expect(await fs.readdir(data.target)).toEqual(["concurrent.txt"]);
    expect(await fs.readFile(path.join(data.target, "concurrent.txt"), "utf8")).toBe("keep concurrent target bytes");
    expect(await fs.readFile(data.outside, "utf8")).toBe("outside must remain unchanged");
    expect((await fs.stat(data.outside)).mtimeMs).toBe(data.outsideStat.mtimeMs);
    expect((await fs.stat(data.incoming)).mode & 0o777).toBe(0o444);
  } finally { await disposeDirectorySnapshot(data.baseline); }
});
