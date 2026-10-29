import { promises as fs } from "node:fs";

/** File bytes must be flushed separately and strictly. Node cannot open/flush
 * directory handles on Windows filesystems; only that unsupported directory
 * phase follows the existing CLI convention. Real I/O/storage errors propagate.
 */
export async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== "win32" || !["EACCES", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(String(code))) throw error;
  } finally { await handle?.close(); }
}
