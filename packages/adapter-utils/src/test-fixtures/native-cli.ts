import { execFileSync } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { shellExecutable } from "./local-sandbox.js";

let bridge: string | undefined;
const bridgeRoots = new Set<string>();
let cleanupRegistered = false;

/** A real PE process for test CLI scripts, never a production launcher shim. */
function nativeBridge(): string {
  // Per-test TMP roots can be removed between cases in the same worker.
  if (bridge && existsSync(bridge)) return bridge;
  const compiler = path.join(process.env.SystemRoot ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  if (!existsSync(compiler)) throw new Error("Windows CLI fixture tests require the .NET Framework C# compiler (csc.exe)");
  const root = mkdtempSync(path.join(os.tmpdir(), "paperclip-native-cli-"));
  const source = path.join(root, "bridge.cs");
  const output = path.join(root, "bridge.exe");
  const literal = (value: string) => `@"${value.replaceAll('"', '""')}"`;
  // Compile only this fixed, local, no-network source. It runs the sibling
  // script using the real interpreter, retaining argv/env/stdout/exit status.
  writeFileSync(source, `using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
class Bridge {
  static string Quote(string value) {
    var result = new StringBuilder("\\\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\\\') { slashes++; continue; }
      if (c == '"') { result.Append('\\\\', slashes * 2 + 1); result.Append(c); slashes = 0; continue; }
      result.Append('\\\\', slashes); slashes = 0; result.Append(c);
    }
    result.Append('\\\\', slashes * 2); return result.Append('"').ToString();
  }
  static int Main(string[] args) {
    string script = Path.ChangeExtension(Assembly.GetExecutingAssembly().Location, null);
    bool shell = File.ReadAllText(script).StartsWith("#!/bin/sh");
    var info = new ProcessStartInfo(shell ? ${literal(shellExecutable("sh"))} : ${literal(process.execPath)});
    info.UseShellExecute = false;
    var command = new StringBuilder(Quote(shell ? script.Replace('\\\\', '/') : script));
    foreach (var arg in args) command.Append(" ").Append(Quote(arg));
    info.Arguments = command.ToString();
    using (var child = Process.Start(info)) { child.WaitForExit(); return child.ExitCode; }
  }
}
`);
  try { execFileSync(compiler, ["/nologo", "/target:exe", `/out:${output}`, source], { stdio: "pipe" }); }
  catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
  bridge = output;
  for (const ownedRoot of bridgeRoots) if (!existsSync(ownedRoot)) bridgeRoots.delete(ownedRoot);
  bridgeRoots.add(root);
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    process.once("exit", () => {
      for (const ownedRoot of bridgeRoots) rmSync(ownedRoot, { recursive: true, force: true });
    });
  }
  return bridge;
}

export async function writeCliFixture(file: string, source: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, source, { mode: 0o700 });
  if (process.platform !== "win32") return;
  await writeFile(path.join(path.dirname(file), "package.json"), '{"type":"commonjs"}\n');
  await copyFile(nativeBridge(), `${file}.exe`);
}
