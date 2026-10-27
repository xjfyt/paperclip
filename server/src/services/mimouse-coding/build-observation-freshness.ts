import type { MimouseBuildObservationSummary } from "@paperclipai/shared";
import type { BuildObservationProfile } from "./build-observation-config.js";

/** Local historical expiry only; never refreshes the original remote observation.
 * Conservatively stale if ANY configured key expires/revokes, even an unused one. */
export function buildObservationExpired(profile: Pick<BuildObservationProfile, "maxObservationAgeSeconds" | "provenancePolicy">,
  proof: MimouseBuildObservationSummary["provenance"], observedAt: Date, now: Date): boolean {
  const age = now.getTime() - observedAt.getTime(); const policy = profile.provenancePolicy;
  return age < 0 || age > profile.maxObservationAgeSeconds * 1000 || Boolean(policy && proof.status === "verified_claim" && (
    // Keep the verifier's startedOn basis, not the potentially much later finish.
    now.getTime() - Date.parse(proof.startedOn) > policy.maxBuildAgeSeconds * 1000
    || policy.keys.some(key => Date.parse(key.validUntil) <= now.getTime() || key.revokedAt !== null && Date.parse(key.revokedAt) <= now.getTime())));
}
