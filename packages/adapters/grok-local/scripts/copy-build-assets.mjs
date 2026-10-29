import { copyFileSync } from "node:fs";

copyFileSync(new URL("../src/server/grok-auth-merge-decision.cjs", import.meta.url), new URL("../dist/server/grok-auth-merge-decision.cjs", import.meta.url));
