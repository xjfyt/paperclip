import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      lexical: path.resolve(import.meta.dirname, "./node_modules/lexical/dist/Lexical.mjs"),
    },
  },
  test: {
    // Each isolated UI worker transforms a large graph; bound concurrency so
    // the full suite remains stable on ordinary development machines.
    maxWorkers: 4,
    environment: "node",
    css: { include: [/motion-tokens\.css/] },
    setupFiles: ["./vitest.setup.ts"],
  },
});
