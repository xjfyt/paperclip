import assert from "node:assert/strict";
import test from "node:test";
import { buildInvocation, checkCleanBuild, isBuildDiagnostic } from "./check-clean-build.mjs";

test("launches JavaScript and standalone package managers without a shell", () => {
  assert.deepEqual(buildInvocation("C:\\tools with spaces\\pnpm.cjs", "win32"), [process.execPath, ["C:\\tools with spaces\\pnpm.cjs", "run", "build"]]);
  assert.deepEqual(buildInvocation("C:\\tools with spaces\\pnpm.exe", "win32"), ["C:\\tools with spaces\\pnpm.exe", ["run", "build"]]);
  assert.deepEqual(buildInvocation("/usr/local/bin/pnpm", "linux"), ["/usr/local/bin/pnpm", ["run", "build"]]);
  assert.throws(() => buildInvocation("pnpm.cmd", "win32"), /not a batch wrapper/);
});

test("recognizes Rust, Vite, CSS and package-manager diagnostics without matching clean summaries", () => {
  for (const line of [
    "runner build: warning: unused import", "error[E0308]: mismatched types", "src/test.ts(1,2): error TS2322: type mismatch",
    "(!) Some chunks are larger than 500 kB", "Found 4 warnings while optimizing generated CSS:",
    "lib generated 18 warnings", "WARN unsupported engine", "Both esbuild and oxc options were set.",
    "\u001b[33mwarning: invalid CSS\u001b[0m",
  ]) assert.equal(isBuildDiagnostic(line), true, line);
  for (const line of ["0 warnings", "warnings: 0", "built in 10s", "dist/error-boundary.js 2.4kB", "const warning = false;"]) {
    assert.equal(isBuildDiagnostic(line), false, line);
  }
});

async function run(source) {
  let output = "";
  const sink = { write(chunk) { output += chunk; } };
  const result = await checkCleanBuild(process.execPath, ["-e", source], { stdout: sink, stderr: sink });
  return { ...result, output };
}

test("accepts a successful clean subprocess and preserves output", async () => {
  const result = await run('console.log("built successfully");');
  assert.equal(result.code, 0);
  assert.equal(result.diagnostics, 0);
  assert.match(result.output, /built successfully/);
});

test("fails an exit-zero build with a warning split across chunks and no final newline", async () => {
  const result = await run('process.stderr.write("war"); setTimeout(() => process.stderr.write("ning: unresolved problem"), 20);');
  assert.equal(result.code, 1);
  assert.equal(result.diagnostics, 1);
  assert.match(result.output, /warning: unresolved problem/);
});

test("preserves failing build status even without diagnostics", async () => {
  const result = await run("process.exit(7);");
  assert.equal(result.code, 7);
  assert.equal(result.diagnostics, 0);
});

test("reports startup failure instead of false success", async () => {
  const sink = { write() {} };
  const result = await checkCleanBuild("paperclip-nonexistent-build-command", [], { stdout: sink, stderr: sink });
  assert.equal(result.code, 1);
  assert.equal(result.error, "ENOENT");
});
