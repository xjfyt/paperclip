import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { hasPrivatePermissions, protectNewPrivatePath } from "@paperclipai/shared/private-filesystem-permissions";

/** Windows credentials need a private DACL before the first secret is written.
 * Existing directories are inspected, never silently re-permissioned.
 */
export async function ensurePrivateCredentialDirectory(directory: string): Promise<void> {
  if (process.platform !== "win32") {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return;
  }
  await mkdir(path.dirname(directory), { recursive: true });
  try {
    await mkdir(directory, { mode: 0o700 });
    protectNewPrivatePath(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || !hasPrivatePermissions(directory, info.mode)) {
    throw Object.assign(new Error("Credential directory does not have verified private permissions."), { code: "EACCES" });
  }
}
