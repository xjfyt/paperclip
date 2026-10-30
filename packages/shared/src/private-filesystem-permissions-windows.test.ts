import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPrivatePermissionPair, hasPrivatePermissions, protectNewPrivatePath } from "./private-filesystem-permissions.js";
import { readPrivateWindowsMasterKey } from "./private-windows-master-key.js";

const hooks = vi.hoisted(() => ({
  calls: 0, timeout: 0, twoTargets: false,
  fault: "" as "" | "spawn" | "timeout" | "output",
  timeoutCode: "", fileReads: 0,
}));
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: (...args: Parameters<typeof actual.execFileSync>) => {
    const options = args[2] as { timeout?: number; env?: NodeJS.ProcessEnv } | undefined;
    if (options?.env?.PAPERCLIP_PRIVATE_ACL_TARGET !== undefined) {
      hooks.calls++; hooks.timeout = options.timeout ?? 0;
      hooks.twoTargets = Boolean(options.env.PAPERCLIP_PRIVATE_ACL_SECOND_TARGET);
      if (hooks.fault === "spawn") throw Object.assign(new Error("synthetic inspector unavailable"), { code: "ENOENT" });
      if (hooks.fault === "output") return "private\nunexpected";
      if (hooks.fault === "timeout") {
        // Keep the production timeout/options and real executable. Only the
        // controlled inspector body stalls, so the OS emits a real timeout.
        try { return actual.execFileSync(args[0], ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from("Start-Sleep -Seconds 60", "utf16le").toString("base64")], args[2]); }
        catch (error) { hooks.timeoutCode = (error as NodeJS.ErrnoException).code ?? ""; throw error; }
      }
    }
    return actual.execFileSync(...args);
  } };
});
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    const value = actual.readFileSync(...args);
    if (typeof args[0] === "number") hooks.fileReads++;
    return value;
  }) as typeof actual.readFileSync;
  return { ...actual, readFileSync, default: { ...actual, readFileSync } };
});

let root = "", directory = "", file = "";
const material = Buffer.alloc(32, 7).toString("base64");
function changeAcl(target: string, kind: "wide" | "null") {
  const rel = path.relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) throw Error("Fixture ACL target must be owned");
  // Fixture-only access; never contains real key bytes or interpolated paths.
  const script = `
$ErrorActionPreference='Stop'
$p=$env:PAPERCLIP_PAIR_FIXTURE_TARGET
$dir=([IO.File]::GetAttributes($p)-band[IO.FileAttributes]::Directory)-ne 0
$acl=if($dir){[IO.Directory]::GetAccessControl($p)}else{[IO.File]::GetAccessControl($p)}
if($env:PAPERCLIP_PAIR_FIXTURE_KIND -eq 'null') {
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PaperclipFixtureNullDacl {
 [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern uint SetNamedSecurityInfoW(string path, int type, uint flags, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
}
'@
 $result=[PaperclipFixtureNullDacl]::SetNamedSecurityInfoW($p,1,4,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero)
 if($result -ne 0){throw 'Fixture null DACL write failed'}
 exit 0
} else {
 $acl.SetAccessRuleProtection($true,$false)
 $inherit=if($dir){[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{[Security.AccessControl.InheritanceFlags]::None}
 $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),[Security.AccessControl.FileSystemRights]::ReadAndExecute,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
}
if($dir){[IO.Directory]::SetAccessControl($p,$acl)}else{[IO.File]::SetAccessControl($p,$acl)}
`;
  execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    env: { ...process.env, PAPERCLIP_PAIR_FIXTURE_TARGET: target, PAPERCLIP_PAIR_FIXTURE_KIND: kind }, windowsHide: true, timeout: 10000, stdio: ["ignore", "pipe", "pipe"],
  });
}
function reset() { hooks.calls = 0; hooks.fileReads = 0; hooks.timeout = 0; hooks.twoTargets = false; hooks.fault = ""; hooks.timeoutCode = ""; }

