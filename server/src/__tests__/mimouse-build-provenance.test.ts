import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MIMOUSE_PROVENANCE_LIMITS, MIMOUSE_PROVENANCE_PROFILE,
  type MimouseBuildProvenanceStatement, type MimouseBuildTrustPolicy,
  type MimouseBuildVerificationContext, type MimouseDsseEnvelope, type MimouseProvenanceDiagnostic,
} from "@paperclipai/shared";
import { mimouseDssePreAuthEncoding, verifyMimouseBuildProvenance } from "../services/mimouse-coding/build-provenance.js";

const now = "2026-10-27T11:00:00Z";
const sha = "a".repeat(40);
interface Fixture {
  privateKey: KeyObject; policy: MimouseBuildTrustPolicy;
  context: MimouseBuildVerificationContext; statement: MimouseBuildProvenanceStatement;
}
function fixture(): Fixture {
  // Test-only ephemeral keys: never written, registered or loaded in production.
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const subject = { name: "app-linux-arm64.tar.gz", digest: { sha256: createHash("sha256").update("fixture artifact").digest("hex") } };
  const source = { uri: "git+https://git.example/org/project", digest: { gitCommit: sha } };
  const statement: MimouseBuildProvenanceStatement = {
    _type: "https://in-toto.io/Statement/v1", subject: [subject], predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://builder.example/buildtypes/workflow/v1",
        externalParameters: { workflow: { path: ".gitlab-ci.yml", ref: sha }, inputs: { target: "linux-arm64", attempts: 1 } },
        resolvedDependencies: [source],
      },
      runDetails: { builder: { id: "https://builder.example/controller/v1" },
        metadata: { invocationId: "https://git.example/org/project/-/jobs/42", startedOn: "2026-10-27T10:58:00Z", finishedOn: "2026-10-27T10:59:00Z" } },
    },
  };
  return {
    privateKey, statement,
    context: { companyId: "company-a", operationId: "delivery-a", invocationId: statement.predicate.runDetails.metadata.invocationId,
      source, subject, buildNotBefore: "2026-10-27T10:57:00Z" },
    policy: {
      schemaVersion: 1, enabled: true, policyId: "controller-policy", revision: 1, companyId: "company-a",
      profile: MIMOUSE_PROVENANCE_PROFILE, builderId: statement.predicate.runDetails.builder.id,
      buildType: statement.predicate.buildDefinition.buildType, sourceUri: source.uri,
      externalParametersJson: JSON.stringify(statement.predicate.buildDefinition.externalParameters),
      maxBuildAgeSeconds: 3600, maxClockSkewSeconds: 0,
      keys: [{ keyId: "controller-key", scheme: "ed25519", publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
        validFrom: "2026-10-01T00:00:00Z", validUntil: "2026-11-01T00:00:00Z", revokedAt: null }],
    },
  };
}
function envelopeForBytes(f: Fixture, payload: Buffer): MimouseDsseEnvelope {
  // Independent reference framing, not the production helper under test.
  const signedBytes = Buffer.concat([Buffer.from(`DSSEv1 28 application/vnd.in-toto+json ${payload.length} `), payload]);
  return { payloadType: "application/vnd.in-toto+json", payload: payload.toString("base64"),
    signatures: [{ keyid: "controller-key", sig: sign(null, signedBytes, f.privateKey).toString("base64") }] };
}
function envelope(f: Fixture, statement: unknown = f.statement): MimouseDsseEnvelope {
  return envelopeForBytes(f, Buffer.from(JSON.stringify(statement)));
}
function check(f: Fixture, data: MimouseDsseEnvelope = envelope(f)) {
  return verifyMimouseBuildProvenance({ envelope: Buffer.from(JSON.stringify(data)), context: f.context, verifiedAt: now }, f.policy);
}
function rejected(f: Fixture, value: unknown, diagnostic: MimouseProvenanceDiagnostic) {
  expect(check(f, envelope(f, value))).toMatchObject({ status: "rejected", diagnostic, cryptographicSignature: "verified" });
}

