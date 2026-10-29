import { requestResponse } from "./client";
import { readApiJson } from "./response";
/** Private reads never join the generic URL-only in-flight GET map. */
export async function researchPrivateGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return readApiJson<T>(await requestResponse(path, { method: "GET", cache: "no-store", signal }));
}
