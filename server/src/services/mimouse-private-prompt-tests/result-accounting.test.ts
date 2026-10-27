import { expect, it } from "vitest";
import type { AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { privatePromptPublicResult, sealPrivatePromptResult } from "./result.js";
const model = "claude-sonnet-4-5-20250929", secret = "PRIVATE_ACCOUNTING_SENTINEL";
type AccountingFixture = AdapterExecutionResult & { resultJson: { modelUsage: Record<string, unknown> } };
function fixture(): AccountingFixture { return { exitCode: 0, signal: null, timedOut: false, model, costUsd: 0.0125, usageBasis: "per_run" as const,
  usage: { inputTokens: 4, cachedInputTokens: 1, outputTokens: 2 }, usageComplete: true,
  resultJson: { type: "result", subtype: "success", result: secret, modelUsage: { [model]: { inputTokens: 4, outputTokens: 2, cacheReadInputTokens: 1, cacheCreationInputTokens: 0, costUSD: 0.0125 } } } }; }
it("emits reported CLI USD accounting and actual approved identity, without private payload", () => {
  const raw = fixture(), actual = privatePromptPublicResult(raw, sealPrivatePromptResult(raw, true), model);
  expect(actual).toMatchObject({ model, costUsd: 0.0125, usageBasis: "per_run", costStatus: "reported",
    pricingProvenance: { source: "provider_reported", version: "claude-cli/private-prompt/v1" }, usageComplete: true });
  expect(JSON.stringify(actual)).not.toContain(secret);
  expect(actual).not.toHaveProperty("usageByModel");
});
it.each(["absent", "mixed", "foreign", "requested_only"])("retains spend but rejects %s model proof", kind => {
  const raw = fixture();
  if (kind === "absent") raw.resultJson.modelUsage = {};
  if (kind === "mixed") Object.assign(raw.resultJson.modelUsage, { [secret]: {} });
  if (kind === "foreign") raw.resultJson.modelUsage = { [secret]: raw.resultJson.modelUsage[model] };
  if (kind === "requested_only") raw.model = "unknown";
  const actual = privatePromptPublicResult(raw, sealPrivatePromptResult(raw, true), model);
  expect(actual.model).toBe(kind === "mixed" ? "mixed" : "unknown");
  expect(actual.costUsd).toBe(0.0125); expect(actual.usageComplete).toBe(true);
  expect(JSON.stringify(actual)).not.toContain(secret);
});
it("does not forward caller supplied provenance or invent per-run/known cost", () => {
  const raw = { ...fixture(), costUsd: undefined, usageBasis: undefined, pricingProvenance: { source: "provider_invoice" as const, evidence: secret } };
  const actual = privatePromptPublicResult(raw, sealPrivatePromptResult(raw, true), model);
  expect(actual).toMatchObject({ costStatus: "unpriced", pricingProvenance: { source: "unknown", version: "claude-cli/private-prompt/v1" } });
  expect(actual.usageBasis).toBeUndefined(); expect(JSON.stringify(actual)).not.toContain(secret);
});
