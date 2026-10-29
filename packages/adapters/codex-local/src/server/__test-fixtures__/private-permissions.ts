import { lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect } from "vitest";
import { hasPrivatePermissions } from "@paperclipai/shared/private-filesystem-permissions";
import { setFixtureAcl } from "@paperclipai/adapter-utils/test-fixtures/windows-private-acl";

/** Assert the actual platform's permission boundary; never emulate mode bits. */
export async function expectPrivatePath(file: string, posixMode: number): Promise<void> {
  const info = await lstat(file);
  expect(info.isSymbolicLink()).toBe(false);
  if (process.platform === "win32") expect(hasPrivatePermissions(file, info.mode), file).toBe(true);
  else expect(info.mode & 0o777, file).toBe(posixMode);
}

/** A real broad NTFS grant makes the production private-path check refuse it.
 * The target is always this test's descendant of os.tmpdir(), never user data. */
export function setUnsafeFixtureDirectory(directory: string, unsafe: boolean): void {
  setFixtureAcl(os.tmpdir(), directory, unsafe);
}

export function fixtureAcl(file: string): string {
  const script = "$ErrorActionPreference='Stop'; $p=$env:PAPERCLIP_FIXTURE_ACL_TARGET; $a=if([IO.Directory]::Exists($p)){[IO.Directory]::GetAccessControl($p)}else{[IO.File]::GetAccessControl($p)}; [Console]::Out.Write($a.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All))";
  return execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { env: { ...process.env, PAPERCLIP_FIXTURE_ACL_TARGET: file }, encoding: "utf8", windowsHide: true, timeout: 10000 });
}
