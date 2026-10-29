import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { workspaceShellInvocation } from "../services/workspace-shell.js";

const execute = promisify(execFile);
const ps = (value: string) => `'${value.replaceAll("'", "''")}'`;
const crt = (value: string) => `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`;

describe("workspace shell invocation", () => {
  it.each(["powershell", "PWSH.EXE", "C:\\Program Files\\PowerShell\\7\\pwsh.exe", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\PowerShell.EXE"])(
    "uses PowerShell flags for %s without rewriting shell source", (shell) => {
      const source = "& 'C:\\with space\\node.exe' '100% & quotes\"'";
      expect(workspaceShellInvocation(shell, source, { platform: "win32", login: true }))
        .toEqual({ command: shell, args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", source] });
    },
  );
  it.each(["cmd", "CMD.EXE", "C:\\Windows\\System32\\cmd.exe"])("uses cmd's raw shell-source contract for %s", (shell) => {
    const source = '"C:\\with space\\node.exe" "100% & quotes\\\""';
    expect(workspaceShellInvocation(shell, source, { platform: "win32" }))
      .toEqual({ command: shell, args: ["/d", "/s", "/c", `"${source}"`], windowsVerbatimArguments: true });
  });
  it.each(["/bin/bash", "C:\\Program Files\\Git\\bin\\bash.exe"])("keeps POSIX flags for explicit shell %s on Windows", (shell) => {
    expect(workspaceShellInvocation(shell, "printf '%s' hi", { platform: "win32", login: true }))
      .toEqual({ command: shell, args: ["-lc", "printf '%s' hi"] });
  });
  it("keeps POSIX shell flags on POSIX", () => {
    expect(workspaceShellInvocation("/bin/sh", "echo hi", { platform: "linux" }))
      .toEqual({ command: "/bin/sh", args: ["-c", "echo hi"] });
  });

  it.each(process.platform === "win32" ? ["powershell", "cmd"] : ["sh"])("starts a real Node child with spaces, metacharacters and quotes through %s", async (kind) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-shell space & %-"));
    try {
      const script = path.join(root, "offline child.cjs");
      const result = path.join(root, "args.json");
      await writeFile(script, 'require("node:fs").writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));');
      const expected = ["with space", "amp&ersand", "100%done", 'double"quote', "single'quote", "trailing\\"];
      const argv = [script, result, ...expected];
      const shell = kind === "sh" ? "/bin/sh" : path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", ...(kind === "cmd" ? ["cmd.exe"] : ["WindowsPowerShell", "v1.0", "powershell.exe"]));
      const source = kind === "cmd"
        ? [process.execPath, ...argv].map(crt).join(" ")
        : kind === "powershell"
          ? `$p = Start-Process -FilePath ${ps(process.execPath)} -ArgumentList @(${argv.map((arg) => ps(crt(arg))).join(",")}) -NoNewWindow -Wait -PassThru; exit $p.ExitCode`
          : `exec ${[process.execPath, ...argv].map((arg) => `'${arg.replaceAll("'", `'"'"'`)}'`).join(" ")}`;
      const invocation = workspaceShellInvocation(shell, source);
      await execute(invocation.command, invocation.args, { windowsVerbatimArguments: invocation.windowsVerbatimArguments, timeout: 10_000, windowsHide: true });
      expect(JSON.parse(await readFile(result, "utf8"))).toEqual(expected);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
