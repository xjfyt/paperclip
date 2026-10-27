import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveDefaultAgentWorkspaceDir, resolvePaperclipInstanceRoot } from "../../home-paths.js";
import { assertPromptApplicationWorkspace, promptApplicationWorkspaceIdentity } from "./workspace.js";
import type { RealizedExecutionWorkspace } from "../workspace-runtime.js";
let home: string, cwd: string;
const agentId = "aaaaaaaa-1111-4111-8111-111111111111";
const workspace = (): RealizedExecutionWorkspace => ({ source: "agent_home", strategy: "project_primary", cwd: resolveDefaultAgentWorkspaceDir(agentId),
  baseCwd: resolveDefaultAgentWorkspaceDir(agentId), projectId: null, workspaceId: null, repoUrl: null, repoRef: null, branchName: null,
  worktreePath: null, warnings: [], created: false, branchCreatedByRuntime: false });
beforeEach(async () => { home = await mkdtemp(path.join(tmpdir(), "prompt-workspace-fixture-")); vi.stubEnv("PAPERCLIP_HOME", home);
  cwd = path.join(home, "configured"); await mkdir(cwd); await mkdir(resolveDefaultAgentWorkspaceDir(agentId), { recursive: true }); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }); });
it("distinguishes controlled metadata cwd from the adapter's configured effective cwd", async () => {
  const proof = await assertPromptApplicationWorkspace(agentId, cwd, workspace(), cwd);
  expect(proof.effectiveCwd).toBe(cwd); expect(proof.workspace.cwd).not.toBe(cwd);
  expect(proof).toMatchObject({ policy: "configured_cwd_with_managed_agent_home_v1", instanceRoot: resolvePaperclipInstanceRoot() });
});
it("rejects alternate actual cwd instead of silently changing fixed directory selection", async () => {
  await expect(assertPromptApplicationWorkspace(agentId, cwd, workspace(), workspace().cwd)).rejects.toThrow("prompt_application_effective_cwd_drift");
});
for (const patch of [{ source: "task_session" }, { cwd: "/unapproved" }, { projectId: "project" }, { repoUrl: "repository" }, { worktreePath: "/worktree" }, { additionalWorkspaces: [{ cwd: "/extra" }] }]) {
  it(`rejects unapproved workspace metadata ${JSON.stringify(patch)}`, async () => {
    await expect(assertPromptApplicationWorkspace(agentId, cwd, { ...workspace(), ...patch } as RealizedExecutionWorkspace)).rejects.toThrow("prompt_application_effective_workspace_drift");
  });
}
it("rejects a symlink inside the server-controlled workspace root", async () => {
  const managed = resolveDefaultAgentWorkspaceDir(agentId); await rm(managed, { recursive: true }); await symlink(cwd, managed);
  await expect(assertPromptApplicationWorkspace(agentId, cwd, workspace())).rejects.toThrow("prompt_application_workspace_path_unverifiable");
});
it("does not bless a configured symlink as a fixed canonical directory", async () => {
  const link = path.join(home, "link"); await symlink(cwd, link);
  await expect(promptApplicationWorkspaceIdentity(agentId, link)).rejects.toThrow("prompt_application_workspace_path_unverifiable");
});
