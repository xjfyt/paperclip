import { defineConfig } from "@playwright/test";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

const fixtureHome = process.env.PAPERCLIP_MIMOUSE_TEST_HOME;
if (!fixtureHome || !path.isAbsolute(fixtureHome)) throw new Error("Set an absolute isolated PAPERCLIP_MIMOUSE_TEST_HOME; never use a real instance");
const marker = path.join(fixtureHome, ".mimouse-test-fixture");
if (!existsSync(marker) || readFileSync(marker, "utf8").trim() !== "paperclip-mimouse-disposable-fixture-v1") throw new Error("Explicit disposable fixture marker required before any server startup");
const fixtureConfig = path.join(fixtureHome, "instances/default/config.json");
if (existsSync(fixtureConfig) || existsSync(path.join(fixtureHome, "instances/default/.env"))) throw new Error("Fixture must not contain application config or dotenv files");
// Test workers also import server services; give them the same isolated home
// and disable inherited external credentials/configuration lookup paths.
Object.assign(process.env, {
  PAPERCLIP_HOME: fixtureHome, PAPERCLIP_CONFIG: fixtureConfig, PAPERCLIP_INSTANCE_ID: "default",
  DATABASE_URL: "", DATABASE_MIGRATION_URL: "", PAPERCLIP_DISABLE_CWD_ENV_FILE: "true",
  PAPERCLIP_SECRETS_MASTER_KEY: "", PAPERCLIP_SECRETS_MASTER_KEY_FILE: path.join(fixtureHome, "fixtures/master.key"),
  PAPERCLIP_PRIVATE_PROMPT_TESTS_ENABLED: "false",
  HEARTBEAT_SCHEDULER_ENABLED: "false", PAPERCLIP_CODING_REPAIR_WORKER_ENABLED: "false",
  PAPERCLIP_OIDC_ENABLED: "false", PAPERCLIP_WORKBUDDY_ENABLED: "false", PAPERCLIP_GITLAB_PUBLISH_ENABLED: "false", PAPERCLIP_GITLAB_POLL_ENABLED: "false", PAPERCLIP_CODING_REPAIR_ENABLED: "false",
  PAPERCLIP_NOTIFICATIONS_ENABLED: "true", PAPERCLIP_NOTIFICATIONS_WORKER_ENABLED: "false",
  MIMOUSE_WECOM_WORKER_ENABLED: "false",
  PAPERCLIP_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1",
});
export default defineConfig({
  testDir: ".", testMatch: "*.spec.ts", workers: 1, timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:3100", headless: true,
    launchOptions: process.env.PAPERCLIP_TEST_CHROMIUM ? { executablePath: process.env.PAPERCLIP_TEST_CHROMIUM } : {},
    screenshot: "only-on-failure", trace: "retain-on-failure",
  },
  webServer: {
    stdout: "pipe", stderr: "pipe",
    // The server entry is compiled; workspace package exports still point at TS.
    // A published/staged all-dist package requires a separate release smoke.
    command: process.env.PAPERCLIP_MIMOUSE_TEST_COMPILED === "true" ? "node --import tsx dist/index.js" : "node --import tsx src/index.ts", cwd: path.resolve(import.meta.dirname, "../../server"),
    url: "http://127.0.0.1:3100/api/health", reuseExistingServer: false, timeout: 120000,
    env: { ...process.env, PAPERCLIP_HOME: fixtureHome, PAPERCLIP_CONFIG: fixtureConfig, PAPERCLIP_INSTANCE_ID: "default",
      DATABASE_URL: "", DATABASE_MIGRATION_URL: "", PAPERCLIP_DISABLE_CWD_ENV_FILE: "true",
      PAPERCLIP_OIDC_ENABLED: "false", PAPERCLIP_WORKBUDDY_ENABLED: "false", PAPERCLIP_GITLAB_PUBLISH_ENABLED: "false", PAPERCLIP_GITLAB_POLL_ENABLED: "false", PAPERCLIP_CODING_REPAIR_ENABLED: "false",
      PAPERCLIP_NOTIFICATIONS_ENABLED: "true", PAPERCLIP_NOTIFICATIONS_WORKER_ENABLED: "false",
      PAPERCLIP_OPEN_ON_LISTEN: "false", PAPERCLIP_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1",
      PAPERCLIP_BIND: "loopback", PAPERCLIP_DEPLOYMENT_MODE: "local_trusted", PAPERCLIP_UI_DEV_MIDDLEWARE: "false" },
  },
  outputDir: "../../test-results/mimouse", reporter: [["list"]],
});
