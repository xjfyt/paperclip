import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@paperclipai/adapter-codex-local",
    environment: "node",
    include: ["src/**/*.test.ts"],
    maxWorkers: process.platform === "win32" ? 1 : 2,
    testTimeout: process.platform === "win32" ? 20_000 : 5_000,
  },
});
