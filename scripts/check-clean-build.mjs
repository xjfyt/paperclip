import { spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { pathToFileURL } from "node:url";

export function buildInvocation(packageManager, platform = process.platform) {
  // npm_execpath can be pnpm.cjs OR the standalone pnpm.exe distribution.
  // Keep JS entrypoints on Node and native binaries executable; never feed a
  // PE binary to Node or introduce a shell with command-string interpolation.
  if (/\.[cm]?js$/i.test(packageManager)) return [process.execPath, [packageManager, "run", "build"]];
  if (platform === "win32" && /\.(cmd|bat)$/i.test(packageManager)) {
    throw new Error("The build gate requires pnpm's JavaScript entrypoint or standalone executable, not a batch wrapper.");
  }
  return [packageManager, ["run", "build"]];
}

// Match emitted compiler/tool diagnostics, not source snippets or a successful
// summary such as "0 warnings". Never change compiler warning thresholds.
export function isBuildDiagnostic(line) {
  const text = stripVTControlCharacters(line);
  return /\b(?:warning|error)(?:\[[^\]]+\]|\s+[A-Z]+\d+)?:\s|\(!\)|\b(?:Found|generated)\s+[1-9]\d*\s+warnings?\b|Both esbuild and oxc options were set/i.test(text)
    || /\bWARN(?:ING)?\b/.test(text);
}

export async function checkCleanBuild(command, args, { cwd, env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  let diagnostics = 0;
  const child = spawn(command, args, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  for (const [stream, output] of [[child.stdout, stdout], [child.stderr, stderr]]) {
    let pending = "";
    stream.setEncoding("utf8");
    stream.on("data", chunk => {
      output.write(chunk);
      const lines = (pending + chunk).split(/\r?\n/);
      pending = lines.pop();
      diagnostics += lines.filter(isBuildDiagnostic).length;
    });
    stream.on("end", () => { if (pending && isBuildDiagnostic(pending)) diagnostics++; });
  }
  const result = await new Promise(resolve => {
    child.once("error", error => resolve({ code: 1, error: error.code ?? "spawn_failed" }));
    child.once("close", (code, signal) => resolve({ code: code ?? 1, signal }));
  });
  return { ...result, diagnostics, code: result.code || (diagnostics > 0 ? 1 : 0) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const packageManager = process.env.npm_execpath;
  if (!packageManager) {
    console.error("Run this gate with pnpm check:build-clean.");
    process.exitCode = 1;
  } else {
    const [command, args] = buildInvocation(packageManager);
    const result = await checkCleanBuild(command, args);
    if (result.error) console.error(`Build process failed to start: ${result.error}`);
    console.log(`Build gate: ${result.code === 0 ? "PASS" : "FAIL"}; ${result.diagnostics} diagnostic lines.`);
    process.exitCode = result.code;
  }
}
