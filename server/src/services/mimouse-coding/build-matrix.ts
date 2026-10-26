import { z } from "zod";
import { MIMOUSE_BUILD_TARGETS, type MimouseBuildMatrix, type MimouseMatrixBlocker } from "@paperclipai/shared";
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const artifact = z.object({
  fileName: z.string().min(1).max(1000), sha256: z.string().regex(/^[a-f0-9]{64}$/), sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  platform: z.enum(["windows", "macos", "linux"]), arch: z.enum(["x86_64", "arm64"]), buildJob: z.string().min(1).max(200),
});
const manifestSchema = z.object({ schemaVersion: z.literal(1), project: z.string(), version: z.string().min(1).max(100), commitSha: sha, artifacts: z.array(artifact).min(1).max(30) });
type Delivery = { id: string; companyId: string; gitlabOrigin: string; projectId: number; headSha: string; artifactManifest: unknown };
/** Recompute from the company-scoped delivery, ignoring caller-written matrix,
 * uploaded/signed/tested booleans and all remote/absolute file locations.
 * Until an actual Runner verifier is integrated every target remains blocked. */
export function buildMatrixInventory(delivery: Delivery): MimouseBuildMatrix {
  const parsed = manifestSchema.safeParse(delivery.artifactManifest);
  let invalid: MimouseMatrixBlocker | undefined;
  if (delivery.artifactManifest == null) invalid = "manifest_missing";
  else if (!parsed.success) invalid = "manifest_invalid";
  else if (parsed.data.project !== String(delivery.projectId) || parsed.data.commitSha !== delivery.headSha) invalid = "manifest_identity_mismatch";
  const artifacts = !invalid && parsed.success ? parsed.data.artifacts : [];
  return {
    schemaVersion: 1, companyId: delivery.companyId, deliveryId: delivery.id, gitlabOrigin: delivery.gitlabOrigin,
    projectId: delivery.projectId, commitSha: delivery.headSha,
    targets: MIMOUSE_BUILD_TARGETS.map(target => {
      const selected = artifacts.filter(item => item.platform === target.platform && item.arch === target.arch);
      const blockers: MimouseMatrixBlocker[] = invalid ? [invalid] : selected.length ? [] : ["artifact_missing"];
      blockers.push("runner_evidence_missing");
      return { ...target, status: "blocked", artifactEvidence: selected.length ? "local_bytes_hashed" : "none",
        artifacts: selected.map(item => ({ fileName: item.fileName, sha256: item.sha256, sizeBytes: item.sizeBytes, declaredBuildJob: item.buildJob })),
        blockers, runnerVerified: false, testVerified: false, signatureVerified: false };
    }),
    upload: { status: "blocked", reason: "upload_contract_missing" }, readyForRelease: false,
  };
}
