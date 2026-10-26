import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";
export default mergeConfig(base, defineConfig({ resolve: { alias: [
  { find: /^@paperclipai\/shared\/(.+)$/, replacement: fileURLToPath(new URL("../packages/shared/src/$1.ts", import.meta.url)) },
  { find: "zod", replacement: fileURLToPath(new URL("../server/node_modules/zod/index.js", import.meta.url)) },
] }, test: { maxWorkers: 1, pool: "forks" } }));
