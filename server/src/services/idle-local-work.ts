import { promises as fs } from "node:fs";
import path from "node:path";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";
import { idleWorkSnapshot } from "./task-admission.js";

export type IdleLocalWork = "none" | "present" | "unknown";
const spoolDirectories = new Set<string>();
export function registerIdleSpoolDirectory(directory: string): void { spoolDirectories.add(path.resolve(directory)); }
export const idleAccountingSpoolPath = () => path.join(resolvePaperclipInstanceRoot(), "accounting-receipts");
export const idleOrphanSpoolPath = () => process.env.SANDBOX_ORPHAN_CLEANUP_SPOOL_DIR ??
  path.join(resolvePaperclipInstanceRoot(), "data", "sandbox-orphan-cleanup");
export const idleQuotaRecoveryPath = () => path.join(resolvePaperclipInstanceRoot(), "quota-credential-recovery");
let startupComplete = false;
let ingressTracked = false;
let scheduledBackups = false;
export function markIdleIngressTracked() { ingressTracked = true; }
export function markIdleStartupComplete(options: { scheduledBackups: boolean }) {
  scheduledBackups = options.scheduledBackups;
  startupComplete = true;
}

async function classifyMissingDirectory(directory: string, error: unknown): Promise<IdleLocalWork> {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "unknown";
  // Windows also reports ENOENT for file/child. Prove the nearest existing
  // parent is a directory before treating this as an absent recovery spool.
  let parent = path.dirname(path.resolve(directory));
  while (true) {
    try {
      const info = await fs.lstat(parent);
      return info.isDirectory() && !info.isSymbolicLink() ? "none" : "unknown";
    } catch (parentError) {
      if ((parentError as NodeJS.ErrnoException).code !== "ENOENT") return "unknown";
    }
    const next = path.dirname(parent);
    if (next === parent) return "unknown";
    parent = next;
  }
}

/** Any entry, including malformed JSON, a temp file or a failed probe, is
 * evidence to retain. Recovery readers intentionally skip some such files;
 * they cannot certify that stopping the process is safe. */
export async function inspectIdleSpool(directory: string): Promise<IdleLocalWork> {
  try {
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) return "unknown";
    const dir = await fs.opendir(directory);
    try { return (await dir.read()) === null ? "none" : "present"; }
    finally { await dir.close(); }
  } catch (error) {
    return classifyMissingDirectory(directory, error);
  }
}

/** Credential journals are grouped by company. Successful recovery leaves its
 * empty company directory behind; every file, probe or unexpected entry still
 * blocks. Never decrypt journals or follow directory symlinks during a scan. */
export async function inspectIdleQuotaRecovery(directory: string): Promise<IdleLocalWork> {
  try {
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) return "unknown";
    const dir = await fs.opendir(directory);
    try {
      for (let entry = await dir.read(); entry !== null; entry = await dir.read()) {
        if (!entry.isDirectory() || entry.isSymbolicLink()
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.name)) return "present";
        const state = await inspectIdleSpool(path.join(directory, entry.name));
        if (state !== "none") return state;
      }
      return "none";
    } finally { await dir.close(); }
  } catch (error) {
    return classifyMissingDirectory(directory, error);
  }
}

export async function readIdleLocalWork(options: { backupCheckpoint?: boolean } = {}): Promise<IdleLocalWork> {
  if (!startupComplete || !ingressTracked) return "unknown";
  // This exemption belongs only to a scan which will finish a new backup
  // under the same admission hold before it can return an empty report.
  if ((scheduledBackups && !options.backupCheckpoint) || idleWorkSnapshot().active !== 0) return "present";
  const directories = new Set([...spoolDirectories, idleAccountingSpoolPath(), idleOrphanSpoolPath()]);
  const results = await Promise.all([
    ...[...directories].map(inspectIdleSpool),
    inspectIdleQuotaRecovery(idleQuotaRecoveryPath()),
  ]);
  if (results.includes("unknown")) return "unknown";
  return results.includes("present") ? "present" : "none";
}
