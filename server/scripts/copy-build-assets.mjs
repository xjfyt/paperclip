import { cpSync, lstatSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outputRoot = fileURLToPath(new URL("../dist/", import.meta.url));

function prepareReadOnlyOutput(source, destination) {
  // Native Windows cpSync(force) cannot replace an existing readonly file.
  // Remove only the matching regular build output; never follow a link or
  // recursively clear unrelated output files to make the copy succeed.
  const relative = path.relative(outputRoot, destination);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Build copy target must remain inside the server dist directory");
  }
  if (!lstatSync(source).isFile()) return true;
  let target;
  try { target = lstatSync(destination); }
  catch (error) { if (error.code === "ENOENT") return true; throw error; }
  if (!target.isFile() || target.isSymbolicLink() || (target.mode & 0o200) !== 0) return true;
  for (let parent = path.dirname(destination); ; parent = path.dirname(parent)) {
    const entry = lstatSync(parent);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Readonly build output has an unverified parent");
    if (path.relative(outputRoot, parent) === "") break;
  }
  rmSync(destination, { force: true });
  return true;
}

for (const [source, destination] of [
  ["../src/onboarding-assets/", "../dist/onboarding-assets/"],
  ["../src/built-ins/", "../dist/built-ins/"],
  ["../src/services/scripts/", "../dist/services/scripts/"],
  ["../../packages/paperclip-runner/dist/", "../dist/vendor/paperclip-runner/"],
]) {
  cpSync(new URL(source, import.meta.url), new URL(destination, import.meta.url), {
    recursive: true,
    force: true,
    ...(process.platform === "win32" ? { filter: prepareReadOnlyOutput } : {}),
  });
}
