import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
  it("maps an explicit remote PATH once without corrupting native or already mapped paths", () => {
    const native = path.join(os.tmpdir(), "paperclip-fixture-bin");
    const remote = sandboxPath(native);
    const mapped = shellScript(remote);
    expect(shellScript(mapped)).toBe(mapped);
    expect(shellScript(native.replaceAll("\\", "/"))).toBe(native.replaceAll("\\", "/"));
    const env = shellEnvironment({ PATH: remote });
    expect(env.PATH).toContain(mapped);
    if (process.platform === "win32") {
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
