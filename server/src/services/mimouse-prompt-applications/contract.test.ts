import { afterEach, expect, it, vi } from "vitest";
import { applicationTaskIsNew, assertApplicationAuthEnvironment, assertApplicationProfile } from "./contract.js";
import { approvePromptApplicationSchema, promptApplicationRequestQuerySchema } from "@paperclipai/shared/mimouse-prompt-applications";
const id = "aaaaaaaa-1111-4111-8111-111111111111";
const config = () => ({ engine: "cli", model: "claude-fixture", cwd: "/fixed", env: { ANTHROPIC_API_KEY: { type: "secret_ref", secretId: id, version: 1 } }, dangerouslySkipPermissions: false });
afterEach(() => vi.unstubAllEnvs());
it("accepts the supported profile without changing permissions or source config", () => {
  for (const k of ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_BEDROCK_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"]) vi.stubEnv(k, "");
  const input = config(), before = structuredClone(input); expect(assertApplicationProfile("claude_local", input, {})).toMatchObject({ cwd: "/fixed" }); expect(input).toEqual(before);
});
for (const name of ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_BEDROCK_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"]) {
  it(`rejects conflicting ambient ${name} instead of silently choosing billing identity`, () => expect(() => assertApplicationAuthEnvironment({ [name]: "present" })).toThrow("prompt_application_ambient_auth_or_provider_route_unsupported"));
}
for (const patch of [{ engine: "acp" }, { filesystemScope: "workspace" }, { filesystemSandboxCommand: "/wrapper" }, { networkScope: "none" }, { cwd: "relative" }, { command: "/arbitrary/file" }, { args: ["--resume", "old"] }, { env: { ANTHROPIC_API_KEY: { type: "secret_ref", secretId: id, version: "latest" } } }]) {
  it(`rejects unsupported target ${JSON.stringify(patch)}`, () => expect(() => assertApplicationProfile("claude_local", { ...config(), ...patch }, {})).toThrow());
}
it("excludes old issue, old queued run, retry and any prior task run", () => {
  const baseline = { configuredAt: new Date(200), issueCreatedAt: new Date(201), runCreatedAt: new Date(202), priorRun: false, retryOfRunId: null };
  expect(applicationTaskIsNew(baseline)).toBe(true);
  for (const patch of [{ issueCreatedAt: new Date(200) }, { runCreatedAt: new Date(199) }, { priorRun: true }, { retryOfRunId: id }]) expect(applicationTaskIsNew({ ...baseline, ...patch })).toBe(false);
});
it("requires all four explicit ordinary disclosure and non-equivalence confirmations", () => {
  const input = { requestId: id, expectedGeneration: 0, approvalDigest: "a".repeat(64), confirmOrdinaryVisibility: true, confirmBareComparisonNotToolQuality: true, confirmNewTasksOnly: true, confirmNoAutomaticRun: true };
  expect(approvePromptApplicationSchema.safeParse(input).success).toBe(true);
  for (const key of ["confirmOrdinaryVisibility", "confirmBareComparisonNotToolQuality", "confirmNewTasksOnly", "confirmNoAutomaticRun"]) expect(approvePromptApplicationSchema.safeParse({ ...input, [key]: false }).success).toBe(false);
});
it("request recovery needs a complete fixed action/target/generation tuple", () => {
  expect(promptApplicationRequestQuerySchema.safeParse({}).success).toBe(true);
  expect(promptApplicationRequestQuerySchema.safeParse({ applicationId: id }).success).toBe(false);
  expect(promptApplicationRequestQuerySchema.safeParse({ applicationId: id, action: "approve", expectedGeneration: "2" }).success).toBe(true);
  expect(promptApplicationRequestQuerySchema.safeParse({ applicationId: id, action: "force", expectedGeneration: 2 }).success).toBe(false);
});
