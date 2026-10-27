import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { conflict } from "../../errors.js";
import { resolveDefaultAgentWorkspaceDir, resolvePaperclipInstanceRoot } from "../../home-paths.js";
import type { RealizedExecutionWorkspace } from "../workspace-runtime.js";

async function canonicalDirectory(directory: string) {
  const resolved = path.resolve(directory), stat = await lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(resolved) !== resolved) throw conflict("prompt_application_workspace_path_unverifiable");
  return resolved;
}
/** The existing Claude adapter gives config.cwd precedence over agent_home metadata.
 * This binds that policy, not a new filesystem-isolation guarantee. */
export async function promptApplicationWorkspaceIdentity(agentId: string, configuredCwd: string) {
  return { policy: "configured_cwd_with_managed_agent_home_v1", configuredCwd: await canonicalDirectory(configuredCwd),
    instanceRoot: await canonicalDirectory(resolvePaperclipInstanceRoot()), managedAgentHome: resolveDefaultAgentWorkspaceDir(agentId) };
}
export async function assertPromptApplicationWorkspace(agentId: string, configuredCwd: string, workspace: RealizedExecutionWorkspace, effectiveCwd?: string) {
  const identity = await promptApplicationWorkspaceIdentity(agentId, configuredCwd);
  if (workspace.source !== "agent_home" || workspace.strategy !== "project_primary" ||
    workspace.cwd !== identity.managedAgentHome || workspace.baseCwd !== identity.managedAgentHome ||
    workspace.projectId || workspace.workspaceId || workspace.repoUrl || workspace.repoRef || workspace.branchName || workspace.worktreePath ||
    workspace.additionalWorkspaces?.length || workspace.pendingForwardBranchReconcile || workspace.created || workspace.branchCreatedByRuntime) {
    throw conflict("prompt_application_effective_workspace_drift");
  }
  // Verify every server-owned descendant rather than trusting context paths.
  await canonicalDirectory(path.join(identity.instanceRoot, "workspaces"));
  await canonicalDirectory(identity.managedAgentHome);
  if (effectiveCwd !== undefined && await canonicalDirectory(effectiveCwd) !== identity.configuredCwd) throw conflict("prompt_application_effective_cwd_drift");
  return { ...identity, effectiveCwd: identity.configuredCwd, workspace };
}
