import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Native PostgreSQL clusters are expensive on Windows; bounding concurrent
    // owners avoids many initdb/migration stacks starving each other's budgets.
    maxWorkers: process.platform === "win32" ? 2 : undefined,
  },
});
