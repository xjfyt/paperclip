import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPrivatePermissions, protectNewPrivatePath } from "@paperclipai/shared/private-filesystem-permissions";
import { setFixtureAcl } from "./helpers/windows-private-acl.js";

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-private-acl-")); });
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });

describe.skipIf(process.platform !== "win32")("native Windows private ACLs", { timeout: 20000 }, () => {
  it("protects a new empty file before content is written, including literal special characters", async () => {
    const file = path.join(root, "private ' spaced $(ignored) 文件.txt");
    await fs.writeFile(file, "", { flag: "wx" });
    protectNewPrivatePath(file);
    expect(hasPrivatePermissions(file, (await fs.stat(file)).mode)).toBe(true);
    expect(await fs.readFile(file, "utf8")).toBe("");
    await fs.writeFile(file, "synthetic-credential");
    expect(hasPrivatePermissions(file, (await fs.stat(file)).mode)).toBe(true);
  });
  it("rejects an actual Everyone read grant without silently repairing the existing file", async () => {
    const file = path.join(root, "broad.txt");
    await fs.writeFile(file, "synthetic-credential", { flag: "wx" });
    setFixtureAcl(root, file, true);
    expect(hasPrivatePermissions(file, 0o600)).toBe(false);
    expect(hasPrivatePermissions(file, 0o600)).toBe(false);
    expect(await fs.readFile(file, "utf8")).toBe("synthetic-credential");
  });
  it("gives new children a private inherited ACL", async () => {
    const directory = path.join(root, "credentials");
    await fs.mkdir(directory);
    protectNewPrivatePath(directory);
    const file = path.join(directory, "child.txt");
    await fs.writeFile(file, "", { flag: "wx" });
    expect(hasPrivatePermissions(directory, 0o777)).toBe(true);
    expect(hasPrivatePermissions(file, 0o666)).toBe(true);
  });
  it("rejects a reparse point without tightening its target ACL", async () => {
    const target = path.join(root, "target.txt"), link = path.join(root, "link.txt");
    await fs.writeFile(target, "", { flag: "wx" });
    setFixtureAcl(root, target, true);
    await fs.symlink(target, link, "file");
    expect(hasPrivatePermissions(link, 0o600)).toBe(false);
    expect(() => protectNewPrivatePath(link)).toThrow("private Windows ACL");
    expect(hasPrivatePermissions(target, 0o600)).toBe(false);
  });
  it("fails closed without the OS ACL inspector and does not write any secret", async () => {
    const file = path.join(root, "empty.txt");
    await fs.writeFile(file, "", { flag: "wx" });
    vi.stubEnv("SystemRoot", path.join(root, "missing-system"));
    expect(hasPrivatePermissions(file, 0o600)).toBe(false);
    expect(() => protectNewPrivatePath(file)).toThrow("private Windows ACL");
    expect(await fs.readFile(file, "utf8")).toBe("");
  });
});

it.skipIf(process.platform === "win32")("retains POSIX mode checks", () => {
  expect(hasPrivatePermissions("/private/file", 0o600)).toBe(true);
  expect(hasPrivatePermissions("/private/file", 0o644)).toBe(false);
});
