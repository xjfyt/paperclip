import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkSecretProviders, listSecretProviders } from "../secrets/provider-registry.js";
import { hasPrivatePermissions, protectNewPrivatePath } from "@paperclipai/shared/private-filesystem-permissions";
import { setFixtureAcl } from "@paperclipai/adapter-utils/test-fixtures/windows-private-acl";

function fileSddl(file: string) {
  const script = "[Console]::Out.Write([IO.File]::GetAccessControl($env:PAPERCLIP_FIXTURE_ACL_TARGET).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All))";
  return execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { encoding: "utf8", windowsHide: true, env: { ...process.env, PAPERCLIP_FIXTURE_ACL_TARGET: file } }).trim();
}

describe("secret provider registry", () => {
  const previousKeyFile = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  const previousMasterKey = process.env.PAPERCLIP_SECRETS_MASTER_KEY;
  const tmpDirs: string[] = [];

  afterEach(() => {
    if (previousKeyFile === undefined) {
      delete process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
    } else {
      process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = previousKeyFile;
    }
    if (previousMasterKey === undefined) {
      delete process.env.PAPERCLIP_SECRETS_MASTER_KEY;
    } else {
      process.env.PAPERCLIP_SECRETS_MASTER_KEY = previousMasterKey;
    }
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("describes managed and external-reference provider capabilities", () => {
    const descriptors = listSecretProviders();

    expect(descriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "local_encrypted",
          supportsManagedValues: true,
          supportsExternalReferences: false,
          configured: true,
        }),
        expect.objectContaining({
          id: "aws_secrets_manager",
          supportsManagedValues: true,
          supportsExternalReferences: true,
          configured: false,
        }),
      ]),
    );
  });

  it("reports insecure local key access using the platform's real permissions without repairing it", async () => {
    const dir = path.join(os.tmpdir(), `paperclip-secret-provider-${randomBytes(6).toString("hex")}`);
    mkdirSync(dir);
    tmpDirs.push(dir);
    protectNewPrivatePath(dir);
    const keyFile = path.join(dir, "master.key");
    writeFileSync(keyFile, "", { mode: 0o600, flag: "wx" });
    protectNewPrivatePath(keyFile);
    writeFileSync(keyFile, randomBytes(32).toString("base64"), { encoding: "utf8", mode: 0o644 });
    chmodSync(keyFile, 0o644);
    if (process.platform === "win32") setFixtureAcl(dir, keyFile, true);
    const originalBytes = readFileSync(keyFile);
    const originalAcl = process.platform === "win32" ? fileSddl(keyFile) : null;
    process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE = keyFile;
    delete process.env.PAPERCLIP_SECRETS_MASTER_KEY;

    const checks = await checkSecretProviders();
    const local = checks.find((check) => check.provider === "local_encrypted");

    expect(local).toMatchObject({
      status: process.platform === "win32" ? "error" : "warn",
      details: { keyFilePath: keyFile },
    });
    if (process.platform === "win32") {
      expect(local?.message).toContain("private Windows storage");
      expect(hasPrivatePermissions(keyFile, statSync(keyFile).mode)).toBe(false);
      expect(fileSddl(keyFile)).toBe(originalAcl);
    } else expect(local?.warnings?.join("\n")).toContain("chmod 600");
    expect(readFileSync(keyFile)).toEqual(originalBytes);
    expect(local?.backupGuidance?.join("\n")).toContain("database");
  }, process.platform === "win32" ? 15_000 : 5_000);
});
