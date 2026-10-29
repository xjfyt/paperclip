import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stopOwnedWindowsEmbeddedPostgres } from "./embedded-postgres-windows.js";

describe("owned Windows PostgreSQL shutdown", () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
  async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-windows-stop-test-"));
    roots.push(root);
    const databaseDir = path.join(root, "db");
    await fs.mkdir(databaseDir);
    const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null as number | null, signalCode: null });
    const pidFile = path.join(databaseDir, "postmaster.pid");
    const lines = ["12345", databaseDir, "0", "45432", "", "localhost", "", "ready"];
    await fs.writeFile(pidFile, lines.join("\n"));
    const input = { child, databaseDir, port: 45432, pgCtl: "qualified-pg_ctl.exe", persistent: true };
    const stopped = async () => { await fs.unlink(pidFile); child.exitCode = 0; child.emit("exit", 0, null); };
    return { root, input, lines, child, pidFile, stopped };
  }

  it("uses native fast shutdown and preserves a persistent directory after confirmed exit", async () => {
    const { input, child, pidFile, stopped } = await fixture();
    const run = vi.fn(stopped);
    await stopOwnedWindowsEmbeddedPostgres(input, run);
    expect(run).toHaveBeenCalledWith("qualified-pg_ctl.exe", ["-D", await fs.realpath(input.databaseDir), "stop", "-m", "fast", "-w", "-t", "30"], expect.objectContaining({ windowsHide: true, timeout: 35_000 }));
    await expect(fs.stat(input.databaseDir)).resolves.toBeTruthy();
    await expect(fs.stat(pidFile)).rejects.toMatchObject({ code: "ENOENT" });
    expect(child.listenerCount("exit")).toBe(0);
  });

  it.each(["pid", "directory", "port"])("refuses a mismatched %s without dispatching a stop or removing files", async (field) => {
    const { input, lines, pidFile, root } = await fixture();
    if (field === "pid") lines[0] = "54321";
    if (field === "directory") lines[1] = root;
    if (field === "port") lines[3] = "54329";
    await fs.writeFile(pidFile, lines.join("\n"));
    const run = vi.fn();
    await expect(stopOwnedWindowsEmbeddedPostgres(input, run)).rejects.toThrow("does not match its owner");
    expect(run).not.toHaveBeenCalled();
    await expect(fs.stat(pidFile)).resolves.toBeTruthy();
  });

  it("preserves a crashed cluster rather than using a stale PID to stop another process", async () => {
    const { input, child, pidFile } = await fixture();
    child.exitCode = 1;
    const run = vi.fn();
    await expect(stopOwnedWindowsEmbeddedPostgres(input, run)).rejects.toThrow("without a clean shutdown");
    expect(run).not.toHaveBeenCalled();
    await expect(fs.stat(pidFile)).resolves.toBeTruthy();
  });

  it("removes only a nonpersistent owned directory after successful shutdown", async () => {
    const { input, root, stopped } = await fixture();
    const sibling = path.join(root, "retained.txt");
    await fs.writeFile(sibling, "retained");
    await stopOwnedWindowsEmbeddedPostgres({ ...input, persistent: false }, stopped);
    await expect(fs.stat(input.databaseDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(sibling, "utf8")).toBe("retained");
  });

  it("preserves files and removes the exit listener if pg_ctl rejects", async () => {
    const { input, child, pidFile } = await fixture();
    await expect(stopOwnedWindowsEmbeddedPostgres(input, async () => { throw new Error("native stop failed"); })).rejects.toThrow("native stop failed");
    await expect(fs.stat(pidFile)).resolves.toBeTruthy();
    expect(child.listenerCount("exit")).toBe(0);
  });
});
