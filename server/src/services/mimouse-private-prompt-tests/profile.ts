import { createHash } from "node:crypto";
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
