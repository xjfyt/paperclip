import { statSync } from "node:fs";
import path from "node:path";

/** Resolve an installed pnpm entrypoint without invoking a Windows batch shell. */
export function resolvePnpmInvocation(env: NodeJS.ProcessEnv = process.env, platform = process.platform): { file: string; args: string[] } {
  if (platform !== "win32") return { file: "pnpm", args: [] };
  const isFile = (candidate: string) => {
    try { return statSync(candidate).isFile(); } catch { return false; }
  };
  const invocation = (candidate: string) => /\.[cm]?js$/i.test(candidate)
    ? { file: process.execPath, args: [candidate] }
    : { file: candidate, args: [] };
  const explicit = env.npm_execpath;
  if (explicit && path.isAbsolute(explicit) && /^pnpm\.(?:exe|[cm]?js)$/i.test(path.basename(explicit)) && isFile(explicit)) {
    return invocation(explicit);
  }
  const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
  for (const entry of searchPath.split(path.delimiter).filter(Boolean)) {
    // Do not silently add the current directory to executable discovery.
    if (!path.isAbsolute(entry)) continue;
    for (const relative of ["pnpm.exe", "node_modules/pnpm/pnpm.exe", "node_modules/pnpm/bin/pnpm.cjs", "node_modules/corepack/dist/pnpm.js"]) {
      const candidate = path.join(entry, relative);
      if (isFile(candidate)) return invocation(candidate);
    }
  }
  throw new Error("Cannot find an installed pnpm executable or JavaScript entrypoint; Windows batch wrappers cannot be used without a shell.");
}
