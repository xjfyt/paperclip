import { promises as fs } from "node:fs";
import { spawnSync as nativeSpawnSync } from "node:child_process";
import os from "node:os";
import nativePath from "node:path";

// This is the fake remote POSIX provider boundary. Production host paths and
// remote confinement checks stay untouched; only the local Git Bash simulator
// translates the same current-drive temporary files into MSYS path spelling.
const windows = process.platform === "win32";
const gitBin = nativePath.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "usr", "bin");
export const gnuTarCandidates = windows ? [nativePath.join(gitBin, "tar.exe")] : ["gtar", "tar"];

function remotePath(value: string): string {
  if (!windows || !/^[A-Za-z]:[\\/]/.test(value)) return value;
  if (nativePath.parse(value).root.toLowerCase() !== nativePath.parse(process.cwd()).root.toLowerCase()) throw new Error("Local POSIX fixtures require the current drive");
  return value.slice(2).replaceAll("\\", "/");
}

export const fixtureMkdtemp: typeof fs.mkdtemp = (async (prefix: string, options?: Parameters<typeof fs.mkdtemp>[1]) => {
    const actual = windows && prefix.startsWith("/tmp/") ? nativePath.join(os.tmpdir(), nativePath.basename(prefix)) : prefix;
    const value = await fs.mkdtemp(actual, options as never);
    if (typeof value !== "string") throw new Error("Local POSIX fixtures require string temporary paths");
    return remotePath(value);
  }) as typeof fs.mkdtemp;

export const fixturePath: typeof nativePath = {
  ...nativePath,
  join: (...parts: string[]) => parts[0]?.startsWith("/") ? nativePath.posix.join(...parts) : nativePath.join(...parts),
  dirname: (value: string) => value.startsWith("/") ? nativePath.posix.dirname(value) : nativePath.dirname(value),
};

function shellScript(value: string): string {
  if (!windows) return value;
  const prefix = remotePath(os.tmpdir());
  return value.replaceAll(prefix, `/${nativePath.parse(os.tmpdir()).root[0]!.toLowerCase()}${prefix}`);
}

export const spawnSync: typeof nativeSpawnSync = ((command: string, args: string[] = [], options: import("node:child_process").SpawnSyncOptions = {}) => {
  if (!windows) return nativeSpawnSync(command, args, options);
  let executable = command;
  if (/^\/bin\/(?:ba)?sh$/.test(command)) executable = nativePath.join(gitBin, `${nativePath.posix.basename(command)}.exe`);
  const env = Object.fromEntries(Object.entries({ ...process.env, ...options.env }).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const inheritedPath = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
  for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
  env.PATH = `${gitBin};${inheritedPath}`;
  env.MSYS = `${env.MSYS ?? ""} winsymlinks:nativestrict`.trim();
  return nativeSpawnSync(executable, args.map(shellScript), { ...options, env });
}) as typeof nativeSpawnSync;
