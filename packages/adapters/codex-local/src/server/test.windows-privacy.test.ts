import { existsSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasPrivatePermissions } from "@paperclipai/shared/private-filesystem-permissions";
import { installIsolatedHostFixture } from "@paperclipai/adapter-utils/test-fixtures/isolated-host";
import { writeCliFixture } from "@paperclipai/adapter-utils/test-fixtures/native-cli";

const observation = vi.hoisted(() => ({
  writes: [] as string[], roots: [] as string[], failProtection: false, remoteExecutions: 0,
}));
const isProbe = (file: string) => path.basename(file).startsWith("paperclip-codex-probe-");
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  const beforeWrite = async (file: string) => {
    if (!isProbe(path.dirname(file))) return;
    const directory = path.dirname(file);
    expect(hasPrivatePermissions(directory, (await actual.stat(directory)).mode)).toBe(true);
    const entry = await actual.lstat(file).catch(() => null);
    if (entry) {
      expect(entry.size).toBe(0);
      expect(hasPrivatePermissions(file, entry.mode)).toBe(true);
    }
    observation.writes.push(file);
  };
  const writeFile: typeof actual.writeFile = async (...args) => {
    await beforeWrite(String(args[0]));
    return actual.writeFile(...args);
  };
  const open: typeof actual.open = async (...args) => {
    const handle = await actual.open(...args);
    if (isProbe(path.dirname(String(args[0])))) {
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async (...writeArgs) => { await beforeWrite(String(args[0])); return write(...writeArgs); };
    }
    return handle;
  };
  return { ...actual, default: { ...actual, writeFile, open }, writeFile, open };
});
vi.mock("@paperclipai/shared/private-filesystem-permissions", async (original) => {
  const actual = await original<typeof import("@paperclipai/shared/private-filesystem-permissions")>();
  return { ...actual, protectNewPrivatePath: (directory: string) => {
    if (isProbe(directory)) {
      expect(readdirSync(directory)).toEqual([]);
      observation.roots.push(directory);
      if (observation.failProtection) throw new Error("fixture private probe storage unavailable");
    }
    actual.protectNewPrivatePath(directory);
  } };
});
vi.mock("@paperclipai/adapter-utils/execution-target", async (original) => {
  const actual = await original<typeof import("@paperclipai/adapter-utils/execution-target")>();
  return { ...actual,
    ensureAdapterExecutionTargetDirectory: async () => {},
    ensureAdapterExecutionTargetCommandResolvable: async () => {},
    maybeRunSandboxInstallCommand: async () => null,
    prepareAdapterExecutionTargetRuntime: async () => ({
      target: null, workspaceRemoteDir: "/remote/workspace", runtimeRootDir: "/remote/runtime",
      assetDirs: { home: "/remote/home" }, restoreWorkspace: async () => {},
    }),
    runAdapterExecutionTargetProcess: async (...args: Parameters<typeof actual.runAdapterExecutionTargetProcess>) => {
      if (args[1]?.kind !== "remote") return actual.runAdapterExecutionTargetProcess(...args);
      observation.remoteExecutions++;
      return { exitCode: 0, signal: null, timedOut: false, stdout: '{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}\n', stderr: "", pid: null, startedAt: new Date().toISOString() };
    },
  };
});
import { testEnvironment } from "./test.js";

installIsolatedHostFixture();
beforeEach(() => {
  observation.writes = []; observation.roots = []; observation.failProtection = false; observation.remoteExecutions = 0;
  vi.stubEnv("OPENAI_API_KEY", undefined);
});
describe.skipIf(process.platform !== "win32")("Windows private Codex probe storage", () => {
  for (const remote of [false, true]) {
    for (const failProtection of [false, true]) {
      it(`${remote ? "remote upload" : "local executable"} ${failProtection ? "refuses unavailable protection before writing or execution" : "protects real storage before its first credential write"}`, async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-privacy-fixture-"));
        const marker = path.join(root, "ran.json");
        const command = path.join(root, "codex");
        await writeCliFixture(command, `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('codex-cli 0.120.0'); process.exit(0); }
const auth = JSON.parse(fs.readFileSync(require('node:path').join(process.env.CODEX_HOME, 'auth.json'), 'utf8'));
fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ home: process.env.CODEX_HOME, correct: auth.OPENAI_API_KEY === 'fixture-probe-secret' }));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'hello'}}));
`);
        const home = path.join(root, "external-home");
        if (remote) {
          await fs.mkdir(home);
          await fs.writeFile(path.join(home, "auth.json"), '{"tokens":{"access_token":"fixture-remote-token"}}');
          await fs.writeFile(path.join(home, "config.toml"), 'model = "fixture"\n');
        }
        observation.failProtection = failProtection;
        const probe = testEnvironment({ companyId: "company", adapterType: "codex_local",
          config: { engine: "cli", command: `${command}.exe`, cwd: root,
            env: remote ? { CODEX_HOME: home } : { OPENAI_API_KEY: "fixture-probe-secret" } },
          ...(remote ? { executionTarget: { kind: "remote" as const, transport: "sandbox" as const, remoteCwd: "/remote/workspace", runner: { execute: async () => { throw new Error("unexpected transport"); } } } } : {}),
        });
        if (failProtection) {
          await expect(probe).rejects.toThrow("fixture private probe storage unavailable");
          expect(observation.writes).toEqual([]);
          expect(existsSync(marker)).toBe(false);
          expect(observation.remoteExecutions).toBe(0);
        } else {
          const result = await probe;
          expect(result.checks).toContainEqual(expect.objectContaining({ code: "codex_hello_probe_passed" }));
          expect(observation.writes.length).toBe(remote ? 2 : 1);
          if (remote) expect(observation.remoteExecutions).toBe(1);
          else expect(JSON.parse(await fs.readFile(marker, "utf8"))).toMatchObject({ correct: true });
          expect(JSON.stringify(result)).not.toContain("fixture-probe-secret");
          expect(JSON.stringify(result)).not.toContain("fixture-remote-token");
        }
        expect(observation.roots).toHaveLength(1);
        for (const directory of observation.roots) expect(existsSync(directory)).toBe(false);
      });
    }
  }
});
