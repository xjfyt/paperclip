import { defineConfig } from "@playwright/test";
import path from "node:path";

if (!process.env.PAPERCLIP_MIMOUSE_TEST_HOME) throw new Error("Set an isolated PAPERCLIP_MIMOUSE_TEST_HOME; never use a real instance");
export default defineConfig({
  testDir: ".", testMatch: "*.spec.ts", workers: 1, timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:3100", headless: true,
    launchOptions: process.env.PAPERCLIP_TEST_CHROMIUM ? { executablePath: process.env.PAPERCLIP_TEST_CHROMIUM } : {},
    screenshot: "only-on-failure", trace: "retain-on-failure",
  },
  webServer: {
    stdout: "pipe", stderr: "pipe",
    command: "node --import tsx src/index.ts", cwd: path.resolve(import.meta.dirname, "../../server"),
    url: "http://127.0.0.1:3100/api/health", reuseExistingServer: false, timeout: 120000,
    env: { ...process.env, PAPERCLIP_HOME: process.env.PAPERCLIP_MIMOUSE_TEST_HOME,
      PAPERCLIP_OPEN_ON_LISTEN: "false", PAPERCLIP_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1",
      PAPERCLIP_BIND: "loopback", PAPERCLIP_DEPLOYMENT_MODE: "local_trusted", PAPERCLIP_UI_DEV_MIDDLEWARE: "false" },
  },
  outputDir: "../../test-results/mimouse", reporter: [["list"]],
});
