import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPrivatePermissions, protectNewPrivatePath } from "@paperclipai/shared/private-filesystem-permissions";
import { setFixtureAcl } from "@paperclipai/adapter-utils/test-fixtures/windows-private-acl";
import { localEncryptedProvider as provider } from "../secrets/local-encrypted-provider.js";

const hooks = vi.hoisted(() => ({
  descriptors: new Map<number, string>(),
  beforeOpen: undefined as undefined | ((file: string, flags: unknown) => void),
  beforeWrite: undefined as undefined | ((file: string, descriptor: number) => void),
  beforeLink: undefined as undefined | ((source: string, target: string) => void),
  beforeRename: undefined as undefined | ((source: string, target: string) => void),
  actualProtect: undefined as undefined | ((file: string) => void),
}));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>) => { hooks.beforeOpen?.(String(args[0]), args[1]); const fd = actual.openSync(...args); hooks.descriptors.set(fd, String(args[0])); return fd; },
    closeSync: (fd: number) => { hooks.descriptors.delete(fd); return actual.closeSync(fd); },
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => { if (typeof args[0] === "number") hooks.beforeWrite?.(hooks.descriptors.get(args[0])!, args[0]); return actual.writeFileSync(...args); },
    linkSync: (source: string, target: string) => { hooks.beforeLink?.(source, target); return actual.linkSync(source, target); },
    renameSync: (source: string, target: string) => { hooks.beforeRename?.(source, target); return actual.renameSync(source, target); },
  };
});
vi.mock("@paperclipai/shared/private-filesystem-permissions", async importOriginal => {
  const actual = await importOriginal<typeof import("@paperclipai/shared/private-filesystem-permissions")>(); hooks.actualProtect = actual.protectNewPrivatePath;
  return { ...actual, protectNewPrivatePath: vi.fn(actual.protectNewPrivatePath) };
});

