import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
const root = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
export default defineConfig({resolve:{alias:[
{find:/^@paperclipai\/db\/schema\/(.*)$/,replacement:root+'/packages/db/src/schema/$1.ts'},
{find:'@paperclipai/db',replacement:root+'/packages/db/src/index.ts'},
{find:'@paperclipai/shared/telemetry',replacement:root+'/packages/shared/src/telemetry/index.ts'},
{find:/^@paperclipai\/shared\/(.*)$/,replacement:root+'/packages/shared/src/$1.ts'},
{find:'@paperclipai/shared',replacement:root+'/packages/shared/src/index.ts'},
{find:/^@paperclipai\/adapter-utils\/(.*)$/,replacement:root+'/packages/adapter-utils/src/$1.ts'},
{find:'@paperclipai/adapter-utils',replacement:root+'/packages/adapter-utils/src/index.ts'},
{find:'@paperclipai/adapter-claude-local/server',replacement:root+'/packages/adapters/claude-local/src/server/index.ts'},
]},test:{env:{PAPERCLIP_DISABLE_CWD_ENV_FILE:'true',PAPERCLIP_TELEMETRY_DISABLED:'1',DO_NOT_TRACK:'1'},environment:'node',maxWorkers:1,pool:'forks',hookTimeout:180000,testTimeout:90000,include:['server/src/services/mimouse-private-prompt-tests/*.test.ts']}});
