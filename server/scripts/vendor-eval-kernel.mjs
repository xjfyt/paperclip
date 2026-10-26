import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The current kernel is dependency-free. Fail closed if a future compiled
 * kernel introduces imports instead of shipping a hidden workspace dependency. */
export function stageEvalKernel({ kernelRoot, destination, licensePath }) {
  const manifest = JSON.parse(readFileSync(resolve(kernelRoot, "package.json"), "utf8"));
  if (manifest.name !== "@paperclipai/paperclip-eval-kernel" || manifest.license !== "MIT") throw new Error("Unexpected eval kernel identity/license");
  if (Object.keys(manifest.dependencies ?? {}).length || Object.keys(manifest.optionalDependencies ?? {}).length) throw new Error("Eval kernel runtime dependencies require explicit vendor review");
  const dist = resolve(kernelRoot, "dist");
  for (const name of ["index.js", "index.d.ts"]) if (!existsSync(resolve(dist, name))) throw new Error(`Build eval kernel before server vendoring: missing ${name}`);
  const hashes = {};
  for (const entry of readdirSync(dist, { withFileTypes: true })) {
    if (!entry.isFile()) throw new Error("Unexpected eval kernel dist tree; review new nested modules");
    const bytes = readFileSync(resolve(dist, entry.name));
    if (entry.name.endsWith(".js")) {
      const ast = parse(bytes.toString("utf8"), { ecmaVersion: "latest", sourceType: "module" });
      const walk = value => {
        if (!value || typeof value !== "object") return;
        if (value.type === "ImportDeclaration" || value.type === "ImportExpression" || ((value.type === "ExportNamedDeclaration" || value.type === "ExportAllDeclaration") && value.source)) throw new Error("Eval kernel emitted a runtime import; explicit vendor review required");
        for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(walk); else if (child && typeof child === "object") walk(child);
      };
      walk(ast);
    }
    hashes[entry.name] = createHash("sha256").update(bytes).digest("hex");
  }
  const license = readFileSync(licensePath);
  rmSync(destination, { recursive: true, force: true }); mkdirSync(destination, { recursive: true }); cpSync(dist, destination, { recursive: true });
  writeFileSync(resolve(destination, "LICENSE"), license);
  writeFileSync(resolve(destination, "PROVENANCE.json"), JSON.stringify({ package: manifest.name, version: manifest.version, license: manifest.license, source: "packages/paperclip-eval-kernel", files: hashes }, null, 2) + "\n");
  return hashes;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  stageEvalKernel({ kernelRoot: resolve(serverRoot, "../packages/paperclip-eval-kernel"), destination: resolve(serverRoot, "dist/vendor/paperclip-eval-kernel"), licensePath: resolve(serverRoot, "../LICENSE") });
}
