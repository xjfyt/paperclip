import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIMOUSE_PROVENANCE_PROFILE, type MimouseBuildProvenanceStatement, type MimouseBuildTrustPolicy } from "@paperclipai/shared";
import { guardedRemoteHttpFetch } from "../services/remote-http-fetch.js";
import { observeMimouseGitlabBuild } from "../services/mimouse-coding/gitlab-build-observer.js";
import { GITLAB_BUILD_OBSERVATION_LIMITS, type GitlabBuildObservationConfig, type GitlabBuildObservationContext,
  type GitlabBuildObservationTransport } from "../services/mimouse-coding/gitlab-build-observation-contract.js";

vi.mock("../services/remote-http-fetch.js", () => ({ guardedRemoteHttpFetch: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); vi.useRealTimers(); });
const origin = "https://git.example"; const commit = "a".repeat(40); const now = "2026-10-27T11:00:00.000Z";
const token = "fixture-credential-must-not-appear-in-result";
interface JobFixture {
  id: number; pipeline: { id: number; project_id: number; sha: string; status: string }; commit: { id: string };
  status: string; erased_at?: string | null; artifacts_expire_at?: string | null; web_url?: string;
  started_at: string; finished_at: string;
}
function fixture() {
  const bytes = Buffer.from("not executable: test artifact bytes");
  const source = { uri: `${origin}/org/project.git`, digest: { gitCommit: commit } };
  const subject = { name: "app.bin", digest: { sha256: createHash("sha256").update(bytes).digest("hex") } };
  const job: JobFixture = { id: 42, pipeline: { id: 7, project_id: 3, sha: commit, status: "success" }, commit: { id: commit }, status: "success",
    erased_at: null, artifacts_expire_at: null, web_url: `${origin}/org/project/-/jobs/42`,
    started_at: "2026-10-27T10:58:00.000Z", finished_at: "2026-10-27T10:59:00.000Z" };
  const statement: MimouseBuildProvenanceStatement = { _type: "https://in-toto.io/Statement/v1", subject: [subject], predicateType: "https://slsa.dev/provenance/v1",
    predicate: { buildDefinition: { buildType: "https://builder.example/type/v1", externalParameters: { workflow: { path: ".gitlab-ci.yml", ref: commit } }, resolvedDependencies: [source] },
      runDetails: { builder: { id: "https://builder.example/controller" }, metadata: { invocationId: `${origin}/org/project/-/jobs/42`, startedOn: job.started_at, finishedOn: job.finished_at } } } };
  const keys = generateKeyPairSync("ed25519"); // Memory-only fixtures; never real provisioning.
  const policy: MimouseBuildTrustPolicy = { schemaVersion: 1, enabled: true, policyId: "fixture", revision: 1, companyId: "company-a",
    profile: MIMOUSE_PROVENANCE_PROFILE, builderId: statement.predicate.runDetails.builder.id, buildType: statement.predicate.buildDefinition.buildType,
    sourceUri: source.uri, externalParametersJson: JSON.stringify(statement.predicate.buildDefinition.externalParameters), maxBuildAgeSeconds: 3600, maxClockSkewSeconds: 0,
    keys: [{ keyId: "fixture", scheme: "ed25519", publicKeyPem: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
      validFrom: "2026-10-01T00:00:00Z", validUntil: "2026-11-01T00:00:00Z", revokedAt: null }] };
  function envelope(value: MimouseBuildProvenanceStatement = statement) {
    const payload = Buffer.from(JSON.stringify(value));
    const pae = Buffer.concat([Buffer.from(`DSSEv1 28 application/vnd.in-toto+json ${payload.length} `), payload]);
    return Buffer.from(JSON.stringify({ payloadType: "application/vnd.in-toto+json", payload: payload.toString("base64"),
      signatures: [{ keyid: "fixture", sig: sign(null, pae, keys.privateKey).toString("base64") }] }));
  }
  const config: GitlabBuildObservationConfig = { schemaVersion: 1, enabled: true, companyId: "company-a", origin, allowedOrigins: [origin], projectId: 3,
    sourceUri: source.uri, artifactPath: "dist/app.bin", provenancePath: "provenance/app.dsse.json", invocationMapping: "gitlab_job_web_url", totalTimeoutMs: 30000 };
  const context: GitlabBuildObservationContext = { companyId: "company-a", operationId: "delivery-a", projectId: 3, pipelineId: 7, jobId: 42,
    source, subject, buildNotBefore: "2026-10-27T10:57:00Z", expectedSizeBytes: bytes.length };
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const transport: GitlabBuildObservationTransport = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/jobs/42")) return Response.json(job);
    if (url.endsWith("/pipelines/7")) return Response.json(job.pipeline);
    if (url.endsWith("/artifacts/dist/app.bin")) return new Response(bytes);
    if (url.endsWith("/artifacts/provenance/app.dsse.json")) return new Response(envelope());
    throw Error("unexpected fixture request");
  };
  return { bytes, job, context, config, policy, statement, envelope, calls, transport };
}
type Fixture = ReturnType<typeof fixture>;
function collect(f: Fixture, transport: GitlabBuildObservationTransport = f.transport, signal?: AbortSignal) {
  return observeMimouseGitlabBuild({ context: f.context, token, provenancePolicy: f.policy, signal }, f.config, { transport, now: () => new Date(now) });
}
function streamResponse(chunks: Uint8Array[], cancelled: () => void = () => undefined, status = 200) {
  return new Response(new ReadableStream<Uint8Array>({ pull(controller) { const next = chunks.shift(); if (next) controller.enqueue(next); else controller.close(); }, cancel: cancelled }), { status });
}

