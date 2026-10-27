import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import {
  MIMOUSE_PROVENANCE_LIMITS, MIMOUSE_PROVENANCE_PROFILE,
  mimouseBuildProvenanceStatementSchema, mimouseBuildTrustPolicySchema,
  mimouseBuildVerificationContextSchema, mimouseBuildVerificationDisabledSchema, mimouseDsseEnvelopeSchema, mimouseProvenanceTimeSchema,
  type MimouseBuildUnassessedFacts, type MimouseBuildVerificationResult, type MimouseProvenanceDiagnostic,
} from "@paperclipai/shared";

class Rejection extends Error {
  constructor(readonly code: MimouseProvenanceDiagnostic) { super(code); }
}
function reject(code: MimouseProvenanceDiagnostic): never { throw new Rejection(code); }
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Bounded JSON reader: JSON.parse alone loses duplicate (including escaped)
 * keys. No reviver can recover that ambiguity after parsing. */
function boundedJson(bytes: Uint8Array, byteLimit: number): JsonValue {
  if (bytes.byteLength > byteLimit) reject("input_too_large");
  let input: string;
  try { input = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return reject("utf8_invalid"); }
  let cursor = 0; let nodes = 0;
  function whitespace() { while (/[\x20\t\r\n]/.test(input[cursor] ?? "!")) cursor++; }
  function string(): string {
    const start = cursor++;
    while (cursor < input.length) {
      const character = input[cursor++];
      if (character === "\\") { cursor++; continue; }
      if (character !== '"') continue;
      let value: unknown;
      try { value = JSON.parse(input.slice(start, cursor)); } catch { return reject("json_invalid"); }
      if (typeof value !== "string") return reject("json_invalid");
      for (const point of value) {
        if (point.length === 1 && /[\uD800-\uDFFF]/.test(point)) reject("json_ambiguous");
      }
      return value;
    }
    return reject("json_invalid");
  }
  function value(depth: number): JsonValue {
    if (++nodes > MIMOUSE_PROVENANCE_LIMITS.jsonNodes || depth > MIMOUSE_PROVENANCE_LIMITS.jsonDepth) reject("json_limits_exceeded");
    whitespace();
    const token = input[cursor];
    if (token === '"') return string();
    if (token === "{") {
      cursor++; whitespace();
      const result: { [key: string]: JsonValue } = {}; const keys = new Set<string>();
      if (input[cursor] === "}") { cursor++; return result; }
      while (cursor < input.length) {
        if (input[cursor] !== '"') reject("json_invalid");
        const key = string();
        if (keys.has(key) || ["__proto__", "prototype", "constructor"].includes(key)) reject("json_ambiguous");
        keys.add(key); whitespace();
        if (input[cursor++] !== ":") reject("json_invalid");
        result[key] = value(depth + 1); whitespace();
        const separator = input[cursor++];
        if (separator === "}") return result;
        if (separator !== ",") reject("json_invalid");
        whitespace();
      }
    } else if (token === "[") {
      cursor++; whitespace(); const result: JsonValue[] = [];
      if (input[cursor] === "]") { cursor++; return result; }
      while (cursor < input.length) {
        result.push(value(depth + 1)); whitespace(); const separator = input[cursor++];
        if (separator === "]") return result;
        if (separator !== ",") reject("json_invalid");
      }
    } else {
      for (const [word, result] of [["null", null], ["true", true], ["false", false]] as const) {
        if (input.startsWith(word, cursor)) { cursor += word.length; return result; }
      }
      const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(input.slice(cursor));
      if (number) {
        cursor += number[0].length; const result = Number(number[0]);
        // This profile does not admit lossy numbers or negative zero.
        if (!/^-?(?:0|[1-9]\d*)$/.test(number[0]) || !Number.isSafeInteger(result) || Object.is(result, -0)) reject("json_ambiguous");
        return result;
      }
    }
    return reject("json_invalid");
  }
  const result = value(0); whitespace();
  if (cursor !== input.length) reject("json_invalid");
  return result;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return reject("json_invalid");
}
function base64(value: string, maxBytes: number, sizeCode: MimouseProvenanceDiagnostic = "payload_too_large"): Buffer {
  // Accept standard AND URL-safe alphabets; forbid mixed alphabets, ignored
  // whitespace, misplaced padding and nonzero unused bits.
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value) || (/[+/]/.test(value) && /[-_]/.test(value))) reject("base64_invalid");
  const bare = value.replace(/=+$/, "");
  const padding = (4 - bare.length % 4) % 4;
  if (padding === 3 || (value.includes("=") && value.length - bare.length !== padding)) reject("base64_invalid");
  if (Math.floor(bare.length * 3 / 4) > maxBytes) reject(sizeCode);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== bare.replace(/-/g, "+").replace(/_/g, "/")) reject("base64_invalid");
  return bytes;
}

