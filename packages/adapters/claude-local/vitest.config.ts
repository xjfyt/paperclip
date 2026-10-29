import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@paperclipai/adapter-claude-local",
    environment: "node",
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
    testTimeout: process.platform === "win32" ? 20_000 : 5_000,
  },
});
