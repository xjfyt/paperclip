import { defineConfig } from "vitest/config";
/** Small isolated fixture suite: no DB/server setup and no vendor connection. */
export default defineConfig({
  root: new URL("../../", import.meta.url).pathname,
  resolve: { alias: [{
    find: /^@paperclipai\/db\/schema\/mimouse_wecom$/,
    replacement: new URL("../../packages/db/src/schema/mimouse_wecom.ts", import.meta.url).pathname,
  }] },
  test: {
    environment: "node", pool: "forks", maxWorkers: 1, maxConcurrency: 1, isolate: true,
    include: ["server/src/__tests__/mimouse-wecom*.test.ts", "server/src/__tests__/mimouse-log-policy.test.ts"],
  },
});
