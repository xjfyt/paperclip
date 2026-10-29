import { afterEach, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, access } from "node:fs/promises";
import type { CommandManagedRuntimeRunner } from "@paperclipai/adapter-utils/command-managed-runtime";
import { tmpdir } from "node:os";
import nativePath from "node:path";
import { fixturePath as path, sandboxPath, shellExecutable, runLocalSandboxProcess, cleanupLocalSandboxProcesses } from "@paperclipai/adapter-utils/test-fixtures/local-sandbox";
import { writeCliFixture } from "@paperclipai/adapter-utils/test-fixtures/native-cli";
import { createInterface } from "node:readline";
import { createNativeGitHubAccess, type NativeGitHubAccess } from "./native-github-access.js";
const scope = { companyId: "company-a", agentId: "agent-a", issueId: "task-a" };
const run = (runId: string) => ({ ...scope, runId });
const cleanups: (() => Promise<unknown>)[] = [];
const remotePath = (file: string) => process.platform === "win32" ? `/${nativePath.parse(file).root[0]!.toLowerCase()}${sandboxPath(file)}` : file;
const hostPath = (file: string) => process.platform === "win32" && /^\/[a-z]\//i.test(file) ? `${file[1]}:${file.slice(2)}` : file;
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function broker(resolveCredentials = vi.fn(async (binding: ReturnType<typeof run>) => ({
  status: "available", env: { GH_TOKEN: `fixture-${binding.runId}` },
})), remote = false, bridgeUnavailable = false, onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "paperclip-native-github-reuse-"));
  cleanups.push(async () => { await cleanupLocalSandboxProcesses([root]); await rm(root, { recursive: true, force: true }); });
  const bin = path.join(root, "real-bin");
  await mkdir(bin);
  await writeCliFixture(path.join(bin, "gh"), `#!${process.execPath}\nprocess.stdout.write(process.env.GH_TOKEN || 'anonymous');`);
  const remoteRoot = remotePath(root);
  const remoteEnv = { HOME: remoteRoot, PATH: `${remotePath(bin)}:${remotePath(nativePath.dirname(process.execPath))}:${process.platform === "win32" ? "/mingw64/bin:" : ""}/usr/bin:/bin` };
  const execute: CommandManagedRuntimeRunner["execute"] = async (input) => {
    const launcher = process.platform === "win32" && ["git", "gh"].includes(path.basename(input.command));
    return runLocalSandboxProcess("native-github-provider-fixture", launcher ? shellExecutable("sh") : shellExecutable(input.command),
      launcher ? ["-c", 'exec node "$@"', "fixture-node", input.command, ...(input.args ?? [])] : input.args ?? [], {
        cwd: hostPath(input.cwd ?? remoteRoot), env: {
          ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", PATHEXT: process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD" } : {}),
          ...remoteEnv, ...input.env,
        }, inheritEnv: false, stdin: input.stdin, timeoutSec: 15, graceSec: 1, onLog: async () => {},
      });
  };
  const target = remote ? { kind: "remote" as const, transport: "sandbox" as const, providerKey: "test",
    remoteCwd: remoteRoot, runner: { execute }, streamRunLogs: false } : null;
  const result = await createNativeGitHubAccess({ scope, target, cwd: remote ? remoteRoot : root,
    env: { PATH: remote ? remoteEnv.PATH : `${bin}${nativePath.delimiter}${process.env.PATH ?? ""}`, PAPERCLIP_API_KEY: "old-run-api-key" }, resolveCredentials, onLog },
    bridgeUnavailable ? async () => { throw new Error("fixture bridge unavailable"); } : undefined);
  cleanups.push(result.stop);
  return { ...result, root, resolveCredentials, execute };
}
function request(broker: NativeGitHubAccess, extra: RequestInit = {}, endpoint = "/runtime-tools/github/credentials") {
  return fetch(broker.env.PAPERCLIP_GITHUB_BROKER_URL + endpoint, {
    method: "POST", body: "{}", headers: { authorization: `Bearer ${broker.env.PAPERCLIP_GITHUB_BRIDGE_TOKEN}`, "content-type": "application/json" }, ...extra,
  });
}
it.each([false, true])("keeps one live parent and its original launcher environment across two authorized runs (callback bridge: %s)", async (remote) => {
  const b = await broker(undefined, remote);
  const parent = spawn(process.execPath, ["-e", `
    const {execFile}=require('node:child_process');
    require('node:readline').createInterface({input:process.stdin}).on('line', () => {
      const launcher = ${JSON.stringify(process.platform === "win32")};
      const remote = ${JSON.stringify(remote)};
      const command = launcher ? (remote ? ${JSON.stringify(shellExecutable("sh"))} : process.execPath) : 'gh';
      const args = launcher ? (remote ? ['-c', 'exec node "$@"', 'fixture-node', process.env.PAPERCLIP_GITHUB_LAUNCHER_DIR + '/gh'] : [process.env.PAPERCLIP_GITHUB_LAUNCHER_DIR + '/gh']) : [];
      execFile(command, args, (error, stdout, stderr) => console.log(JSON.stringify({pid:process.pid, value:stdout, error:error?.message, stderr})));
    });
  `], { env: { ...process.env, ...b.env, PAPERCLIP_API_KEY: "stale-api-key" }, stdio: ["pipe", "pipe", "pipe"] });
  cleanups.push(async () => {
    if (parent.exitCode !== null || parent.signalCode !== null) return;
    const exited = new Promise<void>(resolve => parent.once("exit", () => resolve()));
    parent.kill(); await exited;
  });
  const lines = createInterface({ input: parent.stdout });
  const operation = () => new Promise<{ pid: number; value: string; stderr: string }>(resolve => {
    lines.once("line", line => resolve(JSON.parse(line))); parent.stdin.write("run\n");
  });
  expect((await request(b)).status).toBe(403);
  const releaseA = b.activate(run("run-a"));
  const a = await operation();
  expect(a.value).toBe("fixture-run-a");
  releaseA();
  expect((await operation()).value).toBe("anonymous");
  const releaseB = b.activate(run("run-b"));
  releaseA(); // A's delayed cleanup cannot revoke B.
  const second = await operation();
  expect(second.value).toBe("fixture-run-b");
  expect(second.pid).toBe(a.pid);
  expect(b.resolveCredentials.mock.calls.map(([binding]) => binding.runId)).toEqual(["run-a", "run-b"]);
  expect(await readFile(hostPath(path.join(b.env.PAPERCLIP_GITHUB_LAUNCHER_DIR, "gh")), "utf8")).not.toContain(b.env.PAPERCLIP_GITHUB_BROKER_TOKEN);
  releaseB(); await b.stop();
  await expect(access(hostPath(b.env.PAPERCLIP_GITHUB_LAUNCHER_DIR))).rejects.toThrow();
}, 45_000);
it("rejects other scopes, concurrent bindings, browser requests and forged authority", async () => {
  const b = await broker();
  for (const field of ["companyId", "agentId", "issueId"] as const) {
    expect(() => b.activate({ ...run("a"), [field]: "other" })).toThrow("scope mismatch");
  }
  const release = b.activate(run("a"));
  expect(() => b.activate(run("b"))).toThrow("busy");
  const rejectedHeaders: Record<string, string>[] = [{ authorization: "Bearer wrong" }, { authorization: "é".repeat(71) },
    { authorization: `Bearer ${b.env.PAPERCLIP_GITHUB_BRIDGE_TOKEN}`, origin: "https://browser.test" }];
  for (const headers of rejectedHeaders) {
    expect((await request(b, { headers })).status).toBe(403);
  }
  expect((await request(b, {}, "/api/companies")).status).toBe(404);
  expect((await request(b, { method: "GET", body: undefined })).status).toBe(404);
  const response = await request(b, { body: JSON.stringify({ runId: "b", responsibleUserId: "other" }) });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(b.resolveCredentials).toHaveBeenCalledExactlyOnceWith(run("a"));
  release(); await b.stop();
  expect(() => b.activate(run("b"))).toThrow("closed");
});
it("does not release an in-flight credential after its run has been replaced", async () => {
  let complete!: (value: { status: string; env: { GH_TOKEN: string } }) => void;
  const resolver = vi.fn(() => new Promise<{ status: string; env: { GH_TOKEN: string } }>(resolve => { complete = resolve; }));
  const b = await broker(resolver);
  const release = b.activate(run("a"));
  const pending = request(b);
  await vi.waitFor(() => expect(resolver).toHaveBeenCalledOnce());
  release(); b.activate(run("b"));
  complete({ status: "available", env: { GH_TOKEN: "must-not-escape" } });
  const response = await pending;
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain("must-not-escape");
});
it.each([403, 409, 500])("preserves denial/steering without leaking errors (%s)", async (status) => {
  const b = await broker(vi.fn(async () => { throw Object.assign(new Error("secret-value"), { status }); }));
  b.activate(run("a"));
  const response = await request(b);
  expect(response.status).toBe(status === 500 ? 503 : status);
  expect(await response.text()).not.toContain("secret-value");
});

it.each([false, true])("keeps anonymous launchers usable when the remote broker cannot start (logging fails: %s)", async (loggingFails) => {
  const onLog = vi.fn(async () => { if (loggingFails) throw new Error("fixture log sink unavailable"); });
  const b = await broker(undefined, true, true, onLog);
  expect(onLog).toHaveBeenCalledWith("stderr", expect.stringContaining("continuing without managed GitHub access"));
  b.activate(run("a"));
  expect(b.ready).toBe(false);
  expect(b.env.PAPERCLIP_GITHUB_BROKER_TOKEN).toBe("");
  const result = await b.execute({ command: path.join(b.env.PAPERCLIP_GITHUB_LAUNCHER_DIR, "gh"), args: [],
    env: { ...b.env, GH_TOKEN: "ambient-must-not-leak" } });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toBe("anonymous");
  expect(b.resolveCredentials).not.toHaveBeenCalled();
});
