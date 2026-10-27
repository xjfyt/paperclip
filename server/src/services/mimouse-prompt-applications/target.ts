import { promptApplicationWorkspaceIdentity } from "./workspace.js";
import { assertApplicationProfile } from "./contract.js";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { agents, authUsers, companies, companyMemberships, companySecrets, companySecretVersions, environments, instanceSettings, principalPermissionGrants } from "@paperclipai/db";
import { resolveCommandForLogs } from "@paperclipai/adapter-utils/server-utils";
import { PROMPT_APPLICATION_SLOT, type PromptApplicationSnapshot } from "@paperclipai/shared/mimouse-prompt-applications";
import { getServerAdapter, privatePromptTestImplementation } from "../../adapters/registry.js";
import { conflict, forbidden, unprocessable } from "../../errors.js";
import { privateConfigDigest, privatePromptExecutionPolicy } from "../mimouse-private-prompt-tests/profile.js";
import { deriveBundleState, resolveManagedInstructionsRoot } from "../agent-instructions.js";
import { authorizationService } from "../authorization.js";
import { authorizeInstructionRead } from "../agent-instruction-authorization.js";
import { assertInstructionPathSafe } from "../agent-instruction-files.js";
import { inspectAgentFile } from "../agent-file-store.js";
import type { PrivatePromptTx } from "../mimouse-private-prompt-tests/service.js";
export const applicationDigest = privateConfigDigest;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export async function assertApplicationPrincipal(tx: PrivatePromptTx, companyId: string, userId: string, lock = true) {
  const memberQuery = tx.select({ id: companyMemberships.id }).from(companyMemberships).innerJoin(authUsers, eq(authUsers.id, companyMemberships.principalId)).where(and(
    eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, userId),
    eq(companyMemberships.status, "active"), inArray(companyMemberships.membershipRole, ["owner", "admin"])));
  const [member] = await (lock ? memberQuery.for("share") : memberQuery);
  const companyQuery = tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId));
  const [company] = await (lock ? companyQuery.for("share") : companyQuery);
  if (!member || company?.status !== "active") throw forbidden("prompt_application_approver_revoked");
}
export async function assertApplicationConfigurationAuthority(tx: PrivatePromptTx, companyId: string, agentId: string, userId: string) {
  // Pin the rows the existing authority evaluator reads; grant deletion cannot
  // commit between this decision and the transaction's admission receipt.
  await tx.select({ id: principalPermissionGrants.id }).from(principalPermissionGrants).where(and(
    eq(principalPermissionGrants.companyId, companyId), eq(principalPermissionGrants.principalType, "user"), eq(principalPermissionGrants.principalId, userId))).for("share");
  const decision = await authorizationService(tx).decide({ actor: { type: "board", source: "session", userId },
    action: "agent_config:update", resource: { type: "agent", companyId, agentId } });
  if (!decision.allowed) throw forbidden("prompt_application_agent_configuration_denied");
}
export { assertApplicationProfile, assertApplicationAuthEnvironment } from "./contract.js";
async function fileHash(filename: string) {
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.size > 256 * 1024 * 1024) throw unprocessable("prompt_application_file_unverifiable");
  const hash = createHash("sha256");
  for await (const data of createReadStream(filename)) hash.update(data);
  return hash.digest("hex");
}
/** Hash installed code bytes, not a self-declared adapter name/version. No process is executed. */
export async function promptApplicationImplementationDigest() {
  const roots = [path.dirname(fileURLToPath(import.meta.resolve("@paperclipai/adapter-claude-local/server"))),
    path.dirname(fileURLToPath(import.meta.resolve("@paperclipai/adapter-utils/server-utils")))];
  const entries: Array<[string, string]> = [];
  let count = 0, bytes = 0;
  for (const [index, root] of roots.entries()) {
    const walk = async (directory: string, depth = 0) => {
      if (depth > 16) throw unprocessable("prompt_application_implementation_unverifiable");
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const filename = path.join(directory, entry.name);
        if (++count > 4000 || entry.isSymbolicLink()) throw unprocessable("prompt_application_implementation_unverifiable");
        if (entry.isDirectory()) await walk(filename, depth + 1);
        else if (entry.isFile() && /\.(?:js|ts)$/.test(entry.name) && !/\.(?:test|d)\.ts$/.test(entry.name)) {
          bytes += (await lstat(filename)).size;
          if (bytes > 32 * 1024 * 1024) throw unprocessable("prompt_application_implementation_unverifiable");
          entries.push([`${index}/${path.relative(root, filename)}`, await fileHash(filename)]);
        }
      }
    };
    await walk(root);
  }
  // Changes to the server contract invalidate approval as well as adapter code.
  const extension = path.extname(fileURLToPath(import.meta.url));
  for (const contract of ["target", "service", "execution", "recovery", "contract", "workspace", "../heartbeat/run-completion", "../heartbeat/run-lifecycle", "../heartbeat/workspaces", "../recovery/service", "../heartbeat", "../heartbeat/runtime-execution", "../../adapters/registry", "../../routes/mimouse-prompt-applications",
    "../heartbeat/queue", "../issues", "../mimouse-cost-routing/service", "../mimouse-cost-routing/store", "../mimouse-cost-routing/clock",
    "../mimouse-cost-routing/selection", "../mimouse-cost-routing/candidates", "../mimouse-cost-routing/execution", "../mimouse-cost-routing/contract",
    "../mimouse-cost-routing/evidence", "../mimouse-cost-routing/evidence-service", "../mimouse-cost-routing/wake-authority", "../mimouse-cost-routing/recovery",
    "../mimouse-private-prompt-tests/service", "../mimouse-private-prompt-tests/compare", "../mimouse-private-prompt-tests/profile",
    "../cost-routing-preview/proof", "../../routes/mimouse-cost-routing"]) {
    entries.push([`server/${contract}`, await fileHash(fileURLToPath(new URL(`${contract}${extension}`, import.meta.url)))]);
  }
  return applicationDigest(entries);
}
async function instructionsDigest(tx: PrivatePromptTx, agent: typeof agents.$inferSelect, userId: string) {
  await authorizeInstructionRead(tx, { type: "board", userId, source: "session" }, agent);
  const state = deriveBundleState(agent);
  if (!state.rootPath) return null;
  const root = resolveManagedInstructionsRoot(agent);
  if (path.resolve(state.rootPath) !== root || await realpath(root) !== root) throw unprocessable("prompt_application_managed_instructions_required");
  const inventory: Array<[string, string]> = []; let count = 0, bytes = 0;
  const walk = async (directory: string, depth = 0) => {
    if (depth > 16) throw unprocessable("prompt_application_instructions_unverifiable");
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++count > 2000 || entry.isSymbolicLink()) throw unprocessable("prompt_application_instructions_unverifiable");
      const candidate = path.join(directory, entry.name), relative = path.relative(root, candidate);
      await assertInstructionPathSafe(root, relative);
      if (entry.isDirectory()) await walk(candidate, depth + 1);
      else if (entry.isFile()) {
        bytes += (await lstat(candidate)).size;
        if (bytes > 8 * 1024 * 1024) throw unprocessable("prompt_application_instructions_unverifiable");
        const file = await inspectAgentFile(root, relative, 0);
        if (!file) throw unprocessable("prompt_application_instructions_unverifiable");
        inventory.push([relative, file.hash]);
      }
    }
  };
  await walk(root); return applicationDigest(inventory);
}
export async function resolvePromptApplicationTarget(tx: PrivatePromptTx, companyId: string, agentId: string, actorUserId: string): Promise<PromptApplicationSnapshot> {
  const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).for("share");
  if (!agent || !["active", "idle", "running"].includes(agent.status)) throw unprocessable("prompt_application_agent_unavailable");
  await assertApplicationConfigurationAuthority(tx, companyId, agentId, actorUserId);
  const profile = assertApplicationProfile(agent.adapterType, agent.adapterConfig, agent.runtimeConfig);
  if (!privatePromptTestImplementation(getServerAdapter(agent.adapterType))) throw unprocessable("prompt_application_builtin_adapter_required");
  const [settings] = await tx.select().from(instanceSettings).where(eq(instanceSettings.singletonKey, "default")).for("share");
  const executionPolicy = privatePromptExecutionPolicy(settings?.general, settings?.experimental, process.env.PAPERCLIP_EXECUTION_MODE);
  const requestedId = agent.defaultEnvironmentId ?? settings?.defaultEnvironmentId;
  const [environment] = await tx.select().from(environments).where(requestedId ? eq(environments.id, requestedId) : eq(environments.driver, "local")).for("share");
  if (!environment || environment.driver !== "local" || environment.status !== "active" || Object.keys(environment.config).length || Object.keys(environment.envVars).length) {
    throw unprocessable("prompt_application_local_environment_required");
  }
  const credentials: Array<{ secretId: string; version: number }> = [], secretDigests: Array<{ key: string; hash: string }> = [];
  for (const [key, value] of Object.entries(profile.env)) {
    if (typeof value === "string") continue;
    const ref = object(value);
    if (ref.type !== "secret_ref" || typeof ref.secretId !== "string" || !Number.isSafeInteger(ref.version) || Number(ref.version) < 1) throw unprocessable("prompt_application_pinned_secret_required");
    const [secret] = await tx.select({ hash: companySecretVersions.valueSha256 }).from(companySecrets).innerJoin(companySecretVersions, eq(companySecretVersions.secretId, companySecrets.id)).where(and(
      eq(companySecrets.companyId, companyId), eq(companySecrets.id, ref.secretId), eq(companySecrets.provider, "local_encrypted"), eq(companySecrets.scope, "company"),
      isNull(companySecrets.deletedAt), eq(companySecretVersions.version, Number(ref.version)), isNull(companySecretVersions.revokedAt))).for("share");
    if (!secret) throw unprocessable("prompt_application_pinned_secret_unavailable");
    credentials.push({ secretId: ref.secretId, version: Number(ref.version) }); secretDigests.push({ key, hash: secret.hash });
  }
  const literalEnv = Object.fromEntries(Object.entries(profile.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const command = await resolveCommandForLogs(typeof agent.adapterConfig.command === "string" ? agent.adapterConfig.command : "claude", profile.cwd, {
    ...process.env, ...literalEnv,
  });
  if (!path.isAbsolute(command)) throw unprocessable("prompt_application_cli_binary_unavailable");
  const implementationDigest = await promptApplicationImplementationDigest();
  const targetDigest = applicationDigest({ agentId, adapterType: agent.adapterType, adapterConfig: agent.adapterConfig,
    runtimeConfig: agent.runtimeConfig, permissions: agent.permissions, defaultEnvironmentId: agent.defaultEnvironmentId,
    workspaceIdentity: await promptApplicationWorkspaceIdentity(agent.id, profile.cwd),
    environment, executionPolicy, general: settings?.general, experimental: settings?.experimental,
    secretDigests, hostEnvironment: process.env, commandHash: await fileHash(await realpath(command)),
    instructionsHash: await instructionsDigest(tx, agent, actorUserId), implementationDigest });
  return { schemaVersion: 1, adapterType: "claude_local", engine: "cli", slot: PROMPT_APPLICATION_SLOT, model: profile.model,
    environmentId: environment.id, targetDigest, implementationDigest, credentials, workspacePolicy: "configured_cwd_with_managed_agent_home_v1",
    scope: "new_projectless_tasks_first_fresh_dispatch", completeContextCaptured: false, ordinaryToolsQualityProven: false };
}
export function assertApplicationTarget(expected: PromptApplicationSnapshot, actual: PromptApplicationSnapshot) {
  if (applicationDigest(expected) !== applicationDigest(actual)) throw conflict("prompt_application_target_drift");
}
