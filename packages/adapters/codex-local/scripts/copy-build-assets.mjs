import { copyFileSync } from "node:fs";

for (const file of ["codex-auth-merge-decision.cjs", "codex-auth-merge-extract.sh"]) {
  copyFileSync(new URL(`../src/server/${file}`, import.meta.url), new URL(`../dist/server/${file}`, import.meta.url));
}
