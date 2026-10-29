import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPrivatePermissions, protectNewPrivatePath } from "@paperclipai/shared/private-filesystem-permissions";
import { setFixtureAcl } from "@paperclipai/adapter-utils/test-fixtures/windows-private-acl";
import { resolveDecisionSigningSecret, signDecisionSpec, verifyDecisionSpec } from "../services/decision-signing.js";

const fixture = vi.hoisted(() => ({
  actualProtect: undefined as undefined | ((file: string) => void),
  beforeLink: undefined as undefined | ((source: string, destination: string) => void),
  beforeOpen: undefined as undefined | ((file: string, flags: string | number) => void),
}));
vi.mock("@paperclipai/shared/private-filesystem-permissions", async importOriginal => {
  const actual = await importOriginal<typeof import("@paperclipai/shared/private-filesystem-permissions")>();
  fixture.actualProtect = actual.protectNewPrivatePath;
  return { ...actual, protectNewPrivatePath: vi.fn(actual.protectNewPrivatePath) };
});
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, openSync: (file: string, flags: string | number, mode?: number) => {
    fixture.beforeOpen?.(file, flags);
    return actual.openSync(file, flags, mode);
  }, linkSync: (source: string, destination: string) => {
    fixture.beforeLink?.(source, destination);
    return actual.linkSync(source, destination);
  } };
});

