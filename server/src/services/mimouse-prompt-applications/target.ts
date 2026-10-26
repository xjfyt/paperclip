import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { agents, authUsers, companies, companyMemberships, companySecrets, companySecretVersions, environments, instanceSettings } from "@paperclipai/db";
import { resolveCommandForLogs } from "@paperclipai/adapter-utils/server-utils";
import { PROMPT_APPLICATION_SLOT, type PromptApplicationSnapshot } from "@paperclipai/shared/mimouse-prompt-applications";
import { getServerAdapter, privatePromptTestImplementation } from "../../adapters/registry.js";
import { conflict, forbidden, unprocessable } from "../../errors.js";
import { privateConfigDigest, privatePromptExecutionPolicy } from "../mimouse-private-prompt-tests/profile.js";
import type { PrivatePromptTx } from "../mimouse-private-prompt-tests/service.js";
export const applicationDigest = privateConfigDigest;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export async function assertApplicationPrincipal(tx: PrivatePromptTx, companyId: string, userId: string) {
  const [member] = await tx.select({ id: companyMemberships.id }).from(companyMemberships).innerJoin(authUsers, eq(authUsers.id, companyMemberships.principalId)).where(and(
    eq(companyMemberships.companyId, companyId), eq(companyMemberships.principalType, "user"), eq(companyMemberships.principalId, userId),
    eq(companyMemberships.status, "active"), inArray(companyMemberships.membershipRole, ["owner", "admin"]))).for("share");
  const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).for("share");
  if (!member || company?.status !== "active") throw forbidden("prompt_application_approver_revoked");
}
export function assertApplicationProfile(adapterType: string, config: Record<string, unknown>, runtime: Record<string, unknown>) {
  const env = object(config.env), key = object(env.ANTHROPIC_API_KEY);
  if (adapterType !== "claude_local" || config.engine !== "cli" || typeof config.model !== "string" || !config.model.trim() ||
    typeof config.cwd !== "string" || !path.isAbsolute(config.cwd) ||
    key.type !== "secret_ref" || typeof key.secretId !== "string" || !Number.isSafeInteger(key.version) || Number(key.version) < 1 ||
    Object.keys(runtime).some(k => k !== "heartbeat") ||
    ["extraArgs", "args", "agentCommand", "remoteExecution", "aiConnection", "aiRouter", "aiBinding"].some(k => config[k] != null) ||
    Object.keys(env).some(k => /^(ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_USE_|AWS_|GOOGLE_|VERTEX_)/.test(k))) {
    throw unprocessable("prompt_application_profile_requires_local_cli_pinned_api_key_and_cwd");
  }
  return { env, cwd: config.cwd, model: config.model };
}
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
  for (const [index, root] of roots.entries()) {
    const walk = async (directory: string) => {
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(filename);
        else if (entry.isFile() && /\.(?:js|ts)$/.test(entry.name) && !/\.(?:test|d)\.ts$/.test(entry.name)) {
          if (entries.length > 1500) throw unprocessable("prompt_application_implementation_unverifiable");
          entries.push([`${index}/${path.relative(root, filename)}`, await fileHash(filename)]);
        }
      }
    };
    await walk(root);
  }
  // Changes to the server contract invalidate approval as well as adapter code.
  entries.push(["server", await fileHash(fileURLToPath(import.meta.url))]);
  return applicationDigest(entries);
}
async function instructionsDigest(config: Record<string, unknown>) {
  const filename = typeof config.instructionsFilePath === "string" ? config.instructionsFilePath : null;
  const root = typeof config.instructionsRootPath === "string" ? config.instructionsRootPath : filename ? path.dirname(filename) : null;
  if (!root) return null;
  if (!path.isAbsolute(root)) throw unprocessable("prompt_application_instructions_unverifiable");
  const canonicalRoot = await realpath(root), inventory: Array<[string, string]> = [];
  const walk = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".git") continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw unprocessable("prompt_application_instruction_symlink_unsupported");
      if (entry.isDirectory()) await walk(candidate);
      else if (entry.isFile()) {
        if (inventory.length > 2000) throw unprocessable("prompt_application_instructions_unverifiable");
        inventory.push([path.relative(canonicalRoot, candidate), await fileHash(candidate)]);
      }
    }
  };
  // A standalone file does not authorize recursively reading its parent.
  if (config.instructionsRootPath) await walk(canonicalRoot);
  else if (filename) inventory.push([path.basename(filename), await fileHash(await realpath(filename))]);
  return applicationDigest(inventory);
}
export async function resolvePromptApplicationTarget(tx: PrivatePromptTx, companyId: string, agentId: string): Promise<PromptApplicationSnapshot> {
  const [agent] = await tx.select().from(agents).where(and(eq(agents.companyId, companyId), eq(agents.id, agentId))).for("share");
  if (!agent || !["active", "idle", "running"].includes(agent.status)) throw unprocessable("prompt_application_agent_unavailable");
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
  const command = await resolveCommandForLogs(typeof agent.adapterConfig.command === "string" ? agent.adapterConfig.command : "claude", profile.cwd, {
    ...process.env, ...Object.fromEntries(Object.entries(profile.env).filter(([, v]) => typeof v === "string")),
  });
  if (!path.isAbsolute(command)) throw unprocessable("prompt_application_cli_binary_unavailable");
  const implementationDigest = await promptApplicationImplementationDigest();
  const targetDigest = applicationDigest({ agentId, adapterType: agent.adapterType, adapterConfig: agent.adapterConfig,
    runtimeConfig: agent.runtimeConfig, permissions: agent.permissions, defaultEnvironmentId: agent.defaultEnvironmentId,
    environment, executionPolicy, general: settings?.general, experimental: settings?.experimental,
    secretDigests, hostEnvironment: process.env, commandHash: await fileHash(await realpath(command)),
    instructionsHash: await instructionsDigest(agent.adapterConfig), implementationDigest });
  return { schemaVersion: 1, adapterType: "claude_local", engine: "cli", slot: PROMPT_APPLICATION_SLOT, model: profile.model,
    environmentId: environment.id, targetDigest, implementationDigest, credentials,
    scope: "new_projectless_tasks_first_fresh_dispatch", completeContextCaptured: false, ordinaryToolsQualityProven: false };
}
export function assertApplicationTarget(expected: PromptApplicationSnapshot, actual: PromptApplicationSnapshot) {
  if (applicationDigest(expected) !== applicationDigest(actual)) throw conflict("prompt_application_target_drift");
}
