import { mkdtemp, mkdir, lstat, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  materializeNativeRuntimeSkills,
  releaseMaterializedNativeRuntimeSkills,
} from "./runtime-context-materializer.js";

describe("empty native runtime skills cleanup", () => {
  it("releases an empty skills home across repeated launches", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperclip-empty-skills-"));
    const home = join(root, "skills");
    try {
      for (let launch = 0; launch < 2; launch += 1) {
        await materializeNativeRuntimeSkills(null, home);
        expect(await readdir(home)).toEqual([]);
        await releaseMaterializedNativeRuntimeSkills(home);
        await expect(lstat(home)).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a linked empty home without removing its target", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperclip-linked-skills-"));
    const target = join(root, "target");
    const home = join(root, "skills");
    try {
      await mkdir(target);
      await symlink(target, home, process.platform === "win32" ? "junction" : "dir");
      await expect(releaseMaterializedNativeRuntimeSkills(home)).rejects.toThrow("without links");
      expect((await lstat(home)).isSymbolicLink()).toBe(true);
      expect(await readdir(target)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
