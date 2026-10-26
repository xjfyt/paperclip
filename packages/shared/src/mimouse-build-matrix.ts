/** This is an evidence inventory, never an authorization or release gate. */
export const MIMOUSE_BUILD_TARGETS = [
  { platform: "windows", arch: "x86_64" }, { platform: "windows", arch: "arm64" },
  { platform: "macos", arch: "x86_64" }, { platform: "macos", arch: "arm64" },
  { platform: "linux", arch: "x86_64" }, { platform: "linux", arch: "arm64" },
] as const;
export type MimouseBuildTarget = typeof MIMOUSE_BUILD_TARGETS[number];
export type MimouseMatrixBlocker = "manifest_missing" | "manifest_invalid" | "manifest_identity_mismatch" | "artifact_missing" | "runner_evidence_missing" | "upload_contract_missing";
export interface MimouseBuildMatrix {
  schemaVersion: 1;
  companyId: string; deliveryId: string; gitlabOrigin: string; projectId: number; commitSha: string;
  targets: Array<{
    platform: MimouseBuildTarget["platform"]; arch: MimouseBuildTarget["arch"];
    status: "blocked";
    /** Platform/arch are declarations; hashing bytes does not prove their target. */
    artifactEvidence: "none" | "local_bytes_hashed";
    artifacts: Array<{ fileName: string; sha256: string; sizeBytes: number; declaredBuildJob: string }>;
    blockers: MimouseMatrixBlocker[];
    runnerVerified: false; testVerified: false; signatureVerified: false;
  }>;
  upload: { status: "blocked"; reason: "upload_contract_missing" };
  readyForRelease: false;
}
