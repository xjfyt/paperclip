import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPrivatePermissions, protectNewPrivatePath } from "@paperclipai/shared/private-filesystem-permissions";
import { setFixtureAcl } from "./helpers/windows-private-acl.js";
import { copySeededSecretsKey } from "../commands/worktree.js";

const hooks = vi.hoisted(() => ({
  descriptors: new Map<number, string>(),
  beforeOpen: undefined as undefined | ((file: string, flags: unknown) => void),
  beforeWrite: undefined as undefined | ((file: string, descriptor: number) => void),
  beforeLink: undefined as undefined | ((source: string, target: string) => void),
  actualProtect: undefined as undefined | ((file: string) => void),
}));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      hooks.beforeOpen?.(String(args[0]), args[1]);
      const fd = actual.openSync(...args); hooks.descriptors.set(fd, String(args[0])); return fd;
    },
    closeSync: (fd: number) => { hooks.descriptors.delete(fd); return actual.closeSync(fd); },
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (typeof args[0] === "number") hooks.beforeWrite?.(hooks.descriptors.get(args[0])!, args[0]);
      return actual.writeFileSync(...args);
    },
    linkSync: (source: string, target: string) => { hooks.beforeLink?.(source, target); return actual.linkSync(source, target); },
  };
});
vi.mock("@paperclipai/shared/private-filesystem-permissions", async importOriginal => {
  const actual = await importOriginal<typeof import("@paperclipai/shared/private-filesystem-permissions")>();
  hooks.actualProtect = actual.protectNewPrivatePath;
  return { ...actual, protectNewPrivatePath: vi.fn(actual.protectNewPrivatePath) };
});

