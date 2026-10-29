import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPrivatePermissions, protectNewPrivatePath } from "@paperclipai/shared/private-filesystem-permissions";
import { setFixtureAcl } from "./helpers/windows-private-acl.js";
import { ensureLocalSecretsKeyFile } from "../config/secrets-key.js";
import { secretsCheck } from "../checks/secrets-check.js";
import type { PaperclipConfig } from "../config/schema.js";

const hooks = vi.hoisted(() => ({
  descriptors: new Map<number, string>(),
  beforeOpen: undefined as undefined | ((file: string, flags: unknown) => void),
  beforeWrite: undefined as undefined | ((file: string) => void),
}));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const wrapped = { ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      hooks.beforeOpen?.(String(args[0]), args[1]);
      const descriptor = actual.openSync(...args); hooks.descriptors.set(descriptor, String(args[0])); return descriptor;
    },
    closeSync: (descriptor: number) => { hooks.descriptors.delete(descriptor); return actual.closeSync(descriptor); },
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      hooks.beforeWrite?.(typeof args[0] === "number" ? hooks.descriptors.get(args[0])! : String(args[0]));
      return actual.writeFileSync(...args);
    },
  };
  return { ...wrapped, default: wrapped };
});

let root: string, key: string, config: PaperclipConfig;
const material = Buffer.alloc(32, 9).toString("base64");
function sddl(file: string) {
  const script = "$p=$env:PAPERCLIP_FIXTURE_ACL_TARGET;$d=([IO.File]::GetAttributes($p)-band[IO.FileAttributes]::Directory)-ne 0;$a=if($d){[IO.Directory]::GetAccessControl($p)}else{[IO.File]::GetAccessControl($p)};[Console]::Out.Write($a.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::All))";
  return execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { env: { ...process.env, PAPERCLIP_FIXTURE_ACL_TARGET: file }, encoding: "utf8", windowsHide: true }).trim();
}
function seed() {
  fs.mkdirSync(path.dirname(key)); protectNewPrivatePath(path.dirname(key));
  fs.writeFileSync(key, "", { flag: "wx" }); protectNewPrivatePath(key); fs.writeFileSync(key, material);
}
function initialize(entry: "onboard/configure" | "doctor") {
  if (entry === "onboard/configure") return ensureLocalSecretsKeyFile(config);
  const health = secretsCheck(config);
  expect(health.status).toBe("warn"); expect(health.canRepair).toBe(true); expect(health.repair).toBeTypeOf("function");
  return health.repair!();
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-key-initialization-")); key = path.join(root, "secrets", "master.key");
  config = { database: { mode: "embedded-postgres" }, secrets: { provider: "local_encrypted", strictMode: true, localEncrypted: { keyFilePath: key } } } as PaperclipConfig;
  hooks.beforeOpen = undefined; hooks.beforeWrite = undefined; hooks.descriptors.clear();
  vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", ""); vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY_FILE", "");
});
afterEach(() => { hooks.beforeOpen = undefined; hooks.beforeWrite = undefined; vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });

describe.skipIf(process.platform !== "win32")("Windows CLI secret initialization", { timeout: 40000 }, () => {
  for (const entry of ["onboard/configure", "doctor"] as const) {
    it(`${entry} creates fresh private storage before the first key byte and reuses the same key`, async () => {
      let writes = 0;
      hooks.beforeWrite = file => {
        writes++;
        expect(hasPrivatePermissions(path.dirname(file), 0)).toBe(true);
        expect(hasPrivatePermissions(file, 0)).toBe(true);
        expect(fs.statSync(file).size).toBe(0);
      };
      await initialize(entry); hooks.beforeWrite = undefined;
      expect(writes).toBe(1);
      expect(hasPrivatePermissions(path.dirname(key), 0)).toBe(true); expect(hasPrivatePermissions(key, 0)).toBe(true);
      const before = fs.readFileSync(key), identity = fs.lstatSync(key, { bigint: true }), acl = sddl(key);
      expect(Buffer.from(before.toString("utf8"), "base64")).toHaveLength(32);
      if (entry === "onboard/configure") expect(ensureLocalSecretsKeyFile(config).status).toBe("existing");
      else expect(secretsCheck(config).status).toBe("pass");
      expect(fs.readFileSync(key)).toEqual(before); expect(fs.lstatSync(key, { bigint: true }).ino).toBe(identity.ino); expect(sddl(key)).toBe(acl);
      expect(fs.readdirSync(root)).toEqual(["secrets"]); expect(fs.readdirSync(path.dirname(key))).toEqual(["master.key"]);
    });
    it.each(["file", "directory"] as const)(`${entry} refuses a broad existing %s without repairing it`, kind => {
      seed(); const changed = kind === "file" ? key : path.dirname(key); setFixtureAcl(root, changed, true);
      const before = sddl(changed), bytes = fs.readFileSync(key);
      let writes = 0; hooks.beforeWrite = () => { writes++; };
      if (entry === "onboard/configure") expect(() => ensureLocalSecretsKeyFile(config)).toThrow("verified private Windows");
      else {
        const check = secretsCheck(config);
        expect(check).toMatchObject({ status: "fail", canRepair: false }); expect(check.repair).toBeUndefined();
      }
      expect(writes).toBe(0); expect(fs.readFileSync(key)).toEqual(bytes); expect(sddl(changed)).toBe(before);
      expect(fs.readdirSync(path.dirname(key))).toEqual(["master.key"]);
    });
    it(`${entry} refuses an observed key disappearing without regenerating it`, () => {
      seed(); const retained = `${key}.retained`, acl = sddl(key);
      let writes = 0; hooks.beforeWrite = () => { writes++; };
      hooks.beforeOpen = (file, flags) => { if (file === key && typeof flags === "number") { hooks.beforeOpen = undefined; fs.renameSync(key, retained); } };
      if (entry === "onboard/configure") expect(() => ensureLocalSecretsKeyFile(config)).toThrow("verified private Windows");
      else {
        const check = secretsCheck(config);
        expect(check).toMatchObject({ status: "fail", canRepair: false }); expect(check.repair).toBeUndefined();
      }
      expect(writes).toBe(0); expect(fs.existsSync(key)).toBe(false); expect(fs.readFileSync(retained, "utf8")).toBe(material); expect(sddl(retained)).toBe(acl);
    });
  }
});
