import { createHash } from "node:crypto";
import { isExecutionForcedToKubernetes, isLocalExecutionDenied } from "../execution-allowlist.js";
import { unprocessable } from "../../errors.js";
export const PRIVATE_PROMPT_IMPLEMENTATION = "paperclip.builtin.claude-local.cli.literal.v1" as const;
export const privatePromptTestsEnabled = () => process.env.PAPERCLIP_PRIVATE_PROMPT_TESTS_ENABLED === "true";
export const privatePromptHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
/** Hash canonical JSON, not insertion order. Values never appear in exceptions. */
export function privateConfigDigest(value: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
    return value;
  };
  return privatePromptHash(JSON.stringify(canonical(value)));
}
export function assertPrivatePromptProfile(adapterType: string, raw: unknown) {
  const config = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  // Deliberately reject all overlays, extra CLI args, subscription homes and
  // routing bindings. Nothing is silently removed from an approved profile.
  const allowed = new Set(["engine", "model", "cwd", "env"]);
  const env = config.env && typeof config.env === "object" && !Array.isArray(config.env) ? config.env as Record<string, unknown> : {};
  const binding = env.ANTHROPIC_API_KEY as Record<string, unknown> | undefined;
  if (adapterType !== "claude_local" || config.engine !== "cli" || Object.keys(config).some(key => !allowed.has(key)) ||
      typeof config.model !== "string" || !/^claude-[a-zA-Z0-9.-]+$/.test(config.model) ||
      config.cwd !== undefined && (typeof config.cwd !== "string" || !config.cwd.startsWith("/")) ||
      Object.keys(env).length !== 1 || !binding || binding.type !== "secret_ref" ||
      typeof binding.secretId !== "string" || typeof binding.version !== "number" || !Number.isSafeInteger(binding.version) || binding.version < 1) {
    throw unprocessable("private_prompt_profile_unsupported");
  }
  return { model: config.model, secretId: binding.secretId, secretVersion: binding.version, configDigest: privateConfigDigest(config) };
}
/** Runtime routing is separate from adapterConfig and cannot be silently ignored. */
export function assertPrivatePromptRuntimeConfig(config: Record<string, unknown> | null | undefined, _defaultEnvironmentId?: string | null) {
  if (config && Object.keys(config).some(key => key !== "heartbeat")) {
    throw unprocessable("private_prompt_runtime_overlay_unsupported");
  }
}
export function assertPrivatePromptHarness(issue: {
  companyId: string; visibility: string; assigneeAgentId: string | null; responsibleUserId: string | null;
  originKind: string | null; originId: string | null; workMode: string; harnessKind: string | null;
}, binding: { companyId: string; agentId: string; actorUserId: string; id: string }) {
  if (issue.companyId !== binding.companyId || issue.visibility !== "private" || issue.assigneeAgentId !== binding.agentId ||
      issue.responsibleUserId !== binding.actorUserId || issue.originKind !== "private_prompt_test" || issue.originId !== binding.id ||
      issue.workMode !== "skill_test" || issue.harnessKind !== "skill_test") throw unprocessable("private_prompt_harness_binding_denied");
}

/** Pinned skill files are text context only; executable/binary packages are unsupported. */
export function assertPrivatePromptTextInventory(files: Array<{ path: string; kind: string; content: string; encoding?: string; executable?: boolean }>) {
  if (!Array.isArray(files) || !files.length || files.some(file => !file || typeof file.path !== "string" ||
    !["skill", "markdown", "reference"].includes(file.kind) || typeof file.content !== "string" ||
    (file.encoding !== undefined && file.encoding !== "utf8") || (file.executable !== undefined && file.executable !== false) ||
    Object.keys(file).some(key => !["path", "kind", "content", "encoding", "executable"].includes(key))) || !files.some(file => file.path === "SKILL.md" && file.content.trim().length > 0)) {
    throw unprocessable("private_prompt_text_skill_required");
  }
  return files.map(file => ({ path: file.path, kind: file.kind, content: file.content, encoding: "utf8" as const, executable: false }));
}

export function assertPrivatePromptLocalEnvironment(environment: { id: string; driver: string; status: string; config: unknown; envVars: unknown } | undefined) {
  const emptyObject = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
  if (!environment || environment.driver !== "local" || environment.status !== "active" ||
      !emptyObject(environment.config) || !emptyObject(environment.envVars)) throw unprocessable("private_prompt_environment_unsupported");
  return { id: environment.id, driver: "local", status: "active", config: {}, envVars: {} };
}

export function privatePromptFixedContext(caseInput: string, versionId: string, inventory: unknown, literal: string) {
  const context = ["Private prompt test. Return the answer as text. No tools are available.",
    `Fixed test case:\n${caseInput}`, `Pinned skill version ${versionId}:\n${JSON.stringify(inventory)}`].join("\n\n");
  const actualPrompt = `${context}\n\n<private-prompt-revision>\n${literal}\n</private-prompt-revision>`;
  if (Buffer.byteLength(actualPrompt, "utf8") > 256000) throw unprocessable("private_prompt_text_context_too_large");
  return context;
}

export function privatePromptExecutionPolicy(general: Record<string, unknown> | undefined, experimental: Record<string, unknown> | undefined, bootstrapMode: string | undefined) {
  const executionMode = general?.executionMode ?? "any";
  const bootstrapExecutionMode = bootstrapMode?.trim() || "any";
  const managedSandboxOnly = experimental?.enableManagedSandboxOnly === true;
  if (!["any", "kubernetes"].includes(String(executionMode)) || !["any", "kubernetes"].includes(bootstrapExecutionMode) ||
      isExecutionForcedToKubernetes({ executionMode: executionMode as "any" | "kubernetes" }) ||
      isExecutionForcedToKubernetes({ executionMode: bootstrapExecutionMode as "any" | "kubernetes" }) ||
      isLocalExecutionDenied({ managedSandboxOnly })) throw unprocessable("private_prompt_environment_policy_unsupported");
  return { executionMode, bootstrapExecutionMode, managedSandboxOnly };
}
