import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { hasPrivatePermissions, protectNewPrivatePath } from "./private-filesystem-permissions.js";

vi.mock("./plugin.js", async () => {
  const { NOOP_PLUGIN_TRACER } = await import("@paperclipai/plugin-sdk");
  return { getPluginTracer: () => NOOP_PLUGIN_TRACER };
});
import { performSyncOut } from "./file-sync.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

it("keeps the standalone permission implementation byte-identical to its canonical shared source", () => {
  const local = readFileSync(new URL("./private-filesystem-permissions.ts", import.meta.url), "utf8");
  const canonical = readFileSync(new URL("../../../../shared/src/private-filesystem-permissions.ts", import.meta.url), "utf8");
  expect(local.slice(local.indexOf("\n") + 1)).toBe(canonical);
});

it.runIf(process.platform === "win32")("restores an ordinary workspace without changing its existing broad directory ACL while keeping incoming payload private", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-daytona-acl-"));
  roots.push(root);
  const target = path.join(root, "target");
  await fs.mkdir(target);
  protectNewPrivatePath(target);
  const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = "$ErrorActionPreference='Stop';$p=$env:PAPERCLIP_TEST_ACL_PATH;$a=[IO.Directory]::GetAccessControl($p);$s=[Security.Principal.SecurityIdentifier]::new('S-1-1-0');$a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($s,[Security.AccessControl.FileSystemRights]::ReadAndExecute,[Security.AccessControl.AccessControlType]::Allow));[IO.Directory]::SetAccessControl($p,$a)";
  execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { env: { ...process.env, PAPERCLIP_TEST_ACL_PATH: target }, windowsHide: true, stdio: "pipe" });
  expect(hasPrivatePermissions(target, (await fs.stat(target)).mode)).toBe(false);
  const readAcl = () => execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from("[Console]::Out.Write([IO.Directory]::GetAccessControl($env:PAPERCLIP_TEST_ACL_PATH).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All))", "utf16le").toString("base64")], { env: { ...process.env, PAPERCLIP_TEST_ACL_PATH: target }, windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const originalAcl = readAcl();
  await fs.writeFile(path.join(target, "keep.txt"), "preserve existing bytes");
  await fs.writeFile(path.join(root, "incoming.txt"), "incoming private payload");
  const archive = path.join(root, "safe.tar");
  execFileSync("tar", ["-cf", archive, "-C", root, "incoming.txt"]);
  const sandbox = {
    process: { executeCommand: async () => ({ exitCode: 0 }) },
    fs: {
      downloadFiles: async (requests: Array<{ source: string; destination: string }>) => {
        for (const request of requests) await fs.copyFile(archive, request.destination);
        return requests.map(request => ({ source: request.source }));
      },
      deleteFile: async () => undefined,
    },
  };
  await expect(performSyncOut({ sandbox: sandbox as never, remoteDir: "/workspace", timeoutSeconds: 30,
    operations: [{ operationId: "acl", files: [{ sourcePath: "/workspace/source", targetPath: target, kind: "directory" }] }],
  })).resolves.toBeDefined();
  expect(hasPrivatePermissions(target, (await fs.stat(target)).mode)).toBe(false);
  expect(readAcl()).toBe(originalAcl);
  expect((await fs.readdir(target)).sort()).toEqual(["incoming.txt", "keep.txt"]);
  expect(await fs.readFile(path.join(target, "incoming.txt"), "utf8")).toBe("incoming private payload");
  expect(hasPrivatePermissions(path.join(target, "incoming.txt"), (await fs.stat(path.join(target, "incoming.txt"))).mode)).toBe(true);
  expect(await fs.readFile(path.join(target, "keep.txt"), "utf8")).toBe("preserve existing bytes");
  expect((await fs.readdir(root)).filter(name => name.startsWith(".paperclip-extract-"))).toEqual([]);
}, 60_000);

it.runIf(process.platform === "win32")("rejects an existing host junction before installing any staged member and preserves outside bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-daytona-hostlink-"));
  roots.push(root);
  const target = path.join(root, "target");
  const outside = path.join(root, "outside");
  const source = path.join(root, "source");
  await fs.mkdir(target);
  await fs.mkdir(outside);
  await fs.mkdir(path.join(source, "z-junction"), { recursive: true });
  await fs.writeFile(path.join(outside, "keep.txt"), "outside sentinel");
  const before = await fs.stat(path.join(outside, "keep.txt"));
  await fs.symlink(outside, path.join(target, "z-junction"), "junction");
  await fs.writeFile(path.join(source, "a-first.txt"), "must not install before all paths validate");
  await fs.writeFile(path.join(source, "z-junction", "incoming.txt"), "must not write outside");
  const archive = path.join(root, "safe.tar");
  execFileSync("tar", ["-cf", archive, "-C", source, "a-first.txt", "z-junction"]);
  const sandbox = {
    process: { executeCommand: async () => ({ exitCode: 0 }) },
    fs: {
      downloadFiles: async (requests: Array<{ source: string; destination: string }>) => {
        for (const request of requests) await fs.copyFile(archive, request.destination);
        return requests.map(request => ({ source: request.source }));
      },
      deleteFile: async () => undefined,
    },
  };
  await expect(performSyncOut({ sandbox: sandbox as never, remoteDir: "/workspace", timeoutSeconds: 30,
    operations: [{ operationId: "junction", files: [{ sourcePath: "/workspace/source", targetPath: target, kind: "directory" }] }],
  })).rejects.toThrow(/refuses an existing link/);
  expect(await fs.readdir(target)).toEqual(["z-junction"]);
  expect(await fs.readdir(outside)).toEqual(["keep.txt"]);
  expect(await fs.readFile(path.join(outside, "keep.txt"), "utf8")).toBe("outside sentinel");
  expect((await fs.stat(path.join(outside, "keep.txt"))).mtimeMs).toBe(before.mtimeMs);
  expect((await fs.readdir(root)).filter(name => name.startsWith(".paperclip-extract-"))).toEqual([]);
}, 60_000);
