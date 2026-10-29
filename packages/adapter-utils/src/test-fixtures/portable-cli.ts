import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { sandboxPath, shellExecutable, shellScript, runLocalSandboxProcess } from "./local-sandbox.js";

/** Run an emulated POSIX provider command, including executable shell files,
 * through Git Bash on Windows. Native host adapters use the .cmd entry below.
 */
export const runPosixSandboxProcess: typeof runLocalSandboxProcess = async (id, command, args, options) => {
  let result;
  if (process.platform === "win32" && !/\.(exe|com)$/i.test(command)) {
    result = await runLocalSandboxProcess(id, shellExecutable("bash"), ["-c", 'exec "$@"', "--", shellScript(command), ...args], options);
  } else {
    result = await runLocalSandboxProcess(id, command, args, options);
  }
  // The fake provider exposes /Users/... while Git Bash reports /c/Users/....
  // Translate textual path responses back at that same provider boundary.
  const virtualTemp = sandboxPath(os.tmpdir());
  return process.platform === "win32" ? { ...result,
    stdout: result.stdout.replaceAll(shellScript(virtualTemp), virtualTemp),
    stderr: result.stderr.replaceAll(shellScript(virtualTemp), virtualTemp),
  } : result;
};

/** Offline POSIX-script fixture with an explicit executable entry on Windows.
 * Callers use the returned absolute path, never a same-name ambient provider.
 */
export async function writePosixCliFixture(file: string, source: string): Promise<string> {
  const absolute = path.resolve(file);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, shellScript(source), { mode: 0o755 });
  if (process.platform !== "win32") return absolute;
  const shell = shellExecutable("bash");
  if (/[\r\n"%!]/.test(absolute + shell)) throw new Error("Unsupported fixture path for a batch entrypoint");
  const entry = `${absolute}.cmd`;
  await fs.writeFile(entry, `@echo off\r\n"${shell}" --noprofile --norc "${shellScript(sandboxPath(absolute))}" %*\r\nexit /b %errorlevel%\r\n`);
  return entry;
}
