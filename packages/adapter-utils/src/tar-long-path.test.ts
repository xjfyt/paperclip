import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { createTarballFromDirectory } from "./sandbox-managed-runtime.js";

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
