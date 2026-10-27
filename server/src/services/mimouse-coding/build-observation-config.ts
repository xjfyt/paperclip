import { createHash, createPublicKey } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { MIMOUSE_PROVENANCE_LIMITS, mimouseBuildTrustPolicySchema, startMimouseBuildObservationSchema } from "@paperclipai/shared";
import { gitlabBuildObservationConfigSchema } from "./gitlab-build-observation-contract.js";

export const BUILD_OBSERVATION_CONFIG_LIMITS = { bytes: 128 * 1024, depth: 16, nodes: 8192, profiles: 32, companyProfiles: 8 } as const;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
function invalid(): never { throw Error("config_invalid"); }

// Private acceptance parser: reject ambiguity BEFORE JSON.parse can discard it.
// Configuration numbers are deliberately restricted to lossless decimal integers.
function json(bytes: Uint8Array, limits: { bytes: number; depth: number; nodes: number } = BUILD_OBSERVATION_CONFIG_LIMITS): JsonValue {
  if (bytes.byteLength > limits.bytes) invalid();
  const input = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  let cursor = 0; let nodes = 0;
  function whitespace() { while (/[\x20\t\r\n]/.test(input[cursor] ?? "!")) cursor++; }
  function string(): string {
    const start = cursor++;
    while (cursor < input.length) {
      const character = input[cursor++];
      if (character === "\\") { cursor++; continue; }
      if (character !== '"') continue;
      const result: unknown = JSON.parse(input.slice(start, cursor));
      if (typeof result !== "string") invalid();
      for (const point of result) if (point.length === 1 && /[\uD800-\uDFFF]/.test(point)) invalid();
      return result;
    }
    return invalid();
  }
  function value(depth: number): JsonValue {
    if (++nodes > limits.nodes || depth > limits.depth) invalid();
    whitespace(); const token = input[cursor];
    if (token === '"') return string();
    if (token === "{") {
      cursor++; whitespace(); const result: { [key: string]: JsonValue } = {}; const keys = new Set<string>();
      if (input[cursor] === "}") { cursor++; return result; }
      while (cursor < input.length) {
        if (input[cursor] !== '"') invalid();
        const key = string();
        if (keys.has(key) || ["__proto__", "prototype", "constructor"].includes(key)) invalid();
        keys.add(key); whitespace(); if (input[cursor++] !== ":") invalid();
        result[key] = value(depth + 1); whitespace(); const separator = input[cursor++];
        if (separator === "}") return result;
        if (separator !== ",") invalid();
        whitespace();
      }
    } else if (token === "[") {
      cursor++; whitespace(); const result: JsonValue[] = [];
      if (input[cursor] === "]") { cursor++; return result; }
      while (cursor < input.length) {
        result.push(value(depth + 1)); whitespace(); const separator = input[cursor++];
        if (separator === "]") return result;
        if (separator !== ",") invalid();
      }
    } else {
      for (const [word, result] of [["null", null], ["true", true], ["false", false]] as const) {
        if (input.startsWith(word, cursor)) { cursor += word.length; return result; }
      }
      const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(input.slice(cursor));
      if (number) {
        cursor += number[0].length; const result = Number(number[0]);
        if (!/^-?(?:0|[1-9]\d*)$/.test(number[0]) || !Number.isSafeInteger(result) || Object.is(result, -0)) invalid();
        return result;
      }
    }
    return invalid();
  }
  const result = value(0); whitespace(); if (cursor !== input.length) invalid(); return result;
}
function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return invalid();
}
const relativePath = z.string().min(1).max(1000).regex(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/)
  .refine(value => value.split("/").every(part => part !== "." && part !== ".."));
const profileSchema = z.object({
  id: startMimouseBuildObservationSchema.shape.profileId, companyId: z.string().uuid(),
  observer: gitlabBuildObservationConfigSchema, manifestPath: relativePath,
  subjectName: z.string().min(1).max(2000).regex(/^[^\s\u0000-\u001f\u007f]+$/),
  maxObservationAgeSeconds: z.number().int().min(1).max(31 * 86400),
  provenancePolicy: mimouseBuildTrustPolicySchema.nullable(),
}).strict();
const configSchema = z.object({ schemaVersion: z.literal(1), profiles: z.array(profileSchema).min(1).max(BUILD_OBSERVATION_CONFIG_LIMITS.profiles) }).strict();
export type BuildObservationProfile = z.infer<typeof profileSchema>;
export type BuildObservationConfig = { enabled: true; digest: string; profiles: BuildObservationProfile[] }
  | { enabled: false; diagnostic: "disabled" | "config_invalid" };
export interface BuildObservationConfigOptions { enabled: boolean; filePath?: string }

function assertOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || value !== url.origin) invalid();
}
function validateProfiles(profiles: BuildObservationProfile[]) {
  const identities = new Set<string>(); const companies = new Map<string, number>();
  for (const profile of profiles) {
    const identity = `${profile.companyId}:${profile.id}`;
    if (identities.has(identity)) invalid(); identities.add(identity);
    const count = (companies.get(profile.companyId) ?? 0) + 1;
    if (count > BUILD_OBSERVATION_CONFIG_LIMITS.companyProfiles) invalid(); companies.set(profile.companyId, count);
    const { observer, provenancePolicy: policy } = profile;
    if (observer.companyId !== profile.companyId) invalid();
    assertOrigin(observer.origin); observer.allowedOrigins.forEach(assertOrigin);
    if (!observer.allowedOrigins.includes(observer.origin) || new Set(observer.allowedOrigins).size !== observer.allowedOrigins.length) invalid();
    const source = observer.sourceUri.replace(/^git\+/, ""); const repo = new URL(source);
    if (repo.origin !== observer.origin || repo.protocol !== "https:" || repo.username || repo.password || repo.search || repo.hash
      || source !== repo.href || !/^\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(repo.pathname)
      || repo.pathname.split("/").some(part => part === "." || part === "..")) invalid();
    if (!policy) continue;
    if (policy.companyId !== profile.companyId || policy.sourceUri !== observer.sourceUri) invalid();
    const parameters = json(Buffer.from(policy.externalParametersJson), { bytes: MIMOUSE_PROVENANCE_LIMITS.parametersBytes,
      depth: MIMOUSE_PROVENANCE_LIMITS.jsonDepth, nodes: MIMOUSE_PROVENANCE_LIMITS.jsonNodes });
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters) || !Object.keys(parameters).length) invalid();
    const ids = new Set<string>(); const publicKeys = new Set<string>();
    for (const key of policy.keys) {
      if (ids.has(key.keyId) || Date.parse(key.validFrom) >= Date.parse(key.validUntil)) invalid(); ids.add(key.keyId);
      if (!/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\r\n]+\n-----END PUBLIC KEY-----\n?$/.test(key.publicKeyPem)) invalid();
      const parsed = createPublicKey(key.publicKeyPem);
      if (parsed.type !== "public" || parsed.asymmetricKeyType !== "ed25519") invalid();
      const fingerprint = createHash("sha256").update(parsed.export({ type: "spki", format: "der" })).digest("hex");
      if (publicKeys.has(fingerprint)) invalid(); publicKeys.add(fingerprint);
    }
  }
}

/** Operator-only file selection, never request data. No cache: callers re-read at
 * dispatch/finalization boundaries. Workspace exclusion is a deployment rule,
 * NOT OS isolation; parent directory/same-source multi-instance control remains
 * the operator's responsibility. O_NOFOLLOW only protects the final component.
 * Repeated reads cannot make file replacement atomic with a DB transaction. */
export async function loadBuildObservationConfig(options?: BuildObservationConfigOptions): Promise<BuildObservationConfig> {
  const enabled = options ? options.enabled : process.env.PAPERCLIP_BUILD_OBSERVATIONS_ENABLED === "true";
  if (!enabled) return { enabled: false, diagnostic: "disabled" };
  try {
    const filePath = options ? options.filePath : process.env.PAPERCLIP_BUILD_OBSERVATIONS_CONFIG_FILE;
    if (!filePath || filePath.length > 4096 || /[\u0000-\u001f\u007f]/.test(filePath) || !path.isAbsolute(filePath) || path.normalize(filePath) !== filePath) invalid();
    // NONBLOCK prevents a misconfigured FIFO from hanging before fstat rejects it.
    const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > BUILD_OBSERVATION_CONFIG_LIMITS.bytes) invalid();
      const buffer = Buffer.alloc(BUILD_OBSERVATION_CONFIG_LIMITS.bytes + 1); let used = 0;
      while (used < buffer.length) {
        const read = await handle.read(buffer, used, buffer.length - used, used);
        if (!read.bytesRead) break; used += read.bytesRead;
      }
      if (used > BUILD_OBSERVATION_CONFIG_LIMITS.bytes) invalid();
      const after = await handle.stat();
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || used !== after.size) invalid();
      bytes = buffer.subarray(0, used);
    } finally { await handle.close(); }
    const parsed = configSchema.parse(json(bytes)); validateProfiles(parsed.profiles);
    return { enabled: true, digest: createHash("sha256").update(canonical({ configuration: parsed, sourcePathSha256: createHash("sha256").update(filePath).digest("hex") })).digest("hex"), profiles: parsed.profiles };
  } catch { return { enabled: false, diagnostic: "config_invalid" }; }
}
