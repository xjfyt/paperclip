import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runChildProcess as hostRunChildProcess } from "../server-utils.js";

// These tests run a POSIX sandbox against real temporary files on the host.
// On Windows, /Users/... addresses the current drive in Node; Git Bash needs
// /c/Users/... for the same file. Keep this translation at the fake provider
// boundary instead of passing Windows paths through the remote POSIX contract.
export function sandboxPath(value: string): string {
  if (process.platform !== "win32") return value;
  if (!path.win32.isAbsolute(value) || value.startsWith("/")) return value;
  const drive = (file: string) => path.win32.parse(file).root.replaceAll("\\", "/").toLowerCase();
  if (drive(value) !== drive(process.cwd())) {
    throw new Error("The local sandbox fixture needs its temporary files on the current drive");
  }
  return value.slice(2).replaceAll("\\", "/");
}

export const fixturePath: typeof path = {
  ...path,
  join: (...parts: string[]) => parts[0]?.startsWith("/") ? path.posix.join(...parts) : path.join(...parts),
  dirname: (value: string) => value.startsWith("/") ? path.posix.dirname(value) : path.dirname(value),
  relative: (from: string, to: string) => from.startsWith("/") ? path.posix.relative(from, to) : path.relative(from, to),
};

function gitShellDirectory(): string {
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA];
  const candidates = roots.filter((root): root is string => Boolean(root))
    .flatMap((root) => [path.join(root, "Git", "usr", "bin"), path.join(root, "Programs", "Git", "usr", "bin")]);
  const directory = candidates.find((candidate) => existsSync(path.join(candidate, "sh.exe")));
  if (!directory) throw new Error("Windows POSIX sandbox tests require Git Bash (sh.exe)");
  return directory;
}

export function shellExecutable(command: string): string {
  if (process.platform !== "win32") return command;
  const name = command.replace(/^\/bin\//, "");
  if (name === "sh" || name === "bash") return path.join(gitShellDirectory(), `${name}.exe`);
  return command;
}

export function shellScript(script: string): string {
  if (process.platform !== "win32") return script;
  const remoteTemp = sandboxPath(os.tmpdir());
  const msysTemp = `/${path.parse(os.tmpdir()).root[0]!.toLowerCase()}${remoteTemp}`;
  return script.replaceAll(remoteTemp, (match, offset: number) => {
    const before = script.slice(0, offset);
    const previous = before.at(-1);
    // A rooted remote path can follow shell quoting or a PATH delimiter, but
    // a substring inside /c/Users/... is already in the MSYS namespace.
    if (previous && !/\s/.test(previous) && !"'\"=:;([".includes(previous)) return match;
    if (/(?:^|[\s'"=;(])[A-Za-z]:$/.test(before)) return match;
    return msysTemp;
  });
}

export function shellArgs(args: string[] | undefined): string[] {
  return (args ?? []).map(shellScript);
}

export function shellEnvironment(env: NodeJS.ProcessEnv = {}): Record<string, string> {
  const merged = Object.fromEntries(Object.entries({ ...process.env, ...env })
    .filter((entry): entry is [string, string] => entry[1] !== undefined));
  if (process.platform !== "win32") return merged;
  for (const [name, value] of Object.entries(merged)) merged[name] = shellScript(value);
  const explicitPath = Object.entries(env).find(([name]) => name.toLowerCase() === "path")?.[1];
  const inheritedPath = Object.entries(merged).find(([name]) => name.toLowerCase() === "path")?.[1];
  for (const key of Object.keys(merged)) if (key.toLowerCase() === "path") delete merged[key];
  merged.PATH = `${gitShellDirectory()};${shellScript(explicitPath ?? inheritedPath ?? "")}`;
  merged.MSYS = `${merged.MSYS ?? ""} winsymlinks:nativestrict`.trim();
  return merged;
}

function launch(command: string, args: readonly string[]) {
  if (process.platform === "win32" && /\.[cm]js$/.test(command) && existsSync(command)) {
    return { command: process.execPath, args: [command, ...args], cleanup: () => {} };
  }
  // Git Bash's MSYS argv parser differs from libuv's Windows CRT quoting, even
  // below CreateProcess's size limit. Keep shell source and positional values
  // in owned files, leaving only a fixed short source wrapper in Windows argv.
  if (process.platform === "win32" && /(?:^|[\\/])(?:ba)?sh(?:\.exe)?$/.test(command)
    && (args[0] === "-c" || args[0] === "-lc") && args[1] !== undefined) {
    if (args.some((arg) => arg.includes("\0"))) throw new TypeError("Shell fixture arguments must not contain NUL bytes");
    const directory = mkdtempSync(path.join(os.tmpdir(), "paperclip-test-shell-"));
    const script = path.join(directory, "command.sh");
    const wrapper = path.join(directory, "arguments.sh");
    writeFileSync(script, args[1]!);
    const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
    const shellFile = (file: string) => `/${path.parse(file).root[0]!.toLowerCase()}${sandboxPath(file)}`;
    const restoreZero = args[2] === undefined ? "" : `BASH_ARGV0=${quote(args[2])}\n[ "$0" = ${quote(args[2])} ] || exit 125\n`;
    writeFileSync(wrapper, `${restoreZero}set -- ${args.slice(3).map(quote).join(" ")}\n. ${quote(shellFile(script))}\n`);
    return { command, args: [args[0], `. ${quote(shellFile(wrapper))}`],
    cleanup: () => rmSync(directory, { recursive: true, force: true }) };
  }
  return { command, args: [...args], cleanup: () => {} };
}

export const runLocalSandboxProcess: typeof hostRunChildProcess = async (runId, command, args, options) => {
  const prepared = launch(command, args);
  try { return await hostRunChildProcess(runId, prepared.command, prepared.args, options); }
  finally { prepared.cleanup(); }
};

export const spawnLocalSandbox: typeof nodeSpawn = ((...input: Parameters<typeof nodeSpawn>) => {
  const prepared = launch(input[0], input[1] ?? []);
  const child = nodeSpawn(prepared.command, prepared.args, input[2]);
  child.once("close", prepared.cleanup);
  child.once("error", prepared.cleanup);
  return child;
}) as typeof nodeSpawn;

export async function cleanupLocalSandboxProcesses(roots: string[]): Promise<void> {
  if (process.platform !== "win32" || roots.length === 0) return;
  const temp = path.resolve(os.tmpdir()).toLowerCase() + path.sep;
  for (const root of roots) {
    if (!path.resolve(root).toLowerCase().startsWith(temp) || !path.basename(root).startsWith("paperclip-")) {
      throw new Error("Refusing to clean processes outside an owned local sandbox fixture");
    }
  }
  const result = await hostRunChildProcess("local-sandbox-fixture-cleanup",
    path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      fileURLToPath(new URL("./cleanup-local-sandbox.ps1", import.meta.url))], {
      cwd: process.cwd(), env: {}, timeoutSec: 15, graceSec: 1,
      stdin: JSON.stringify(roots), onLog: async () => {},
    });
  if (result.exitCode !== 0 || result.timedOut) throw new Error(`Local sandbox fixture cleanup failed: ${result.stderr}`);
}