/** Standard DSSE PAE. No JSON canonicalization enters the signature preimage. */
export function mimouseDssePreAuthEncoding(payloadType: string, payload: Uint8Array): Buffer {
  for (const point of payloadType) if (point.length === 1 && /[\uD800-\uDFFF]/.test(point)) reject("utf8_invalid");
  const type = Buffer.from(payloadType, "utf8");
  if (type.length > 2000 || payload.byteLength > MIMOUSE_PROVENANCE_LIMITS.payloadBytes) reject("input_too_large");
  return Buffer.concat([Buffer.from(`DSSEv1 ${type.length} `), type, Buffer.from(` ${payload.byteLength} `), payload]);
}
function digest(bytes: string | Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function parsePublicKey(pem: string): KeyObject {
  try {
    if (!/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\r\n]+\n-----END PUBLIC KEY-----\n?$/.test(pem)) reject("key_invalid");
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519" || key.type !== "public") reject("key_invalid");
    return key;
  } catch { return reject("key_invalid"); }
}
function otherFacts(): MimouseBuildUnassessedFacts {
  return { artifactBytes: "unassessed", artifactCodeSignature: "unassessed", platform: "unassessed",
    tests: "unassessed", workflowClosure: "unassessed", controllerObservation: "blocked", c3: "blocked" };
}

/** Pure, unwired library. No file/network/DB/clock reads, default trust root,
 * signer, registration or collector. Operator policy MUST NOT be client input.
 * The caller must supply the CURRENT trusted server time and CURRENT operator
 * policy; historical/client-selected inputs cannot establish current validity.
 * It must independently authorize the operation-to-invocation relationship.
 * Even success only verifies a signed claim against caller-resolved context. */
