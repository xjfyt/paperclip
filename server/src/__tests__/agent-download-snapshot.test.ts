import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasPrivatePermissions } from "@paperclipai/shared/private-filesystem-permissions";
import { agentDownloadStream, snapshotAgentDownload, type AgentDownloadFile } from "../services/agent-download-snapshot.js";

describe("agent download disk snapshots", () => {
  let root: string;
  let source: AgentDownloadFile;
  let filename: string;
  const snapshots = new Set<string>();
  const handles = new Set<fs.FileHandle>();
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-download-test-"));
    filename = path.join(root, "source");
    await fs.writeFile(filename, Buffer.alloc(160 * 1024 + 3, 0x61));
    const handle = await fs.open(filename, "r");
    handles.add(handle);
    const identity = await handle.stat({ bigint: true });
    source = { handle, identity, size: Number(identity.size) };
    const mkdtemp = fs.mkdtemp.bind(fs);
    vi.spyOn(fs, "mkdtemp").mockImplementation((async (...args: Parameters<typeof fs.mkdtemp>) => {
      const directory = await mkdtemp(...args);
      if (typeof directory === "string" && path.basename(directory).startsWith("paperclip-agent-download-")) snapshots.add(directory);
      return directory;
    }) as typeof fs.mkdtemp);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all([...handles].map(handle => handle.close()));
    handles.clear();
    for (const directory of snapshots) {
      expect(path.dirname(directory)).toBe(os.tmpdir());
      await fs.rm(directory, { recursive: true, force: true });
    }
    snapshots.clear();
    expect(path.basename(root)).toMatch(/^agent-download-test-/);
    await fs.rm(root, { recursive: true, force: true });
  });

  async function expectRemoved(directory: string) {
    for (let i = 0; i < 100; i++) {
      if (!(await fs.stat(directory).catch(() => null))) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(await fs.stat(directory).catch(() => null)).toBeNull();
  }
  function observeSnapshot(onOpen: (handle: fs.FileHandle, filename: string) => void) {
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      handles.add(handle);
      onOpen(handle, String(args[0]));
      return handle;
    });
  }

  it("protects an empty destination before writing, bounds buffers, and releases the original before streaming", async () => {
    let checked = false;
    observeSnapshot((handle, name) => {
      const write = handle.write.bind(handle);
      vi.spyOn(handle, "write").mockImplementation((async (...args: Parameters<typeof handle.write>) => {
        if (!checked) {
          expect((await handle.stat()).size).toBe(0);
          expect(hasPrivatePermissions(path.dirname(name), (await fs.stat(path.dirname(name))).mode)).toBe(true);
          expect(hasPrivatePermissions(name, (await handle.stat()).mode)).toBe(true);
          checked = true;
        }
        return write(...args);
      }) as typeof handle.write);
    });
    const read = vi.spyOn(source.handle, "read");
    const snapshot = await snapshotAgentDownload(source);
    expect(checked).toBe(true);
    expect(read.mock.calls.length).toBeGreaterThan(1);
    expect(new Set(read.mock.calls.map(args => args[0])).size).toBe(1);
    for (const args of read.mock.calls) expect((args[0] as Buffer).length).toBe(64 * 1024);
    await fs.rename(filename, `${filename}.replaced`);
    await fs.writeFile(filename, "new bytes");
    const stream = agentDownloadStream(snapshot);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(Buffer.alloc(source.size, 0x61));
    expect(await fs.readFile(filename, "utf8")).toBe("new bytes");
    await expectRemoved(snapshot.directory);
  });

  it.each(["growth", "same-size overwrite"])("rejects %s between the initial descriptor check and copying", async kind => {
    if (kind === "growth") await fs.appendFile(filename, "extra");
    else await fs.writeFile(filename, Buffer.alloc(source.size, 0x62));
    await expect(snapshotAgentDownload(source)).rejects.toThrow("changed while taking a snapshot");
    for (const directory of snapshots) await expectRemoved(directory);
  });

  it("rejects a source mutation during the real copy and removes all partial bytes", async () => {
    const read = source.handle.read.bind(source.handle);
    let changed = false;
    vi.spyOn(source.handle, "read").mockImplementation((async (...args: Parameters<typeof source.handle.read>) => {
      const result = await read(...args);
      if (!changed) { changed = true; await fs.appendFile(filename, "racing append"); }
      return result;
    }) as typeof source.handle.read);
    await expect(snapshotAgentDownload(source)).rejects.toThrow("changed while taking a snapshot");
    for (const directory of snapshots) await expectRemoved(directory);
  });

  it("copies all bytes when the destination performs short writes", async () => {
    observeSnapshot(handle => {
      const write = handle.write.bind(handle);
      vi.spyOn(handle, "write").mockImplementation(((buffer: Buffer, offset: number, length: number, position: number) =>
        write(buffer, offset, Math.min(length, 4096), position)) as typeof handle.write);
    });
    const snapshot = await snapshotAgentDownload(source);
    expect(await snapshot.handle.readFile()).toEqual(Buffer.alloc(source.size, 0x61));
    await snapshot.handle.close();
  });

  it("rejects a zero-byte destination write and cleans the incomplete snapshot", async () => {
    observeSnapshot(handle => {
      vi.spyOn(handle, "write").mockResolvedValue({ bytesWritten: 0, buffer: Buffer.alloc(0) });
    });
    await expect(snapshotAgentDownload(source)).rejects.toThrow("could not be written");
    for (const directory of snapshots) await expectRemoved(directory);
  });

  it("still removes partial bytes when both copying and destination close report errors", async () => {
    vi.spyOn(source.handle, "read").mockRejectedValue(new Error("injected read failure"));
    observeSnapshot(handle => {
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => { await close(); throw new Error("injected close failure"); });
    });
    const error = await snapshotAgentDownload(source).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.cause.message).toBe("injected read failure");
    expect(error.errors.map((item: Error) => item.message)).toEqual(["injected read failure", "injected close failure"]);
    for (const directory of snapshots) await expectRemoved(directory);
  });

  it.each(["before transfer", "during transfer"])("closes and removes snapshots when a consumer aborts %s", async when => {
    const snapshot = await snapshotAgentDownload(source);
    const stream = agentDownloadStream(snapshot);
    if (when === "during transfer") {
      stream.once("data", () => { stream.pause(); stream.destroy(); });
    } else stream.destroy();
    await once(stream, "close");
    expect(stream.closed).toBe(true);
    await expect(snapshot.handle.stat()).rejects.toThrow();
    await expectRemoved(snapshot.directory);
  });
});