let root: string;
const payload = "synthetic-worktree-secret-local-only";
function target() { return path.join(root, "target", "secrets", "master.key"); }
function input(inline = true): Parameters<typeof copySeededSecretsKey>[0] {
  return { sourceConfigPath: path.join(root, "source", "config.json"),
    sourceConfig: { secrets: { provider: "local_encrypted", localEncrypted: { keyFilePath: path.join(root, "source", "secrets", "master.key") } } } as Parameters<typeof copySeededSecretsKey>[0]["sourceConfig"],
    sourceEnvEntries: inline ? { PAPERCLIP_SECRETS_MASTER_KEY: payload } : {}, targetKeyFilePath: target() };
}
function seedPrivate(file: string, value: string | Buffer) {
  if (!fs.existsSync(path.dirname(file))) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    hooks.actualProtect!(path.dirname(file));
  }
  fs.writeFileSync(file, "", { mode: 0o600, flag: "wx" }); hooks.actualProtect!(file);
  fs.writeFileSync(file, value);
}
function sddl(file: string) {
  const script = "$p=$env:PAPERCLIP_FIXTURE_ACL_TARGET; $d=([IO.File]::GetAttributes($p)-band[IO.FileAttributes]::Directory)-ne 0; $a=if($d){[IO.Directory]::GetAccessControl($p)}else{[IO.File]::GetAccessControl($p)};[Console]::Out.Write($a.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All))";
  return execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { env: { ...process.env, PAPERCLIP_FIXTURE_ACL_TARGET: file }, encoding: "utf8", windowsHide: true }).trim();
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-worktree-key-security-"));
  hooks.beforeOpen = undefined; hooks.beforeWrite = undefined; hooks.beforeLink = undefined; hooks.descriptors.clear();
  vi.mocked(protectNewPrivatePath).mockReset().mockImplementation(file => hooks.actualProtect!(file));
  vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", ""); vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY_FILE", "");
});
afterEach(() => { hooks.beforeOpen = undefined; hooks.beforeWrite = undefined; hooks.beforeLink = undefined; vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe.skipIf(process.platform !== "win32")("native Windows worktree seeded keys", { timeout: 40000 }, () => {
  it("protects exclusively created empty directories and the temporary key before its first byte", () => {
    const protectedPaths: string[] = [];
    vi.mocked(protectNewPrivatePath).mockImplementation(file => {
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) expect(fs.readdirSync(file)).toEqual([]); else expect(stat.size).toBe(0);
      hooks.actualProtect!(file); protectedPaths.push(file);
    });
    let writes = 0;
    hooks.beforeWrite = (file, fd) => { writes++; expect(fs.fstatSync(fd).size).toBe(0); expect(hasPrivatePermissions(file, 0)).toBe(true); };
    copySeededSecretsKey(input());
    expect(writes).toBe(1); expect(protectedPaths).toHaveLength(3);
    expect(fs.readFileSync(target(), "utf8")).toBe(payload);
    expect(hasPrivatePermissions(target(), 0)).toBe(true);
    expect(fs.readdirSync(path.dirname(target()))).toEqual(["master.key"]);
  });
  it("copies real private source bytes without changing the source key or ACL", () => {
    const request = input(false), source = request.sourceConfig.secrets.localEncrypted.keyFilePath;
    const bytes = Buffer.from([0, 1, 255, 36, 92, 10]); seedPrivate(source, bytes);
    const before = sddl(source), directoryBefore = sddl(path.dirname(source));
    copySeededSecretsKey(request);
    expect(fs.readFileSync(target())).toEqual(bytes); expect(fs.readFileSync(source)).toEqual(bytes);
    expect(sddl(source)).toBe(before); expect(sddl(path.dirname(source))).toBe(directoryBefore);
  });
  it.each(["source-file", "source-directory", "target-file", "target-directory"] as const)("rejects an existing broad %s without changing bytes or DACL", kind => {
    const request = input(false), source = request.sourceConfig.secrets.localEncrypted.keyFilePath;
    seedPrivate(source, payload); seedPrivate(target(), "old target bytes");
    const chosen = kind.startsWith("source") ? source : target();
    const changed = kind.endsWith("directory") ? path.dirname(chosen) : chosen;
    setFixtureAcl(root, changed, true);
    const before = sddl(changed), sourceBefore = fs.readFileSync(source), targetBefore = fs.readFileSync(target());
    expect(() => copySeededSecretsKey(request)).toThrow("verified private Windows");
    expect(fs.readFileSync(source)).toEqual(sourceBefore); expect(fs.readFileSync(target())).toEqual(targetBefore);
    expect(sddl(changed)).toBe(before); expect(protectNewPrivatePath).not.toHaveBeenCalled();
  });
  it.each(["source", "target", "target-directory"] as const)("rejects an existing %s link without changing the outside bytes", kind => {
    const request = input(false), source = request.sourceConfig.secrets.localEncrypted.keyFilePath;
    seedPrivate(source, payload); seedPrivate(target(), "old target bytes");
    const outside = path.join(root, "outside", "master.key"); seedPrivate(outside, "outside preserved bytes");
    const outsideBefore = sddl(outside);
    if (kind === "target-directory") {
      fs.rmSync(path.dirname(target()), { recursive: true, force: true });
      fs.symlinkSync(path.dirname(outside), path.dirname(target()), "junction");
    } else {
      const linked = kind === "source" ? source : target(); fs.unlinkSync(linked); fs.symlinkSync(outside, linked, "file");
    }
    expect(() => copySeededSecretsKey(request)).toThrow("verified private Windows");
    expect(fs.readFileSync(outside, "utf8")).toBe("outside preserved bytes"); expect(sddl(outside)).toBe(outsideBefore);
    expect(protectNewPrivatePath).not.toHaveBeenCalled();
  });
  it("keeps an existing equal private key and its inode/DACL unchanged, but rejects a different key", () => {
    seedPrivate(target(), payload); const before = fs.lstatSync(target(), { bigint: true }), acl = sddl(target());
    copySeededSecretsKey(input());
    expect(fs.lstatSync(target(), { bigint: true }).ino).toBe(before.ino); expect(sddl(target())).toBe(acl);
    const request = input(); request.sourceEnvEntries.PAPERCLIP_SECRETS_MASTER_KEY = "different synthetic key";
    expect(() => copySeededSecretsKey(request)).toThrow("verified private Windows");
    expect(fs.readFileSync(target(), "utf8")).toBe(payload); expect(sddl(target())).toBe(acl);
    expect(protectNewPrivatePath).not.toHaveBeenCalled();
  });
  it("does not recreate a target key that disappears after its existence was observed", () => {
    const request = input(false), source = request.sourceConfig.secrets.localEncrypted.keyFilePath;
    const targetBytes = "original target key bytes";
    seedPrivate(source, payload); seedPrivate(target(), targetBytes);
    const sourceAcl = sddl(source), targetAcl = sddl(target()), directoryAcl = sddl(path.dirname(target()));
    const retained = `${target()}.retained`;
    let writes = 0;
    hooks.beforeWrite = () => { writes++; };
    hooks.beforeOpen = (file, flags) => {
      if (file === target() && typeof flags === "number") {
        hooks.beforeOpen = undefined;
        fs.renameSync(file, retained);
      }
    };
    expect(() => copySeededSecretsKey(request)).toThrow("verified private Windows");
    expect(writes).toBe(0); expect(protectNewPrivatePath).not.toHaveBeenCalled();
    expect(fs.existsSync(target())).toBe(false);
    expect(fs.readFileSync(source, "utf8")).toBe(payload); expect(sddl(source)).toBe(sourceAcl);
    expect(fs.readFileSync(retained, "utf8")).toBe(targetBytes); expect(sddl(retained)).toBe(targetAcl);
    expect(sddl(path.dirname(target()))).toBe(directoryAcl);
    expect(fs.readdirSync(path.dirname(target()))).toEqual(["master.key.retained"]);
  });
  it("refuses a failed temporary protection before any write and removes only its empty temporary file", () => {
    let writes = 0; hooks.beforeWrite = () => { writes++; };
    vi.mocked(protectNewPrivatePath).mockImplementation(file => {
      if (file.endsWith(".tmp")) { expect(fs.statSync(file).size).toBe(0); throw Error("synthetic probe unavailable"); }
      hooks.actualProtect!(file);
    });
    expect(() => copySeededSecretsKey(input())).toThrow("verified private Windows");
    expect(writes).toBe(0); expect(fs.existsSync(target())).toBe(false);
    expect(fs.readdirSync(path.dirname(target()))).toEqual([]);
  });
  it("preserves a competing temporary file when exclusive creation fails", () => {
    let collision: string | undefined;
    hooks.beforeOpen = (file, flags) => { if (flags === "wx") { collision = file; seedPrivate(file, "competing bytes"); } };
    expect(() => copySeededSecretsKey(input())).toThrow("verified private Windows");
    expect(collision).toBeDefined(); expect(fs.readFileSync(collision!, "utf8")).toBe("competing bytes");
    expect(fs.existsSync(target())).toBe(false);
  });
  it("rejects a replaced temporary entry before writing and preserves the foreign replacement", () => {
    let replaced: string | undefined, writes = 0;
    hooks.beforeWrite = () => { writes++; };
    vi.mocked(protectNewPrivatePath).mockImplementation(file => {
      hooks.actualProtect!(file);
      if (file.endsWith(".tmp")) {
        replaced = file; fs.unlinkSync(file); fs.writeFileSync(file, "foreign replacement bytes", { flag: "wx" });
      }
    });
    expect(() => copySeededSecretsKey(input())).toThrow("verified private Windows");
    expect(writes).toBe(0); expect(fs.existsSync(target())).toBe(false);
    expect(replaced).toBeDefined(); expect(fs.readFileSync(replaced!, "utf8")).toBe("foreign replacement bytes");
  });
  it.each([true, false])("preserves an atomic publication winner (same key: %s)", same => {
    const winner = same ? payload : "competing private key";
    hooks.beforeLink = (_temporary, file) => { seedPrivate(file, winner); };
    if (same) copySeededSecretsKey(input()); else expect(() => copySeededSecretsKey(input())).toThrow("verified private Windows");
    expect(fs.readFileSync(target(), "utf8")).toBe(winner); expect(hasPrivatePermissions(target(), 0)).toBe(true);
    expect(fs.readdirSync(path.dirname(target()))).toEqual(["master.key"]);
  });
});
