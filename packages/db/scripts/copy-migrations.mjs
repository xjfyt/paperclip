import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const source = new URL("../src/migrations/", import.meta.url);
const target = new URL("../dist/migrations/", import.meta.url);
// Only replace this package's generated migration directory, keeping compiled
// JS and source snapshots intact.
const targetPath = fileURLToPath(target);
if (path.relative(packageRoot, targetPath) !== path.join("dist", "migrations")) {
  throw new Error("Migration output must stay inside packages/db/dist/migrations");
}
rmSync(targetPath, { recursive: true, force: true });
mkdirSync(new URL("meta/", target), { recursive: true });
for (const entry of readdirSync(source, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".sql")) {
    copyFileSync(new URL(entry.name, source), new URL(entry.name, target));
  }
}
copyFileSync(new URL("meta/_journal.json", source), new URL("meta/_journal.json", target));