let root: string, key: string;
const valid = Buffer.alloc(32, 7).toString("base64");
function seed(file: string, raw = valid) {
  if (!fs.existsSync(path.dirname(file))) { fs.mkdirSync(path.dirname(file), { recursive: true }); hooks.actualProtect!(path.dirname(file)); }
  fs.writeFileSync(file, "", { flag: "wx", mode: 0o600 }); hooks.actualProtect!(file); fs.writeFileSync(file, raw);
}
function sddl(file: string) {
  const script = "$p=$env:PAPERCLIP_FIXTURE_ACL_TARGET;$d=([IO.File]::GetAttributes($p)-band[IO.FileAttributes]::Directory)-ne 0;$a=if($d){[IO.Directory]::GetAccessControl($p)}else{[IO.File]::GetAccessControl($p)};[Console]::Out.Write($a.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All))";
  return execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { env: { ...process.env, PAPERCLIP_FIXTURE_ACL_TARGET: file }, encoding: "utf8", windowsHide: true }).trim();
}
const create = () => provider.createSecret({ value: "synthetic-provider-challenge" });
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-local-key-security-")); key = path.join(root, "secrets", "master.key");
  hooks.beforeOpen = undefined; hooks.beforeWrite = undefined; hooks.beforeLink = undefined; hooks.beforeRename = undefined; hooks.descriptors.clear();
  vi.mocked(protectNewPrivatePath).mockReset().mockImplementation(file => hooks.actualProtect!(file));
  vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", ""); vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY_FILE", key);
});
afterEach(() => { hooks.beforeOpen = undefined; hooks.beforeWrite = undefined; hooks.beforeLink = undefined; hooks.beforeRename = undefined; vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe.skipIf(process.platform !== "win32")("local encrypted Windows private storage", { timeout: 30000 }, () => {
  it("protects empty staging/key paths before the first byte and reports real private DACL health", async () => {
    const protectedPaths: string[] = [];
    vi.mocked(protectNewPrivatePath).mockImplementation(file => {
      if (fs.lstatSync(file).isDirectory()) expect(fs.readdirSync(file)).toEqual([]); else expect(fs.statSync(file).size).toBe(0);
      hooks.actualProtect!(file); protectedPaths.push(file);
    });
    let writes = 0;
    hooks.beforeWrite = (file, fd) => { writes++; expect(fs.fstatSync(fd).size).toBe(0); expect(hasPrivatePermissions(file, 0)).toBe(true); };
    const encrypted = await create();
    expect(writes).toBe(1); expect(protectedPaths).toHaveLength(2);
    expect(Buffer.from(fs.readFileSync(key, "utf8"), "base64")).toHaveLength(32);
    expect(await provider.resolveVersion(encrypted)).toBe("synthetic-provider-challenge");
    expect(await provider.healthCheck()).toMatchObject({ status: "ok", warnings: [] });
    expect(fs.readdirSync(root)).toEqual(["secrets"]); expect(fs.readdirSync(path.dirname(key))).toEqual(["master.key"]);
  });
  it.each(["file", "directory"] as const)("rejects a broad existing %s for reads/writes/health with original bytes and ACL unchanged", async kind => {
    seed(key); const changed = kind === "file" ? key : path.dirname(key); setFixtureAcl(root, changed, true);
    const before = sddl(changed), bytes = fs.readFileSync(key);
    await expect(create()).rejects.toThrow("verified private Windows");
    expect(await provider.healthCheck()).toMatchObject({ status: "error" });
    expect(fs.readFileSync(key)).toEqual(bytes); expect(sddl(changed)).toBe(before); expect(protectNewPrivatePath).not.toHaveBeenCalled();
  });
  it.each(["key", "directory", "dangling-key"] as const)("rejects an existing %s link without touching outside bytes", async kind => {
    const outside = path.join(root, "outside", "master.key"); seed(outside); const before = sddl(outside);
    fs.mkdirSync(path.dirname(key), { recursive: true }); hooks.actualProtect!(path.dirname(key));
    if (kind === "directory") { fs.rmdirSync(path.dirname(key)); fs.symlinkSync(path.dirname(outside), path.dirname(key), "junction"); }
    else fs.symlinkSync(kind === "key" ? outside : path.join(root, "missing"), key, "file");
    await expect(create()).rejects.toThrow(); expect(await provider.healthCheck()).toMatchObject({ status: "error" });
    expect(fs.readFileSync(outside, "utf8")).toBe(valid); expect(sddl(outside)).toBe(before); expect(protectNewPrivatePath).not.toHaveBeenCalled();
  });
  it("reports a missing key with Windows guidance without creating storage", async () => {
    const health = await provider.healthCheck(); expect(health.status).toBe("warn");
    expect(health.warnings?.join(" ")).toContain("private Windows"); expect(health.warnings?.join(" ")).not.toContain("0600");
    expect(fs.readdirSync(root)).toEqual([]); expect(protectNewPrivatePath).not.toHaveBeenCalled();
  });
  it("preserves malformed private key bytes and returns bounded health error with backup guidance", async () => {
    const invalid = "synthetic-invalid-existing-key"; seed(key, invalid); const before = sddl(key);
    await expect(create()).rejects.toThrow("Invalid secrets master key");
    const health = await provider.healthCheck(); expect(health.status).toBe("error"); expect(health.message).not.toContain(invalid);
    expect(health.backupGuidance?.join(" ")).toContain("Preserve"); expect(fs.readFileSync(key, "utf8")).toBe(invalid); expect(sddl(key)).toBe(before);
  });
  it("does not generate a new master key when an observed key disappears during opening", async () => {
    seed(key); const retained = `${key}.retained`, before = sddl(key);
    let writes = 0; hooks.beforeWrite = () => { writes++; };
    hooks.beforeOpen = (file, flags) => { if (file === key && typeof flags === "number") fs.renameSync(key, retained); };
    await expect(create()).rejects.toThrow();
    expect(writes).toBe(0); expect(protectNewPrivatePath).not.toHaveBeenCalled();
    expect(fs.existsSync(key)).toBe(false); expect(fs.readFileSync(retained, "utf8")).toBe(valid); expect(sddl(retained)).toBe(before);
    expect(fs.readdirSync(path.dirname(key))).toEqual(["master.key.retained"]);
  });
  it("reports verification error rather than first-write guidance when an observed key disappears during health inspection", async () => {
    seed(key); const retained = `${key}.retained`, before = sddl(key);
    hooks.beforeOpen = (file, flags) => { if (file === key && typeof flags === "number") fs.renameSync(key, retained); };
    const health = await provider.healthCheck();
    expect(health.status).toBe("error"); expect(health.message).not.toContain("does not exist yet");
    expect(health.warnings?.join(" ") ?? "").not.toContain("first managed secret write");
    expect(fs.existsSync(key)).toBe(false); expect(fs.readFileSync(retained, "utf8")).toBe(valid); expect(sddl(retained)).toBe(before);
    expect(protectNewPrivatePath).not.toHaveBeenCalled();
  });
  it.each(["directory", "file"] as const)("refuses failed %s protection before any secret write", async kind => {
    let writes = 0; hooks.beforeWrite = () => { writes++; };
    vi.mocked(protectNewPrivatePath).mockImplementation(file => {
      if (fs.lstatSync(file).isDirectory() === (kind === "directory")) throw Error("synthetic unavailable ACL probe");
      hooks.actualProtect!(file);
    });
    await expect(create()).rejects.toThrow(); expect(writes).toBe(0); expect(fs.existsSync(key)).toBe(false);
  });
  it("does not repair or replace a broad directory appearing before atomic directory publication", async () => {
    let before = "", writes = 0; hooks.beforeWrite = () => { writes++; };
    hooks.beforeRename = (_staging, directory) => { fs.mkdirSync(directory); setFixtureAcl(root, directory, true); before = sddl(directory); };
    await expect(create()).rejects.toThrow(); expect(writes).toBe(0); expect(sddl(path.dirname(key))).toBe(before);
    expect(fs.readdirSync(path.dirname(key))).toEqual([]); expect(fs.readdirSync(root)).toEqual(["secrets"]);
  });
  it("preserves a competing temporary file when wx creation fails", async () => {
    let collision = ""; hooks.beforeOpen = (file, flags) => { if (flags === "wx") { collision = file; seed(file, "foreign bytes"); } };
    await expect(create()).rejects.toThrow(); expect(fs.readFileSync(collision, "utf8")).toBe("foreign bytes"); expect(fs.existsSync(key)).toBe(false);
  });
  it("refuses a replaced temporary entry without deleting foreign bytes or writing secret bytes", async () => {
    let replaced = "", writes = 0; hooks.beforeWrite = () => { writes++; };
    vi.mocked(protectNewPrivatePath).mockImplementation(file => { hooks.actualProtect!(file); if (file.endsWith(".tmp")) { replaced = file; fs.unlinkSync(file); fs.writeFileSync(file, "foreign bytes", { flag: "wx" }); } });
    await expect(create()).rejects.toThrow(); expect(writes).toBe(0); expect(fs.readFileSync(replaced, "utf8")).toBe("foreign bytes"); expect(fs.existsSync(key)).toBe(false);
  });
  it("uses an independently published complete private winner without overwriting it", async () => {
    hooks.beforeLink = (_temporary, file) => { seed(file); };
    const encrypted = await create(); expect(fs.readFileSync(key, "utf8")).toBe(valid);
    expect(await provider.resolveVersion(encrypted)).toBe("synthetic-provider-challenge"); expect(fs.readdirSync(path.dirname(key))).toEqual(["master.key"]);
  });
});
