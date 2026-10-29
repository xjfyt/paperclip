import { defineConfig } from "vitest/config";

export default defineConfig({ test: {
  name: "@paperclipai/adapter-grok-local", environment: "node",
  include: ["src/**/*.test.ts"],
  // Credential tests inspect real NTFS ACLs through the OS, without mocks.
  testTimeout: process.platform === "win32" ? 30_000 : 5_000,
  maxWorkers: process.platform === "win32" ? 2 : undefined,
} });
