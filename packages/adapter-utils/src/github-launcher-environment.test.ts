import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { mkdtemp, mkdir as nativeMkdir, readFile as nativeReadFile, realpath, rm as nativeRm, writeFile as nativeWriteFile } from "node:fs/promises";
import os from "node:os";
import nativePath from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as ssh from "./ssh.js";
import type { CommandManagedRuntimeRunner } from "./command-managed-runtime.js";
import { githubBrokerEnvironment } from "./github-launcher.js";
import { fixturePath as path, sandboxPath, shellExecutable } from "./test-fixtures/local-sandbox.js";
import { writeCliFixture } from "./test-fixtures/native-cli.js";
import {
  ensureAdapterExecutionTargetCommandResolvable,
  prepareGitHubOperationLaunchers,
  prepareGitHubExecutionEnvironment,
  runAdapterExecutionTargetProcess,
} from "./execution-target.js";

const exec = promisify(execFile);
// Expose the real Git Bash POSIX mount namespace to the simulated provider;
// translate only the test's own filesystem access back to the native host.
const hostPath = (value: string) => process.platform === "win32" && /^\/[a-z]\//i.test(value)
  ? `${value[1]}:${value.slice(2)}` : value;
const remotePathFor = (value: string) => process.platform === "win32"
  ? `/${nativePath.parse(value).root[0]!.toLowerCase()}${sandboxPath(value)}` : value;
const mkdir = (file: string, options?: Parameters<typeof nativeMkdir>[1]) => nativeMkdir(hostPath(file), options);
const readFile = (file: string, encoding: "utf8") => nativeReadFile(hostPath(file), encoding);
const writeFile = (file: string, data: string) => nativeWriteFile(hostPath(file), data);
const rm = (file: string, options?: Parameters<typeof nativeRm>[1]) => nativeRm(hostPath(file), options);
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function sandbox(layout: string) {
  const root = remotePathFor(await mkdtemp(path.join(os.tmpdir(), "paperclip-launcher-env-")));
  roots.push(root);
  const bin = path.join(root, layout);
  await mkdir(bin, { recursive: true });
  for (const cli of ["claude", "codex", "git", "gh"]) {
    await writeCliFixture(hostPath(path.join(bin, cli)), `#!/bin/sh\nprintf '%s\\n' '${cli} started'\n`);
  }
  const nodeDirectory = process.platform === "win32"
    ? `/${nativePath.parse(process.execPath).root[0]!.toLowerCase()}${sandboxPath(path.dirname(process.execPath))}`
    : path.dirname(process.execPath);
  const remotePath = `${bin}:${nodeDirectory}:${process.platform === "win32" ? "/mingw64/bin:" : ""}/usr/local/bin:/usr/bin:/bin`;
  // Execute real shells and staged launchers, with a provider-owned environment.
  // Do not inherit the controller's PATH, HOME, credentials, or shell hooks.
  const execute: CommandManagedRuntimeRunner["execute"] = async (input) => {
    const startedAt = new Date().toISOString();
    try {
      const script = process.platform === "win32" && ["git", "gh"].includes(path.basename(input.command));
      const environment = { HOME: root, PATH: remotePath, ...input.env };
      // This fixture models a POSIX provider. Git Bash converts its POSIX PATH
      // to native PATH only when starting the real Windows Node executable.
      // Keep controller credentials out of the provider-owned environment.
      const execution = exec(script ? shellExecutable("sh") : shellExecutable(input.command), script
        ? ["-c", 'exec node "$@"', "fixture-node", input.command, ...(input.args ?? [])]
        : input.args ?? [], {
        cwd: hostPath(input.cwd ?? root),
        env: process.platform === "win32" ? {
          SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT,
          ...environment,
        } : environment,
        timeout: input.timeoutMs ?? 15_000,
      });
      const inputComplete = new Promise<void>((resolve, reject) => {
        const stdin = execution.child.stdin;
        if (!stdin) return resolve();
        // Hash-skip staging can exit before reading the supplied file body.
        // Its exit result still determines success; other input errors fail.
        stdin.on("error", (error: NodeJS.ErrnoException) => {
          if (error.code === "EPIPE") resolve();
          else reject(error);
        });
        stdin.end(input.stdin ?? "", resolve);
      });
      const [result] = await Promise.all([execution, inputComplete]);
      return { ...result, exitCode: 0, signal: null, timedOut: false, pid: null, startedAt };
    } catch (error) {
      const result = error as Error & { code?: number; killed?: boolean; stdout?: string; stderr?: string };
      return { exitCode: result.code ?? 1, signal: null, timedOut: result.killed ?? false,
        stdout: result.stdout ?? "", stderr: result.stderr ?? "", pid: null, startedAt };
    }
  };
  const runner = { execute: vi.fn(execute) };
  const target = { kind: "remote" as const, transport: "sandbox" as const,
    providerKey: "fixture", remoteCwd: root, runner };
  return { root, bin, remotePath, runner, target };
}

