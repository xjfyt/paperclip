import { z } from "zod";
import {
  mimouseBuildVerificationContextSchema,
  type MimouseBuildVerificationResult, type MimouseProvenanceDiagnostic,
} from "@paperclipai/shared";

export const GITLAB_BUILD_OBSERVATION_LIMITS = { metadataBytes: 2 * 1024 * 1024, artifactBytes: 64 * 1024 * 1024, totalMs: 30_000 } as const;
const id = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const label = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:/@-]+$/);
const artifactPath = z.string().min(1).max(1000).regex(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/)
  .refine(value => value.split("/").every(part => part !== "." && part !== ".."));
/** Server-owned settings, not an API request. There is no default registration. */
export const gitlabBuildObservationConfigSchema = z.object({
  schemaVersion: z.literal(1), enabled: z.literal(true), companyId: label,
  origin: z.string().max(2000), allowedOrigins: z.array(z.string().max(2000)).min(1).max(32),
  projectId: id, sourceUri: z.string().min(1).max(2000), artifactPath, provenancePath: artifactPath,
  // Opt in only if this builder documents invocationId = GitLab job web_url.
  // This is a mapping of an existing CI identity, not a controller protocol.
  invocationMapping: z.literal("gitlab_job_web_url").nullable(),
  totalTimeoutMs: z.number().int().min(1).max(GITLAB_BUILD_OBSERVATION_LIMITS.totalMs),
}).strict().refine(value => value.artifactPath !== value.provenancePath);
export const gitlabBuildObservationContextSchema = mimouseBuildVerificationContextSchema.omit({ invocationId: true }).extend({
  projectId: id, pipelineId: id, jobId: id,
  expectedSizeBytes: z.number().int().min(0).max(GITLAB_BUILD_OBSERVATION_LIMITS.artifactBytes),
}).strict();
export type GitlabBuildObservationConfig = z.infer<typeof gitlabBuildObservationConfigSchema>;
export type GitlabBuildObservationContext = z.infer<typeof gitlabBuildObservationContextSchema>;
export type GitlabBuildObservationTransport = (url: string, init: RequestInit) => Promise<Response>;
export type GitlabObservationCode = "disabled" | "config_invalid" | "context_invalid" | "context_mismatch"
  | "credential_invalid" | "origin_not_allowed" | "source_mapping_invalid" | "private_endpoint"
  | "cancelled" | "deadline_exceeded" | "transport_failed" | "redirect_refused" | "http_status_rejected"
  | "body_missing" | "body_failed" | "response_too_large" | "receipt_invalid" | "identity_mismatch"
  | "job_not_successful" | "pipeline_not_successful" | "job_erased" | "job_changed" | "pipeline_changed"
  | "artifact_size_mismatch" | "artifact_digest_mismatch" | "observation_complete";
export type GitlabObservationStatus = "success" | "failed" | "canceled" | "running" | "pending" | "other";
export interface GitlabJobObservation {
  jobId: number; pipelineId: number; projectId: number; commitSha: string; status: GitlabObservationStatus;
  erasure: "unknown" | "not_erased" | "erased";
  artifactExpiry: "unknown" | "not_scheduled" | "reported";
  artifactsExpireAt: string | null;
}
export type GitlabProvenanceObservation = {
  status: "not_checked"; reason: "not_collected" | "invocation_mapping_unconfigured" | "invocation_unavailable";
} | {
  status: "disabled" | "rejected"; diagnostic: MimouseProvenanceDiagnostic;
  cryptographicSignature: "not_checked" | "invalid" | "verified";
} | Pick<Extract<MimouseBuildVerificationResult, { status: "verified_claim" }>,
  "status" | "cryptographicSignature" | "payloadSha256" | "policySha256" | "verifiedAt" | "startedOn" | "finishedOn">;
export interface GitlabBuildObservationResult {
  status: "disabled" | "blocked" | "observed"; diagnostic: GitlabObservationCode; admission: "blocked";
  binding?: { companyId: string; operationId: string; projectId: number; pipelineId: number; jobId: number;
    sourceSha: string; originSha256: string; sourceUriSha256: string };
  job?: GitlabJobObservation;
  pipelineStatus?: GitlabObservationStatus;
  artifact?: { sha256: string; sizeBytes: number; pathSha256: string; basis: "exact_job_bytes" };
  envelopeSha256?: string;
  observedAt?: string;
  jobRechecked: boolean; pipelineRechecked: boolean;
  provenance: GitlabProvenanceObservation;
  blockers: Array<"controller_provenance_unavailable" | "workflow_closure_unassessed" | "platform_unassessed"
    | "tests_unassessed" | "code_signature_unassessed" | "erasure_unknown" | "artifact_expiry_unknown"
    | "invocation_mapping_unconfigured" | "invocation_unavailable" | "provenance_not_verified">;
  otherFacts: { workflowClosure: "unassessed"; platform: "unassessed"; tests: "unassessed";
    artifactCodeSignature: "unassessed"; controllerObservation: "blocked"; c3: "blocked" };
}