export function verifyMimouseBuildProvenance(input: {
  envelope: Uint8Array; context: unknown; verifiedAt: string;
}, operatorPolicy?: unknown): MimouseBuildVerificationResult {
  if (operatorPolicy === undefined || mimouseBuildVerificationDisabledSchema.safeParse(operatorPolicy).success) {
    return { status: "disabled", diagnostic: "disabled", cryptographicSignature: "not_checked", otherFacts: otherFacts() };
  }
  let cryptographicSignature: "not_checked" | "invalid" | "verified" = "not_checked";
  try {
    const policyResult = mimouseBuildTrustPolicySchema.safeParse(operatorPolicy);
    if (!policyResult.success) reject("policy_invalid");
    const policy = policyResult.data;
    if (new Set(policy.keys.map(key => key.keyId)).size !== policy.keys.length
      || policy.keys.some(key => Date.parse(key.validFrom) >= Date.parse(key.validUntil))) reject("policy_invalid");
    const keys = policy.keys.map(config => {
      const publicKey = parsePublicKey(config.publicKeyPem);
      return { config, publicKey, fingerprint: digest(publicKey.export({ format: "der", type: "spki" })) };
    });
    // keyid is unsigned. The same key must not acquire different validity or
    // revocation semantics by being registered under a second lookup hint.
    if (new Set(keys.map(key => key.fingerprint)).size !== keys.length) reject("policy_invalid");
    let parameters: JsonValue;
    try { parameters = boundedJson(Buffer.from(policy.externalParametersJson), MIMOUSE_PROVENANCE_LIMITS.parametersBytes); }
    catch { return reject("policy_invalid"); }
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters) || !Object.keys(parameters).length) reject("policy_invalid");
    const contextResult = mimouseBuildVerificationContextSchema.safeParse(input.context);
    if (!contextResult.success) reject("context_invalid");
    const context = contextResult.data;
    if (context.companyId !== policy.companyId || context.source.uri !== policy.sourceUri) reject("context_mismatch");
    const verifiedAt = input.verifiedAt;
    if (!mimouseProvenanceTimeSchema.safeParse(verifiedAt).success) reject("time_invalid");
    const now = Date.parse(verifiedAt); const skew = policy.maxClockSkewSeconds * 1000;
    if (Date.parse(context.buildNotBefore) > now + skew) reject("context_invalid");
    const rawEnvelope = input.envelope;
    if (!(rawEnvelope instanceof Uint8Array)) reject("input_invalid");
    if (rawEnvelope.byteLength > MIMOUSE_PROVENANCE_LIMITS.envelopeBytes) reject("input_too_large");
    const envelopeBytes = Buffer.from(rawEnvelope); // Snapshot once; do not re-read after verification.
    const envelopeResult = mimouseDsseEnvelopeSchema.safeParse(boundedJson(envelopeBytes, MIMOUSE_PROVENANCE_LIMITS.envelopeBytes));
    if (!envelopeResult.success) reject("envelope_invalid");
    const envelope = envelopeResult.data;
    const payload = base64(envelope.payload, MIMOUSE_PROVENANCE_LIMITS.payloadBytes);
    const signature = base64(envelope.signatures[0].sig, 64, "signature_invalid");
    if (signature.length !== 64) reject("signature_invalid");
    const selectedKey = keys.find(candidate => candidate.config.keyId === envelope.signatures[0].keyid);
    if (!selectedKey) reject("key_unknown");
    const { config: key, publicKey } = selectedKey;
    if (key.revokedAt !== null && Date.parse(key.revokedAt) <= now) reject("key_revoked");
    if (now < Date.parse(key.validFrom)) reject("key_not_yet_valid");
    if (now >= Date.parse(key.validUntil)) reject("key_expired");
    cryptographicSignature = "invalid";
    try { if (!verify(null, mimouseDssePreAuthEncoding(envelope.payloadType, payload), publicKey, signature)) reject("signature_invalid"); }
    catch { return reject("signature_invalid"); }
    cryptographicSignature = "verified";
    const statementResult = mimouseBuildProvenanceStatementSchema.safeParse(boundedJson(payload, MIMOUSE_PROVENANCE_LIMITS.payloadBytes));
    if (!statementResult.success) reject("claims_invalid");
    const statement = statementResult.data;
    const { buildDefinition, runDetails } = statement.predicate;
    if (runDetails.builder.id !== policy.builderId) reject("builder_mismatch");
    if (buildDefinition.buildType !== policy.buildType) reject("build_type_mismatch");
    if (canonical(buildDefinition.externalParameters) !== canonical(parameters)) reject("workflow_parameters_mismatch");
    const source = buildDefinition.resolvedDependencies[0];
    if (source.uri !== context.source.uri || source.digest.gitCommit !== context.source.digest.gitCommit) reject("source_mismatch");
    const subject = statement.subject[0];
    if (subject.name !== context.subject.name || subject.digest.sha256 !== context.subject.digest.sha256) reject("subject_mismatch");
    const { invocationId, startedOn, finishedOn } = runDetails.metadata;
    if (invocationId !== context.invocationId) reject("invocation_mismatch");
    const started = Date.parse(startedOn); const finished = Date.parse(finishedOn);
    if (started > finished) reject("build_time_invalid");
    if (finished > now + skew) reject("build_in_future");
    if (now - started > policy.maxBuildAgeSeconds * 1000) reject("build_too_old");
    if (started < Date.parse(context.buildNotBefore)) reject("build_before_context");
    if (started < Date.parse(key.validFrom) || finished >= Date.parse(key.validUntil)) reject("build_outside_key_window");
    return {
      status: "verified_claim", cryptographicSignature, profile: MIMOUSE_PROVENANCE_PROFILE,
      policyId: policy.policyId, policyRevision: policy.revision, policySha256: digest(canonical(policy)),
      keyId: key.keyId, publicKeySha256: selectedKey.fingerprint, context,
      envelopeSha256: digest(envelopeBytes), payloadSha256: digest(payload), verifiedAt,
      startedOn, finishedOn, builderId: runDetails.builder.id, buildType: buildDefinition.buildType, otherFacts: otherFacts(),
    };
  } catch (error) {
    if (!(error instanceof Rejection)) throw error;
    return { status: "rejected", diagnostic: error.code, cryptographicSignature, otherFacts: otherFacts() };
  }
}
