import { requestResponse } from "./client";
import { readApiJson } from "./response";

/** Private reads must not share api.get's URL-only inflight cache across sessions. */
export async function privateFeedbackGet<T>(path: string, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const response = await requestResponse(path, { method: "GET", signal, cache: "no-store" });
  const value = await readApiJson<T>(response);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  return value;
}