describe("DSSE PAE", () => {
  it("matches the official DSSE protocol vector independently of our signing fixture", () => {
    // https://github.com/secure-systems-lab/dsse/blob/master/protocol.md#test-vectors
    expect(mimouseDssePreAuthEncoding("http://example.com/HelloWorld", Buffer.from("hello world")).toString())
      .toBe("DSSEv1 29 http://example.com/HelloWorld 11 hello world");
  });
  it("counts UTF-8 bytes and retains binary body bytes", () => {
    expect(mimouseDssePreAuthEncoding("é", Buffer.from([0, 255]))).toEqual(Buffer.concat([Buffer.from("DSSEv1 2 é 2 "), Buffer.from([0, 255])]));
    expect(mimouseDssePreAuthEncoding("", Buffer.alloc(0)).toString()).toBe("DSSEv1 0  0 ");
    expect(() => mimouseDssePreAuthEncoding("\ud800", Buffer.alloc(0))).toThrow("utf8_invalid");
    expect(() => mimouseDssePreAuthEncoding("a", Buffer.alloc(MIMOUSE_PROVENANCE_LIMITS.payloadBytes + 1))).toThrow("input_too_large");
  });
});

describe("bounded operator-policy provenance verification", () => {
  it("verifies a real Ed25519 signature without upgrading other evidence", () => {
    const f = fixture(); const result = check(f);
    expect(result).toMatchObject({ status: "verified_claim", cryptographicSignature: "verified", context: f.context,
      startedOn: "2026-10-27T10:58:00Z", finishedOn: "2026-10-27T10:59:00Z", verifiedAt: now,
      otherFacts: { artifactBytes: "unassessed", artifactCodeSignature: "unassessed", platform: "unassessed", tests: "unassessed", controllerObservation: "blocked", c3: "blocked" } });
    expect(result).not.toHaveProperty("signatureVerified"); expect(result).not.toHaveProperty("readyForRelease");
    expect(JSON.stringify(result)).not.toMatch(/BEGIN PUBLIC KEY|PRIVATE KEY/);
  });
  it("is off without an operator policy, including explicit disabled configuration", () => {
    const input = { get envelope(): Uint8Array { throw Error("disabled must not read input"); }, context: null, verifiedAt: "bad" };
    for (const policy of [undefined, { schemaVersion: 1, enabled: false }]) {
      expect(verifyMimouseBuildProvenance(input, policy)).toMatchObject({ status: "disabled", cryptographicSignature: "not_checked" });
    }
  });
  it("accepts standard/URL-safe base64 with canonical padding or no padding", () => {
    const f = fixture();
    for (const urlSafe of [false, true]) for (const padded of [false, true]) {
      const e = envelope(f);
      function encode(value: string) { return (urlSafe ? value.replace(/\+/g, "-").replace(/\//g, "_") : value).replace(padded ? /$^/ : /=+$/, ""); }
      e.payload = encode(e.payload); e.signatures[0].sig = encode(e.signatures[0].sig);
      expect(check(f, e).status).toBe("verified_claim");
    }
  });
  it("verifies original signed bytes, not reconstructed or canonicalized JSON", () => {
    const f = fixture(); const payload = Buffer.from(JSON.stringify(f.statement, null, 2));
    expect(check(f, envelopeForBytes(f, payload)).status).toBe("verified_claim");
    const e = envelopeForBytes(f, payload); e.payload = Buffer.from(JSON.stringify(f.statement)).toString("base64");
    expect(check(f, e)).toMatchObject({ diagnostic: "signature_invalid", cryptographicSignature: "invalid" });
    const rawBodySignature = envelopeForBytes(f, payload);
    rawBodySignature.signatures[0].sig = sign(null, payload, f.privateKey).toString("base64");
    expect(check(f, rawBodySignature)).toMatchObject({ diagnostic: "signature_invalid", cryptographicSignature: "invalid" });
  });
  it("pins every external parameter while ignoring only JSON property order", () => {
    const f = fixture();
    f.policy.externalParametersJson = JSON.stringify({ inputs: { attempts: 1, target: "linux-arm64" }, workflow: { ref: sha, path: ".gitlab-ci.yml" } });
    expect(check(f).status).toBe("verified_claim");
    f.statement.predicate.buildDefinition.externalParameters.workflow = { path: "untrusted.yml", ref: sha };
    rejected(f, f.statement, "workflow_parameters_mismatch");
  });
  it("keeps tenant/operation context separate from standard payload and rejects tenant crossover", () => {
    const f = fixture(); expect(JSON.stringify(f.statement)).not.toMatch(/companyId|operationId|deliveryId/);
    f.context.companyId = "company-b"; expect(check(f)).toMatchObject({ diagnostic: "context_mismatch" });
    f.context.companyId = "company-a"; f.context.source.uri = "git+https://git.example/other/project";
    expect(check(f)).toMatchObject({ diagnostic: "context_mismatch" });
  });
  it("never refreshes build age or grants durable anti-replay protection on re-verification", () => {
    const f = fixture(); const bytes = Buffer.from(JSON.stringify(envelope(f)));
    const later = verifyMimouseBuildProvenance({ envelope: bytes, context: f.context, verifiedAt: "2026-10-27T11:01:00Z" }, f.policy);
    expect(later).toMatchObject({ status: "verified_claim", startedOn: "2026-10-27T10:58:00Z", finishedOn: "2026-10-27T10:59:00Z", verifiedAt: "2026-10-27T11:01:00Z" });
    const old = verifyMimouseBuildProvenance({ envelope: bytes, context: f.context, verifiedAt: "2026-10-27T12:00:00Z" }, f.policy);
    expect(old).toMatchObject({ diagnostic: "build_too_old", cryptographicSignature: "verified" });
    f.context.invocationId = "https://git.example/org/project/-/jobs/43";
    expect(check(f)).toMatchObject({ diagnostic: "invocation_mismatch" });
  });
  it("does not pretend that the CI signature covers the app operation binding", () => {
    const f = fixture(); const e = envelope(f); const first = check(f, e);
    f.context.operationId = "delivery-b"; const rebound = check(f, e);
    expect(first).toMatchObject({ status: "verified_claim", context: { operationId: "delivery-a" } });
    expect(rebound).toMatchObject({ status: "verified_claim", context: { operationId: "delivery-b" } });
    // A future route must authorize each operation -> CI invocation link itself.
    if (first.status !== "verified_claim" || rebound.status !== "verified_claim") throw Error("fixture did not verify");
    expect(rebound.payloadSha256).toBe(first.payloadSha256);
    expect(rebound.finishedOn).toBe(first.finishedOn);
  });
  it("rejects previously verified envelope bytes after current policy revokes their key", () => {
    const f = fixture(); const e = envelope(f);
    expect(check(f, e).status).toBe("verified_claim");
    f.policy.revision++; f.policy.keys[0].revokedAt = now;
    expect(check(f, e)).toMatchObject({ status: "rejected", diagnostic: "key_revoked", cryptographicSignature: "not_checked" });
  });
  it("enforces bounded future skew and the exact build-age boundary", () => {
    const f = fixture(); f.policy.maxClockSkewSeconds = 5;
    f.statement.predicate.runDetails.metadata.finishedOn = "2026-10-27T11:00:05Z";
    expect(check(f).status).toBe("verified_claim");
    f.statement.predicate.runDetails.metadata.finishedOn = "2026-10-27T11:00:06Z";
    expect(check(f)).toMatchObject({ diagnostic: "build_in_future" });
    f.statement.predicate.runDetails.metadata.finishedOn = "2026-10-27T10:59:00Z";
    f.policy.maxBuildAgeSeconds = 120; expect(check(f).status).toBe("verified_claim");
    f.policy.maxBuildAgeSeconds = 119; expect(check(f)).toMatchObject({ diagnostic: "build_too_old" });
  });
  it("does not accept a client trust boolean, platform, success/JUnit or JWS as evidence", () => {
    const f = fixture();
    for (const extra of [{ trusted: true }, { platform: "linux", arch: "arm64" }, { status: "success" }, { junit: "<testsuite/>" }, { alg: "EdDSA", protected: "jws" }]) {
      rejected(f, { ...f.statement, ...extra }, "claims_invalid");
    }
    rejected(f, { trusted: true }, "claims_invalid");
  });
});

const claimMutations: Array<{ name: string; mutate: (s: MimouseBuildProvenanceStatement) => unknown; code: MimouseProvenanceDiagnostic }> = [
  { name: "statement version", mutate: s => ({ ...s, _type: "https://in-toto.io/Statement/v2" }), code: "claims_invalid" },
  { name: "predicate version", mutate: s => ({ ...s, predicateType: "https://slsa.dev/provenance/v0.2" }), code: "claims_invalid" },
  { name: "unknown nested field", mutate: s => ({ ...s, predicate: { ...s.predicate, extra: true } }), code: "claims_invalid" },
  { name: "builder", mutate: s => { s.predicate.runDetails.builder.id = "https://other.example/builder"; return s; }, code: "builder_mismatch" },
  { name: "build type", mutate: s => { s.predicate.buildDefinition.buildType += "/wrong"; return s; }, code: "build_type_mismatch" },
  { name: "unexpected input", mutate: s => { s.predicate.buildDefinition.externalParameters.extra = true; return s; }, code: "workflow_parameters_mismatch" },
  { name: "source URI", mutate: s => { s.predicate.buildDefinition.resolvedDependencies[0].uri += "/wrong"; return s; }, code: "source_mismatch" },
  { name: "source commit", mutate: s => { s.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "c".repeat(40); return s; }, code: "source_mismatch" },
  { name: "subject name", mutate: s => { s.subject[0].name += ".wrong"; return s; }, code: "subject_mismatch" },
  { name: "subject digest", mutate: s => { s.subject[0].digest.sha256 = "c".repeat(64); return s; }, code: "subject_mismatch" },
  { name: "extra subject", mutate: s => ({ ...s, subject: [...s.subject, s.subject[0]] }), code: "claims_invalid" },
  { name: "unsupported digest", mutate: s => ({ ...s, subject: [{ name: s.subject[0].name, digest: { sha512: "c".repeat(128) } }] }), code: "claims_invalid" },
  { name: "invocation", mutate: s => { s.predicate.runDetails.metadata.invocationId += "-wrong"; return s; }, code: "invocation_mismatch" },
  { name: "invalid calendar date", mutate: s => { s.predicate.runDetails.metadata.startedOn = "2026-02-30T10:00:00Z"; return s; }, code: "claims_invalid" },
  { name: "backwards time", mutate: s => { s.predicate.runDetails.metadata.startedOn = "2026-10-27T10:59:30Z"; return s; }, code: "build_time_invalid" },
  { name: "future time", mutate: s => { s.predicate.runDetails.metadata.finishedOn = "2026-10-27T11:00:01Z"; return s; }, code: "build_in_future" },
  { name: "stale time", mutate: s => { s.predicate.runDetails.metadata.startedOn = "2026-10-27T09:00:00Z"; return s; }, code: "build_too_old" },
  { name: "prior operation build", mutate: s => { s.predicate.runDetails.metadata.startedOn = "2026-10-27T10:56:59Z"; return s; }, code: "build_before_context" },
];
describe("signed but unacceptable claims", () => {
  it.each(claimMutations)("rejects $name", ({ mutate, code }) => {
    const f = fixture(); rejected(f, mutate(structuredClone(f.statement)), code);
  });
});

describe("key policy and signature failures", () => {
  it("rejects an unknown hint, a wrong actual key, and tampered signatures", () => {
    const f = fixture(); const e = envelope(f); e.signatures[0].keyid = "unregistered";
    expect(check(f, e)).toMatchObject({ diagnostic: "key_unknown", cryptographicSignature: "not_checked" });
    e.signatures[0].keyid = "controller-key";
    const bytes = Buffer.from(e.signatures[0].sig, "base64"); bytes[0] ^= 1; e.signatures[0].sig = bytes.toString("base64");
    expect(check(f, e)).toMatchObject({ diagnostic: "signature_invalid", cryptographicSignature: "invalid" });
    f.policy.keys[0].publicKeyPem = fixture().policy.keys[0].publicKeyPem;
    expect(check(f)).toMatchObject({ diagnostic: "signature_invalid" });
  });
  it("rejects private keys, malformed public keys and algorithm-confusion keys", () => {
    const f = fixture();
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    for (const pem of ["invalid", f.privateKey.export({ format: "pem", type: "pkcs8" }).toString(), ec.publicKey.export({ format: "pem", type: "spki" }).toString()]) {
      f.policy.keys[0].publicKeyPem = pem; expect(check(f)).toMatchObject({ diagnostic: "key_invalid" });
    }
  });
  it.each([
    { patch: { revokedAt: "2026-10-27T11:00:00Z" }, code: "key_revoked" },
    { patch: { validFrom: "2026-10-28T00:00:00Z" }, code: "key_not_yet_valid" },
    { patch: { validUntil: now }, code: "key_expired" },
    { patch: { validFrom: "2026-10-27T10:58:01Z" }, code: "build_outside_key_window" },
  ])("rejects $code at the exact policy boundary", ({ patch, code }) => {
    const f = fixture(); Object.assign(f.policy.keys[0], patch); expect(check(f)).toMatchObject({ diagnostic: code });
  });
  it("requires valid, unique, operator-owned configuration and explicit context", () => {
    const f = fixture(); const input = { envelope: Buffer.from(JSON.stringify(envelope(f))), context: f.context, verifiedAt: now };
    const policies: unknown[] = [
      { ...f.policy, schemaVersion: 2 }, { ...f.policy, enabled: true, trustUrl: "https://untrusted.example/key" },
      { ...f.policy, keys: [{ ...f.policy.keys[0], scheme: "rsa" }] }, { ...f.policy, keys: [f.policy.keys[0], f.policy.keys[0]] },
      { ...f.policy, keys: [f.policy.keys[0], { ...f.policy.keys[0], keyId: "alias", revokedAt: now }] },
      { ...f.policy, externalParametersJson: '{"a":1,"a":2}' }, { ...f.policy, externalParametersJson: "{}" },
      { ...f.policy, keys: [{ ...f.policy.keys[0], validUntil: f.policy.keys[0].validFrom }] },
    ];
    for (const policy of policies) expect(verifyMimouseBuildProvenance(input, policy)).toMatchObject({ diagnostic: "policy_invalid" });
    expect(verifyMimouseBuildProvenance({ ...input, context: { ...f.context, trusted: true } }, f.policy)).toMatchObject({ diagnostic: "context_invalid" });
    expect(verifyMimouseBuildProvenance({ ...input, context: { ...f.context, buildNotBefore: "2026-10-28T00:00:00Z" } }, f.policy)).toMatchObject({ diagnostic: "context_invalid" });
    expect(verifyMimouseBuildProvenance({ ...input, verifiedAt: "not-a-date" }, f.policy)).toMatchObject({ diagnostic: "time_invalid" });
  });
});

describe("bounded, unambiguous decoding", () => {
  it("rejects malformed envelope JSON, duplicate/escaped keys, BOM, invalid UTF-8 and overlarge input", () => {
    const f = fixture(); const e = envelope(f); const serialized = JSON.stringify(e);
    const cases: Array<{ bytes: Buffer; code: MimouseProvenanceDiagnostic }> = [
      { bytes: Buffer.from("{bad"), code: "json_invalid" },
      { bytes: Buffer.from(serialized + " false"), code: "json_invalid" },
      { bytes: Buffer.from('{"payload":"x",' + serialized.slice(1)), code: "json_ambiguous" },
      { bytes: Buffer.from('{"paylo\\u0061d":"x",' + serialized.slice(1)), code: "json_ambiguous" },
      { bytes: Buffer.from('{"__proto__":{},' + serialized.slice(1)), code: "json_ambiguous" },
      { bytes: Buffer.from("\ufeff" + serialized), code: "json_invalid" },
      { bytes: Buffer.from([0xc0, 0xaf]), code: "utf8_invalid" },
      { bytes: Buffer.alloc(MIMOUSE_PROVENANCE_LIMITS.envelopeBytes + 1), code: "input_too_large" },
    ];
    for (const { bytes, code } of cases) expect(verifyMimouseBuildProvenance({ envelope: bytes, context: f.context, verifiedAt: now }, f.policy))
      .toMatchObject({ diagnostic: code, cryptographicSignature: "not_checked" });
  });
  it("rejects unknown envelope fields/types, extra signatures and custom JWS", () => {
    const f = fixture(); const e = envelope(f);
    for (const data of [{ ...e, keyUrl: "https://untrusted.example/key" }, { ...e, payloadType: "application/json" },
      { ...e, signatures: [...e.signatures, e.signatures[0]] }, { ...e, signatures: [{ ...e.signatures[0], alg: "EdDSA" }] },
      { protected: "eyJhbGciOiJFZERTQSJ9", payload: e.payload, signature: e.signatures[0].sig }]) {
      expect(verifyMimouseBuildProvenance({ envelope: Buffer.from(JSON.stringify(data)), context: f.context, verifiedAt: now }, f.policy))
        .toMatchObject({ diagnostic: "envelope_invalid" });
    }
  });
  it("rejects base64 ambiguity instead of relying on Node's permissive decoder", () => {
    const f = fixture(); const e = envelope(f);
    for (const bad of ["A", "AA=", "AA===", "AA==\n", "AB==", "AA-_+/==", "AA!A"]) {
      expect(check(f, { ...e, payload: bad })).toMatchObject({ diagnostic: "base64_invalid" });
    }
    expect(check(f, { ...e, payload: Buffer.alloc(MIMOUSE_PROVENANCE_LIMITS.payloadBytes + 1).toString("base64") }))
      .toMatchObject({ diagnostic: "payload_too_large" });
    expect(check(f, { ...e, signatures: [{ keyid: "controller-key", sig: "AA==" }] })).toMatchObject({ diagnostic: "signature_invalid" });
  });
  it("checks signed JSON for duplicates, lossy numbers, surrogates, depth and node limits", () => {
    const f = fixture(); const original = JSON.stringify(f.statement);
    const cases: Array<{ raw: string; code: MimouseProvenanceDiagnostic }> = [
      { raw: '{"_type":"duplicate",' + original.slice(1), code: "json_ambiguous" },
      { raw: original.replace('"attempts":1', '"attempts":9007199254740993'), code: "json_ambiguous" },
      { raw: original.replace('"attempts":1', '"attempts":1.0000000000000001'), code: "json_ambiguous" },
      { raw: original.replace('"attempts":1', '"attempts":-0'), code: "json_ambiguous" },
      { raw: original.replace('"attempts":1', '"attempts":"\\ud800"'), code: "json_ambiguous" },
      { raw: "[".repeat(18) + "0" + "]".repeat(18), code: "json_limits_exceeded" },
      { raw: JSON.stringify(Array.from({ length: 2049 }, () => 0)), code: "json_limits_exceeded" },
      { raw: "{\"x\":true,}", code: "json_invalid" },
    ];
    for (const { raw, code } of cases) expect(check(f, envelopeForBytes(f, Buffer.from(raw))))
      .toMatchObject({ diagnostic: code, cryptographicSignature: "verified" });
    expect(check(f, envelopeForBytes(f, Buffer.from([0xed, 0xa0, 0x80])))).toMatchObject({ diagnostic: "utf8_invalid", cryptographicSignature: "verified" });
  });
});