let root: string;
let key: string;
let directory: string;
const secret = Buffer.alloc(32, 7).toString("base64");
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "decision-signing-security-"));
  vi.stubEnv("PAPERCLIP_HOME", root);
  vi.stubEnv("PAPERCLIP_INSTANCE_ID", "default");
  vi.stubEnv("PAPERCLIP_DECISION_SIGNING_SECRET", "");
  key = path.join(root, "instances", "default", "secrets", "decision-signing.key");
  directory = path.dirname(key);
  fixture.beforeLink = undefined;
  fixture.beforeOpen = undefined;
  vi.mocked(protectNewPrivatePath).mockReset().mockImplementation(file => fixture.actualProtect!(file));
});
afterEach(() => {
  fixture.beforeLink = undefined;
  fixture.beforeOpen = undefined;
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
function privateDirectory() {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") fixture.actualProtect!(directory);
}
function acl(file: string) {
  const command = "$p=$env:PAPERCLIP_FIXTURE_ACL_TARGET; $a=if([IO.Directory]::Exists($p)){[IO.Directory]::GetAccessControl($p)}else{[IO.File]::GetAccessControl($p)}; [Console]::Out.Write($a.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All))";
  return execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")],
    { env: { ...process.env, PAPERCLIP_FIXTURE_ACL_TARGET: file }, encoding: "utf8", windowsHide: true, timeout: 10000 }).trim();
}

describe("decision signing key publication", () => {
  it("persists one complete private key and reuses it for signature verification", () => {
    const value = resolveDecisionSigningSecret();
    expect(value.length).toBeGreaterThanOrEqual(32);
    expect(readFileSync(key, "utf8")).toBe(value);
    expect(hasPrivatePermissions(directory, statSync(directory).mode)).toBe(true);
    expect(hasPrivatePermissions(key, statSync(key).mode)).toBe(true);
    expect(resolveDecisionSigningSecret()).toBe(value);
    const signature = signDecisionSpec({ option: "yes" });
    expect(verifyDecisionSpec({ option: "yes" }, signature)).toBe(true);
    expect(verifyDecisionSpec({ option: "no" }, signature)).toBe(false);
    expect(readdirSync(directory)).toEqual(["decision-signing.key"]);
  }, 30000);
  it("preserves an independently published winner rather than replacing its key", () => {
    fixture.beforeLink = (source, destination) => {
      expect(destination).toBe(key);
      expect(readFileSync(source, "utf8").length).toBeGreaterThanOrEqual(32);
      expect(hasPrivatePermissions(source, statSync(source).mode)).toBe(true);
      writeFileSync(destination, secret, { flag: "wx", mode: 0o600 });
    };
    expect(resolveDecisionSigningSecret()).toBe(secret);
    expect(readFileSync(key, "utf8")).toBe(secret);
    expect(readdirSync(directory)).toEqual(["decision-signing.key"]);
  }, 30000);
  it("does not remove a temporary path it failed to create exclusively", () => {
    let collision: string | undefined;
    fixture.beforeOpen = (file, flags) => {
      if (flags === "wx" && file.endsWith(".tmp")) {
        collision = file;
        writeFileSync(file, "independently owned bytes", { flag: "wx", mode: 0o600 });
      }
    };
    expect(() => resolveDecisionSigningSecret()).toThrow(expect.objectContaining({ code: "EEXIST" }));
    expect(collision).toBeDefined();
    expect(readFileSync(collision!, "utf8")).toBe("independently owned bytes");
    expect(existsSync(key)).toBe(false);
  }, 30000);
  it("refuses a key symlink without changing its outside target", () => {
    privateDirectory();
    const outside = path.join(root, "outside.key");
    writeFileSync(outside, secret);
    symlinkSync(outside, key, "file");
    expect(() => resolveDecisionSigningSecret()).toThrow("must be a regular file");
    expect(readFileSync(outside, "utf8")).toBe(secret);
    expect(lstatSync(key).isSymbolicLink()).toBe(true);
  }, 30000);
});

describe.skipIf(process.platform !== "win32")("native Windows decision signing ACLs", () => {
  it("protects only empty new paths before the first credential byte", () => {
    const protectedPaths: string[] = [];
    vi.mocked(protectNewPrivatePath).mockImplementation(file => {
      const before = lstatSync(file);
      if (before.isDirectory()) expect(readdirSync(file)).toEqual([]);
      else expect(before.size).toBe(0);
      fixture.actualProtect!(file);
      expect(hasPrivatePermissions(file, before.mode)).toBe(true);
      protectedPaths.push(file);
    });
    const generated = resolveDecisionSigningSecret();
    expect(protectedPaths[0]).toBe(directory);
    expect(protectedPaths[1]).toMatch(/decision-signing\.key\..*\.tmp$/);
    expect(protectedPaths).toHaveLength(2);
    expect(readFileSync(key, "utf8")).toBe(generated);
  }, 30000);
  it.each(["directory", "file"] as const)("rejects an existing broad %s without changing bytes or its DACL", target => {
    privateDirectory();
    writeFileSync(key, secret, { mode: 0o600 });
    const unsafe = target === "directory" ? directory : key;
    setFixtureAcl(root, unsafe, true);
    const before = acl(unsafe);
    expect(() => resolveDecisionSigningSecret()).toThrow("verified private Windows permissions");
    expect(readFileSync(key, "utf8")).toBe(secret);
    expect(acl(unsafe)).toBe(before);
    expect(protectNewPrivatePath).not.toHaveBeenCalled();
    expect(readdirSync(directory)).toEqual(["decision-signing.key"]);
  }, 30000);
  it("leaves no key or payload when protection of the new empty temporary file fails", () => {
    vi.mocked(protectNewPrivatePath).mockImplementation(file => {
      if (file.endsWith(".tmp")) { expect(statSync(file).size).toBe(0); throw new Error("fixture ACL establishment unavailable"); }
      fixture.actualProtect!(file);
    });
    expect(() => resolveDecisionSigningSecret()).toThrow("fixture ACL establishment unavailable");
    expect(existsSync(key)).toBe(false);
    expect(readdirSync(directory)).toEqual([]);
  }, 30000);
  it("rejects an unavailable ACL probe without returning or modifying the old key", () => {
    privateDirectory();
    writeFileSync(key, secret, { mode: 0o600 });
    vi.stubEnv("SystemRoot", path.join(root, "missing-system-root"));
    expect(() => resolveDecisionSigningSecret()).toThrow("verified private Windows permissions");
    expect(readFileSync(key, "utf8")).toBe(secret);
    expect(protectNewPrivatePath).not.toHaveBeenCalled();
  }, 30000);
  it("rejects a linked secrets directory and preserves the linked directory", () => {
    const outside = path.join(root, "outside-directory");
    mkdirSync(outside);
    writeFileSync(path.join(outside, "decision-signing.key"), secret);
    mkdirSync(path.dirname(directory), { recursive: true });
    symlinkSync(outside, directory, "junction");
    expect(() => resolveDecisionSigningSecret()).toThrow("must be a directory");
    expect(readFileSync(path.join(outside, "decision-signing.key"), "utf8")).toBe(secret);
    expect(lstatSync(directory).isSymbolicLink()).toBe(true);
  }, 30000);
});
