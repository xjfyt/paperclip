import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const stamp = path.join(root, "server/dist/build-info.json");
if (!existsSync(stamp) || !existsSync(path.join(root, "server/dist/index.js"))) throw new Error("Build the server successfully before running compiled recovery tests");
if (!existsSync(path.join(root, "ui/dist/index.html"))) throw new Error("Build the UI before running compiled recovery tests");
const { commit } = JSON.parse(readFileSync(stamp, "utf8"));
if (typeof commit !== "string" || !/^[a-f0-9]{40}$/.test(commit)) throw new Error("Valid server build stamp required");
// A test/doc-only commit may follow the build; changed runtime sources may not.
execFileSync("git", ["diff", "--quiet", commit, "--", "server", "packages", "cli", "external-adapters"], { cwd: root });
const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve("@playwright/test/cli"), "test", "--config", "tests/mimouse/playwright.config.ts", "recovery-closure.spec.ts", ...process.argv.slice(2)], {
  cwd: root, stdio: "inherit", env: { ...process.env,
    PAPERCLIP_MIMOUSE_TEST_AUTHENTICATED: "true", PAPERCLIP_MIMOUSE_TEST_COMPILED: "true",
    PAPERCLIP_TEST_POSTGRES_TCP_ONLY: "1",
    // Dedicated disposable-fixture values; never inherit a production auth key.
    BETTER_AUTH_SECRET: "mimouse-disposable-auth-fixture-secret-never-for-production",
    PAPERCLIP_AUTH_PUBLIC_BASE_URL: "http://127.0.0.1:3100",
    PAPERCLIP_AUTH_BASE_URL_MODE: "explicit", PAPERCLIP_AUTH_DISABLE_SIGN_UP: "false",
  },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
