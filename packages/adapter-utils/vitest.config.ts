import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@paperclipai/adapter-utils",
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
    // Real Git Bash startup and filesystem transfers are slower than POSIX
    // exec on Windows. Explicit deadline tests retain their own budgets.
    testTimeout: process.platform === "win32" ? 20_000 : 5_000,
  },
});
