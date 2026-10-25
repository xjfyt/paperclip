export function parseEvent(line) {
  let event;
  try { event = JSON.parse(line); } catch { return null; }
  return event && typeof event === "object" && !Array.isArray(event) ? event : null;
}
export function resultAccounting(event) {
  const value = event?.usage;
  const valid = n => Number.isFinite(n) && n >= 0;
  const usage = value && valid(value.input_tokens) && valid(value.output_tokens)
    ? { inputTokens: value.input_tokens, outputTokens: value.output_tokens,
      ...(valid(value.cache_read_input_tokens) ? { cachedInputTokens: value.cache_read_input_tokens } : {}) } : undefined;
  return {
    ...(usage ? { tokenUsage: usage } : {}),
    costStatus: "unpriced", billingType: "credits", costUsd: null,
    ...(valid(event?.total_credits) ? { creditsCumulative: event.total_credits } : {}),
  };
}
