import fs from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ensurePrivateCredentialDirectory } from "@paperclipai/adapter-utils/private-credential-paths";
import * as permissions from "@paperclipai/shared/private-filesystem-permissions";
import { setFixtureAcl } from "@paperclipai/adapter-utils/test-fixtures/windows-private-acl";
import { writeCredentialSeedOrNewer } from "./codex-auth-seed-write.js";
import { writeApiKeyAuthJson, writeManagedCodexMcpConfig } from "./codex-home.js";
import { ensureCodexAuthCacheEntryDir, resolveCodexAuthCacheDir } from "./codex-auth-cache.js";
import { deriveProofHome, installDeviceLoginCredential } from "./device-login-export.js";
import { expectPrivatePath, fixtureAcl } from "./__test-fixtures__/private-permissions.js";

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-private-write-")); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
const secret = "SYNTHETIC_CODEX_CREDENTIAL_MUST_NOT_LEAK";
const auth = (refresh: string) => Buffer.from(JSON.stringify({ tokens: { account_id: "acct-fixture", refresh_token: secret }, last_refresh: refresh }));
const older = auth("2026-07-09T01:00:00Z"), newer = auth("2026-07-09T02:00:00Z");
const env = () => ({ PAPERCLIP_HOME: root, PAPERCLIP_INSTANCE_ID: "default" });
function write(destinationPath: string, log = vi.fn()) {
  return writeCredentialSeedOrNewer({ sourceBytes: newer, destinationPath, seedIfDestAbsent: true,
    log, writtenLine: "written", keptLine: "kept", tempPrefix: "credential-fixture", errorLabel: "credential fixture", env: env() });
}

it("protects the actual empty staged file before writing credential bytes", async () => {
  const directory = path.join(root, "home");
  await ensurePrivateCredentialDirectory(directory);
  const original = permissions.protectNewPrivatePath;
  const observed: string[] = [];
  vi.spyOn(permissions, "protectNewPrivatePath").mockImplementation(file => {
    if (statSync(file).isFile()) { expect(readFileSync(file)).toHaveLength(0); observed.push(file); }
    original(file);
  });
  const destination = path.join(directory, "auth.json"), log = vi.fn();
  expect(await write(destination, log)).toBe("written");
  expect(observed).toHaveLength(1);
  expect(await fs.readFile(destination)).toEqual(newer);
  await expectPrivatePath(destination, 0o600);
  expect(await fs.readdir(directory)).toEqual(["auth.json"]);
  expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
});

it.runIf(process.platform === "win32")("rejects a broad existing credential without changing bytes, DACL or leaving a temp", async () => {
  const directory = path.join(root, "home"); await ensurePrivateCredentialDirectory(directory);
  const destination = path.join(directory, "auth.json"); await fs.writeFile(destination, older);
  setFixtureAcl(root, destination, true);
  const before = fixtureAcl(destination), log = vi.fn();
  await expect(write(destination, log)).rejects.toMatchObject({ code: "EACCES" });
  expect(await fs.readFile(destination)).toEqual(older);
  expect(fixtureAcl(destination)).toBe(before);
  expect(await fs.readdir(directory)).toEqual(["auth.json"]); expect(log).not.toHaveBeenCalled();
});

it.runIf(process.platform === "win32")("rejects a broad existing directory without repairing its ACL or writing credential bytes", async () => {
  const directory = path.join(root, "home"); await fs.mkdir(directory);
  setFixtureAcl(root, directory, true);
  const before = fixtureAcl(directory);
  await expect(write(path.join(directory, "auth.json"))).rejects.toMatchObject({ code: "EACCES" });
  expect(fixtureAcl(directory)).toBe(before); expect(await fs.readdir(directory)).toEqual([]);
});

it.runIf(process.platform === "win32")("fails closed before writing when the actual ACL inspector is unavailable", async () => {
  const directory = path.join(root, "home"); await ensurePrivateCredentialDirectory(directory);
  vi.stubEnv("SystemRoot", path.join(root, "missing-system"));
  const log = vi.fn();
  await expect(write(path.join(directory, "auth.json"), log)).rejects.toThrow("private permissions");
  expect(await fs.readdir(directory)).toEqual([]); expect(log).not.toHaveBeenCalled();
});

it.runIf(process.platform === "win32").each(["api-key", "mcp-config"])("keeps an existing broad %s file unchanged and never writes the replacement secret", async kind => {
  const directory = path.join(root, "home"); await ensurePrivateCredentialDirectory(directory);
  const destination = path.join(directory, kind === "api-key" ? "auth.json" : "config.toml");
  await fs.writeFile(destination, older); setFixtureAcl(root, destination, true);
  const before = fixtureAcl(destination);
  const operation = kind === "api-key" ? writeApiKeyAuthJson(directory, secret) : writeManagedCodexMcpConfig({ codexHome: directory,
    apiBaseUrl: "http://127.0.0.1:3100", gateways: [{ name: "fixture", endpointPath: "/runtime", bearerToken: secret }] });
  await expect(operation).rejects.toMatchObject({ code: "EACCES" });
  expect(await fs.readFile(destination)).toEqual(older); expect(fixtureAcl(destination)).toBe(before);
  expect(await fs.readdir(directory)).toEqual([path.basename(destination)]);
});

it.runIf(process.platform === "win32")("refuses a planted credential symlink while preserving its target", async () => {
  const directory = path.join(root, "home"); await ensurePrivateCredentialDirectory(directory);
  const target = path.join(root, "untouched.json"); await fs.writeFile(target, older);
  const destination = path.join(directory, "auth.json"); await fs.symlink(target, destination, "file");
  await expect(write(destination)).rejects.toMatchObject({ code: "EACCES" });
  expect((await fs.lstat(destination)).isSymbolicLink()).toBe(true); expect(await fs.readFile(target)).toEqual(older);
});

it.runIf(process.platform === "win32")("refuses an existing broad cache root without altering its ACL or adding an account", async () => {
  await ensureCodexAuthCacheEntryDir(env(), "acct-one", "company-one");
  const directory = resolveCodexAuthCacheDir(env(), "company-one"); setFixtureAcl(root, directory, true);
  const before = fixtureAcl(directory), entries = await fs.readdir(directory);
  await expect(ensureCodexAuthCacheEntryDir(env(), "acct-two", "company-one")).rejects.toMatchObject({ code: "EACCES" });
  expect(fixtureAcl(directory)).toBe(before); expect(await fs.readdir(directory)).toEqual(entries);
});

it.runIf(process.platform === "win32")("refuses an existing broad device proof home and preserves the prior credential and ACL", async () => {
  const proofHome = deriveProofHome({ env: env(), companyId: "company-one", runId: "fixture" });
  const log = vi.fn();
  await installDeviceLoginCredential({ sandboxAuthBytes: older, proofHome, env: env(), companyId: "company-one", log });
  setFixtureAcl(root, proofHome, true);
  const before = fixtureAcl(proofHome), destination = path.join(proofHome, "auth.json");
  await expect(installDeviceLoginCredential({ sandboxAuthBytes: newer, proofHome, env: env(), companyId: "company-one", log })).rejects.toMatchObject({ code: "EACCES" });
  expect(await fs.readFile(destination)).toEqual(older); expect(fixtureAcl(proofHome)).toBe(before);
  expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
});
