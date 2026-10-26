import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { skillSnapshotHash, skillFileBytes, assertSkillSnapshotPath, snapshotFile } from "../skill-snapshot.js";
import type { CompanySkillVersionFileInventoryEntry as File } from "@paperclipai/shared";
export type RestoreTreePlan = { root: string; live: string; operationId: string; beforeHash: string; targetHash: string };
const MAX_BYTES = 16 * 1024 * 1024, MAX_FILES = 1000;
/** Only server-derived managed direct children are eligible. Never follow links. */
export async function assertRestoreDirectory(root: string, directory = root) {
  if (process.platform === "win32") throw Error("restore_platform_unsupported");
  root = path.resolve(root); directory = path.resolve(directory);
  if (directory !== root && !directory.startsWith(`${root}${path.sep}`)) throw Error("restore_path_outside_root");
  if (await fs.realpath(root) !== root) throw Error("restore_root_alias_unsupported");
  let current = root;
  for (const part of ["", ...path.relative(root, directory).split(path.sep).filter(Boolean)]) {
    current = part ? path.join(current, part) : current;
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("restore_symbolic_or_special_directory");
  }
}
export function validateRestoreSnapshot(files: File[]) {
  if (!files.length || files.length > MAX_FILES) throw Error("restore_inventory_size");
  const names = new Set<string>(); let total = 0;
  for (const file of files) {
    assertSkillSnapshotPath(file.path);
    if (file.path.split("/").some(part => /[\u0000-\u001f]/.test(part)) || names.has(file.path)) throw Error("restore_duplicate_or_unsafe_path");
    names.add(file.path);
    if (file.encoding && !["utf8", "base64"].includes(file.encoding)) throw Error("restore_invalid_encoding");
    const bytes = skillFileBytes(file);
    if (file.encoding === "base64" && bytes.toString("base64") !== file.content) throw Error("restore_noncanonical_base64");
    total += bytes.length;
    if (total > MAX_BYTES) throw Error("restore_inventory_size");
  }
  for (const name of names) for (const other of names) if (other.startsWith(`${name}/`)) throw Error("restore_path_collision");
  const skill = files.find(file => file.path === "SKILL.md");
  if (!skill || skill.encoding === "base64" || skill.executable) throw Error("restore_skill_markdown_required");
  return skillSnapshotHash(files);
}
async function syncDirectory(directory: string) {
  const handle = await fs.open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function mkdir(root: string, directory: string) {
  const parts = path.relative(root, directory).split(path.sep).filter(Boolean); let current = root;
  await assertRestoreDirectory(root);
  for (const part of parts) {
    if (part === "..") throw Error("restore_path_outside_root"); current = path.join(current, part);
    await fs.mkdir(current, { mode: 0o755 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    await assertRestoreDirectory(root, current);
  }
}
function locations(plan: RestoreTreePlan) {
  if (!/^[a-f0-9-]{36}$/i.test(plan.operationId)) throw Error("restore_invalid_operation_id");
  const root = path.resolve(plan.root), live = path.resolve(plan.live), relative = path.relative(root, live);
  if (!relative || relative.includes(path.sep) || relative.startsWith("__") || relative.startsWith(".")) throw Error("restore_managed_direct_child_required");
  const operation = path.join(root, "__mimouse_restores__", plan.operationId);
  return { root, live, operation, stage: path.join(operation, "target"), backup: path.join(operation, "before") };
}
/** Actual bytes and executable flags, including unexpected files. No inventory
 * allowlist can hide a file that would otherwise survive restoration. */
export async function readRestoreTree(root: string, directory: string): Promise<File[] | null> {
  try { await fs.lstat(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  await assertRestoreDirectory(root, directory); const out: File[] = []; let total = 0;
  async function walk(dir: string, prefix: string) {
    await assertRestoreDirectory(root, dir);
    if (((await fs.lstat(dir)).mode & 0o7777) !== 0o755) throw Error("restore_noncanonical_directory_mode");
    for (const name of (await fs.readdir(dir)).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name; assertSkillSnapshotPath(relative);
      const absolute = path.join(dir, name), stat = await fs.lstat(absolute);
      if (stat.isSymbolicLink()) throw Error("restore_symbolic_file");
      if (stat.isDirectory()) { await walk(absolute, relative); continue; }
      if (!stat.isFile() || stat.nlink !== 1) throw Error("restore_special_or_hardlinked_file");
      const executable = Boolean(stat.mode & 0o111);
      if ((stat.mode & 0o7777) !== (executable ? 0o755 : 0o644)) throw Error("restore_noncanonical_file_mode");
      total += stat.size; if (total > MAX_BYTES || out.length >= MAX_FILES) throw Error("restore_inventory_size");
      const handle = await fs.open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const checked = await handle.stat(); if (!checked.isFile() || checked.nlink !== 1 || checked.ino !== stat.ino || checked.dev !== stat.dev) throw Error("restore_file_changed");
        const bytes = await handle.readFile(); if (bytes.length !== stat.size) throw Error("restore_file_changed");
        out.push(snapshotFile(relative, relative === "SKILL.md" ? "skill" : "other", bytes, executable));
      } finally { await handle.close(); }
    }
  }
  await walk(directory, ""); return out;
}
export async function stageRestoreTree(plan: RestoreTreePlan, files: File[], onDirectorySynced?: (directory: string) => void) {
  if (validateRestoreSnapshot(files) !== plan.targetHash) throw Error("restore_target_hash_mismatch");
  const loc = locations(plan); await assertRestoreDirectory(loc.root, loc.live);
  const before = await readRestoreTree(loc.root, loc.live);
  if (!before || skillSnapshotHash(before) !== plan.beforeHash) throw Error("restore_live_snapshot_changed");
  await mkdir(loc.root, loc.operation);
  async function durableStage() {
    // Persist every directory entry, including parents of multi-level children.
    // Reused complete stages are also re-synced before a new journal commit.
    async function syncTree(directory: string) {
      await assertRestoreDirectory(loc.root, directory);
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const child = path.join(directory, entry.name);
        if (entry.isDirectory()) await syncTree(child);
        else if (entry.isFile()) { const handle = await fs.open(child, constants.O_RDONLY | constants.O_NOFOLLOW); try { await handle.sync(); } finally { await handle.close(); } }
        else throw Error("restore_symbolic_or_special_file");
      }
      await syncDirectory(directory); onDirectorySynced?.(directory);
    }
    // The original tree is the future compensation backup. Flush its bytes
    // too: a durable rename alone does not make pre-existing file data durable.
    await syncTree(loc.live);
    await syncTree(loc.stage);
    for (const directory of [loc.operation, path.dirname(loc.operation), loc.root]) { await syncDirectory(directory); onDirectorySynced?.(directory); }
  }
  const existing = await readRestoreTree(loc.root, loc.stage);
  if (existing) { if (skillSnapshotHash(existing) === plan.targetHash && !await readRestoreTree(loc.root, loc.backup)) { await durableStage(); return; } throw Error("restore_orphan_stage_requires_review"); }
  await fs.mkdir(loc.stage, { mode: 0o755 });
  for (const file of files) {
    const target = path.join(loc.stage, file.path); await mkdir(loc.root, path.dirname(target));
    const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, file.executable ? 0o755 : 0o644);
    try { await handle.writeFile(skillFileBytes(file)); await handle.chmod(file.executable ? 0o755 : 0o644); await handle.sync(); } finally { await handle.close(); }
    await syncDirectory(path.dirname(target));
  }
  await durableStage();
  const staged = await readRestoreTree(loc.root, loc.stage);
  if (!staged || skillSnapshotHash(staged) !== plan.targetHash) throw Error("restore_staged_snapshot_mismatch");
}
/** Caller must commit a durable pending journal BEFORE invoking this method.
 * Recovery verifies all three trees, follows recorded resolution and never
 * guesses when bytes differ. Checkpoint is test-only crash injection, not API. */
export async function resolveRestoreTree(plan: RestoreTreePlan, resolution: "apply" | "compensate", checkpoint?: (phase: string) => Promise<void>) {
  const loc = locations(plan); await assertRestoreDirectory(loc.root, loc.operation);
  async function hash(directory: string) { const files = await readRestoreTree(loc.root, directory); return files === null ? null : skillSnapshotHash(files); }
  let live = await hash(loc.live), before = await hash(loc.backup), target = await hash(loc.stage);
  if (resolution === "apply") {
    if (live === plan.beforeHash && before === null && target === plan.targetHash) {
      await fs.rename(loc.live, loc.backup); await syncDirectory(loc.root); await syncDirectory(loc.operation);
      await checkpoint?.("before_moved"); live = null; before = plan.beforeHash;
    }
    if (live === null && before === plan.beforeHash && target === plan.targetHash) {
      await fs.rename(loc.stage, loc.live); await syncDirectory(loc.root); await syncDirectory(loc.operation);
      await checkpoint?.("target_installed"); live = plan.targetHash; target = null;
    }
    if (live !== plan.targetHash || before !== plan.beforeHash || target !== null) throw Error("restore_layout_requires_operator_review");
  } else {
    if (live === plan.targetHash && before === plan.beforeHash && target === null) {
      await fs.rename(loc.live, loc.stage); await syncDirectory(loc.root); await syncDirectory(loc.operation);
      await checkpoint?.("target_uninstalled"); live = null; target = plan.targetHash;
    }
    if (live === null && before === plan.beforeHash && target === plan.targetHash) {
      await fs.rename(loc.backup, loc.live); await syncDirectory(loc.root); await syncDirectory(loc.operation);
      await checkpoint?.("before_restored"); live = plan.beforeHash; before = null;
    }
    if (live !== plan.beforeHash || before !== null || target !== plan.targetHash) throw Error("restore_layout_requires_operator_review");
  }
  if (await hash(loc.live) !== (resolution === "apply" ? plan.targetHash : plan.beforeHash)
    || await hash(loc.backup) !== (resolution === "apply" ? plan.beforeHash : null)
    || await hash(loc.stage) !== (resolution === "apply" ? null : plan.targetHash)) throw Error("restore_live_verification_failed");
}
