import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildRemoveDeletedPathsCommand } from "./sandbox-managed-runtime.js";
import { runLocalSandboxProcess, shellEnvironment, shellExecutable } from "./test-fixtures/local-sandbox.js";

const roots: string[] = [];
const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
const shellPath = (value: string) => process.platform === "win32"
  ? `/${value[0]!.toLowerCase()}${value.slice(2).replaceAll("\\", "/")}` : value;
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-delete-batches-")));
  roots.push(root);
  const workspace = path.join(root, "workspace"), manifest = path.join(root, "deleted.nul");
  await fs.mkdir(workspace);
  return { root, workspace, manifest };
}
async function run(workspace: string, manifest: string, prefix = "") {
  return runLocalSandboxProcess("workspace-delete-batches", shellExecutable("sh"), ["-c", prefix + buildRemoveDeletedPathsCommand({ remoteDir: shellPath(workspace), manifestPath: shellPath(manifest) })], {
    cwd: workspace, env: shellEnvironment(), timeoutSec: 30, graceSec: 1, onLog: async () => {},
  });
}

it("removes multiple NUL batches using one rm per checked batch and preserves literal odd names", async () => {
  const { root, workspace, manifest } = await fixture();
  const names = [...Array.from({ length: 129 }, (_, index) => `nested/file-${index}`), "-rf", " 雪 space", "quote'file"];
  if (process.platform !== "win32") names.push("line\nbreak");
  await fs.mkdir(path.join(workspace, "nested"));
  await Promise.all(names.map(name => fs.writeFile(path.join(workspace, name), "delete")));
  await fs.writeFile(path.join(workspace, "keep"), "preserved");
  await fs.writeFile(manifest, Buffer.from(names.join("\0") + "\0"));
  const bin = path.join(root, "bin"), calls = path.join(root, "calls");
  await fs.mkdir(bin);
  const realRm = process.platform === "win32" ? shellPath(path.join(path.dirname(shellExecutable("sh")), "rm.exe")) : "/bin/rm";
  await fs.writeFile(path.join(bin, "rm"), `#!/bin/sh\nprintf '%s\\n' "$#" >> ${quote(shellPath(calls))}\nexec ${quote(realRm)} "$@"\n`, { mode: 0o755 });
  const result = await run(workspace, manifest, `PATH=${quote(shellPath(bin))}:"$PATH"; export PATH; `);
  expect(result).toMatchObject({ exitCode: 0, timedOut: false });
  expect((await fs.readFile(calls, "utf8")).trim().split("\n")).toHaveLength(Math.ceil(names.length / 64) + 1);
  for (const name of names) await expect(fs.lstat(path.join(workspace, name))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile(path.join(workspace, "keep"), "utf8")).toBe("preserved");
  await expect(fs.lstat(manifest)).rejects.toMatchObject({ code: "ENOENT" });
}, 40_000);

it.each(["link", "file"] as const)("refuses a %s ancestor before deleting any member of its batch", async kind => {
  const { root, workspace, manifest } = await fixture();
  const outside = path.join(root, "outside");
  await fs.mkdir(outside); await fs.writeFile(path.join(outside, "target"), "outside");
  await fs.writeFile(path.join(workspace, "safe"), "keep on refusal");
  if (kind === "link") await fs.symlink(outside, path.join(workspace, "unsafe"), process.platform === "win32" ? "junction" : "dir");
  else await fs.writeFile(path.join(workspace, "unsafe"), "not a directory");
  await fs.writeFile(manifest, "safe\0unsafe/target\0");
  const result = await run(workspace, manifest);
  expect(result.timedOut).toBe(false); expect(result.exitCode).not.toBe(0);
  expect(await fs.readFile(path.join(workspace, "safe"), "utf8")).toBe("keep on refusal");
  expect(await fs.readFile(path.join(outside, "target"), "utf8")).toBe("outside");
  expect(await fs.readFile(manifest, "utf8")).toBe("safe\0unsafe/target\0");
}, 40_000);

it.each(["file", "directory"] as const)("unlinks a %s leaf link without following it and accepts already missing paths", async kind => {
  const { root, workspace, manifest } = await fixture();
  const outside = path.join(root, "outside");
  if (kind === "directory") await fs.mkdir(outside);
  const payload = kind === "directory" ? path.join(outside, "payload") : outside;
  await fs.writeFile(payload, "outside");
  await fs.symlink(outside, path.join(workspace, "leaf"), kind === "file" ? "file" : process.platform === "win32" ? "junction" : "dir");
  await fs.writeFile(manifest, "leaf\0missing/entry\0");
  expect(await run(workspace, manifest)).toMatchObject({ exitCode: 0, timedOut: false });
  expect(await fs.readFile(payload, "utf8")).toBe("outside");
  await expect(fs.lstat(path.join(workspace, "leaf"))).rejects.toMatchObject({ code: "ENOENT" });
}, 40_000);
