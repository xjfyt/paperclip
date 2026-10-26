import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
// Pure notification contract fixtures only: no server bootstrap or database.
// Resolve this worktree's new shared contracts even with reused node_modules.
export default defineConfig({
  resolve: { alias: [{ find: "zod", replacement: fileURLToPath(new URL("./node_modules/zod/index.js", import.meta.url)) }, { find: /^@paperclipai\/shared\/(.+)$/, replacement: fileURLToPath(new URL("../packages/shared/src/$1.ts", import.meta.url)) }] },
  test: { environment: "node", include: ["src/services/mimouse-notifications/*.test.ts", "src/services/capability-evidence.test.ts", "../packages/shared/src/notification*.test.ts", "../packages/shared/src/capability-evidence.test.ts"], maxWorkers: 1, pool: "forks" },
});
