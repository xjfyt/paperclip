import { snapshotFile } from "../skill-snapshot.js";
import path from "node:path";
import { expect, it } from "vitest";
import { privatePromptExecutionPolicy, privatePromptFixedContext, assertPrivatePromptLocalEnvironment, assertPrivatePromptTextInventory, assertPrivatePromptHarness, assertPrivatePromptRuntimeConfig, assertPrivatePromptProfile, privateConfigDigest } from "./profile.js";
import { privatePromptWakeAuthority, privatePromptWakeOptions } from "./wake-authority.js";
const profile = { engine: "cli", model: "claude-sonnet-4-5", env: { ANTHROPIC_API_KEY: { type: "secret_ref", secretId: "id", version: 1 } } };
it("accepts only the explicit fixed-version API-key CLI profile", () => {
  expect(assertPrivatePromptProfile("claude_local", profile).secretVersion).toBe(1);
  for (const patch of [{ extraArgs: [] }, { engine: "acp" }, { command: "custom" }, { chrome: false }, { aiConnection: "router" },
    { env: { ANTHROPIC_API_KEY: "inline" } }, { env: { ANTHROPIC_API_KEY: { type: "secret_ref", secretId: "id", version: "latest" } } },
    { env: { ...profile.env, PAPERCLIP_API_KEY: "secret" } }]) expect(() => assertPrivatePromptProfile("claude_local", { ...profile, ...patch })).toThrow("private_prompt_profile_unsupported");
  expect(() => assertPrivatePromptProfile("process", profile)).toThrow("private_prompt_profile_unsupported");
});
it("canonical config digest is order independent and changes with pinned configuration", () => {
  expect(privateConfigDigest({ b: 2, a: 1 })).toBe(privateConfigDigest({ a: 1, b: 2 }));
  expect(privateConfigDigest(profile)).not.toBe(privateConfigDigest({ ...profile, model: "claude-other" }));
});
it("accepts the host's absolute workspace paths and rejects relative working directories", () => {
  expect(() => assertPrivatePromptProfile("claude_local", { ...profile, cwd: path.resolve("fixture-workspace") })).not.toThrow();
  for (const cwd of ["relative/workspace", "../workspace", "", 42]) {
    expect(() => assertPrivatePromptProfile("claude_local", { ...profile, cwd })).toThrow("private_prompt_profile_unsupported");
  }
});
it("serialized/copied/generic wake options cannot forge server-owned authority", () => {
  const opts = privatePromptWakeOptions({ id: "test", issueId: "issue", actorUserId: "user" } as never);
  expect(privatePromptWakeAuthority(opts)).toBe("test");
  expect(privatePromptWakeAuthority({ ...opts })).toBeNull();
  expect(privatePromptWakeAuthority(JSON.parse(JSON.stringify(opts)))).toBeNull();
});

it("rejects separate runtime router/native/environment overlays without fallback", () => {
  expect(() => assertPrivatePromptRuntimeConfig({ heartbeat: { enabled: true } }, null)).not.toThrow();
  for (const config of [{ aiConnection: { mode: "router" } }, { provider: "native" }, { environment: "remote" }]) {
    expect(() => assertPrivatePromptRuntimeConfig(config, null)).toThrow("private_prompt_runtime_overlay_unsupported");
  }

});
it("requires every binding on newly created and reused private harnesses", () => {
  const binding = { companyId: "company", agentId: "agent", actorUserId: "owner", id: "test" };
  const issue = { companyId: "company", visibility: "private", assigneeAgentId: "agent", responsibleUserId: "owner",
    originKind: "private_prompt_test", originId: "test", workMode: "skill_test", harnessKind: "skill_test" };
  expect(() => assertPrivatePromptHarness(issue, binding)).not.toThrow();
  for (const key of Object.keys(issue)) expect(() => assertPrivatePromptHarness({ ...issue, [key]: "wrong" }, binding)).toThrow("private_prompt_harness_binding_denied");
});

it("supports only pinned text inventory with a nonempty SKILL.md", () => {
  const skill = { path: "SKILL.md", kind: "skill", content: "Fixed instructions", encoding: "utf8" };
  expect(() => assertPrivatePromptTextInventory([skill])).not.toThrow();
  for (const files of [[], [{ ...skill, path: "other.md" }], [{ ...skill, content: " " }],
    [{ ...skill, encoding: "base64" }], [{ ...skill, executable: true }], [{ ...skill, kind: "script" }], [{ ...skill, kind: "asset" }]]) {
    expect(() => assertPrivatePromptTextInventory(files)).toThrow("private_prompt_text_skill_required");
  }
});

it("only accepts an active local environment with truly empty config and env", () => {
  const local = { id: "local", driver: "local", status: "active", config: {}, envVars: {} };
  expect(assertPrivatePromptLocalEnvironment(local).id).toBe("local");
  for (const patch of [{ driver: "ssh" }, { status: "disabled" }, { config: { cwd: "/" } }, { envVars: { SECRET: "x" } }, { config: [] }, { envVars: null }]) {
    expect(() => assertPrivatePromptLocalEnvironment({ ...local, ...patch })).toThrow("private_prompt_environment_unsupported");
  }
});

it("bounds complete literal plus fixed text in UTF-8 bytes without truncation", () => {
  expect(privatePromptFixedContext("case", "version", [], "literal")).toContain("case");
  expect(() => privatePromptFixedContext("界".repeat(86000), "v", [], "x")).toThrow("private_prompt_text_context_too_large");
  expect(() => privatePromptFixedContext("case", "v", [], "x".repeat(256000))).toThrow("private_prompt_text_context_too_large");
});

it("rejects forced remote execution before provider/environment preparation", () => {
  expect(privatePromptExecutionPolicy({}, {}, undefined)).toEqual({ executionMode: "any", bootstrapExecutionMode: "any", managedSandboxOnly: false });
  for (const [general, experimental, mode] of [[{ executionMode: "kubernetes" }, {}, undefined], [{}, { enableManagedSandboxOnly: true }, undefined], [{}, {}, "kubernetes"], [{}, {}, "unknown"]] as const) {
    expect(() => privatePromptExecutionPolicy(general, experimental, mode)).toThrow("private_prompt_environment_policy_unsupported");
  }
});

it("normalizes the existing snapshotFile UTF-8 default and safely rejects malformed history", () => {
  const snapshot = snapshotFile("SKILL.md", "skill", Buffer.from("UTF8默认界", "utf8"));
  expect(snapshot.encoding).toBeUndefined();
  const normalized = assertPrivatePromptTextInventory([snapshot]);
  expect(normalized[0]).toEqual({ ...snapshot, encoding: "utf8", executable: false });
  for (const value of [[null], [{ path: "SKILL.md", kind: "skill" }], [{ ...snapshot, encoding: "unknown" }], null]) {
    expect(() => assertPrivatePromptTextInventory(value as never)).toThrow("private_prompt_text_skill_required");
  }
});
