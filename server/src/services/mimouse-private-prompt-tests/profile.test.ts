import { expect, it } from "vitest";
import { assertPrivatePromptProfile, privateConfigDigest } from "./profile.js";
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
it("serialized/copied/generic wake options cannot forge server-owned authority", () => {
  const opts = privatePromptWakeOptions({ id: "test", issueId: "issue", actorUserId: "user" } as never);
  expect(privatePromptWakeAuthority(opts)).toBe("test");
  expect(privatePromptWakeAuthority({ ...opts })).toBeNull();
  expect(privatePromptWakeAuthority(JSON.parse(JSON.stringify(opts)))).toBeNull();
});
