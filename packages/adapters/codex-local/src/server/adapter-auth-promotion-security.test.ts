import fs from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as permissions from "@paperclipai/shared/private-filesystem-permissions";
import { setFixtureAcl } from "@paperclipai/adapter-utils/test-fixtures/windows-private-acl";
import { fixtureAcl } from "./__test-fixtures__/private-permissions.js";
import * as homes from "./codex-home.js";
import { checkStagedCredentialReadiness, promoteDeviceLoginCredential } from "./adapter-auth-promotion.js";

const credential = Buffer.from(JSON.stringify({ tokens: { account_id: "acct-private", access_token: "offline-access", refresh_token: "offline-refresh" } }));
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it("protects the empty readiness root before writing and verifies its actual private credential", async () => {
  const protect = permissions.protectNewPrivatePath;
  const usable = homes.codexHomeHasUsableAuth;
  const observedRoots: string[] = [];
  let observedCredential = false;
  vi.spyOn(permissions, "protectNewPrivatePath").mockImplementation((root) => {
    expect(readdirSync(root)).toEqual([]);
    protect(root);
    expect(permissions.hasPrivatePermissions(root, statSync(root).mode)).toBe(true);
    observedRoots.push(root);
  });
  vi.spyOn(homes, "codexHomeHasUsableAuth").mockImplementation(async (root) => {
    const file = path.join(root, "auth.json");
    expect(await fs.readFile(file)).toEqual(credential);
    expect(permissions.hasPrivatePermissions(file, (await fs.stat(file)).mode)).toBe(true);
    observedCredential = true;
    return usable(root);
  });
  expect(await checkStagedCredentialReadiness(credential)).toEqual({ ready: true });
  expect(observedRoots).toHaveLength(1);
  expect(observedCredential).toBe(true);
  await expect(fs.access(observedRoots[0]!)).rejects.toMatchObject({ code: "ENOENT" });
});

it("removes the still-empty readiness home when protection fails", async () => {
  let created = "";
  vi.spyOn(permissions, "protectNewPrivatePath").mockImplementation((root) => {
    created = root;
    expect(readdirSync(root)).toEqual([]);
    throw Object.assign(new Error("fixture protection unavailable"), { code: "EACCES" });
  });
  await expect(checkStagedCredentialReadiness(credential)).rejects.toMatchObject({ code: "EACCES" });
  expect(created).not.toBe("");
  await expect(fs.access(created)).rejects.toMatchObject({ code: "ENOENT" });
});

it.runIf(process.platform === "win32")("preserves an existing broad company home while the private account login remains durable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-promotion-private-"));
  roots.push(root);
  permissions.protectNewPrivatePath(root);
  const env = { PAPERCLIP_HOME: root, PAPERCLIP_INSTANCE_ID: "fixture" };
  const home = homes.resolveManagedCodexHomeDir(env, "company-private");
  await fs.mkdir(home, { recursive: true });
  const file = path.join(home, "auth.json");
  await fs.writeFile(file, "prior credential");
  setFixtureAcl(root, home, true);
  const beforeAcl = fixtureAcl(home);
  const log = vi.fn();
  const result = await promoteDeviceLoginCredential({ authBytes: credential, companyId: "company-private", userInitiated: true,
    checkReadiness: () => ({ ready: true }), isSoleActiveOwner: () => true, log, env });
  expect(result.outcome).toBe("promoted");
  expect(await fs.readFile(file, "utf8")).toBe("prior credential");
  expect(fixtureAcl(home)).toBe(beforeAcl);
  expect(await fs.readdir(home)).toEqual(["auth.json"]);
  const accountFile = path.join(result.accountHomeDir!, "auth.json");
  expect(await fs.readFile(accountFile)).toEqual(credential);
  expect(permissions.hasPrivatePermissions(accountFile, (await fs.stat(accountFile)).mode)).toBe(true);
  expect(JSON.stringify(log.mock.calls)).toContain("seeding the company default home failed");
  expect(JSON.stringify(log.mock.calls)).not.toContain("offline-refresh");
});
