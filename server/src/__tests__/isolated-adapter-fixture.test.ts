import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const vitestRoot = path.dirname(require.resolve("vitest/package.json"));
const fixtureModule = fileURLToPath(new URL("../../../packages/adapter-utils/src/test-fixtures/isolated-host.ts", import.meta.url));
const execute = promisify(execFile);

it.each(["success", "failure"] as const)("keeps adapter isolation until actual cleanup settles: %s", async (mode) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-isolation-lifecycle-"));
  try {
    const temporary = path.join(root, "temporary");
    const sentinel = path.join(root, "original-home");
    await mkdir(temporary);
    await mkdir(sentinel);
    const report = path.join(root, "report.json");
    const q = JSON.stringify;
    await writeFile(path.join(root, "fixture.test.ts"), `
import { it, afterAll, expect } from ${q(pathToFileURL(path.join(vitestRoot, "dist/index.js")).href)};
import fs from 'node:fs/promises';
import path from 'node:path';
import { installIsolatedHostFixture } from ${q(pathToFileURL(fixtureModule).href)};
let home = '', secondBody = false, observedPrivate = false;
installIsolatedHostFixture({ beforeCleanup: async () => {
  expect(process.env.HOME).toBe(home);
  expect(await fs.readFile(path.join(home, 'proof.txt'), 'utf8')).toBe('owned proof');
  observedPrivate = true;
  ${mode === "failure" ? "throw new Error('intentional cleanup failure');" : ""}
}, cleanupTimeoutMs: 5000 });
it('owns its actual temporary home', async () => {
  home = process.env.HOME!;
  await fs.writeFile(path.join(home, 'proof.txt'), 'owned proof');
});
${mode === "failure" ? "it('must not enter after unsafe cleanup', () => { secondBody = true; });" : ""}
afterAll(async () => {
  const retained = await fs.access(home).then(() => true, () => false);
  await fs.writeFile(${q(report)}, JSON.stringify({ home, retained, secondBody, observedPrivate, finalHome: process.env.HOME }));
});
`);
    const config = path.join(root, "vitest.config.mjs");
    await writeFile(config, `export default { root: ${q(root)}, test: { include: ['fixture.test.ts'], maxWorkers: 1, sequence: { hooks: 'list' } } };`);
    let exitCode = 0;
    try {
      await execute(process.execPath, [path.join(vitestRoot, "vitest.mjs"), "run", "--config", config], {
        env: { ...process.env, HOME: sentinel, USERPROFILE: sentinel, TMPDIR: temporary, TMP: temporary, TEMP: temporary },
        timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      if (mode !== "failure" || (error as { code?: unknown }).code !== 1) throw error;
      exitCode = 1;
    }
    const result = JSON.parse(await readFile(report, "utf8"));
    expect(result.observedPrivate).toBe(true);
    expect(result.secondBody).toBe(false);
    expect(result.retained).toBe(mode === "failure");
    expect(exitCode).toBe(mode === "failure" ? 1 : 0);
    expect(result.finalHome).toBe(mode === "failure" ? result.home : sentinel);
    const relative = path.relative(temporary, result.home);
    expect(relative.startsWith("..")).toBe(false);
    expect(path.isAbsolute(relative)).toBe(false);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}, 45_000);
