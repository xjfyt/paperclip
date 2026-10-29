import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSandboxOrphanCleanupSpool,
  type DeferredOrphanCleanupRecord,
} from "../services/sandbox-orphan-cleanup-spool.ts";

function buildRecord(overrides: Partial<DeferredOrphanCleanupRecord> = {}): DeferredOrphanCleanupRecord {
  return {
    companyId: "company-1",
    environmentId: "environment-1",
    executionWorkspaceId: null,
    issueId: null,
    heartbeatRunId: "run-1",
    provider: "fake",
    providerLeaseId: "sandbox://fake/lease-1",
    metadata: { driver: "sandbox", pluginKey: "example" },
    ...overrides,
  };
}

describe("createSandboxOrphanCleanupSpool", () => {
  let dir!: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "orphan-spool-unit-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("persists a record and loads it back after a restart", async () => {
    const writer = createSandboxOrphanCleanupSpool(dir);
    const record = buildRecord();
    expect(await writer.append(record)).toBe(true);

    // A fresh spool over the same directory models a process restart. The record
    // survives, so the load returns it with every field intact.
    const reader = createSandboxOrphanCleanupSpool(dir);
    const loaded = await reader.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(record);
  });

  it("removes a record so a later load returns nothing", async () => {
    const spool = createSandboxOrphanCleanupSpool(dir);
    const record = buildRecord();
    await spool.append(record);
    await spool.remove(record);
    expect(await spool.load()).toEqual([]);
    expect((await readdir(dir)).filter((name) => name.endsWith(".json"))).toHaveLength(0);
  });

  it("keeps one file when the same orphan is appended twice", async () => {
    const spool = createSandboxOrphanCleanupSpool(dir);
    const record = buildRecord();
    await spool.append(record);
    await spool.append(record);
    // The file name keys on the provider lease id, so the second append overwrites
    // the first file instead of persisting a duplicate.
    const loaded = await spool.load();
    expect(loaded).toHaveLength(1);
  });

  it("persists a record with a null provider lease id", async () => {
    const spool = createSandboxOrphanCleanupSpool(dir);
    const record = buildRecord({ providerLeaseId: null });
    expect(await spool.append(record)).toBe(true);
    const loaded = await spool.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.providerLeaseId).toBeNull();
  });

  it("skips a malformed spool file and returns the other records", async () => {
    const spool = createSandboxOrphanCleanupSpool(dir);
    await spool.append(buildRecord());
    // A torn or hand-edited file cannot authorize a teardown, so the load skips it
    // and keeps the valid record.
    await writeFile(path.join(dir, "broken.json"), "{ not json", "utf8");
    await writeFile(path.join(dir, "wrong-shape.json"), JSON.stringify({ companyId: 1 }), "utf8");
    const loaded = await spool.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.providerLeaseId).toBe("sandbox://fake/lease-1");
  });

  it("returns an empty list when the spool directory does not exist", async () => {
    const spool = createSandboxOrphanCleanupSpool(path.join(dir, "missing"));
    expect(await spool.load()).toEqual([]);
  });

  it.each(["write", "flush"] as const)("retains the previous durable record and removes partial temp after a %s failure", async (phase) => {
    const spool = createSandboxOrphanCleanupSpool(dir);
    const original = buildRecord();
    expect(await spool.append(original)).toBe(true);
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (String(args[0]).endsWith(".tmp")) {
        const failure = Object.assign(new Error("synthetic storage failure"), { code: phase === "write" ? "ENOSPC" : "EIO" });
        if (phase === "write") handle.writeFile = async () => { throw failure; };
        else handle.sync = async () => { throw failure; };
      }
      return handle;
    });
    expect(await spool.append({ ...original, metadata: { replacement: true } })).toBe(false);
    expect(await spool.load()).toEqual([original]);
    expect((await readdir(dir)).filter(name => name.endsWith(".tmp"))).toEqual([]);
  });

  it("does not suppress a genuine directory I/O failure after publishing the record", async () => {
    const spool = createSandboxOrphanCleanupSpool(dir);
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      if (args[0] === dir) throw Object.assign(new Error("synthetic directory storage failure"), { code: "EIO" });
      return open(...args);
    });
    expect(await spool.append(buildRecord())).toBe(false);
    expect(await spool.load()).toEqual([buildRecord()]);
  });
});
