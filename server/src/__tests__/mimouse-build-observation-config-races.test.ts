import { mkdtemp, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const race = vi.hoisted(() => ({
  file: "", beforeOpen: undefined as (() => Promise<void>) | undefined,
  afterOpen: undefined as (() => Promise<void>) | undefined,
  afterFinalStat: undefined as (() => Promise<void>) | undefined,
  readCalls: 0, swapped: false, finalChange: false,
  preciseIdentity: false, preciseClock: false,
}));

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  // Real filesystem metadata and bytes remain in use. Only the precision
  // regressions project chosen 64-bit IDs/times, since OS allocation and clock
  // ticks cannot be made deterministic by sleeping or allocating more files.
  function metadata(value: Awaited<ReturnType<typeof actual.stat>>) {
    const big = typeof value.ino === "bigint";
    if (race.preciseIdentity) Reflect.set(value, "ino", big
      ? (race.swapped ? 9007199254740993n : 9007199254740992n)
      : Number(race.swapped ? 9007199254740993n : 9007199254740992n));
    if (race.preciseClock || race.preciseIdentity) {
      const ns = 1_000_000_000_000_000_000n + (race.finalChange ? 1n : 0n);
      Reflect.set(value, "ctimeMs", big ? ns / 1_000_000n : Number(ns) / 1_000_000);
      if (big) Reflect.set(value, "ctimeNs", ns);
    }
    return value;
  }
  return { ...actual,
    lstat: new Proxy(actual.lstat, { async apply(target, receiver, args) {
      const value = await Reflect.apply(target, receiver, args);
      return String(args[0]) === race.file ? metadata(value) : value;
    } }),
    open: new Proxy(actual.open, { async apply(target, receiver, args) {
      if (String(args[0]) !== race.file) return Reflect.apply(target, receiver, args);
      const beforeOpen = race.beforeOpen; race.beforeOpen = undefined; await beforeOpen?.();
      const handle = await Reflect.apply(target, receiver, args);
      const afterOpen = race.afterOpen; race.afterOpen = undefined; await afterOpen?.();
      let stats = 0;
      handle.stat = new Proxy(handle.stat.bind(handle), { async apply(statTarget, statReceiver, statArgs) {
        const value = metadata(await Reflect.apply(statTarget, statReceiver, statArgs));
        if (++stats === 2) {
          const afterFinalStat = race.afterFinalStat; race.afterFinalStat = undefined; await afterFinalStat?.();
        }
        return value;
      } });
      handle.read = new Proxy(handle.read.bind(handle), { async apply(readTarget, readReceiver, readArgs) {
        race.readCalls++;
        return Reflect.apply(readTarget, readReceiver, readArgs);
      } });
      return handle;
    } }),
  };
});

import { loadBuildObservationConfig } from "../services/mimouse-coding/build-observation-config.js";
const roots: string[] = [];
const fixedTime = new Date("2001-01-01T00:00:00Z");
const document = (projectId = 3) => JSON.stringify({ schemaVersion: 1, profiles: [{
  id: "linux-x64", companyId: "d9e901dc-a5a4-4b21-b3b9-8dd522340997", manifestPath: "dist/app.bin", subjectName: "app.bin",
  maxObservationAgeSeconds: 3600, provenancePolicy: null,
  observer: { schemaVersion: 1, enabled: true, companyId: "d9e901dc-a5a4-4b21-b3b9-8dd522340997", origin: "https://git.example",
    allowedOrigins: ["https://git.example"], projectId, sourceUri: "https://git.example/org/project.git", artifactPath: "dist/app.bin",
    provenancePath: "dist/app.dsse.json", invocationMapping: null, totalTimeoutMs: 30000 },
}] });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "mimouse-observation-config-race-")); roots.push(root);
  const file = path.join(root, "operator.json"); await writeFile(file, document()); await utimes(file, fixedTime, fixedTime);
  race.file = file;
  return { file, held: path.join(root, "held.json"), replacement: path.join(root, "replacement.json") };
}
const load = () => loadBuildObservationConfig({ enabled: true, filePath: race.file });
const invalid = { enabled: false, diagnostic: "config_invalid" };
afterEach(async () => {
  race.file = ""; race.beforeOpen = race.afterOpen = race.afterFinalStat = undefined;
  race.readCalls = 0; race.swapped = race.finalChange = race.preciseIdentity = race.preciseClock = false;
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it("accepts a stable real file through the same descriptor wrappers", async () => {
  await fixture(); expect(await load()).toMatchObject({ enabled: true }); expect(race.readCalls).toBeGreaterThan(0);
});

it("rejects a pathname replaced after its original file descriptor opens", async () => {
  const f = await fixture();
  race.afterOpen = async () => { await rename(f.file, f.held); await writeFile(f.file, document(4)); };
  expect(await load()).toEqual(invalid);
});

it("rejects a same-inode final rewrite even when its original mtime is restored", async () => {
  const f = await fixture(), before = await stat(f.file, { bigint: true });
  race.afterFinalStat = async () => { await writeFile(f.file, document(4) + " "); await utimes(f.file, fixedTime, fixedTime); };
  expect(await load()).toEqual(invalid);
  const after = await stat(f.file, { bigint: true });
  expect(after.ino).toBe(before.ino); expect(after.mtimeNs).toBe(before.mtimeNs); expect(after.size).not.toBe(before.size);
  expect(race.readCalls).toBeGreaterThan(0);
});

it("detects a same-size final rewrite with ctime changes below Number timestamp precision", async () => {
  const f = await fixture(), before = await stat(f.file, { bigint: true }); race.preciseClock = true;
  expect(Number(1_000_000_000_000_000_000n)).toBe(Number(1_000_000_000_000_000_001n));
  race.afterFinalStat = async () => { await writeFile(f.file, document(4)); await utimes(f.file, fixedTime, fixedTime); race.finalChange = true; };
  expect(await load()).toEqual(invalid);
  const after = await stat(f.file, { bigint: true });
  expect(after.ino).toBe(before.ino); expect(after.size).toBe(before.size); expect(after.mtimeNs).toBe(before.mtimeNs);
});

it("distinguishes swapped 64-bit file IDs that alias when converted to Number", async () => {
  const f = await fixture(); await writeFile(f.replacement, document(4)); await utimes(f.replacement, fixedTime, fixedTime);
  race.preciseIdentity = true;
  expect(Number(9007199254740992n)).toBe(Number(9007199254740993n));
  race.beforeOpen = async () => { await rename(f.file, f.held); await rename(f.replacement, f.file); race.swapped = true; };
  expect(await load()).toEqual(invalid);
});
