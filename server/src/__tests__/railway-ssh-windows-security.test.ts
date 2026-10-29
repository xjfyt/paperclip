import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPrivatePermissions, protectNewPrivatePath } from "@paperclipai/shared/private-filesystem-permissions";
import { setFixtureAcl } from "@paperclipai/adapter-utils/test-fixtures/windows-private-acl";
import { instanceId } from "./fixtures/railway/provider.js";
import { generateRailwaySshKey, railwaySshArguments, runRailwaySshCommand } from "../services/railway-ssh.js";

const fixture = vi.hoisted(() => ({ spawn: vi.fn(), actualProtect: undefined as undefined | ((file: string) => void), beforeKeygen: undefined as undefined | ((file: string, args: string[]) => void) }));
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: fixture.spawn, execFile: (...args: Parameters<typeof actual.execFile>) => {
    fixture.beforeKeygen?.(String(args[0]), args[1] as string[]);
    return actual.execFile(...args);
  } };
});
vi.mock("@paperclipai/shared/private-filesystem-permissions", async importOriginal => {
  const actual = await importOriginal<typeof import("@paperclipai/shared/private-filesystem-permissions")>();
  fixture.actualProtect = actual.protectNewPrivatePath;
  return { ...actual, protectNewPrivatePath: vi.fn(actual.protectNewPrivatePath) };
});
let root: string;
const privateKey = "-----BEGIN OPENSSH PRIVATE KEY-----\nsynthetic-local-only\n";
const host = "ssh.railway.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixture";
function input() { return { deploymentInstanceId: instanceId, command: "printf hello", timeoutSeconds: 1, privateKey, knownHosts: host, signal: new AbortController().signal }; }
function sddl(file: string) {
  const script = "$p=$env:PAPERCLIP_FIXTURE_ACL_TARGET; $a=[IO.Directory]::GetAccessControl($p); [Console]::Out.Write($a.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All))";
  return execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { encoding: "utf8", windowsHide: true, env: { ...process.env, PAPERCLIP_FIXTURE_ACL_TARGET: file } }).trim();
}
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "paperclip-railway-windows-security-"));
  vi.stubEnv("TEMP", root); vi.stubEnv("TMP", root);
  fixture.spawn.mockReset(); fixture.beforeKeygen = undefined;
  vi.mocked(protectNewPrivatePath).mockReset().mockImplementation(file => fixture.actualProtect!(file));
});
afterEach(() => { fixture.beforeKeygen = undefined; vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

describe.skipIf(process.platform !== "win32")("native Windows Railway SSH storage", () => {
  it("uses the fixed real keygen only after protecting its new empty directory", async () => {
    const checked: string[] = [];
    vi.mocked(protectNewPrivatePath).mockImplementation(file => {
      expect(lstatSync(file).isDirectory()).toBe(true);
      expect(readdirSync(file)).toEqual([]);
      fixture.actualProtect!(file);
      checked.push(file);
    });
    fixture.beforeKeygen = (file, args) => {
      expect(file).toBe(path.join(process.env.SystemRoot!, "System32", "OpenSSH", "ssh-keygen.exe"));
      const keyPath = args[args.indexOf("-f") + 1]!;
      expect(checked).toContain(path.dirname(keyPath));
      expect(hasPrivatePermissions(path.dirname(keyPath), 0)).toBe(true);
      expect(existsSync(keyPath)).toBe(false);
    };
    const key = await generateRailwaySshKey();
    expect(key.publicKey).toMatch(/^ssh-ed25519 /);
    expect(key.privateKey).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----/);
    expect(checked).toHaveLength(1);
    expect(readdirSync(root)).toEqual([]);
  }, 30000);
  it("protects empty command paths before the first secret byte, uses fixed SSH and excludes ambient state", async () => {
    const protectedPaths: string[] = [];
    vi.stubEnv("SSH_AUTH_SOCK", "must-not-forward"); vi.stubEnv("PAPERCLIP_API_KEY", "must-not-forward");
    vi.mocked(protectNewPrivatePath).mockImplementation(file => {
      const stat = lstatSync(file);
      if (stat.isDirectory()) expect(readdirSync(file)).toEqual([]); else expect(stat.size).toBe(0);
      fixture.actualProtect!(file); protectedPaths.push(file);
    });
    fixture.spawn.mockImplementation((command, args, options) => {
      expect(command).toBe(path.join(process.env.SystemRoot!, "System32", "OpenSSH", "ssh.exe"));
      expect(options.env).not.toHaveProperty("SSH_AUTH_SOCK"); expect(options.env).not.toHaveProperty("PAPERCLIP_API_KEY");
      expect(options.env).not.toHaveProperty("HOME"); expect(options.env).not.toHaveProperty("USERPROFILE");
      const key = args[args.indexOf("-i") + 1];
      expect(readFileSync(key, "utf8")).toBe(privateKey);
      expect(hasPrivatePermissions(key, 0)).toBe(true);
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
      let script = ""; child.stdin.on("data", chunk => { script += chunk; });
      child.stdin.on("finish", () => { const marker = script.match(/paperclip_railway_completed_[a-f0-9]+/)![0]; child.stdout.write(`ok\n${marker}:0\n`); child.emit("close", 0); });
      return child;
    });
    expect(await runRailwaySshCommand(input())).toMatchObject({ exitCode: 0, stdout: "ok" });
    expect(protectedPaths).toHaveLength(3);
    expect(protectedPaths.every(file => !existsSync(file))).toBe(true);
    expect(readdirSync(root)).toEqual([]);
  }, 30000);
  it("rejects unavailable fixed tools before creating any SSH state without using ambient PATH", async () => {
    vi.stubEnv("SystemRoot", path.join(root, "missing-os"));
    await expect(generateRailwaySshKey()).rejects.toMatchObject({ code: "railway_ssh_unavailable", status: 422 });
    await expect(runRailwaySshCommand(input())).rejects.toMatchObject({ code: "railway_ssh_unavailable", status: 422 });
    expect(protectNewPrivatePath).not.toHaveBeenCalled(); expect(fixture.spawn).not.toHaveBeenCalled();
    expect(readdirSync(root)).toEqual([]);
  });
  it("refuses private setup failure before writing a key or spawning SSH and preserves unrelated old ACLs", async () => {
    const oldHome = path.join(root, "old-home"); mkdirSync(oldHome);
    writeFileSync(path.join(oldHome, "identity"), "old synthetic bytes"); setFixtureAcl(root, oldHome, true);
    const before = sddl(oldHome); vi.stubEnv("HOME", oldHome); vi.stubEnv("USERPROFILE", oldHome);
    vi.mocked(protectNewPrivatePath).mockImplementation(file => {
      expect(file).not.toBe(oldHome); expect(lstatSync(file).isDirectory()).toBe(true);
      expect(readdirSync(file)).toEqual([]); throw new Error("synthetic private probe unavailable");
    });
    await expect(generateRailwaySshKey()).rejects.toMatchObject({ code: "railway_ssh_private_material_unavailable" });
    await expect(runRailwaySshCommand(input())).rejects.toMatchObject({ code: "railway_ssh_private_material_unavailable" });
    expect(fixture.spawn).not.toHaveBeenCalled();
    expect(readFileSync(path.join(oldHome, "identity"), "utf8")).toBe("old synthetic bytes");
    expect(sddl(oldHome)).toBe(before); expect(readdirSync(root)).toEqual(["old-home"]);
  }, 30000);
  it("validates the native null-config arguments through real OpenSSH without connecting", () => {
    const runtime = path.join(process.env.SystemRoot!, "System32", "OpenSSH");
    // Configuration parsing needs an existing identity path, but reads no key
    // bytes and opens no network connection.
    writeFileSync(path.join(root, "identity"), "");
    const args = ["-G", ...railwaySshArguments(root, instanceId)];
    const output = execFileSync(path.join(runtime, "ssh.exe"), args, { encoding: "utf8", windowsHide: true,
      env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot, ProgramData: process.env.ProgramData, PATH: runtime, LANG: "C.UTF-8" } });
    expect(output).toContain("hostname ssh.railway.com");
    expect(output).toContain("stricthostkeychecking true");
    expect(output).toContain("identityagent none");
  });
});