describe("exact-job read-only observation", () => {
  it("gets only exact IDs, hashes real bytes, rechecks identities, and never grants admission", async () => {
    const f = fixture(); const result = await collect(f);
    expect(result).toMatchObject({ status: "observed", admission: "blocked", diagnostic: "observation_complete", jobRechecked: true, pipelineRechecked: true,
      artifact: { sha256: f.context.subject.digest.sha256, sizeBytes: f.bytes.length, basis: "exact_job_bytes" },
      provenance: { status: "verified_claim", cryptographicSignature: "verified", finishedOn: f.job.finished_at },
      otherFacts: { controllerObservation: "blocked", c3: "blocked", platform: "unassessed", artifactCodeSignature: "unassessed", tests: "unassessed", workflowClosure: "unassessed" } });
    expect(f.calls.map(call => call.url)).toEqual(["/jobs/42", "/pipelines/7", "/jobs/42/artifacts/dist/app.bin", "/jobs/42/artifacts/provenance/app.dsse.json", "/jobs/42", "/pipelines/7"].map(path => `${origin}/api/v4/projects/3${path}`));
    for (const call of f.calls) { expect(call.init.method).toBe("GET"); expect(call.init.redirect).toBe("manual"); expect(new Headers(call.init.headers).get("accept-encoding")).toBe("identity"); }
    expect(JSON.stringify(result)).not.toMatch(/fixture-credential|BEGIN PUBLIC KEY|PRIVATE KEY|externalParameters|signatureVerified|readyForRelease/);
  });
  it("default-off reads no caller inputs and performs no network or clock work", async () => {
    const input = { get context(): unknown { throw Error("must not read"); }, get token(): string { throw Error("must not read"); } };
    const transport = vi.fn<GitlabBuildObservationTransport>(); const clock = vi.fn(() => new Date());
    for (const config of [undefined, { schemaVersion: 1, enabled: false }]) expect(await observeMimouseGitlabBuild(input, config, { transport, now: clock })).toMatchObject({ status: "disabled" });
    expect(transport).not.toHaveBeenCalled(); expect(clock).not.toHaveBeenCalled(); expect(guardedRemoteHttpFetch).not.toHaveBeenCalled();
  });
  it("uses the guarded default transport with private networking disabled", async () => {
    const f = fixture(); vi.mocked(guardedRemoteHttpFetch).mockImplementation(async (url, init) => f.transport(String(url), init));
    const result = await observeMimouseGitlabBuild({ context: f.context, token, provenancePolicy: f.policy }, f.config, { now: () => new Date(now) });
    expect(result.status).toBe("observed");
    expect(vi.mocked(guardedRemoteHttpFetch).mock.calls.every(call => call[2].allowPrivateNetwork === false)).toBe(true);
  });
  it("preserves guard rejections without leaking raw connection errors", async () => {
    const f = fixture(); vi.mocked(guardedRemoteHttpFetch).mockImplementation(async (_url, _init, options) => { throw options.error(token, "remote_http_private_endpoint"); });
    const result = await observeMimouseGitlabBuild({ context: f.context, token }, f.config);
    expect(result.diagnostic).toBe("private_endpoint"); expect(JSON.stringify(result)).not.toContain(token);
  });
  it("retains unknown erasure/expiry while still collecting bytes, never granting admission", async () => {
    const f = fixture(); delete f.job.erased_at; delete f.job.artifacts_expire_at;
    const result = await collect(f);
    expect(result).toMatchObject({ status: "observed", admission: "blocked", job: { erasure: "unknown", artifactExpiry: "unknown" } });
    expect(result.blockers).toEqual(expect.arrayContaining(["erasure_unknown", "artifact_expiry_unknown"]));
    expect(result.artifact?.sha256).toBe(f.context.subject.digest.sha256);
  });
  it("does not infer removal from an old expiry timestamp when exact bytes are still served", async () => {
    const f = fixture(); f.job.artifacts_expire_at = "2026-01-01T00:00:00Z";
    expect(await collect(f)).toMatchObject({ status: "observed", job: { artifactExpiry: "reported" }, admission: "blocked" });
  });
  it("does not fill missing invocation mapping from a valid envelope", async () => {
    const f = fixture(); f.config.invocationMapping = null;
    expect(await collect(f)).toMatchObject({ status: "observed", provenance: { status: "not_checked", reason: "invocation_mapping_unconfigured" }, admission: "blocked" });
    f.config.invocationMapping = "gitlab_job_web_url"; f.job.web_url = `${origin}/other/project/-/jobs/42?token=${token}`;
    const result = await collect(f); expect(result.provenance).toMatchObject({ status: "not_checked", reason: "invocation_unavailable" });
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it("keeps artifact observations even when cryptographic provenance is rejected", async () => {
    const f = fixture(); f.policy.keys[0].revokedAt = now;
    const result = await collect(f); expect(result).toMatchObject({ status: "observed", provenance: { status: "rejected", diagnostic: "key_revoked" } });
    expect(result.blockers).toContain("provenance_not_verified"); expect(result.artifact).toBeDefined();
  });
  it("does not claim trusted equality of signed build times and GitLab execution times", async () => {
    const f = fixture(); f.job.started_at = "2026-10-27T10:50:00.000Z"; f.job.finished_at = "2026-10-27T10:55:00.000Z";
    const result = await collect(f);
    expect(result).toMatchObject({ status: "observed", provenance: { status: "verified_claim", finishedOn: "2026-10-27T10:59:00.000Z" },
      admission: "blocked", otherFacts: { controllerObservation: "blocked" } });
  });
});

describe("identity and path boundaries", () => {
  it.each(["../app.bin", "a/../app.bin", "/app.bin", "a\\app.bin", "a/%2e%2e/app.bin", "a?token=x", "a//b", ".", "..", "a/#b"])("rejects unsafe artifact path %s before I/O", async artifactPath => {
    const f = fixture(); const result = await observeMimouseGitlabBuild({ context: f.context, token }, { ...f.config, artifactPath }, { transport: f.transport });
    expect(result.diagnostic).toBe("config_invalid"); expect(f.calls).toHaveLength(0);
  });
  it("rejects context company/project/source changes and unapproved or credential-bearing origins", async () => {
    const f = fixture();
    for (const context of [{ ...f.context, companyId: "company-b" }, { ...f.context, projectId: 99 }, { ...f.context, source: { ...f.context.source, uri: `${origin}/other/repo` } }])
      expect((await observeMimouseGitlabBuild({ context, token }, f.config, { transport: f.transport })).diagnostic).toBe("context_mismatch");
    for (const badOrigin of ["https://other.example", "https://user:pass@git.example", "http://git.example"])
      expect((await observeMimouseGitlabBuild({ context: f.context, token }, { ...f.config, origin: badOrigin }, { transport: f.transport })).diagnostic).toBe("origin_not_allowed");
    expect(f.calls).toHaveLength(0);
  });
  it.each([
    { name: "job ID", patch: (j: JobFixture) => { j.id++; } },
    { name: "pipeline ID", patch: (j: JobFixture) => { j.pipeline.id++; } },
    { name: "project ID", patch: (j: JobFixture) => { j.pipeline.project_id++; } },
    { name: "pipeline SHA", patch: (j: JobFixture) => { j.pipeline.sha = "b".repeat(40); } },
    { name: "source SHA", patch: (j: JobFixture) => { j.commit.id = "b".repeat(40); } },
  ])("rejects wrong $name without falling back to another job", async ({ patch }) => {
    const f = fixture(); patch(f.job); expect((await collect(f)).diagnostic).toBe("identity_mismatch"); expect(f.calls).toHaveLength(1);
  });
  it("independently checks the exact pipeline endpoint response", async () => {
    const f = fixture(); const result = await collect(f, async (url, init) => url.endsWith("/pipelines/7") ? Response.json({ ...f.job.pipeline, id: 8 }) : f.transport(url, init));
    expect(result.diagnostic).toBe("identity_mismatch"); expect(result.artifact).toBeUndefined();
  });
  it.each(["failed", "running", "manual"])("does not download artifacts for %s jobs", async value => {
    const f = fixture(); f.job.status = value; expect((await collect(f)).diagnostic).toBe("job_not_successful"); expect(f.calls).toHaveLength(2);
  });
  it("rejects erased jobs and changes after the download", async () => {
    const f = fixture(); f.job.erased_at = now; expect((await collect(f)).diagnostic).toBe("job_erased");
    f.job.erased_at = null; let jobReads = 0;
    const changed = await collect(f, async (url, init) => { if (url.endsWith("/jobs/42") && ++jobReads === 2) return Response.json({ ...f.job, status: "failed" }); return f.transport(url, init); });
    expect(changed).toMatchObject({ status: "blocked", diagnostic: "job_changed", jobRechecked: false });
    let pipelineReads = 0;
    const changedPipeline = await collect(f, async (url, init) => { if (url.endsWith("/pipelines/7") && ++pipelineReads === 2) return Response.json({ ...f.job.pipeline, status: "failed" }); return f.transport(url, init); });
    expect(changedPipeline).toMatchObject({ status: "blocked", diagnostic: "pipeline_changed", pipelineRechecked: false });
  });
});

describe("bounded HTTP body handling", () => {
  it.each([302, 401, 404, 500, 206])("releases rejected HTTP %s bodies without reading/redirecting", async status => {
    const f = fixture(); const cancelled = vi.fn();
    const response = streamResponse([Buffer.from(token)], cancelled, status);
    const transport = vi.fn<GitlabBuildObservationTransport>().mockResolvedValue(response);
    const result = await collect(f, transport);
    expect(result.diagnostic).toBe(status === 302 ? "redirect_refused" : "http_status_rejected");
    expect(cancelled).toHaveBeenCalledTimes(1); expect(transport).toHaveBeenCalledTimes(1); expect(JSON.stringify(result)).not.toContain(token);
  });
  it("ignores misleading Content-Length and hashes actual bytes", async () => {
    const f = fixture();
    for (const length of ["0", "9999999999999999999", "not-a-number"]) {
      const result = await collect(f, async (url, init) => url.endsWith("/artifacts/dist/app.bin") ? new Response(f.bytes, { headers: { "content-length": length } }) : f.transport(url, init));
      expect(result.status).toBe("observed"); expect(result.artifact?.sizeBytes).toBe(f.bytes.length);
    }
  });
  it("rejects truncated or mismatched artifact bytes without a successful artifact digest", async () => {
    const f = fixture();
    for (const bytes of [f.bytes.subarray(1), Buffer.alloc(f.bytes.length)]) {
      const result = await collect(f, async (url, init) => url.endsWith("/artifacts/dist/app.bin") ? new Response(bytes) : f.transport(url, init));
      expect(result.status).toBe("blocked"); expect(result.artifact).toBeUndefined();
      expect(["artifact_size_mismatch", "artifact_digest_mismatch"]).toContain(result.diagnostic);
    }
  });
  it.each([
    { suffix: "/jobs/42", limit: GITLAB_BUILD_OBSERVATION_LIMITS.metadataBytes },
    { suffix: "/artifacts/dist/app.bin", limit: GITLAB_BUILD_OBSERVATION_LIMITS.artifactBytes },
    { suffix: "/artifacts/provenance/app.dsse.json", limit: 96 * 1024 },
  ])("cancels streamed overflow at $suffix", async ({ suffix, limit }) => {
    const f = fixture(); const cancelled = vi.fn(); let sent = 0; const chunk = Buffer.alloc(64 * 1024);
    const body = new ReadableStream<Uint8Array>({ pull(controller) { if (sent <= limit) { controller.enqueue(chunk); sent += chunk.length; } }, cancel: cancelled });
    const result = await collect(f, async (url, init) => url.endsWith(suffix) ? new Response(body) : f.transport(url, init));
    expect(result.diagnostic).toBe("response_too_large"); expect(cancelled).toHaveBeenCalledTimes(1); expect(result.admission).toBe("blocked");
  });
  it.each(['{"id":42,"id":99}', '{"i\\u0064":42,"id":99}', "[".repeat(33) + "0" + "]".repeat(33), "{bad"])("rejects ambiguous/malformed vendor JSON without leaking it", async raw => {
    const f = fixture(); const result = await collect(f, async () => new Response(raw)); expect(result.diagnostic).toBe("receipt_invalid"); expect(result.job).toBeUndefined();
  });
  it.each(["42.000000000000000001", "42e0", "9007199254740990.9999999", "9007199254740993"])("rejects rounded or noncanonical job identity %s", async numeric => {
    const f = fixture(); const raw = JSON.stringify(f.job).replace('"id":42', `"id":${numeric}`);
    expect((await collect(f, async () => new Response(raw))).diagnostic).toBe("receipt_invalid");
  });
  it("checks pipeline/project numeric identity lexemes but allows ordinary vendor decimals", async () => {
    const f = fixture();
    for (const raw of [JSON.stringify(f.job.pipeline).replace('"id":7', '"id":7.00000000000000001'),
      JSON.stringify(f.job.pipeline).replace('"project_id":3', '"project_id":3e0')]) {
      expect((await collect(f, async (url, init) => url.endsWith("/pipelines/7") ? new Response(raw) : f.transport(url, init))).diagnostic).toBe("receipt_invalid");
    }
    expect((await collect(f, async (url, init) => url.endsWith("/jobs/42") ? Response.json({ ...f.job, duration: 0.465, coverage: 98.123 }) : f.transport(url, init))).status).toBe("observed");
  });
  it("projects away private vendor fields and never follows web/download URLs", async () => {
    const f = fixture(); const result = await collect(f, async (url, init) => url.endsWith("/jobs/42")
      ? Response.json({ ...f.job, token, user: { token }, download_url: "https://evil.example/steal" }) : f.transport(url, init));
    expect(result.status).toBe("observed"); expect(JSON.stringify(result)).not.toMatch(/fixture-credential|evil.example/);
  });
  it("ignores Response.url and refuses an already-redirected response", async () => {
    const f = fixture();
    const result = await collect(f, async (url, init) => {
      const response = await f.transport(url, init); Object.defineProperty(response, "url", { value: `https://evil.example/?token=${token}` }); return response;
    });
    expect(result.status).toBe("observed"); expect(f.calls.every(call => call.url.startsWith(`${origin}/api/v4/projects/3/`))).toBe(true);
    const cancelled = vi.fn(); const redirected = streamResponse([Buffer.from(token)], cancelled);
    Object.defineProperty(redirected, "redirected", { value: true });
    expect((await collect(f, async () => redirected)).diagnostic).toBe("redirect_refused"); expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it("requires a complete 200 body and valid UTF-8 metadata", async () => {
    const f = fixture();
    expect((await collect(f, async () => new Response(null))).diagnostic).toBe("body_missing");
    expect((await collect(f, async () => new Response(new Uint8Array([0xc0, 0xaf])))).diagnostic).toBe("receipt_invalid");
  });
  it("reports body errors using stable codes without echoing token-bearing exceptions", async () => {
    const f = fixture(); const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(Error(token)); } });
    const result = await collect(f, async () => new Response(body)); expect(result.diagnostic).toBe("body_failed"); expect(JSON.stringify(result)).not.toContain(token);
  });
});

describe("whole-observation deadline and cancellation", () => {
  it("returns on the total deadline even if an injected transport ignores AbortSignal", async () => {
    vi.useFakeTimers(); const f = fixture(); f.config.totalTimeoutMs = 100;
    const transport = vi.fn<GitlabBuildObservationTransport>(() => new Promise(() => undefined));
    const pending = collect(f, transport); await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ status: "blocked", diagnostic: "deadline_exceeded" }); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("shares one deadline across requests, not a fresh timeout per request", async () => {
    vi.useFakeTimers(); const f = fixture(); f.config.totalTimeoutMs = 100;
    const transport: GitlabBuildObservationTransport = (url, init) => new Promise(resolve => setTimeout(() => { void f.transport(url, init).then(resolve); }, 60));
    const pending = collect(f, transport); await vi.advanceTimersByTimeAsync(100);
    expect((await pending).diagnostic).toBe("deadline_exceeded"); await vi.advanceTimersByTimeAsync(100);
    expect(f.calls).toHaveLength(2);
  });
  it("cancels stalled response bodies and releases late responses", async () => {
    vi.useFakeTimers(); const f = fixture(); f.config.totalTimeoutMs = 100; const cancelled = vi.fn();
    const stalled = new Response(new ReadableStream<Uint8Array>({ pull() {}, cancel: cancelled }));
    const pending = collect(f, async () => stalled); await vi.advanceTimersByTimeAsync(100);
    expect((await pending).diagnostic).toBe("deadline_exceeded"); expect(cancelled).toHaveBeenCalledTimes(1);
    const lateCancelled = vi.fn();
    const late = collect(f, () => new Promise(resolve => setTimeout(() => resolve(streamResponse([f.bytes], lateCancelled)), 150)));
    await vi.advanceTimersByTimeAsync(100); expect((await late).diagnostic).toBe("deadline_exceeded");
    await vi.advanceTimersByTimeAsync(50); expect(lateCancelled).toHaveBeenCalledTimes(1);
  });
  it("honors cancellation before I/O and while streaming, without exposing abort reasons", async () => {
    const f = fixture(); const abort = new AbortController(); abort.abort(token);
    expect((await collect(f, f.transport, abort.signal)).diagnostic).toBe("cancelled"); expect(f.calls).toHaveLength(0);
    const active = new AbortController(); const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull() { active.abort(token); }, cancel: cancelled });
    const result = await collect(f, async () => new Response(body), active.signal);
    expect(result.diagnostic).toBe("cancelled"); expect(JSON.stringify(result)).not.toContain(token); expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
