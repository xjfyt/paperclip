import { once } from "node:events";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeCliFixture } from "./test-fixtures/native-cli.js";
import { cleanupLocalSandboxProcesses, fixturePath, runLocalSandboxProcess, sandboxPath,
  shellArgs, shellEnvironment, shellExecutable, shellScript, spawnLocalSandbox } from "./test-fixtures/local-sandbox.js";

const roots: string[] = [];
async function root() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paperclip-local-sandbox-"));
  roots.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local POSIX sandbox fixture", () => {
  it.each(["-c", "-lc"])("preserves shell argv and independent stdin for quote-heavy %s source", async (flag) => {
    const directory = await root();
    const positional = ["fixture-$0", "two words", "single'quote", 'double"quote', "中文"];
    const input = "独立 stdin ".repeat(3_000);
    const quoted = 'single\' double" slash\\ '.repeat(100);
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    const js = `const fs=require('node:fs');const crypto=require('node:crypto');const value=${JSON.stringify(quoted)};process.stdout.write(JSON.stringify({argv:process.argv.slice(1),input:crypto.createHash('sha256').update(fs.readFileSync(0)).digest('hex'),quoted:crypto.createHash('sha256').update(value).digest('hex')}));`;
    const literal = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
    const script = `# ${quoted.repeat(30)}\n${literal(process.execPath.replaceAll("\\", "/"))} --input-type=commonjs -e ${literal(js)} -- "$0" "$@"`;
    const result = await runLocalSandboxProcess("shell-positional-fixture", shellExecutable("sh"), shellArgs([flag, script, ...positional]),
      { cwd: directory, env: shellEnvironment(), stdin: input, timeoutSec: 15, graceSec: 1, onLog: async () => {} });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ argv: positional, input: hash(input), quoted: hash(quoted) });
  });
  it("recreates a real CLI bridge after its previous isolated TMP was removed", async () => {
    const first = await root();
    const second = await root();
    const source = '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));';
    const args = ["two words", 'a"b', "one&two", "100%done"];
    try {
      for (const directory of [first, second]) {
        for (const key of ["TMPDIR", "TMP", "TEMP"]) vi.stubEnv(key, directory);
        const file = path.join(directory, "offline-cli");
        await writeCliFixture(file, source);
        const result = await runLocalSandboxProcess("native-cli-cache-fixture", process.platform === "win32" ? `${file}.exe` : file, args,
          { cwd: directory, env: {}, timeoutSec: 10, graceSec: 1, onLog: async () => {} });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(args);
        if (directory === first) await rm(first, { recursive: true, force: true });
      }
    } finally { vi.unstubAllEnvs(); }
  });
  it("maps an explicit remote PATH once without corrupting native or already mapped paths", () => {
    const native = path.join(os.tmpdir(), "paperclip-fixture-bin");
    const remote = sandboxPath(native);
    const mapped = shellScript(remote);
    expect(shellScript(mapped)).toBe(mapped);
    expect(shellScript(native.replaceAll("\\", "/"))).toBe(native.replaceAll("\\", "/"));
    const env = shellEnvironment({ PATH: remote });
    expect(env.PATH).toContain(mapped);
    if (process.platform === "win32") {
      expect(sandboxPath(native.replaceAll("\\", "/"))).toBe(remote);
      const otherDrive = path.parse(native).root[0]!.toLowerCase() === "z" ? "y" : "z";
      expect(() => sandboxPath(`${otherDrive}:/outside`)).toThrow("current drive");
      expect(mapped).toBe(`/${path.parse(native).root[0]!.toLowerCase()}${remote}`);
      expect(Object.keys(env).filter((key) => key.toLowerCase() === "path")).toEqual(["PATH"]);
      expect(shellScript(`/usr/bin:${remote}`)).toBe(`/usr/bin:${mapped}`);
    }
  });
  it("addresses the same real files through its POSIX remote namespace", async () => {
    const directory = await root();
    const remote = sandboxPath(directory);
    await mkdir(fixturePath.join(remote, "nested"));
    await writeFile(fixturePath.join(remote, "nested", "proof.txt"), "exact bytes\n");
    expect(await readFile(path.join(directory, "nested", "proof.txt"), "utf8")).toBe("exact bytes\n");
    expect(fixturePath.join(remote, "nested", "proof.txt")).not.toContain("\\");
  });

  it("executes a script beyond CreateProcess's argument limit with independent exact stdin", async () => {
    const directory = await root();
    const body = "字节与换行\n".repeat(10_000);
    const script = `# ${"padding".repeat(6_000)}\nprintf 'ready\\n'\ncat`;
    const result = await runLocalSandboxProcess("large-local-script", shellExecutable("sh"), shellArgs(["-c", script]), {
      cwd: directory, env: shellEnvironment(), stdin: body,
      timeoutSec: 10, graceSec: 1, onLog: async () => {},
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe(`ready\n${body}`);
  });

  it("runs an emitted Node entrypoint without depending on Windows shebang handling", async () => {
    const directory = await root();
    const script = path.join(directory, "proxy.mjs");
    await writeFile(script, '#!/usr/bin/env node\nprocess.stdout.write("proxy-ready");\n');
    if (process.platform !== "win32") await import("node:fs/promises").then((fs) => fs.chmod(script, 0o700));
    const child = spawnLocalSandbox(script, [], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout!.on("data", (bytes) => { output += bytes.toString(); });
    const [code] = await once(child, "close");
    expect(code).toBe(0);
    expect(output).toBe("proxy-ready");
  });

  it("cleans only the owned Windows daemon through a verified handle", async () => {
    const owned = await root();
    const unrelated = await root();
    const children = [];
    try {
      for (const directory of [owned, unrelated]) {
        const script = path.join(directory, "paperclip-process-session-remote.mjs");
        await writeFile(script, 'process.stdout.write("ready");setInterval(() => {}, 1000);');
        const child = spawn(process.execPath, [script], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
        children.push(child);
        await once(child.stdout!, "data");
      }
      const ownedClosed = once(children[0]!, "close");
      await cleanupLocalSandboxProcesses([owned, await root()]);
      if (process.platform === "win32") await ownedClosed;
      else expect(children[0]!.exitCode).toBeNull();
      expect(children[1]!.exitCode).toBeNull();
    } finally {
      await Promise.all(children.map(async (child) => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const closed = once(child, "close");
        child.kill("SIGKILL");
        await closed;
      }));
    }
  });
});
