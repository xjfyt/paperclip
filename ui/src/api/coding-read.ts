import { requestResponse } from "./client";
import { readApiJson } from "./response";

/** Private coding evidence must not join the global URL-only GET pool across
 * authentication epochs. Every observer owns its transport and cancellation. */
export async function readCodingEvidence<T>(path: string, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const response = await requestResponse(path, { method: "GET", cache: "no-store", signal });
  const data = await readApiJson<T>(response);
  signal.throwIfAborted();
  return data;
}
