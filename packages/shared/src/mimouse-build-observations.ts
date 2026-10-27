import { z } from "zod";
import { mimouseProvenanceTimeSchema } from "./mimouse-build-verification.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const profileId = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
const code = z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/);
const status = z.enum(["success", "failed", "canceled", "running", "pending", "other"]);
/** Only selectors and an optimistic concurrency token; never a URL, secret or trust policy. */
export const startMimouseBuildObservationSchema = z.object({
  requestId: z.string().uuid(), profileId, jobId: id, expectedBinding: digest,
}).strict();
export type StartMimouseBuildObservationInput = z.infer<typeof startMimouseBuildObservationSchema>;

const provenance = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_checked"), reason: z.enum([
    "not_collected", "invocation_mapping_unconfigured", "invocation_unavailable",
  ]) }).strict(),
  z.object({ status: z.literal("disabled"), diagnostic: code,
    cryptographicSignature: z.enum(["not_checked", "invalid", "verified"]) }).strict(),
  z.object({ status: z.literal("rejected"), diagnostic: code,
    cryptographicSignature: z.enum(["not_checked", "invalid", "verified"]) }).strict(),
  z.object({ status: z.literal("verified_claim"), cryptographicSignature: z.literal("verified"),
    payloadSha256: digest, policySha256: digest, verifiedAt: mimouseProvenanceTimeSchema,
    startedOn: mimouseProvenanceTimeSchema, finishedOn: mimouseProvenanceTimeSchema }).strict(),
]);
export const mimouseBuildObservationSummarySchema = z.object({
  status: z.enum(["disabled", "blocked", "observed"]), diagnostic: code, admission: z.literal("blocked"),
  job: z.object({ jobId: id, pipelineId: id, projectId: id,
    commitSha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/), status,
    erasure: z.enum(["unknown", "not_erased", "erased"]),
    artifactExpiry: z.enum(["unknown", "not_scheduled", "reported"]),
    // Provider expiry metadata may carry an offset; signed build times below
    // retain the provenance library's stricter canonical UTC acceptance profile.
    artifactsExpireAt: z.string().max(40).datetime({ offset: true }).nullable(),
  }).strict().optional(),
  pipelineStatus: status.optional(),
  artifact: z.object({ sha256: digest, sizeBytes: z.number().int().min(0).max(64 * 1024 * 1024),
    pathSha256: digest, basis: z.literal("exact_job_bytes") }).strict().optional(),
  envelopeSha256: digest.optional(), observedAt: mimouseProvenanceTimeSchema.optional(),
  jobRechecked: z.boolean(), pipelineRechecked: z.boolean(), provenance,
  blockers: z.array(z.enum(["controller_provenance_unavailable", "workflow_closure_unassessed", "platform_unassessed",
    "tests_unassessed", "code_signature_unassessed", "erasure_unknown", "artifact_expiry_unknown",
    "invocation_mapping_unconfigured", "invocation_unavailable", "provenance_not_verified"])).max(10),
  otherFacts: z.object({ workflowClosure: z.literal("unassessed"), platform: z.literal("unassessed"),
    tests: z.literal("unassessed"), artifactCodeSignature: z.literal("unassessed"),
    controllerObservation: z.literal("blocked"), c3: z.literal("blocked") }).strict(),
}).strict();
export type MimouseBuildObservationSummary = z.infer<typeof mimouseBuildObservationSummarySchema>;
export type MimouseBuildObservationCurrentness = {
  /** Local configuration/context comparison only, NEVER a fresh remote liveness claim. */
  status: "local_current" | "stale" | "unknown";
  reasons: Array<"context_changed" | "configuration_changed" | "credential_changed" | "verification_expired"
    | "configuration_unavailable" | "context_unavailable" | "historical_observation">;
};
export interface MimouseBuildObservationReceipt {
  id: string; requestId: string; deliveryId: string; profileId: string;
  status: "observed" | "blocked"; diagnostic: string; admission: "blocked";
  result: MimouseBuildObservationSummary;
  /** Original persisted observation time; reading/replaying does not refresh it. */
  observedAt: string | null; createdAt: string; currentness: MimouseBuildObservationCurrentness;
}
export interface MimouseBuildObservationContext {
  enabled: boolean; diagnostic: string;
  profiles: Array<{ id: string; expectedBinding: string; artifactName: string; pipelineId: number; headSha: string }>;
}
export interface MimouseBuildObservationRequestOutcome {
  input: StartMimouseBuildObservationInput;
  requestId: string; state: "running" | "retryable" | "terminal" | "interrupted";
  attemptCount: number; createdAt: string; retryUntil: string;
  receipt: MimouseBuildObservationReceipt | null;
}
export interface MimouseBuildObservationPage {
  receipts: MimouseBuildObservationReceipt[];
  nextCursor: string | null;
}