function nullDaclObserved(target: string): boolean {
  const script = "$ErrorActionPreference='Stop';$p=$env:PAPERCLIP_PAIR_FIXTURE_TARGET;$a=[IO.File]::GetAccessControl($p);if($null -eq $a){throw 'Fixture ACL unavailable'};$raw=[Security.AccessControl.RawSecurityDescriptor]::new($a.GetSecurityDescriptorBinaryForm(),0);if($null -eq $raw){throw 'Fixture descriptor unavailable'};[Console]::Out.Write(($null -eq $raw.DiscretionaryAcl).ToString().ToLowerInvariant())";
  return String(execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    env: { ...process.env, PAPERCLIP_PAIR_FIXTURE_TARGET: target }, encoding: "utf8", windowsHide: true, timeout: 10000, stdio: ["ignore", "pipe", "pipe"],
  })).trim() === "true";
}

describe.runIf(process.platform === "win32")("Windows private ACL pair", { timeout: 30000 }, () => {
  beforeEach(() => {
    reset(); root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-private-pair-")); protectNewPrivatePath(root);
    directory = path.join(root, "private folder 雪"); fs.mkdirSync(directory); protectNewPrivatePath(directory);
    file = path.join(directory, "master & literal.key"); fs.writeFileSync(file, "", { flag: "wx" }); protectNewPrivatePath(file); fs.writeFileSync(file, material); reset();
  });
  afterEach(() => { reset(); fs.rmSync(root, { recursive: true, force: true }); });
  it("checks an actual private directory and file with one real bounded inspector", () => {
    expect(hasPrivatePermissionPair(directory, 0, file, 0)).toBe(true);
    expect(hooks.calls).toBe(1); expect(hooks.twoTargets).toBe(true); expect(hooks.timeout).toBe(10000);
  });
  it.each(["directory", "file"] as const)("rejects an actual broad %s while its other path remains private", kind => {
    changeAcl(kind === "directory" ? directory : file, "wide");
    expect(hasPrivatePermissions(kind === "directory" ? file : directory, 0)).toBe(true); reset();
    expect(hasPrivatePermissionPair(directory, 0, file, 0)).toBe(false); expect(hooks.calls).toBe(1); expect(hooks.fileReads).toBe(0);
  });
  it("rejects a real null DACL", () => {
    changeAcl(file, "null");
    expect(nullDaclObserved(file)).toBe(true);
    expect(() => nullDaclObserved(path.join(directory, "missing.key"))).toThrow();
    expect(hasPrivatePermissionPair(directory, 0, file, 0)).toBe(false);
  });
  it("rejects a reparse point without reading its target bytes", () => {
    const link = path.join(directory, "linked.key"); fs.symlinkSync(file, link, "file");
    expect(hasPrivatePermissionPair(directory, 0, link, 0)).toBe(false); expect(hooks.fileReads).toBe(0);
  });
  it("reads an existing key with one inspector and rechecks real ACL changes on the next read", () => {
    expect(readPrivateWindowsMasterKey(file)).toBe(material); expect(hooks.calls).toBe(1); expect(hooks.fileReads).toBe(1);
    changeAcl(file, "wide"); reset(); expect(() => readPrivateWindowsMasterKey(file)).toThrow("verified private Windows"); expect(hooks.fileReads).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe(material);
  });
  it("preserves unsafe-parent precedence over a missing key", () => {
    fs.unlinkSync(file); changeAcl(directory, "wide"); reset(); expect(() => readPrivateWindowsMasterKey(file)).toThrow("verified private Windows"); expect(hooks.calls).toBe(1);
  });
  it("keeps a genuinely missing key or parent as ENOENT", () => {
    fs.unlinkSync(file); expect(() => readPrivateWindowsMasterKey(file)).toThrow(expect.objectContaining({ code: "ENOENT" }));
    expect(() => readPrivateWindowsMasterKey(path.join(root, "missing", "master.key"))).toThrow(expect.objectContaining({ code: "ENOENT" }));
  });
  it.each(["spawn", "output"] as const)("fails closed on inspector %s failure without reading bytes", fault => { hooks.fault = fault; expect(hasPrivatePermissionPair(directory, 0, file, 0)).toBe(false); expect(hooks.fileReads).toBe(0); });
  it("fails closed on a real inspector timeout without changing its 10s bound", () => { hooks.fault = "timeout"; expect(hasPrivatePermissionPair(directory, 0, file, 0)).toBe(false); expect(hooks.timeout).toBe(10000); expect(hooks.timeoutCode).toBe("ETIMEDOUT"); expect(hooks.fileReads).toBe(0); });
});