describe("managed GitHub launcher environment", () => {
  it.runIf(process.platform === "win32")("runs native staged launchers with real Git and preserves CLI arguments and exit status", async () => {
    const root = await mkdtemp(nativePath.join(os.tmpdir(), "paperclip-native-github-"));
    roots.push(root);
    const bin = nativePath.join(root, "tools with 'quotes' and spaces");
    await writeCliFixture(nativePath.join(bin, "gh"), '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({args:process.argv.slice(2),token:process.env.GH_TOKEN ?? null})); process.exitCode=Number(process.env.FIXTURE_EXIT ?? 0);');
    const env = await prepareGitHubOperationLaunchers({ runId: `native-${randomUUID()}`, target: null, cwd: root,
      env: { ...githubBrokerEnvironment({}, { url: "", token: "" }), PATH: `${bin}${nativePath.delimiter}${process.env.PATH}` } });
    roots.push(env.PAPERCLIP_GITHUB_LAUNCHER_DIR!);
    expect(env.PATH!.split(nativePath.delimiter)[0]).toBe(env.PAPERCLIP_GITHUB_LAUNCHER_DIR);
    const execute = (program: string, args: string[], extra: Record<string, string> = {}) => runAdapterExecutionTargetProcess("native-launcher", null, program, args,
      { cwd: root, env: { ...env, ...extra }, timeoutSec: 10, graceSec: 1, onLog: async () => {} });
    const git = await execute("git", ["--version"]);
    expect(git.exitCode, git.stderr).toBe(0);
    expect(git.stdout).toMatch(/^git version /);
    const shim = await execute(nativePath.join(env.PAPERCLIP_GITHUB_LAUNCHER_DIR!, "git.cmd"), ["--version"]);
    expect(shim.exitCode, shim.stderr).toBe(0);
    expect(shim.stdout).toMatch(/^git version /);
    const args = ["with spaces", "single'quote", 'double"quote', "", "trailing\\", "a&b", "a|b", "a(b)", "%PATH%", "!delayed!", "a^b", "a>b", "a<b"];
    const gh = await execute("gh", args, { GH_TOKEN: "host-must-not-leak", FIXTURE_EXIT: "23" });
    expect(gh.exitCode, gh.stderr).toBe(23);
    expect(JSON.parse(gh.stdout)).toEqual({ args, token: null });
    await writeFile(nativePath.join(env.PAPERCLIP_GITHUB_LAUNCHER_DIR!, "gh"), "throw new Error('must never execute');");
    await expect(execute("gh", [])).rejects.toThrow("Invalid controller-owned GitHub launcher");
  });

  // The Daytona native directory oracle uses Linux inotify. Run its real
  // filesystem regression on that platform; shell/launcher tests cover both.
  it.runIf(process.platform === "linux")("keeps launcher restaging and command scratch inside the runner runtime", async () => {
    const fixture = await sandbox("usr/bin");
    const privateRoot = path.join(fixture.root, ".paperclip-runtime");
    await mkdir(path.join(privateRoot, "paperclip-runner"), { recursive: true });
    await writeFile(path.join(fixture.root, "user.txt"), "Existing work\n");
    const mutations: string[] = [];
    const watchers = [fixture.root, privateRoot].map((directory) => watch(directory, (_kind, name) => {
      const changed = path.relative(fixture.root, path.join(directory, String(name)));
      if (changed !== ".paperclip-runtime/paperclip-runner") mutations.push(changed);
    }));
    try {
      const input = { runId: "restart-same-launchers", target: fixture.target, cwd: fixture.root,
        env: githubBrokerEnvironment({}, { url: "", token: "" }) };
      const first = await prepareGitHubOperationLaunchers(input);
      const original = await readFile(path.join(first.PAPERCLIP_GITHUB_LAUNCHER_DIR, "git"), "utf8");
      const restored = await prepareGitHubOperationLaunchers(input);
      const command = await fixture.runner.execute({
        command: path.join(restored.PAPERCLIP_GITHUB_LAUNCHER_DIR, "git"), args: ["--version"], env: restored,
      });
      expect(command.exitCode, command.stderr).toBe(0);
      expect(await readFile(path.join(restored.PAPERCLIP_GITHUB_LAUNCHER_DIR, "git"), "utf8")).toBe(original);
      expect(await readFile(path.join(fixture.root, "user.txt"), "utf8")).toBe("Existing work\n");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mutations).toEqual([]);
      // The watcher must still notice housekeeping outside that exact runtime.
      await mkdir(path.join(privateRoot, "outside-runtime-control"));
      await vi.waitFor(() => expect(mutations).toContain(".paperclip-runtime/outside-runtime-control"));
    } finally { for (const watcher of watchers) watcher.close(); }
  });

  it.each(["module", "commonjs"])("runs managed GitHub launchers inside a %s project", async (type) => {
    const fixture = await sandbox("usr/bin");
    const packageJson = JSON.stringify({ type });
    await writeFile(path.join(fixture.root, "package.json"), packageJson);
    // Exercise real Git; gh uses the fixture CLI because it need not be installed.
    await rm(path.join(fixture.bin, "git"));
    if (process.platform === "win32") await rm(path.join(fixture.bin, "git.exe"));
    const env = await prepareGitHubOperationLaunchers({
      runId: "run-package-type", target: fixture.target, cwd: fixture.root,
      env: githubBrokerEnvironment({}, { url: "", token: "" }),
    });
    for (const cli of ["git", "gh"]) {
      const result = await fixture.runner.execute({
        command: path.join(env.PAPERCLIP_GITHUB_LAUNCHER_DIR, cli), args: ["--version"], env,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toMatch(cli === "git" ? /^git version / : /^gh started\n$/);
    }
    expect(await readFile(path.join(fixture.root, "package.json"), "utf8")).toBe(packageJson);
  });

  it("clears empty identity overrides in sandbox shells and preserves a captured identity", async () => {
    const fixture = await sandbox("usr/bin");
    const env = await prepareGitHubOperationLaunchers({
      runId: "run-git-identity", target: fixture.target, cwd: fixture.root,
      env: githubBrokerEnvironment({ GIT_AUTHOR_NAME: "Host Author" }, { url: "", token: "" }),
    });
    const readIdentity = `node -e 'process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([key]) => /^GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)$/.test(key)))))'`;
    const shell = await fixture.runner.execute({ command: "bash", args: ["--noprofile", "--norc", "-c", readIdentity], env });
    expect(shell.exitCode, shell.stderr).toBe(0);
    expect(JSON.parse(shell.stdout)).toEqual({});

    const identity = { GIT_AUTHOR_NAME: "Captured Author", GIT_AUTHOR_EMAIL: "author@example.test",
      GIT_COMMITTER_NAME: "Captured Committer", GIT_COMMITTER_EMAIL: "committer@example.test" };
    for (const profile of [".profile", ".bash_profile", ".bashrc", ".zshenv", ".zprofile", ".zshrc"]) {
      const script = await readFile(path.join(env.PAPERCLIP_GITHUB_LAUNCHER_DIR, profile), "utf8");
      for (const captured of [false, true]) {
        const result = await fixture.runner.execute({ command: "sh", args: ["-c", `${script}\n${readIdentity}`],
          env: { ...env, ...(captured ? identity : {}) } });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(captured ? identity : {});
      }
    }
  });

  it.each([false, true])("probes the remote workspace when the controller cwd is absent (host credentials: %s)", async (hostCredentials) => {
    const fixture = await sandbox("usr/bin");
    const env = await prepareGitHubExecutionEnvironment({
      target: fixture.target,
      cwd: path.join(fixture.root, "controller-only", "agent-workspace"),
      env: {},
      hostCredentials,
      networkAccess: true,
    });

    expect(env.PAPERCLIP_RUNNER_NETWORK_ACCESS).toBe("enabled");
    expect(env.PAPERCLIP_GIT_METADATA_ROOTS).toBe("[]");
    expect(JSON.parse(env.PAPERCLIP_RUNNER_NETWORK_ROOTS!)).not.toHaveLength(0);
    expect(fixture.runner.execute).toHaveBeenCalledWith(expect.objectContaining({ cwd: fixture.root }));
  });

  it("reads Git metadata from the SSH workspace instead of an existing controller directory", async () => {
    const fixture = await sandbox("ssh-toolchain/bin");
    // Use real Git for the probe, not the launcher fixture's stub.
    await rm(path.join(fixture.bin, "git"));
    if (process.platform === "win32") await rm(path.join(fixture.bin, "git.exe"));
    await exec("git", ["init", hostPath(fixture.root)]);
    const controllerCwd = path.join(fixture.root, "controller");
    await mkdir(controllerCwd);
    vi.spyOn(ssh, "createSshCommandManagedRuntimeRunner").mockReturnValue(fixture.runner);
    const target = { kind: "remote" as const, transport: "ssh" as const, remoteCwd: fixture.root,
      spec: { host: "sandbox.example.test", port: 22, username: "runner", remoteCwd: fixture.root,
        remoteWorkspacePath: fixture.root, privateKey: null, knownHosts: null, strictHostKeyChecking: true } };

    const env = await prepareGitHubExecutionEnvironment({
      target, cwd: controllerCwd, env: {}, hostCredentials: false, networkAccess: true,
    });

    const canonical = await fixture.runner.execute({ command: "sh", args: ["-c", "cd .git && pwd -P"] });
    expect(canonical.exitCode, canonical.stderr).toBe(0);
    expect(JSON.parse(env.PAPERCLIP_GIT_METADATA_ROOTS!)).toEqual([canonical.stdout.trim()]);
  });

  it("uses target Git configuration without importing controller credentials", async () => {
    const fixture = await sandbox("usr/bin");
    vi.stubEnv("GH_TOKEN", "controller-secret");
    await mkdir(path.join(fixture.root, ".config/gh"), { recursive: true });
    await writeFile(path.join(fixture.root, ".config/gh/hosts.yml"), "host credential fixture");
    const execute = fixture.runner.execute.getMockImplementation()!;
    fixture.runner.execute.mockImplementation(async (input) => {
      expect(input.command).toBe("sh"); // No Node executable is required on the SSH host.
      const result = await execute(input);
      return { ...result, stdout: `SSH login banner\n${result.stdout}\nlogout` };
    });
    const env = await prepareGitHubExecutionEnvironment({
      target: fixture.target, cwd: fixture.root, env: {
        PAPERCLIP_GIT_METADATA_ROOTS: '["/injected"]',
        PAPERCLIP_RUNNER_NETWORK_ROOTS: '["/injected"]',
        PAPERCLIP_GITHUB_HOST_HOME: "/injected",
        PAPERCLIP_GITHUB_AUTH_MODE: "managed",
        PAPERCLIP_RUNNER_NETWORK_ACCESS: "disabled",
      }, hostCredentials: true, networkAccess: true,
    });
    expect(env.PAPERCLIP_GIT_METADATA_ROOTS).not.toContain("/injected");
    expect(env.PAPERCLIP_RUNNER_NETWORK_ROOTS).not.toContain("/injected");
    expect(env.PAPERCLIP_GITHUB_AUTH_MODE).toBe("host");
    expect(env.PAPERCLIP_RUNNER_NETWORK_ACCESS).toBe("enabled");
    expect(env.PAPERCLIP_GITHUB_HOST_HOME).toBe(fixture.root);
    expect(env.GH_CONFIG_DIR).toBe(path.join(fixture.root, ".config/gh"));
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.PAPERCLIP_GITHUB_LAUNCHER_DIR).toBeUndefined();
  });

  it("preserves local host credential helpers and validates worktree metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-host-git-")); roots.push(root);
    vi.stubEnv("HOME", root);
    vi.stubEnv("GH_TOKEN", "legacy-token");
    await writeFile(path.join(root, ".gitconfig"), '[credential]\n  helper = store\n');
    await exec("git", ["init", path.join(root, "repo")]);
    const env = await prepareGitHubExecutionEnvironment({ target: null, cwd: path.join(root, "repo"), env: {}, hostCredentials: true, networkAccess: true });
    expect(env.GH_TOKEN).toBe("legacy-token");
    expect(env.GIT_CONFIG_GLOBAL).toBeUndefined();
    expect(JSON.parse(env.PAPERCLIP_GIT_METADATA_ROOTS!)).toContain(await realpath(path.join(root, "repo", ".git")));
    const config = await exec("git", ["config", "credential.helper"], { cwd: root, env: { ...process.env, ...env } });
    expect(config.stdout.trim()).toBe("store");
    const isolated = await prepareGitHubExecutionEnvironment({ target: null, cwd: root, env: {}, hostCredentials: false, networkAccess: false });
    expect(isolated.GH_TOKEN).toBeUndefined();
    expect(isolated.PAPERCLIP_RUNNER_NETWORK_ACCESS).toBe("disabled");
    expect(isolated.PAPERCLIP_GITHUB_HOST_HOME).toBeUndefined();
  });

  it.each(["nvm/current/bin", "usr/local/bin", "tools with 'quotes'/bin"])(
    "preserves %s CLIs and keeps GitHub wrappers first in child shells",
    async (layout) => {
      const fixture = await sandbox(layout);
      vi.stubEnv("PATH", "/controller-only/bin");
      const env = await prepareGitHubOperationLaunchers({
        runId: "run-layout", target: fixture.target, cwd: "/controller", env: {},
      });
      expect(env.PATH).toBe(`${env.PAPERCLIP_GITHUB_LAUNCHER_DIR}:${fixture.remotePath}`);
      for (const cli of ["claude", "codex"]) {
        await ensureAdapterExecutionTargetCommandResolvable(cli, fixture.target, fixture.root, env);
        const result = await runAdapterExecutionTargetProcess("run-layout", fixture.target, "bash", [
          "--noprofile", "--norc", "-c", `command -v git; command -v gh; ${cli}`,
        ], { cwd: fixture.root, env, timeoutSec: 5, graceSec: 1, onLog: async () => {} });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout.trim().split("\n")).toEqual([
          `${env.PAPERCLIP_GITHUB_LAUNCHER_DIR}/git`,
          `${env.PAPERCLIP_GITHUB_LAUNCHER_DIR}/gh`,
          `${cli} started`,
        ]);
      }
      for (const profile of [".profile", ".bash_profile", ".bashrc", ".zshenv", ".zprofile", ".zshrc"]) {
        const script = await readFile(path.join(env.PAPERCLIP_GITHUB_LAUNCHER_DIR, profile), "utf8");
        const result = await fixture.runner.execute({ command: "sh", args: ["-c", `${script}\nprintf '%s' "$PATH"`] });
        expect(result.stdout).toBe(env.PATH);
      }
      // The wrappers' Node interpreter and underlying commands are still reachable.
      const github = await fixture.runner.execute({ command: "bash", args: ["-c", "git; gh"], env });
      expect(github.exitCode, github.stderr).toBe(0);
      expect(github.stdout).toBe("git started\ngh started\n");
    },
  );

  it("preserves an explicit remote PATH without querying the remote environment", async () => {
    const fixture = await sandbox("custom/bin");
    const env = await prepareGitHubOperationLaunchers({
      runId: "run-explicit", target: fixture.target, cwd: fixture.root, env: { PATH: fixture.remotePath },
    });
    expect(env.PATH).toBe(`${env.PAPERCLIP_GITHUB_LAUNCHER_DIR}:${fixture.remotePath}`);
    expect(fixture.runner.execute.mock.calls.every(([input]) => !input.args?.join(" ").includes("$PATH"))).toBe(true);
  });

  it("does not copy an inherited controller PATH into a remote launcher", async () => {
    const fixture = await sandbox("nvm/bin");
    vi.stubEnv("PATH", "/controller-only/bin");
    const env = await prepareGitHubOperationLaunchers({
      runId: "run-inherited", target: fixture.target, cwd: fixture.root, env: { PATH: process.env.PATH! },
    });
    expect(env.PATH).toBe(`${env.PAPERCLIP_GITHUB_LAUNCHER_DIR}:${fixture.remotePath}`);
  });

  it("keeps an explicit empty remote PATH empty apart from the managed wrappers", async () => {
    const fixture = await sandbox("nvm/bin");
    const env = await prepareGitHubOperationLaunchers({
      runId: "run-empty", target: fixture.target, cwd: fixture.root, env: { PATH: "" },
    });
    expect(env.PATH).toBe(env.PAPERCLIP_GITHUB_LAUNCHER_DIR);
    expect(fixture.runner.execute.mock.calls.every(([input]) => !input.args?.join(" ").includes("$PATH"))).toBe(true);
    const result = await fixture.runner.execute({ command: "/bin/sh", args: ["-c", "command -v claude"], env });
    expect(result.exitCode).not.toBe(0);
  });

  it("reads the SSH target PATH and ignores login banners", async () => {
    const fixture = await sandbox("ssh-toolchain/bin");
    fixture.runner.execute.mockResolvedValueOnce({ exitCode: 0, timedOut: false, signal: null,
      stdout: `Welcome\n\0${fixture.remotePath}\0\n`, stderr: "", pid: null, startedAt: new Date().toISOString() });
    vi.spyOn(ssh, "createSshCommandManagedRuntimeRunner").mockReturnValue(fixture.runner);
    const target = { kind: "remote" as const, transport: "ssh" as const, remoteCwd: fixture.root,
      spec: { host: "sandbox.example.test", port: 22, username: "runner", remoteCwd: fixture.root,
        remoteWorkspacePath: fixture.root, privateKey: null, knownHosts: null, strictHostKeyChecking: true } };
    const env = await prepareGitHubOperationLaunchers({ runId: "run-ssh", target, cwd: fixture.root, env: {} });
    expect(env.PATH).toBe(`${env.PAPERCLIP_GITHUB_LAUNCHER_DIR}:${fixture.remotePath}`);
    expect(fixture.runner.execute.mock.calls[0]?.[0].env).toBeUndefined();
  });

  it("uses the launch environment for install and re-probe after a missing command", async () => {
    const fixture = await sandbox("custom/bin");
    const env = { PATH: fixture.remotePath, HOME: fixture.root };
    await ensureAdapterExecutionTargetCommandResolvable("fixture-cli", fixture.target, fixture.root, env, {
      installCommand: `cp ${ssh.shellQuote(path.join(fixture.bin, "claude"))} ${ssh.shellQuote(path.join(fixture.bin, "fixture-cli"))}`,
    });
    expect(fixture.runner.execute.mock.calls).toHaveLength(3);
    for (const [input] of fixture.runner.execute.mock.calls) expect(input.env).toEqual(env);
  });

  it("checks command availability with the launch environment, not the provider default", async () => {
    const fixture = await sandbox("nvm/bin");
    const env = { PATH: "/usr/bin:/bin" };
    // The binary exists on the provider PATH, but the requested launch excludes it.
    await expect(ensureAdapterExecutionTargetCommandResolvable(
      "claude", fixture.target, fixture.root, env,
    )).rejects.toThrow('Command "claude" is not installed or not on PATH');
    const result = await runAdapterExecutionTargetProcess("run-missing", fixture.target, "sh", ["-c", "claude"], {
      cwd: fixture.root, env, timeoutSec: 5, graceSec: 1, onLog: async () => {},
    });
    expect(result.exitCode).toBe(127);
  });

  it.each([
    { exitCode: 1, timedOut: false, stdout: "" },
    { exitCode: 0, timedOut: true, stdout: "" },
    { exitCode: 0, timedOut: false, stdout: "login banner only" },
    { exitCode: 0, timedOut: false, stdout: "\0\0" },
  ])("fails before staging when remote PATH discovery fails: %j", async (failure) => {
    const fixture = await sandbox("nvm/bin");
    fixture.runner.execute.mockResolvedValueOnce({ ...failure, signal: null, stderr: "private diagnostic",
      pid: null, startedAt: new Date().toISOString() });
    await expect(prepareGitHubOperationLaunchers({
      runId: "run-failure", target: fixture.target, cwd: fixture.root, env: {},
    })).rejects.toThrow("Could not resolve remote PATH for managed GitHub launchers");
    expect(fixture.runner.execute).toHaveBeenCalledTimes(1);
  });
});
