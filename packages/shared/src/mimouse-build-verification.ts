import { z } from "zod";

/** A deliberately narrow acceptance profile, not a general SLSA parser. */
export const MIMOUSE_PROVENANCE_PROFILE = "dsse-slsa-v1-ed25519-single-subject-v1";
export const MIMOUSE_PROVENANCE_LIMITS = {
  envelopeBytes: 96 * 1024, payloadBytes: 64 * 1024, parametersBytes: 16 * 1024,
  jsonDepth: 16, jsonNodes: 2048,
} as const;
const label = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:/@-]+$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const gitCommit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const identifier = z.string().min(1).max(2000).regex(/^[^\s\u0000-\u001f\u007f]+$/);
// These are opaque identities to compare, never fetch targets.
const uri = identifier.refine(value => /^[a-z][a-z0-9+.-]*:/.test(value));
export const mimouseProvenanceTimeSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
  .refine(value => Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === (value.length === 20 ? value.replace("Z", ".000Z") : value));
export const mimouseProvenanceSubjectSchema = z.object({
  name: identifier, digest: z.object({ sha256 }).strict(),
}).strict();
export const mimouseProvenanceSourceSchema = z.object({
  uri, digest: z.object({ gitCommit }).strict(),
}).strict();
export const mimouseDsseEnvelopeSchema = z.object({
  payloadType: z.literal("application/vnd.in-toto+json"),
  payload: z.string().min(1).max(88 * 1024),
  // keyid is only a selection hint; it is never proof of identity.
  signatures: z.tuple([z.object({ keyid: label, sig: z.string().min(1).max(88) }).strict()]),
}).strict();
export const mimouseBuildProvenanceStatementSchema = z.object({
  _type: z.literal("https://in-toto.io/Statement/v1"),
  subject: z.tuple([mimouseProvenanceSubjectSchema]),
  predicateType: z.literal("https://slsa.dev/provenance/v1"),
  predicate: z.object({
    buildDefinition: z.object({
      buildType: uri,
      // The verifier requires exact structural equality to the operator policy.
      // Unknown external parameter keys therefore cannot be silently accepted.
      externalParameters: z.record(z.string().min(1).max(200), z.unknown()),
      resolvedDependencies: z.tuple([mimouseProvenanceSourceSchema]),
    }).strict(),
    runDetails: z.object({
      builder: z.object({ id: uri }).strict(),
      metadata: z.object({
        invocationId: identifier, startedOn: mimouseProvenanceTimeSchema, finishedOn: mimouseProvenanceTimeSchema,
      }).strict(),
    }).strict(),
  }).strict(),
}).strict();

/** Server/operator configuration ONLY. Never accept this from an API request. */
export const mimouseBuildVerificationDisabledSchema = z.object({ schemaVersion: z.literal(1), enabled: z.literal(false) }).strict();
export const mimouseBuildTrustPolicySchema = z.object({
  schemaVersion: z.literal(1), enabled: z.literal(true),
  policyId: label, revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), companyId: label,
  profile: z.literal(MIMOUSE_PROVENANCE_PROFILE), builderId: uri, buildType: uri, sourceUri: uri,
  // Entire expected buildType-specific object, including workflow path/ref and
  // every input. JSON text enables duplicate/depth checks before object parsing.
  externalParametersJson: z.string().min(2).max(MIMOUSE_PROVENANCE_LIMITS.parametersBytes),
  maxBuildAgeSeconds: z.number().int().min(1).max(31 * 86400),
  maxClockSkewSeconds: z.number().int().min(0).max(300),
  keys: z.array(z.object({
    keyId: label, scheme: z.literal("ed25519"), publicKeyPem: z.string().min(1).max(2048),
    validFrom: mimouseProvenanceTimeSchema, validUntil: mimouseProvenanceTimeSchema,
    revokedAt: mimouseProvenanceTimeSchema.nullable(),
  }).strict()).min(1).max(8),
}).strict();

/** Authenticated server context, separate from the external standard payload.
 * The caller must resolve these expectations from its authorized operation and
 * controller observations, never simply echo a client/envelope assertion. */
export const mimouseBuildVerificationContextSchema = z.object({
  companyId: label, operationId: label, invocationId: identifier,
  source: mimouseProvenanceSourceSchema, subject: mimouseProvenanceSubjectSchema,
  buildNotBefore: mimouseProvenanceTimeSchema,
}).strict();
export type MimouseDsseEnvelope = z.infer<typeof mimouseDsseEnvelopeSchema>;
export type MimouseBuildProvenanceStatement = z.infer<typeof mimouseBuildProvenanceStatementSchema>;
export type MimouseBuildTrustPolicy = z.infer<typeof mimouseBuildTrustPolicySchema>;
export type MimouseBuildVerificationContext = z.infer<typeof mimouseBuildVerificationContextSchema>;
export type MimouseProvenanceDiagnostic =
  | "disabled" | "policy_invalid" | "context_invalid" | "context_mismatch" | "time_invalid"
  | "input_too_large" | "input_invalid" | "utf8_invalid" | "json_invalid" | "json_ambiguous"
  | "json_limits_exceeded" | "envelope_invalid" | "base64_invalid" | "payload_too_large"
  | "key_unknown" | "key_invalid" | "key_revoked" | "key_not_yet_valid" | "key_expired"
  | "signature_invalid" | "claims_invalid" | "builder_mismatch" | "build_type_mismatch"
  | "workflow_parameters_mismatch" | "source_mismatch" | "subject_mismatch" | "invocation_mismatch"
  | "build_time_invalid" | "build_in_future" | "build_too_old" | "build_before_context"
  | "build_outside_key_window";
export interface MimouseBuildUnassessedFacts {
  artifactBytes: "unassessed"; artifactCodeSignature: "unassessed"; platform: "unassessed";
  tests: "unassessed"; workflowClosure: "unassessed"; controllerObservation: "blocked"; c3: "blocked";
}
export type MimouseBuildVerificationResult = {
  status: "disabled" | "rejected";
  diagnostic: MimouseProvenanceDiagnostic;
  cryptographicSignature: "not_checked" | "invalid" | "verified";
  otherFacts: MimouseBuildUnassessedFacts;
} | {
  status: "verified_claim"; cryptographicSignature: "verified";
  profile: typeof MIMOUSE_PROVENANCE_PROFILE;
  policyId: string; policyRevision: number; policySha256: string; keyId: string; publicKeySha256: string;
  context: MimouseBuildVerificationContext;
  envelopeSha256: string; payloadSha256: string;
  /** Caller-supplied trusted server time, not a new build/issuance time or durable replay proof. */
  verifiedAt: string; startedOn: string; finishedOn: string;
  builderId: string; buildType: string;
  otherFacts: MimouseBuildUnassessedFacts;
};
