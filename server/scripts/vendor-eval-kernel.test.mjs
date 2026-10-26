import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stageEvalKernel } from "./vendor-eval-kernel.mjs";
function fixture(run) {
  const root = mkdtempSync(resolve(tmpdir(), "eval-vendor-"));
  try {
    const kernelRoot = resolve(root, "kernel"), destination = resolve(root, "server/dist/vendor/paperclip-eval-kernel"), licensePath = resolve(root, "LICENSE");
    mkdirSync(resolve(kernelRoot, "dist"), { recursive: true }); writeFileSync(resolve(kernelRoot, "package.json"), JSON.stringify({ name: "@paperclipai/paperclip-eval-kernel", version: "0.1.0", license: "MIT", private: true }));
    writeFileSync(resolve(root, "package.json"), '{"type":"module"}'); writeFileSync(licensePath, "MIT fixture license");
    writeFileSync(resolve(kernelRoot, "dist/index.js"), "export const fixture = 42;\n"); writeFileSync(resolve(kernelRoot, "dist/index.d.ts"), "export declare const fixture = 42;\n");
    return Promise.resolve(run({ kernelRoot, destination, licensePath })).finally(() => rmSync(root, { recursive: true, force: true }));
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
}
test("vendored compiled entry resolves without the private package and preserves declarations/license/provenance", () => fixture(async input => {
  stageEvalKernel(input); assert.equal((await import(pathToFileURL(resolve(input.destination, "index.js")).href)).fixture, 42);
  assert.match(readFileSync(resolve(input.destination, "index.d.ts"), "utf8"), /declare/);
  assert.equal(readFileSync(resolve(input.destination, "LICENSE"), "utf8"), "MIT fixture license");
  const provenance = JSON.parse(readFileSync(resolve(input.destination, "PROVENANCE.json"), "utf8")); assert.match(provenance.files["index.js"], /^[a-f0-9]{64}$/);
}));
test("a future hidden runtime import is rejected before replacing the destination", () => fixture(input => {
  mkdirSync(input.destination, { recursive: true }); writeFileSync(resolve(input.destination, "index.js"), "previous");
  for (const source of ['import "private-package";', 'export { x } from "private-package";', 'export const later = () => import("private-package");']) {
    writeFileSync(resolve(input.kernelRoot, "dist/index.js"), source); assert.throws(() => stageEvalKernel(input), /runtime import/);
    assert.equal(readFileSync(resolve(input.destination, "index.js"), "utf8"), "previous");
  }
}));
test("missing compiled declarations and undeclared shipping assumptions fail closed", () => fixture(input => {
  rmSync(resolve(input.kernelRoot, "dist/index.d.ts")); assert.throws(() => stageEvalKernel(input), /Build eval kernel/);
  const manifestPath = resolve(input.kernelRoot, "package.json"), manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, dependencies: { hidden: "1" } })); assert.throws(() => stageEvalKernel(input), /runtime dependencies/);
}));
