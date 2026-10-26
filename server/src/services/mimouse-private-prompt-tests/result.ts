import type { AdapterExecutionResult } from "@paperclipai/adapter-utils";
export const PRIVATE_PROMPT_RESULT_LIMITS = Object.freeze({ maxBytes: 128_000, maxDepth: 16, maxNodes: 4096 });
type PrivateResult = { summary: string | null; resultJson: Record<string, unknown> | null };
/** No truncation: an over-limit result is not an alleged complete result. */
function bounded(value: unknown, depth = 0, budget = { nodes: 0 }, seen = new Set<object>()): boolean {
  if (++budget.nodes > PRIVATE_PROMPT_RESULT_LIMITS.maxNodes || depth > PRIVATE_PROMPT_RESULT_LIMITS.maxDepth) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false;
  seen.add(value);
  const children = Array.isArray(value) ? value : Object.values(value);
  const accepted = children.every(child => bounded(child, depth + 1, budget, seen));
  seen.delete(value);
  return accepted;
}
export function sealPrivatePromptResult(result: AdapterExecutionResult, durableSpawned: boolean): {
  status: "completed" | "failed" | "unknown";
  errorCode: string | null;
  privateResult: PrivateResult | null;
  publicResult: AdapterExecutionResult;
} {
  // Deliberately construct rather than spread: result can contain arbitrary output
  // in errors, errorMeta, login URLs, session params, model names and nested fields.
  const publicResult: AdapterExecutionResult = {
    exitCode: typeof result.exitCode === "number" && Number.isSafeInteger(result.exitCode) ? result.exitCode : 1,
    signal: null, timedOut: result.timedOut === true,
    summary: "Private prompt test: output is available only through its private result API.",
    resultJson: { privatePromptTest: true }, clearSession: true,
  };
  const finish = (status: "completed" | "failed" | "unknown", errorCode: string | null, privateResult: PrivateResult | null = null) => ({
    status, errorCode, privateResult,
    publicResult: { ...publicResult, ...(errorCode ? { errorCode, errorMessage: errorCode } : {}) },
  });
  if (!durableSpawned || result.errorCode === "private_prompt_spawn_unconfirmed") return finish("unknown", "private_prompt_spawn_unconfirmed");
  if (result.timedOut || result.signal) return finish("unknown", "private_prompt_execution_interrupted");
  if (result.exitCode !== 0 || result.errorCode || result.errorMessage) return finish("failed", "private_prompt_adapter_failed");
  const json = result.resultJson;
  if (!json || json.type !== "result" || json.subtype !== "success" || json.is_error === true ||
      !(typeof json.result === "string" && json.result.length > 0 ||
        json.structured_output !== null && typeof json.structured_output === "object")) {
    return finish("failed", "private_prompt_no_usable_result");
  }
  try {
    const privateResult: PrivateResult = { summary: typeof result.summary === "string" ? result.summary : null, resultJson: json };
    if (!bounded(privateResult) || Buffer.byteLength(JSON.stringify(privateResult), "utf8") > PRIVATE_PROMPT_RESULT_LIMITS.maxBytes) {
      return finish("failed", "private_prompt_result_limit_exceeded");
    }
    return finish("completed", null, privateResult);
  } catch {
    return finish("failed", "private_prompt_result_invalid");
  }
}
