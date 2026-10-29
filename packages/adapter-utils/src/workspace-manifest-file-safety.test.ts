import { createHash } from "node:crypto";
import { mkdtemp, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const race = vi.hoisted(() => ({
  file: "", changed: false, preciseIdentity: false,
  afterOpen: undefined as undefined | (() => Promise<void>),
  afterFinalStat: undefined as undefined | (() => Promise<void>),
}));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  const metadata = (value: import("node:fs").Stats | import("node:fs").BigIntStats) => {
    if (race.preciseIdentity) Reflect.set(value, "ino", typeof value.ino === "bigint"
      ? (race.changed ? 9_007_199_254_740_993n : 9_007_199_254_740_992n)
      : Number(race.changed ? 9_007_199_254_740_993n : 9_007_199_254_740_992n));
    return value;
  };
  return { ...actual, promises: { ...actual.promises,
    lstat: new Proxy(actual.promises.lstat, { async apply(target, receiver, args) {
      const value = await Reflect.apply(target, receiver, args);
      return String(args[0]) === race.file ? metadata(value) : value;
    } }),
    open: new Proxy(actual.promises.open, { async apply(target, receiver, args) {
      const file = await Reflect.apply(target, receiver, args);
      if (String(args[0]) !== race.file) return file;
      const stat = file.stat.bind(file);
      let stats = 0;
      file.stat = new Proxy(stat, { async apply(target, receiver, args) {
        const value = metadata(await Reflect.apply(target, receiver, args));
        if (++stats === 2) await race.afterFinalStat?.();
        return value;
      } });
      await race.afterOpen?.();
      return file;
    } }),
  } };
});
import { manifestFileSha256 } from "./workspace-manifest.js";

const roots: string[] = [];
afterEach(async () => {
  race.file = ""; race.changed = false; race.preciseIdentity = false;
  race.afterOpen = undefined; race.afterFinalStat = undefined;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-manifest-identity-"));
  roots.push(root);
  race.file = path.join(root, "manifest.sqlite");
  await writeFile(race.file, "actual manifest bytes");
  return root;
}
it("hashes a stable real regular file", async () => {
  await fixture();
  expect(await manifestFileSha256(race.file)).toBe(createHash("sha256").update("actual manifest bytes").digest("hex"));
});
it("refuses a final symlink to identical real bytes", async () => {
  const root = await fixture();
  const original = path.join(root, "original.sqlite");
  await rename(race.file, original);
  await symlink(original, race.file);
  await expect(manifestFileSha256(race.file)).rejects.toThrow();
});
it("refuses an entry replaced after opening its real descriptor", async () => {
  const root = await fixture();
  race.afterOpen = async () => {
    await rename(race.file, path.join(root, "original.sqlite"));
    await writeFile(race.file, "actual manifest bytes");
  };
  await expect(manifestFileSha256(race.file)).rejects.toThrow();
});
it("refuses same-inode content changes after the final descriptor stat", async () => {
  await fixture();
  race.afterFinalStat = async () => {
    await writeFile(race.file, "changed manifest data");
    await utimes(race.file, new Date("2001-01-01"), new Date("2001-01-01"));
  };
  await expect(manifestFileSha256(race.file)).rejects.toThrow();
});
it("compares descriptor identity above MAX_SAFE_INTEGER without Number rounding", async () => {
  await fixture();
  race.preciseIdentity = true;
  race.afterOpen = async () => { race.changed = true; };
  await expect(manifestFileSha256(race.file)).rejects.toThrow();
});
