import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIMOUSE_PROVENANCE_PROFILE, type MimouseBuildTrustPolicy } from "@paperclipai/shared";
import { BUILD_OBSERVATION_CONFIG_LIMITS, loadBuildObservationConfig, type BuildObservationProfile } from "../services/mimouse-coding/build-observation-config.js";

const companyId = "d9e901dc-a5a4-4b21-b3b9-8dd522340997"; const origin = "https://git.example";
const temporary: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
function profile(): BuildObservationProfile {
  return { id: "linux-x64", companyId, manifestPath: "dist/app.bin", subjectName: "app.bin", maxObservationAgeSeconds: 3600,
    observer: { schemaVersion: 1, enabled: true, companyId, origin, allowedOrigins: [origin], projectId: 3,
      sourceUri: `${origin}/org/project.git`, artifactPath: "dist/app.bin", provenancePath: "dist/app.dsse.json", invocationMapping: null, totalTimeoutMs: 30000 },
    provenancePolicy: null };
}
function policy(): MimouseBuildTrustPolicy {
  const keys = generateKeyPairSync("ed25519"); // Temporary fixture, not a registered credential.
  return { schemaVersion: 1, enabled: true, companyId, profile: MIMOUSE_PROVENANCE_PROFILE, policyId: "fixture", revision: 1,
    builderId: "https://builder.example/id", buildType: "https://builder.example/type", sourceUri: profile().observer.sourceUri,
    externalParametersJson: '{"workflow":{"path":".gitlab-ci.yml"}}', maxBuildAgeSeconds: 3600, maxClockSkewSeconds: 0,
    keys: [{ keyId: "fixture", scheme: "ed25519", publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      validFrom: "2026-01-01T00:00:00Z", validUntil: "2027-01-01T00:00:00Z", revokedAt: null }] };
}
function document(profiles: BuildObservationProfile[] = [profile()]) { return { schemaVersion: 1, profiles }; }
async function file(bytes: string | Uint8Array) {
  const dir = await mkdtemp(path.join(tmpdir(), "mimouse-observation-config-")); temporary.push(dir);
  const filename = path.join(dir, "operator.json"); await writeFile(filename, bytes, { mode: 0o600 }); return filename;
}
async function load(bytes: string | Uint8Array) { return loadBuildObservationConfig({ enabled: true, filePath: await file(bytes) }); }
async function rejectDocument(input: unknown) { expect(await load(JSON.stringify(input))).toEqual({ enabled: false, diagnostic: "config_invalid" }); }

