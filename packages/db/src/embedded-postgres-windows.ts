import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
type OwnedProcess = Pick<ChildProcess, "pid" | "exitCode" | "signalCode"> & {
  once(event: "exit", listener: () => void): unknown;
  off(event: "exit", listener: () => void): unknown;
};
type PgCtlRunner = (file: string, args: string[], options: {
  windowsHide: boolean; timeout: number; maxBuffer: number;
}) => Promise<unknown>;

/** Stop only the cluster belonging to this wrapper's actual child process.
 * taskkill prevents PostgreSQL from removing postmaster.pid and leaves template
 * builds unusable. pg_ctl performs PostgreSQL's fast shutdown and waits for it.
 */
export async function stopOwnedWindowsEmbeddedPostgres(input: {
  child: OwnedProcess;
  databaseDir: string;
  port: number;
  pgCtl: string;
  persistent: boolean;
}, runPgCtl: PgCtlRunner = execute): Promise<void> {
  const { child } = input;
  if (!Number.isSafeInteger(child.pid) || child.pid! <= 1) throw new Error("Embedded PostgreSQL child identity is unavailable");
  const directory = await fs.realpath(input.databaseDir);
  const pidFile = path.join(directory, "postmaster.pid");
  if (child.exitCode !== null || child.signalCode !== null) {
    try { await fs.access(pidFile); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    throw new Error("Embedded PostgreSQL exited without a clean shutdown; preserving its data directory");
  }
  const lines = (await fs.readFile(pidFile, "utf8")).split(/\r?\n/);
  if (Number(lines[0]) !== child.pid || await fs.realpath(lines[1] ?? "") !== directory || Number(lines[3]) !== input.port) {
    throw new Error("Embedded PostgreSQL PID, directory, or port does not match its owner");
  }
  // Attach before dispatch so a fast native exit cannot race registration.
  let onExit: () => void;
  const exited = new Promise<void>(resolve => { onExit = resolve; child.once("exit", onExit); });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await runPgCtl(input.pgCtl, ["-D", directory, "stop", "-m", "fast", "-w", "-t", "30"], {
      windowsHide: true, timeout: 35_000, maxBuffer: 65_536,
    });
    await Promise.race([
      exited,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Embedded PostgreSQL child did not exit after pg_ctl")), 5_000); }),
    ]);
    try { await fs.access(pidFile); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!input.persistent) {
        // Revalidate the exact owned target before recursive deletion. Never
        // reclaim a root or a directory replaced by a link during shutdown.
        if (await fs.realpath(input.databaseDir) !== directory || path.dirname(directory) === directory) {
          throw new Error("Embedded PostgreSQL data directory changed during shutdown");
        }
        await fs.rm(directory, { recursive: true, force: true });
      }
      return;
    }
    throw new Error("Embedded PostgreSQL left its PID file after pg_ctl; preserving its data directory");
  } finally {
    if (timer) clearTimeout(timer);
    child.off("exit", onExit!);
  }
}
