import * as fs from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { hasPrivatePermissions } from "@paperclipai/shared/private-filesystem-permissions";
import { captureRunnerApiResponse } from "./runner-api-response.js";

const hook = vi.hoisted(() => ({
  beforeOpen: undefined as undefined | ((filename: string) => Promise<void>),
  afterOpen: undefined as undefined | ((handle: import("node:fs/promises").FileHandle, filename: string) => Promise<void>),
}));
// Delegate every operation to the actual filesystem; pause only at the open
// boundary to inspect real permissions before the caller can write a byte.
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    await hook.beforeOpen?.(String(args[0]));
    const handle = await actual.open(...args);
    try { await hook.afterOpen?.(handle, String(args[0])); }
    catch (error) { await handle.close(); throw error; }
    return handle;
  } };
});
afterEach(() => { hook.beforeOpen = undefined; hook.afterOpen = undefined; });

it("protects the spill directory and new empty file before the first response byte", async () => {
  let directoryChecked = false, fileChecked = false, filename: string | undefined;
  hook.beforeOpen = async name => {
    filename = name;
    expect(hasPrivatePermissions(dirname(name), (await fs.stat(dirname(name))).mode)).toBe(true);
    await expect(fs.access(name)).rejects.toMatchObject({ code: "ENOENT" });
    directoryChecked = true;
  };
  hook.afterOpen = async (handle, name) => {
    const empty = await handle.stat();
    expect(empty.size).toBe(0);
    expect(hasPrivatePermissions(name, empty.mode)).toBe(true);
    fileChecked = true;
  };
  const capture = await captureRunnerApiResponse(new Response("synthetic response bytes"), 1, new AbortController(), 5_000);
  try {
    expect(directoryChecked && fileChecked).toBe(true);
    expect(await capture.read(0, 100)).toEqual(Buffer.from("synthetic response bytes"));
  } finally { await capture.dispose(); }
  await expect(fs.access(filename!)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(fs.access(dirname(filename!))).rejects.toMatchObject({ code: "ENOENT" });
});