describe("operator-owned build observation configuration", () => {
  it("is disabled by default and does not inspect the selected file", async () => {
    vi.stubEnv("PAPERCLIP_BUILD_OBSERVATIONS_ENABLED", "");
    vi.stubEnv("PAPERCLIP_BUILD_OBSERVATIONS_CONFIG_FILE", "/must-not-read/operator.json");
    expect(await loadBuildObservationConfig()).toEqual({ enabled: false, diagnostic: "disabled" });
    expect(await loadBuildObservationConfig({ enabled: false, get filePath(): string { throw Error("must not read"); } })).toEqual({ enabled: false, diagnostic: "disabled" });
  });
  it("loads optional unsigned profiles without creating trust or performing network I/O", async () => {
    const result = await load(JSON.stringify(document()));
    expect(result).toMatchObject({ enabled: true, digest: expect.stringMatching(/^[a-f0-9]{64}$/), profiles: [profile()] });
  });
  it("reads the server-selected environment file and never caches its contents", async () => {
    const filename = await file(JSON.stringify(document()));
    vi.stubEnv("PAPERCLIP_BUILD_OBSERVATIONS_ENABLED", "true"); vi.stubEnv("PAPERCLIP_BUILD_OBSERVATIONS_CONFIG_FILE", filename);
    const first = await loadBuildObservationConfig(); expect(first.enabled).toBe(true);
    const changed = profile(); changed.maxObservationAgeSeconds = 300;
    await writeFile(filename, JSON.stringify(document([changed])));
    const second = await loadBuildObservationConfig(); expect(second.enabled).toBe(true);
    if (first.enabled && second.enabled) expect(first.digest).not.toBe(second.digest);
    await writeFile(filename, "invalid"); expect(await loadBuildObservationConfig()).toEqual({ enabled: false, diagnostic: "config_invalid" });
  });
  it("canonicalizes object key order but binds policy and profile contents", async () => {
    const filename = await file(JSON.stringify(document()));
    const first = await loadBuildObservationConfig({ enabled: true, filePath: filename });
    await writeFile(filename, JSON.stringify({ profiles: [profile()], schemaVersion: 1 }));
    const second = await loadBuildObservationConfig({ enabled: true, filePath: filename });
    expect(first).toEqual(second);
    const signed = profile(); signed.provenancePolicy = policy();
    const withPolicy = await load(JSON.stringify(document([signed]))); expect(withPolicy.enabled).toBe(true);
    if (first.enabled && withPolicy.enabled) expect(first.digest).not.toBe(withPolicy.digest);
  });
  it("accepts canonical git+https source identities without fetching them", async () => {
    const p = profile(); p.observer.sourceUri = `git+${p.observer.sourceUri}`;
    expect((await load(JSON.stringify(document([p])))).enabled).toBe(true);
  });
  it("enforces actual byte limits while permitting an exactly bounded document", async () => {
    const raw = JSON.stringify(document());
    expect((await load(raw.padEnd(BUILD_OBSERVATION_CONFIG_LIMITS.bytes, " "))).enabled).toBe(true);
    expect(await load(raw.padEnd(BUILD_OBSERVATION_CONFIG_LIMITS.bytes + 1, " "))).toEqual({ enabled: false, diagnostic: "config_invalid" });
  });
  it("rejects symlinks, directories and missing files without disclosing paths", async () => {
    const target = await file(JSON.stringify(document())); const link = path.join(path.dirname(target), "link.json"); await symlink(target, link);
    for (const filePath of [link, path.dirname(target), `${target}.missing`])
      expect(await loadBuildObservationConfig({ enabled: true, filePath })).toEqual({ enabled: false, diagnostic: "config_invalid" });
  });
  it.each([undefined, "relative.json", "/tmp/../operator.json", "/tmp//operator.json", "/tmp/operator\u0000.json", "https://git.example/operator.json"])("rejects noncanonical server file path %s", async filePath => {
    expect(await loadBuildObservationConfig({ enabled: true, filePath })).toEqual({ enabled: false, diagnostic: "config_invalid" });
  });
  it.each([
    (raw: string) => raw.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    (raw: string) => raw.replace('"schemaVersion":1', '"schemaVersion":1,"\\u0073chemaVersion":1'),
    (raw: string) => raw.replace('"schemaVersion":1', '"__proto__":{},"schemaVersion":1'),
    (raw: string) => raw.replace('"schemaVersion":1', '"schemaVersion":2'),
    (raw: string) => raw.replace('"projectId":3', '"projectId":3.00000000000000001'),
    (raw: string) => raw.replace('"projectId":3', '"projectId":3e0'),
    (raw: string) => raw.replace('"projectId":3', '"projectId":9007199254740993'),
    (raw: string) => raw.replace('"projectId":3', '"projectId":-0'),
    (raw: string) => raw.replace('"subjectName":"app.bin"', '"subjectName":"\\ud800"'),
    (raw: string) => `${raw} null`,
    (raw: string) => `\ufeff${raw}`,
    (raw: string) => raw.replace('"schemaVersion":1', `"extra":${"[".repeat(18)}0${"]".repeat(18)},"schemaVersion":1`),
  ])("fails closed for ambiguous or unsupported input %#", async change => {
    expect(await load(change(JSON.stringify(document())))).toEqual({ enabled: false, diagnostic: "config_invalid" });
  });
  it("rejects invalid UTF-8 and excess JSON nodes", async () => {
    expect(await load(Buffer.from([0xc0, 0xaf]))).toEqual({ enabled: false, diagnostic: "config_invalid" });
    expect(await load(`[${Array.from({ length: 8193 }, () => "0").join(",")}]`)).toEqual({ enabled: false, diagnostic: "config_invalid" });
  });
  it.each([
    { name: "cross-company observer", change: (p: BuildObservationProfile) => { p.observer.companyId = "other"; } },
    { name: "unapproved origin", change: (p: BuildObservationProfile) => { p.observer.allowedOrigins = ["https://other.example"]; } },
    { name: "HTTP origin", change: (p: BuildObservationProfile) => { p.observer.origin = "http://git.example"; } },
    { name: "origin slash", change: (p: BuildObservationProfile) => { p.observer.origin += "/"; } },
    { name: "origin credentials", change: (p: BuildObservationProfile) => { p.observer.origin = "https://token@git.example"; } },
    { name: "duplicate origin", change: (p: BuildObservationProfile) => { p.observer.allowedOrigins.push(origin); } },
    { name: "other source host", change: (p: BuildObservationProfile) => { p.observer.sourceUri = "https://other.example/org/repo"; } },
    { name: "source traversal", change: (p: BuildObservationProfile) => { p.observer.sourceUri = `${origin}/org/a/../project`; } },
    { name: "source encoded slash", change: (p: BuildObservationProfile) => { p.observer.sourceUri = `${origin}/org%2fother/project`; } },
    { name: "source query", change: (p: BuildObservationProfile) => { p.observer.sourceUri += "?token=secret"; } },
    { name: "manifest traversal", change: (p: BuildObservationProfile) => { p.manifestPath = "dist/../app.bin"; } },
    { name: "artifact traversal", change: (p: BuildObservationProfile) => { p.observer.artifactPath = "../app.bin"; } },
    { name: "colliding artifact paths", change: (p: BuildObservationProfile) => { p.observer.provenancePath = p.observer.artifactPath; } },
  ])("rejects $name", async ({ change }) => { const p = profile(); change(p); await rejectDocument(document([p])); });
  it("rejects duplicate profiles, per-company/global excess and unknown configuration fields", async () => {
    await rejectDocument(document([profile(), profile()]));
    await rejectDocument(document(Array.from({ length: 9 }, (_, index) => ({ ...profile(), id: `profile-${index}` }))));
    await rejectDocument(document(Array.from({ length: 33 }, (_, index) => ({ ...profile(), id: `profile-${index}` }))));
    await rejectDocument({ ...document(), credentials: "not allowed" });
    await rejectDocument({ schemaVersion: 1, profiles: [{ ...profile(), observer: { ...profile().observer, token: "not allowed" } }] });
  });
  it.each([
    { name: "company", change: (p: MimouseBuildTrustPolicy) => { p.companyId = "other"; } },
    { name: "source", change: (p: MimouseBuildTrustPolicy) => { p.sourceUri = `${origin}/other/repo`; } },
    { name: "duplicate parameters", change: (p: MimouseBuildTrustPolicy) => { p.externalParametersJson = '{"workflow":1,"workflow":2}'; } },
    { name: "empty parameters", change: (p: MimouseBuildTrustPolicy) => { p.externalParametersJson = "{}"; } },
    { name: "invalid key", change: (p: MimouseBuildTrustPolicy) => { p.keys[0].publicKeyPem = "private-or-invalid-key"; } },
    { name: "inverted key window", change: (p: MimouseBuildTrustPolicy) => { p.keys[0].validFrom = p.keys[0].validUntil; } },
    { name: "duplicate key alias", change: (p: MimouseBuildTrustPolicy) => { p.keys.push({ ...p.keys[0], keyId: "alias" }); } },
  ])("rejects invalid trust policy $name", async ({ change }) => {
    const p = profile(); p.provenancePolicy = policy(); change(p.provenancePolicy); await rejectDocument(document([p]));
  });
});

it("changes the private binding when identical config moves to another operator-selected path", async () => {
  const first = await load(JSON.stringify(document())); const second = await load(JSON.stringify(document()));
  if (!first.enabled || !second.enabled) throw Error("fixture_config_invalid");
  expect(first.digest).not.toBe(second.digest);
  expect(Object.keys(first).sort()).toEqual(["digest", "enabled", "profiles"]);
});
