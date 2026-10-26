import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitLabError } from "./gitlab.js";
const exec = promisify(execFile);
/** Missing promisor objects must fail locally, never trigger implicit transport.
 * Inspection only. Deliberately separate from authorized push environment. */
export async function readonlyCodingGit(cwd: string, maxBuffer = 65536) {
  const options = { cwd: cwd, timeout: 15000, maxBuffer: maxBuffer, env: { PATH: process.env.PATH, HOME: process.env.HOME, SYSTEMROOT: process.env.SYSTEMROOT, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1", GIT_GRAFT_FILE: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" } };
  const disabledFilters: string[] = [];
  const git = async (args: string[], outputLimit = maxBuffer) => (await exec("git", ["--no-pager", "-c", "core.fsmonitor=false", "-c", "color.ui=false", ...disabledFilters, ...args], { ...options, maxBuffer: outputLimit })).stdout;
  // status may refresh the index and invoke clean/process filters. Disable every
  // configured driver without interpreting its command or running a shell.
  try {
    const keys = await git(["config", "--null", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|process|required)$"]);
    for (const key of keys.split("\0").filter(Boolean)) disabledFilters.push("-c", `${key}=${key.endsWith(".required") ? "false" : ""}`);
  } catch (error) { if ((error as { code?: number }).code !== 1) throw error; }
  return async (args: string[]) => {
    if (args[0] === "status") {
      // status can recurse into submodules, each with independent local filters.
      // Do not silently ignore their dirtiness or execute their configuration.
      const entries = await git(["ls-files", "--stage", "-z"], 8 * 1024 * 1024);
      if (entries.split("\0").some(entry => entry.startsWith("160000 "))) throw new GitLabError("submodule_workspace_requires_external_review");
    }
    return git(args);
  };
}
export interface CodingWorkspace { cwd: string; repoUrl: string; branchName: string }
export async function verifyLocalCodingHead(workspace: CodingWorkspace, baseSha: string, headSha: string) {
  if (!/^[a-f0-9]{40}$/.test(headSha) || !/^[a-f0-9]{40}$/.test(baseSha)) throw new GitLabError("invalid_commit_sha");
  const git = await readonlyCodingGit(workspace.cwd);
  const [head, branch, status] = await Promise.all([git(["rev-parse", "HEAD"]), git(["branch", "--show-current"]), git(["status", "--porcelain"])]);
  if (head.trim() !== headSha || branch.trim() !== workspace.branchName) throw new GitLabError("workspace_head_changed");
  if (status.trim()) throw new GitLabError("workspace_not_clean");
  await git(["check-ref-format", "--branch", workspace.branchName]);
  for (const sha of [baseSha, headSha]) if ((await git(["rev-parse", `${sha}^{commit}`])).trim() !== sha) throw new GitLabError("commit_identity_mismatch");
  await git(["merge-base", "--is-ancestor", baseSha, headSha]);
}
