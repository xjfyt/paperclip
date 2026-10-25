import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { artifactManifest } from "../services/mimouse-coding/artifacts.js";
import { deliveryGate, repairDecision } from "../services/mimouse-coding/gitlab.js";
const exec = promisify(execFile);
describe("coding fixture repository", () => {
  it("records a real failing test, repairs once, and binds manifest/CI/review to the fix commit", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paperclip-coding-fixture-"));
    const git = (args: string[]) => exec("git", args, { cwd });
    await git(["init", "-b", "paperclip/fixture"]); await git(["config", "user.name", "Fixture"]); await git(["config", "user.email", "fixture@example.test"]);
    await writeFile(path.join(cwd, "sum.cjs"), "module.exports=(a,b)=>a-b;\n");
    await writeFile(path.join(cwd, "sum.test.cjs"), "const assert=require('node:assert/strict');assert.equal(require('./sum.cjs')(2,3),5);\n");
    await git(["add", "."]); await git(["commit", "-m", "fixture: reproduce arithmetic defect"]);
    const base = (await git(["rev-parse", "HEAD"])).stdout.trim();
    await expect(exec(process.execPath, ["sum.test.cjs"], { cwd })).rejects.toThrow();
    expect(repairDecision({ attempts: 0, remainingBudgetCents: 1, elapsedMs: 10, maxDurationMs: 1000, fingerprint: "sum", previousFingerprint: null, environmentAvailable: true }).action).toBe("repair");
    await writeFile(path.join(cwd, "sum.cjs"), "module.exports=(a,b)=>a+b;\n");
    const startedAt = new Date().toISOString(); await exec(process.execPath, ["sum.test.cjs"], { cwd }); const finishedAt = new Date().toISOString();
    await git(["add", "sum.cjs"]); await git(["commit", "-m", "fixture: fix arithmetic defect"]); const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
    expect(head).not.toBe(base);
    const manifest = await artifactManifest({ root: cwd, project: "fixture", version: "0.0.1-test", commitSha: head, artifacts: [{ path: "sum.cjs", platform: "linux", arch: "x86_64", buildJob: "local-fixture", testStatus: "passed", signatureStatus: "unsigned" }] });
    expect(manifest.artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/); expect(manifest.uploaded).toBe(false);
    const evidence = [{ commitSha: head, command: "node sum.test.cjs", exitCode: 0, startedAt, finishedAt, logRef: "fixture-local-result", status: "passed" as const }];
    const mockedRemote = { headSha: head, reviewedSha: head, mr: { iid: 1, sha: head, state: "opened" }, pipeline: { id: 1, sha: base, status: "success" }, evidence };
    expect(deliveryGate(mockedRemote).readyForReleaseCandidate).toBe(false);
    expect(deliveryGate({ ...mockedRemote, pipeline: { id: 2, sha: head, status: "success" } }).readyForReleaseCandidate).toBe(true);
    // CI/MR are protocol fixtures, not a real GitLab or a multi-platform build.
  });
  it("rejects artifact symlinks outside the allocated root", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "artifact-fence-"));
    const root = await mkdtemp(path.join(parent, "workspace-"));
    const outside = path.join(parent, "outside.txt"); await writeFile(outside, "fixture"); await symlink(outside, path.join(root, "escape"));
    await expect(artifactManifest({ root, project: "fixture", version: "test", commitSha: "a".repeat(40), artifacts: [{ path: "escape", platform: "linux", arch: "x86_64", buildJob: "test", testStatus: "not_run", signatureStatus: "unknown" }] })).rejects.toThrow("artifact_outside_workspace");
  });
});
