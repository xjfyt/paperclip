import { describe, expect, it } from "vitest";
import { buildMatrixInventory } from "../services/mimouse-coding/build-matrix.js";
const head = "a".repeat(40);
const artifact = { fileName: "app.bin", platform: "linux", arch: "x86_64", sha256: "b".repeat(64), sizeBytes: 12, buildJob: "declared-local-job", path: "/private/root/app.bin", location: "https://secret.invalid/?token=secret" };
const manifest = { schemaVersion: 1, project: "7", version: "test", commitSha: head, artifacts: [artifact] };
const delivery = { id: "delivery-a", companyId: "company-a", gitlabOrigin: "https://git.example", projectId: 7, headSha: head, artifactManifest: manifest };
describe("six-target build evidence inventory", () => {
  it("reports missing evidence separately for all six required targets", () => {
    const result = buildMatrixInventory({ ...delivery, artifactManifest: null });
    expect(result.targets.map(t => `${t.platform}/${t.arch}`)).toEqual(["windows/x86_64", "windows/arm64", "macos/x86_64", "macos/arm64", "linux/x86_64", "linux/arm64"]);
    expect(result.targets.every(t => t.status === "blocked" && t.blockers.includes("manifest_missing"))).toBe(true);
    expect(result.upload).toEqual({ status: "blocked", reason: "upload_contract_missing" });
  });
  it("does not upgrade local hashes or claimed test/signature/upload flags to Runner verification", () => {
    const result = buildMatrixInventory({ ...delivery, artifactManifest: { ...manifest, uploaded: true, productionReleased: true,
      buildMatrix: { readyForRelease: true }, artifacts: [{ ...artifact, testStatus: "passed", signatureStatus: "verified" }] } });
    expect(result.targets[4]).toMatchObject({ artifactEvidence: "local_bytes_hashed", status: "blocked", blockers: ["runner_evidence_missing"], runnerVerified: false, testVerified: false, signatureVerified: false });
    expect(result.targets.filter(t => t.artifactEvidence === "none")).toHaveLength(5);
    expect(result.readyForRelease).toBe(false); expect(JSON.stringify(result)).not.toMatch(/secret|private|https:\/\/secret/);
  });
  it.each([{ projectId: 8 }, { headSha: "c".repeat(40) }])("rejects a manifest for a different project or SHA (%j)", patch => {
    const result = buildMatrixInventory({ ...delivery, ...patch });
    expect(result.targets.every(t => t.artifacts.length === 0 && t.blockers.includes("manifest_identity_mismatch"))).toBe(true);
  });
  it.each([{}, { ...manifest, schemaVersion: 99 }, { ...manifest, artifacts: [{ ...artifact, sha256: "not-a-hash" }] }, { ...manifest, artifacts: [{ ...artifact, sizeBytes: -1 }] }, { ...manifest, artifacts: [{ ...artifact, platform: "other" }] }])("fails closed on malformed legacy manifests", artifactManifest => {
    const result = buildMatrixInventory({ ...delivery, artifactManifest });
    expect(result.targets.every(t => t.artifacts.length === 0 && t.blockers.includes("manifest_invalid"))).toBe(true);
  });
  it("keeps company, delivery and GitLab origin identity and includes multiple files in one target", () => {
    const result = buildMatrixInventory({ ...delivery, artifactManifest: { ...manifest, artifacts: [artifact, { ...artifact, fileName: "app.map", sha256: "d".repeat(64) }] } });
    expect(result).toMatchObject({ companyId: "company-a", deliveryId: "delivery-a", gitlabOrigin: "https://git.example", projectId: 7, commitSha: head });
    expect(result.targets[4].artifacts).toHaveLength(2); expect(result.targets[4].runnerVerified).toBe(false);
  });
});
