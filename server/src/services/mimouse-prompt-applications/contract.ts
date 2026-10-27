import path from "node:path";
import { HttpError, unprocessable } from "../../errors.js";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function assertApplicationProfile(adapterType: string, config: Record<string, unknown>, runtime: Record<string, unknown>) {
  const env = object(config.env), key = object(env.ANTHROPIC_API_KEY);
  assertApplicationAuthEnvironment({ ...process.env, ...env });
  if (adapterType !== "claude_local" || config.engine !== "cli" || typeof config.model !== "string" || !config.model.trim() ||
    typeof config.cwd !== "string" || !path.isAbsolute(config.cwd) ||
    key.type !== "secret_ref" || typeof key.secretId !== "string" || !Number.isSafeInteger(key.version) || Number(key.version) < 1 ||
    (config.command != null && config.command !== "claude") ||
    Object.keys(env).some(k => ["PATH", "HOME", "NODE_OPTIONS", "BASH_ENV", "ENV"].includes(k)) ||
    Object.keys(runtime).some(k => k !== "heartbeat") ||
    ["extraArgs", "args", "agentCommand", "remoteExecution", "aiConnection", "aiRouter", "aiBinding", "filesystemScope", "networkScope", "filesystemSandboxCommand", "filesystemExtraPaths", "networkAllowlist"].some(k => config[k] != null) ||
    Object.keys(env).some(k => /^(ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_USE_|AWS_|GOOGLE_|VERTEX_)/.test(k))) {
    throw unprocessable("prompt_application_profile_requires_local_cli_pinned_api_key_and_cwd");
  }
  return { env, cwd: config.cwd, model: config.model };
}
export function assertApplicationAuthEnvironment(env: Record<string, unknown>) {
  if (Object.entries(env).some(([key, value]) => value != null && value !== "" &&
    /^(ANTHROPIC_AUTH_TOKEN$|ANTHROPIC_BASE_URL$|ANTHROPIC_BEDROCK_BASE_URL$|CLAUDE_CODE_USE_|CLAUDE_CODE_OAUTH_TOKEN$)/.test(key))) {
    throw unprocessable("prompt_application_ambient_auth_or_provider_route_unsupported");
  }
}
/** Earlier/existing tasks keep their previous behavior; a new task cannot inherit a late binding. */
export function applicationTaskIsNew(input: { configuredAt: Date; issueCreatedAt: Date; runCreatedAt: Date; priorRun: boolean; retryOfRunId: string | null }) {
  return input.issueCreatedAt > input.configuredAt && input.runCreatedAt > input.configuredAt && !input.priorRun && !input.retryOfRunId;
}

/** Typed server admission error; arbitrary adapter diagnostic text is not authority. */
export class PromptApplicationExecutionBlocked extends HttpError {
  constructor(reason: string) { super(422, reason, { code: "prompt_application_blocked" }); }
}
export const applicationExecutionConflict = (reason: string) => new PromptApplicationExecutionBlocked(reason);
