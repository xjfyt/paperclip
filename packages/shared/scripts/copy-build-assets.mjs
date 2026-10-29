import { copyFileSync, mkdirSync } from "node:fs";

const target = new URL("../dist/cliplab/", import.meta.url);
mkdirSync(target, { recursive: true });
for (const name of ["LICENSE", "PROVENANCE.md"]) {
  copyFileSync(new URL(`../src/cliplab/${name}`, import.meta.url), new URL(name, target));
}
