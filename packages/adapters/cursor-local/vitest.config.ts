import { defineConfig } from "vitest/config";

export default defineConfig({ test: {
  name: "@paperclipai/adapter-cursor-local", environment: "node",
  include: ["src/**/*.test.ts"],
  // Real Git Bash subprocesses have native Windows startup overhead.
  testTimeout: process.platform === "win32" ? 30_000 : 5_000,
  maxWorkers: process.platform === "win32" ? 2 : undefined,
} });
