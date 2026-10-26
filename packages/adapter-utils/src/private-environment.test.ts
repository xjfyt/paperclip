import { afterEach, expect, it, vi } from "vitest";
import { runChildProcess } from "./server-utils.js";
afterEach(() => vi.unstubAllEnvs());
it("provided-only child receives exact stdin and no inherited credentials", async () => {
  vi.stubEnv("PAPERCLIP_API_KEY", "must-not-inherit");
  vi.stubEnv("GITHUB_TOKEN", "must-not-inherit");
  vi.stubEnv("ANTHROPIC_API_KEY", "must-not-inherit");
  const literal = "  中文🧪\r\n{{exact}}  \n";
  const spawned = vi.fn(async () => {});
  // This fixture is Node only: no real CLI, credentials, networking, or shell.
  const result = await runChildProcess("private-env-fixture", process.execPath, ["-e", `
    let body = ''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => body += chunk);
    process.stdin.on('end', () => process.stdout.write(JSON.stringify({ body,
      paperclip: process.env.PAPERCLIP_API_KEY ?? null,
      github: process.env.GITHUB_TOKEN ?? null,
      provider: process.env.ANTHROPIC_API_KEY ?? null })));
  `], { cwd: "/tmp", env: {}, inheritEnv: false, stdin: literal,
    timeoutSec: 10, graceSec: 1, onLog: async () => {}, onSpawn: spawned });
  expect(result.exitCode).toBe(0);
  expect(spawned).toHaveBeenCalledTimes(1);
  expect(JSON.parse(result.stdout)).toEqual({ body: literal, paperclip: null, github: null, provider: null });
});
