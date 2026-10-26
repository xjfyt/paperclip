import { expect, it } from "vitest";
import { privatePromptPublicResult, sealPrivatePromptResult } from "./result.js";
const secret = "private literal {{exact}}";
const result = { exitCode: 0, signal: null, timedOut: false, resultJson: { type: "result", subtype: "success", result: secret }, summary: secret };
it("keeps bounded completed output private and never spreads arbitrary fields", () => {
  const sealed = sealPrivatePromptResult({ ...result, sessionId: secret, sessionParams: { secret }, loginUrl: secret, model: secret } as never, true);
  expect(sealed.status).toBe("completed");
  expect(sealed.privateResult?.summary).toBe(secret);
  expect(JSON.stringify(sealed.publicResult)).not.toContain(secret);
  expect(sealed.publicResult.clearSession).toBe(true);
});
it("distinguishes zero exit without a useful result, unconfirmed spawn, and interrupted work", () => {
  expect(sealPrivatePromptResult({ ...result, resultJson: {} }, true).errorCode).toBe("private_prompt_no_usable_result");
  expect(sealPrivatePromptResult(result, false).status).toBe("unknown");
  expect(sealPrivatePromptResult({ ...result, timedOut: true }, true).status).toBe("unknown");
});
it("never copies raw provider error or cause into any result", () => {
  const sealed = sealPrivatePromptResult({ ...result, exitCode: 1, errorMessage: secret, errorMeta: { cause: secret } }, true);
  expect(sealed.privateResult).toBeNull();
  expect(JSON.stringify(sealed)).not.toContain(secret);
});
it.each(["bytes", "depth", "nodes", "cycle"])("rejects %s overflow without truncating to completed", kind => {
  let extra: unknown = secret;
  if (kind === "bytes") extra = "a".repeat(128001);
  if (kind === "depth") for (let i = 0; i < 17; i++) extra = { nested: extra };
  if (kind === "nodes") extra = Array(4100).fill(0);
  if (kind === "cycle") { const object: Record<string, unknown> = {}; object.self = object; extra = object; }
  const sealed = sealPrivatePromptResult({ ...result, resultJson: { ...result.resultJson, extra } }, true);
  expect(sealed.status).toBe("failed"); expect(sealed.privateResult).toBeNull();
  expect(sealed.errorCode).toBe("private_prompt_result_limit_exceeded");
});

it("reconstructs the full public accounting boundary without arbitrary usage fields", () => {
  const dirty = { ...result, costUsd: 0.01, usageComplete: true, usage: { inputTokens: 2, outputTokens: 3,
    cachedInputTokens: 1, cacheWriteTokens: -1, marker: secret, nested: { body: secret } } };
  const output = privatePromptPublicResult(dirty, sealPrivatePromptResult(dirty, true), "claude-fixed");
  expect(output.usage).toEqual({ inputTokens: 2, outputTokens: 3, cachedInputTokens: 1 });
  expect(JSON.stringify(output)).not.toContain(secret);
  const bad = { ...dirty, costUsd: Infinity, usage: { inputTokens: NaN, outputTokens: 2 } };
  const rejected = privatePromptPublicResult(bad, sealPrivatePromptResult(bad, true), "claude-fixed");
  expect(rejected.usage).toBeUndefined(); expect(rejected.costUsd).toBeUndefined(); expect(rejected.usageComplete).toBe(false);
});
