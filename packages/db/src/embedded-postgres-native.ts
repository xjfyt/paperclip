import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

function resolveNativePackageName(): string | null {
  if (process.platform !== "linux") return null;

  switch (process.arch) {
    case "arm64":
      return "linux-arm64";
    case "arm":
      return "linux-arm";
    case "ia32":
      return "linux-ia32";
    case "ppc64":
      return "linux-ppc64";
    case "x64":
      return "linux-x64";
    default:
      return null;
  }
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await fs.stat(value);
    return true;
  } catch {
    return false;
  }
}

/** Resolve through the embedded dependency's own issuer: npm may hoist the
 * native optional package while keeping the patched wrapper bundled under DB. */
export async function resolveEmbeddedPostgresNativeLibDir(
  embeddedEntry: string,
  nativePackageName: string,
): Promise<string | null> {
  if (!["linux-arm64", "linux-arm", "linux-ia32", "linux-ppc64", "linux-x64"].includes(nativePackageName)) {
    throw new Error("Unsupported embedded PostgreSQL native package");
  }
  const expectedName = `@embedded-postgres/${nativePackageName}`;
  let nativeEntry: string;
  try {
    nativeEntry = createRequire(embeddedEntry).resolve(expectedName);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") return null;
    throw error;
  }
  const nativeRoot = await fs.realpath(path.dirname(path.dirname(nativeEntry)));
  const manifest = JSON.parse(await fs.readFile(path.join(nativeRoot, "package.json"), "utf8"));
  if (manifest.name !== expectedName) throw new Error("Unexpected embedded PostgreSQL native package identity");
  const libDir = path.join(nativeRoot, "native", "lib");
  if (!(await pathExists(libDir))) return null;
  const canonicalLibDir = await fs.realpath(libDir);
  const relativeLibDir = path.relative(nativeRoot, canonicalLibDir);
  if (!relativeLibDir || relativeLibDir === ".." || relativeLibDir.startsWith(`..${path.sep}`) || path.isAbsolute(relativeLibDir)) {
    throw new Error("Embedded PostgreSQL native libraries escape the installed package");
  }
  return canonicalLibDir;
}

function prependPathEnv(name: string, value: string): void {
  const current = process.env[name] ?? "";
  const parts = current.split(path.delimiter).filter(Boolean);
  if (parts.includes(value)) return;
  process.env[name] = [value, ...parts].join(path.delimiter);
}

export async function ensureLinuxSharedLibraryAliases(libDir: string): Promise<string[]> {
  const entries = await fs.readdir(libDir, { withFileTypes: true });
  const created: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(/^(lib.+\.so\.\d+)\.\d+(?:\.\d+)?$/);
    if (!match) continue;

    const aliasName = match[1];
    const aliasPath = path.join(libDir, aliasName);
    try {
      await fs.symlink(entry.name, aliasPath);
      created.push(aliasPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }

  return created;
}

export async function prepareEmbeddedPostgresNativeRuntime(): Promise<void> {
  const nativePackageName = resolveNativePackageName();
  if (!nativePackageName) return;
  let embeddedEntry: string;
  try { embeddedEntry = require.resolve("embedded-postgres"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") return;
    throw error;
  }
  const libDir = await resolveEmbeddedPostgresNativeLibDir(embeddedEntry, nativePackageName);
  if (!libDir) return;

  prependPathEnv("LD_LIBRARY_PATH", libDir);
  await ensureLinuxSharedLibraryAliases(libDir);
}
