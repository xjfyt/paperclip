import path from "node:path";

/** A workspace command is already shell source, not an argv array. Preserve
 * that source verbatim and select the flags understood by the chosen shell. */
export function workspaceShellInvocation(
  shell: string,
  source: string,
  options: { login?: boolean; platform?: NodeJS.Platform } = {},
): { command: string; args: string[]; windowsVerbatimArguments?: true } {
  if ((options.platform ?? process.platform) === "win32") {
    const name = path.win32.basename(shell).toLowerCase().replace(/\.exe$/, "");
    if (name === "powershell" || name === "pwsh") {
      return { command: shell, args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", source] };
    }
    if (name === "cmd") {
      // cmd /s removes this outer pair; the source owns its inner quoting.
      return { command: shell, args: ["/d", "/s", "/c", `"${source}"`], windowsVerbatimArguments: true };
    }
  }
  return { command: shell, args: [options.login ? "-lc" : "-c", source] };
}
