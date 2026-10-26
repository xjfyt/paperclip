import { afterEach, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { stageRestoreTree, resolveRestoreTree, readRestoreTree, validateRestoreSnapshot } from "../services/mimouse-evaluation/restore-files.js";
import { skillSnapshotHash, skillFileBytes } from "../services/skill-snapshot.js";
import type { CompanySkillVersionFileInventoryEntry as File } from "@paperclipai/shared";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const before: File[] = [{ path: "SKILL.md", kind: "skill", content: "# Baseline\n" }, { path: "obsolete.txt", kind: "other", content: "remove on activation" }];
const target: File[] = [{ path: "SKILL.md", kind: "skill", content: "# Candidate\n" }, { path: "bin/example.sh", kind: "script", content: "#!/bin/sh\nexit 0\n", executable: true }, { path: "assets/data.bin", kind: "asset", content: "AP8B", encoding: "base64" }];
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mimouse-restore-fs-"))); roots.push(root);
  const live = path.join(root, "example"); await fs.mkdir(live);
  for (const file of before) { const filePath = path.join(live, file.path); await fs.writeFile(filePath, skillFileBytes(file)); await fs.chmod(filePath, 0o644); }
  return { root, live, operationId: randomUUID(), beforeHash: skillSnapshotHash(before), targetHash: skillSnapshotHash(target) };
}
it("materializes actual binary bytes, executable modes and deletions with preserved original backup", async () => {
  const plan = await fixture(); await stageRestoreTree(plan, target); await resolveRestoreTree(plan, "apply");
  expect(skillSnapshotHash((await readRestoreTree(plan.root, plan.live))!)).toBe(plan.targetHash);
  expect(await fs.readFile(path.join(plan.live, "assets/data.bin"))).toEqual(Buffer.from([0, 255, 1]));
  expect((await fs.stat(path.join(plan.live, "bin/example.sh"))).mode & 0o777).toBe(0o755);
  await expect(fs.stat(path.join(plan.live, "obsolete.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  const backup = path.join(plan.root, "__mimouse_restores__", plan.operationId, "before"); expect(skillSnapshotHash((await readRestoreTree(plan.root, backup))!)).toBe(plan.beforeHash);
});
it.each(["before_moved", "target_installed"])("recovers a crash at %s idempotently without mixing inventories", async phase => {
  const plan = await fixture(); await stageRestoreTree(plan, target);
  await expect(resolveRestoreTree(plan, "apply", async point => { if (point === phase) throw Error("fixture_crash"); })).rejects.toThrow("fixture_crash");
  await resolveRestoreTree(plan, "apply"); await resolveRestoreTree(plan, "apply");
  expect(skillSnapshotHash((await readRestoreTree(plan.root, plan.live))!)).toBe(plan.targetHash);
});
it.each(["before_moved", "target_installed"])("compensates a crash at %s using verified original files", async phase => {
  const plan = await fixture(); await stageRestoreTree(plan, target);
  await expect(resolveRestoreTree(plan, "apply", async point => { if (point === phase) throw Error("fixture_crash"); })).rejects.toThrow("fixture_crash");
  await resolveRestoreTree(plan, "compensate"); await resolveRestoreTree(plan, "compensate");
  expect(skillSnapshotHash((await readRestoreTree(plan.root, plan.live))!)).toBe(plan.beforeHash);
});
it("recovers an interruption during compensation without switching back to activation", async () => {
  const plan = await fixture(); await stageRestoreTree(plan, target); await resolveRestoreTree(plan, "apply");
  await expect(resolveRestoreTree(plan, "compensate", async phase => { if (phase === "target_uninstalled") throw Error("fixture_crash"); })).rejects.toThrow("fixture_crash");
  await resolveRestoreTree(plan, "compensate"); expect(skillSnapshotHash((await readRestoreTree(plan.root, plan.live))!)).toBe(plan.beforeHash);
});
it("rejects changed live bytes, symbolic links, hard links and unknown modes without touching target", async () => {
  const plan = await fixture(); await fs.appendFile(path.join(plan.live, "SKILL.md"), "changed");
  await expect(stageRestoreTree(plan, target)).rejects.toThrow("restore_live_snapshot_changed");
  await fs.writeFile(path.join(plan.live, "SKILL.md"), before[0]!.content); await fs.symlink("SKILL.md", path.join(plan.live, "link"));
  await expect(stageRestoreTree(plan, target)).rejects.toThrow("restore_symbolic_file"); await fs.unlink(path.join(plan.live, "link"));
  await fs.link(path.join(plan.live, "SKILL.md"), path.join(plan.live, "hard")); await expect(stageRestoreTree(plan, target)).rejects.toThrow("restore_special_or_hardlinked_file"); await fs.unlink(path.join(plan.live, "hard"));
  await fs.chmod(path.join(plan.live, "SKILL.md"), 0o600); await expect(stageRestoreTree(plan, target)).rejects.toThrow("restore_noncanonical_file_mode");
});
it("refuses to guess after external edits during interrupted restoration", async () => {
  const plan = await fixture(); await stageRestoreTree(plan, target); await resolveRestoreTree(plan, "apply");
  await fs.appendFile(path.join(plan.live, "SKILL.md"), "external edit");
  await expect(resolveRestoreTree(plan, "compensate")).rejects.toThrow("restore_layout_requires_operator_review");
  expect(await fs.readFile(path.join(plan.live, "SKILL.md"), "utf8")).toContain("external edit");
});
it("validates traversal, duplicate paths, file-directory collisions and canonical binary payloads", () => {
  for (const files of [[...target, target[0]!], [...target, { path: "../escape", kind: "other", content: "x" }], [...target, { path: "bin", kind: "other", content: "x" }], [{ ...target[0]!, encoding: "base64", content: "bad!!!" }]]) expect(() => validateRestoreSnapshot(files as File[])).toThrow();
});

it("fsyncs every nested directory bottom-up, including a reused complete stage", async () => {
  const plan = await fixture(), deep = [...target, { path: "a/b/c/file.txt", kind: "other" as const, content: "nested" }];
  plan.targetHash = skillSnapshotHash(deep);
  for (let attempt = 0; attempt < 2; attempt++) {
    const synced: string[] = []; await stageRestoreTree(plan, deep, directory => synced.push(directory));
    const stage = path.join(plan.root, "__mimouse_restores__", plan.operationId, "target");
    const paths = [path.join(stage, "a/b/c"), path.join(stage, "a/b"), path.join(stage, "a"), stage, path.dirname(stage), path.dirname(path.dirname(stage)), plan.root];
    for (const directory of paths) expect(synced).toContain(directory);
    for (let index = 1; index < paths.length; index++) expect(synced.indexOf(paths[index - 1]!)).toBeLessThan(synced.indexOf(paths[index]!));
  }
});

it("creates canonical staging under umask 0077 without widening existing source or parent directories", async () => {
  const plan = await fixture(), invalid = await fixture(), existingParent = await fixture(), invalidStage = await fixture();
  await fs.chmod(invalid.live, 0o700);
  const orphanStage = path.join(invalidStage.root, "__mimouse_restores__", invalidStage.operationId, "target");
  await fs.mkdir(orphanStage, { recursive: true }); await fs.chmod(orphanStage, 0o700);
  const namespace = path.join(existingParent.root, "__mimouse_restores__");
  await fs.mkdir(namespace); await fs.chmod(namespace, 0o700);
  const deep = [...target, { path: "a/b/c/data.bin", kind: "asset" as const, content: "AP8B", encoding: "base64" as const }];
  plan.targetHash = skillSnapshotHash(deep);
  const previous = process.umask(0o077);
  try {
    await stageRestoreTree(plan, deep);
    const operation = path.join(plan.root, "__mimouse_restores__", plan.operationId), stage = path.join(operation, "target");
    for (const directory of [path.dirname(operation), operation, stage, path.join(stage, "a"), path.join(stage, "a/b"), path.join(stage, "a/b/c"), path.join(stage, "assets"), path.join(stage, "bin")]) {
      expect((await fs.stat(directory)).mode & 0o7777).toBe(0o755);
    }
    await resolveRestoreTree(plan, "apply"); expect(skillSnapshotHash((await readRestoreTree(plan.root, plan.live))!)).toBe(plan.targetHash);
    expect((await fs.stat(path.join(plan.live, "bin/example.sh"))).mode & 0o7777).toBe(0o755);
    expect((await fs.stat(path.join(plan.live, "a/b/c/data.bin"))).mode & 0o7777).toBe(0o644);
    await resolveRestoreTree(plan, "compensate"); expect(skillSnapshotHash((await readRestoreTree(plan.root, plan.live))!)).toBe(plan.beforeHash);
    await expect(stageRestoreTree(invalid, target)).rejects.toThrow("restore_noncanonical_directory_mode");
    expect((await fs.stat(invalid.live)).mode & 0o7777).toBe(0o700);
    await expect(stageRestoreTree(invalidStage, target)).rejects.toThrow("restore_noncanonical_directory_mode");
    expect((await fs.stat(orphanStage)).mode & 0o7777).toBe(0o700);
    await stageRestoreTree(existingParent, target);
    expect((await fs.stat(namespace)).mode & 0o7777).toBe(0o700);
  } finally { process.umask(previous); }
});
