import { constants } from "node:fs";
import { mkdtemp, readFile, writeFile, stat, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stageNativeRunnerAttachmentBytes } from "./native-runner-file-handoff.js";

const control = vi.hoisted(() => ({ redirectedPath: null as string | null, redirects: 0 }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: (...args: Parameters<typeof actual.open>) => {
      if (
        control.redirectedPath &&
        String(args[0]).replaceAll("\\", "/").includes("/.paperclip-inbound/")
      ) {
        control.redirects++;
        return actual.open(control.redirectedPath, constants.O_RDWR);
      }
      return actual.open(...args);
    },
  };
});

const roots: string[] = [];
async function fixtureRoot(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix)); roots.push(root); return root;
}
async function assertNoPayload(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    expect(entry.isSymbolicLink()).toBe(false);
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await assertNoPayload(file);
    else expect((await readFile(file)).length).toBe(0);
  }
}
afterEach(async () => {
  control.redirectedPath = null; control.redirects = 0;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("confined native attachment staging", () => {
  it(process.platform === "win32" ? "refuses an unverifiable empty file without staging payload bytes" : "stages an inspectable empty file and cleans it idempotently", async () => {
    const workspaceRoot = await fixtureRoot("native-empty-stage-");
    const staging = stageNativeRunnerAttachmentBytes({
      workspaceRoot,
      body: Buffer.alloc(0),
    });
    if (process.platform === "win32") {
      await expect(staging).rejects.toThrow("descriptor_unverifiable");
      await assertNoPayload(workspaceRoot);
      return;
    }
    const stage = await staging;
    expect(
      await readFile(path.join(workspaceRoot, stage.workspaceRelativePath)),
    ).toEqual(Buffer.alloc(0));
    await stage.cleanup();
    await stage.cleanup();
  });

  it("never truncates an outside inode when an open is redirected before validation", async () => {
    const workspaceRoot = await fixtureRoot("native-stage-raced-open-");
    const outside = path.join(
      await fixtureRoot("native-stage-outside-"),
      "keep.txt",
    );
    await writeFile(outside, "untouched external bytes");
    const staging = stageNativeRunnerAttachmentBytes({
      workspaceRoot,
      body: Buffer.from("initial"),
    });
    const slot = process.platform === "win32" ? null : await staging;
    if (slot) await slot.cleanup();
    else await expect(staging).rejects.toThrow("descriptor_unverifiable");
    control.redirectedPath = outside;
    try {
      await expect(
        stageNativeRunnerAttachmentBytes({
          workspaceRoot,
          body: Buffer.from("new"),
        }),
      ).rejects.toThrow(process.platform === "win32" ? "descriptor_unverifiable" : "path_denied");
    } finally {
      control.redirectedPath = null;
    }
    expect(control.redirects).toBeGreaterThan(0);
    expect(await readFile(outside, "utf8")).toBe("untouched external bytes");
    if (slot) expect(
      (await stat(path.join(workspaceRoot, slot.workspaceRelativePath))).size,
    ).toBe(0);
    else await assertNoPayload(workspaceRoot);
  });
});
