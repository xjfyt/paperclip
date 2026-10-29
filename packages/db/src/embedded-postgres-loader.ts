import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { stopOwnedWindowsEmbeddedPostgres } from "./embedded-postgres-windows.js";

let windowsConstructor: typeof import("embedded-postgres").default | undefined;

/**
 * Resolve from @paperclipai/db, which publishes the qualified, patched wrapper
 * as a bundled dependency. Importing from a server/CLI caller can select an
 * unrelated hoisted, unpatched copy instead. Callers retain lifecycle ownership
 * and may wrap this lazy load in their coordinated shutdown-hook guard.
 */
export async function loadEmbeddedPostgres(): Promise<typeof import("embedded-postgres")> {
  const mod = await import("embedded-postgres");
  if (process.platform !== "win32") return mod;
  if (!windowsConstructor) {
    const require = createRequire(import.meta.url);
    const embeddedEntry = require.resolve("embedded-postgres");
    const nativeEntry = createRequire(embeddedEntry).resolve("@embedded-postgres/windows-x64");
    const pgCtl = path.resolve(path.dirname(nativeEntry), "../native/bin/pg_ctl.exe");
    windowsConstructor = class extends mod.default {
      private stopping: Promise<void> | undefined;

      override stop(): Promise<void> {
        // The qualified wrapper's private runtime field is needed to bind
        // pg_ctl to the child it actually spawned, rather than trusting a PID
        // file by itself. Clear it only after confirmed clean shutdown, as the
        // dependency's own stop does on other platforms.
        const owner = this as unknown as { process?: ChildProcess };
        const child = owner.process;
        if (!child) return Promise.resolve();
        if (!this.stopping) {
          this.stopping = stopOwnedWindowsEmbeddedPostgres({
            child, databaseDir: this.options.databaseDir, port: this.options.port,
            persistent: this.options.persistent, pgCtl,
          }).then(() => { if (owner.process === child) owner.process = undefined; })
            .finally(() => { this.stopping = undefined; });
        }
        return this.stopping;
      }
    };
  }
  return { ...mod, default: windowsConstructor };
}
