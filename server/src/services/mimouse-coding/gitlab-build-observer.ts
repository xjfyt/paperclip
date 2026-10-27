import { createHash } from "node:crypto";
import { z } from "zod";
import { MIMOUSE_PROVENANCE_LIMITS, mimouseBuildVerificationDisabledSchema } from "@paperclipai/shared";
import { guardedRemoteHttpFetch } from "../remote-http-fetch.js";
import { gitlabOrigin } from "./gitlab.js";
import { verifyMimouseBuildProvenance } from "./build-provenance.js";
import {
  GITLAB_BUILD_OBSERVATION_LIMITS as limits, gitlabBuildObservationConfigSchema, gitlabBuildObservationContextSchema,
  type GitlabBuildObservationResult, type GitlabBuildObservationTransport, type GitlabJobObservation,
  type GitlabObservationCode, type GitlabObservationStatus,
} from "./gitlab-build-observation-contract.js";

class ObservationError extends Error { constructor(readonly code: GitlabObservationCode) { super(code); } }
function fail(code: GitlabObservationCode): never { throw new ObservationError(code); }
function hash(value: string | Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const timestamp = z.string().max(40).datetime({ offset: true });
// Vendor extras are projected away, not interpreted as trusted facts.
const pipelineSchema = z.object({ id, project_id: id, sha, status: z.string().min(1).max(32) });
const jobSchema = z.object({
  id, pipeline: pipelineSchema, commit: z.object({ id: sha }), status: z.string().min(1).max(32),
  erased_at: timestamp.nullable().optional(), artifacts_expire_at: timestamp.nullable().optional(),
  started_at: timestamp.nullable().optional(), finished_at: timestamp.nullable().optional(), web_url: z.string().max(2000).optional(),
});
type Job = z.infer<typeof jobSchema>;
function status(value: string): GitlabObservationStatus {
  switch (value) { case "success": case "failed": case "canceled": case "running": case "pending": return value; default: return "other"; }
}
function jobObservation(job: Job): GitlabJobObservation {
  return { jobId: job.id, pipelineId: job.pipeline.id, projectId: job.pipeline.project_id, commitSha: job.commit.id,
    status: status(job.status), erasure: job.erased_at === undefined ? "unknown" : job.erased_at === null ? "not_erased" : "erased",
    artifactExpiry: job.artifacts_expire_at === undefined ? "unknown" : job.artifacts_expire_at === null ? "not_scheduled" : "reported",
    artifactsExpireAt: job.artifacts_expire_at ?? null };
}
function initialResult(): GitlabBuildObservationResult {
  return { status: "blocked", diagnostic: "config_invalid", admission: "blocked", jobRechecked: false, pipelineRechecked: false,
    provenance: { status: "not_checked", reason: "not_collected" },
    blockers: ["controller_provenance_unavailable", "workflow_closure_unassessed", "platform_unassessed", "tests_unassessed", "code_signature_unassessed"],
    otherFacts: { workflowClosure: "unassessed", platform: "unassessed", tests: "unassessed", artifactCodeSignature: "unassessed", controllerObservation: "blocked", c3: "blocked" } };
}
function cancelBody(response: Response) { void response.body?.cancel().catch(() => undefined); }
const productionTransport: GitlabBuildObservationTransport = (url, init) => guardedRemoteHttpFetch(url, init, {
  allowPrivateNetwork: false,
  error: (_message, code) => new ObservationError(code === "remote_http_private_endpoint" ? "private_endpoint" : "transport_failed"),
});

/** Vendor JSON is bounded before parsing; detect duplicate/escaped duplicate
 * keys and excessive nesting without recursing into ignored vendor content. */
function metadataJson(bytes: Uint8Array): unknown {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const stack: Array<{ keys: Set<string> | null; expectingKey: boolean; key: string | null }> = [];
    let keys = 0;
    for (let i = 0; i < text.length; i++) {
      const token = text[i];
      if (token === '"') {
        const start = i++;
        for (; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
        const frame = stack[stack.length - 1];
        if (frame?.keys && frame.expectingKey) {
          const key: unknown = JSON.parse(text.slice(start, i + 1));
          if (typeof key !== "string" || frame.keys.has(key) || ["__proto__", "constructor", "prototype"].includes(key) || ++keys > 4096) fail("receipt_invalid");
          frame.keys.add(key); frame.expectingKey = false; frame.key = key;
        }
      } else if (token === "{" || token === "[") {
        stack.push({ keys: token === "{" ? new Set<string>() : null, expectingKey: token === "{", key: null });
        if (stack.length > 32) fail("receipt_invalid");
      } else if (token === "}" || token === "]") stack.pop();
      else if (token === "," && stack.length) stack[stack.length - 1].expectingKey = true;
      else if (token === ":" && ["id", "project_id"].includes(stack[stack.length - 1]?.key ?? "")) {
        const numeric = /^\s*(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i + 1));
        // JSON.parse would otherwise round e.g. 42.000000000000000001 to 42.
        // String commit IDs remain strings; unrelated vendor decimals are OK.
        if (numeric && (!/^[1-9]\d*$/.test(numeric[1]) || !Number.isSafeInteger(Number(numeric[1])))) fail("receipt_invalid");
      }
    }
    const value: unknown = JSON.parse(text); return value;
  } catch { return fail("receipt_invalid"); }
}

/** Read-only, default-off and unwired. All config, context, current secret and
 * provenance policy must be resolved by an authorized server caller. Test
 * dependencies must never be exposed as API input. No archive extraction or
 * execution; the existing guarded transport may decode HTTP content encoding. */
export async function observeMimouseGitlabBuild(input: {
  context: unknown; token: string; provenancePolicy?: unknown; signal?: AbortSignal;
}, operatorConfig?: unknown, deps: { transport?: GitlabBuildObservationTransport; now?: () => Date; beforeDispatch?: () => Promise<void> } = {}): Promise<GitlabBuildObservationResult> {
  const result = initialResult();
  if (operatorConfig === undefined || mimouseBuildVerificationDisabledSchema.safeParse(operatorConfig).success) {
    return { ...result, status: "disabled", diagnostic: "disabled" };
  }
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  let expired = false;
  try {
    const parsedConfig = gitlabBuildObservationConfigSchema.safeParse(operatorConfig);
    if (!parsedConfig.success) fail("config_invalid");
    const config = parsedConfig.data;
    const parsedContext = gitlabBuildObservationContextSchema.safeParse(input.context);
    if (!parsedContext.success) fail("context_invalid");
    const context = parsedContext.data;
    if (context.companyId !== config.companyId || context.projectId !== config.projectId || context.source.uri !== config.sourceUri) fail("context_mismatch");
    let origin: string;
    try { origin = gitlabOrigin(config.origin, config.allowedOrigins); if (!origin.startsWith("https://")) fail("origin_not_allowed"); }
    catch { return fail("origin_not_allowed"); }
    let expectedJobUrl: string;
    try {
      const repo = new URL(config.sourceUri.replace(/^git\+/, ""));
      if (repo.origin !== origin || repo.username || repo.password || repo.search || repo.hash || !/^\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(repo.pathname)) fail("source_mapping_invalid");
      expectedJobUrl = `${origin}${repo.pathname.replace(/\.git$/, "")}/-/jobs/${context.jobId}`;
    } catch { return fail("source_mapping_invalid"); }
    const token = input.token;
    if (typeof token !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(token)) fail("credential_invalid");
    const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
    const deadlineAt = performance.now() + config.totalTimeoutMs;
    function abortCode(): GitlabObservationCode { return expired ? "deadline_exceeded" : "cancelled"; }
    function checkAbort() {
      if (performance.now() >= deadlineAt) { expired = true; controller.abort(); }
      if (signal.aborted) fail(abortCode());
    }
    // One deadline for metadata, both downloads, rechecks and verification.
    deadline = setTimeout(() => { expired = true; controller.abort(); }, config.totalTimeoutMs);
    function bounded<T>(promise: Promise<T>): Promise<T> {
      return new Promise((resolve, reject) => {
        const aborted = () => { signal.removeEventListener("abort", aborted); reject(new ObservationError(abortCode())); };
        signal.addEventListener("abort", aborted, { once: true });
        promise.then(value => { signal.removeEventListener("abort", aborted); resolve(value); }, error => { signal.removeEventListener("abort", aborted); reject(error); });
        if (signal.aborted) aborted();
      });
    }
    const transport = deps.transport ?? productionTransport;
    async function read(path: string, maxBytes: number, retain: boolean) {
      checkAbort();
      let response: Response;
      try {
        if (deps.beforeDispatch) await bounded(deps.beforeDispatch());
        checkAbort();
        const pending = transport(`${origin}/api/v4/projects/${config.projectId}${path}`, { method: "GET", redirect: "manual", signal,
          headers: { "PRIVATE-TOKEN": token, "Accept-Encoding": "identity" } }).then(value => {
          if (signal.aborted) { cancelBody(value); fail(abortCode()); } return value;
        });
        response = await bounded(pending);
      } catch (error) { if (error instanceof ObservationError) throw error; checkAbort(); return fail("transport_failed"); }
      if (response.redirected || (response.status >= 300 && response.status < 400)) { cancelBody(response); fail("redirect_refused"); }
      if (response.status !== 200) { cancelBody(response); fail("http_status_rejected"); }
      if (!response.body) fail("body_missing");
      const reader = response.body.getReader(); const chunks: Buffer[] = []; const digest = createHash("sha256");
      let bytes = 0; let complete = false;
      const cancel = () => { void reader.cancel().catch(() => undefined); };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        for (;;) {
          checkAbort(); const chunk = await bounded(reader.read()); checkAbort();
          if (chunk.done) { complete = true; break; }
          bytes += chunk.value.byteLength;
          if (bytes > maxBytes) fail("response_too_large");
          digest.update(chunk.value); if (retain) chunks.push(Buffer.from(chunk.value));
        }
        return { sha256: digest.digest("hex"), sizeBytes: bytes, data: retain ? Buffer.concat(chunks) : Buffer.alloc(0) };
      } catch (error) { if (error instanceof ObservationError) throw error; checkAbort(); return fail("body_failed"); }
      finally { signal.removeEventListener("abort", cancel); if (!complete) cancel(); try { reader.releaseLock(); } catch { /* An aborted reader may still settle. */ } }
    }
    async function job() {
      const row = jobSchema.safeParse(metadataJson((await read(`/jobs/${context.jobId}`, limits.metadataBytes, true)).data));
      if (!row.success) fail("receipt_invalid");
      const value = row.data;
      if (value.id !== context.jobId || value.pipeline.id !== context.pipelineId || value.pipeline.project_id !== config.projectId
        || value.pipeline.sha !== context.source.digest.gitCommit || value.commit.id !== context.source.digest.gitCommit) fail("identity_mismatch");
      return value;
    }
    async function pipeline() {
      const row = pipelineSchema.safeParse(metadataJson((await read(`/pipelines/${context.pipelineId}`, limits.metadataBytes, true)).data));
      if (!row.success) fail("receipt_invalid");
      if (row.data.id !== context.pipelineId || row.data.project_id !== config.projectId || row.data.sha !== context.source.digest.gitCommit) fail("identity_mismatch");
      return row.data;
    }
    result.binding = { companyId: context.companyId, operationId: context.operationId, projectId: context.projectId,
      pipelineId: context.pipelineId, jobId: context.jobId, sourceSha: context.source.digest.gitCommit,
      originSha256: hash(origin), sourceUriSha256: hash(context.source.uri) };
    const before = await job(); result.job = jobObservation(before);
    const beforePipeline = await pipeline(); result.pipelineStatus = status(beforePipeline.status);
    if (before.status !== "success") fail("job_not_successful");
    if (beforePipeline.status !== "success" || before.pipeline.status !== "success") fail("pipeline_not_successful");
    if (before.erased_at != null) fail("job_erased");
    if (before.erased_at === undefined) result.blockers.push("erasure_unknown");
    if (before.artifacts_expire_at === undefined) result.blockers.push("artifact_expiry_unknown");
    const artifactEndpoint = (path: string) => `/jobs/${context.jobId}/artifacts/${path.split("/").map(encodeURIComponent).join("/")}`;
    const artifact = await read(artifactEndpoint(config.artifactPath), limits.artifactBytes, false);
    if (artifact.sizeBytes !== context.expectedSizeBytes) fail("artifact_size_mismatch");
    if (artifact.sha256 !== context.subject.digest.sha256) fail("artifact_digest_mismatch");
    result.artifact = { sha256: artifact.sha256, sizeBytes: artifact.sizeBytes, pathSha256: hash(config.artifactPath), basis: "exact_job_bytes" };
    const envelope = await read(artifactEndpoint(config.provenancePath), MIMOUSE_PROVENANCE_LIMITS.envelopeBytes, true);
    result.envelopeSha256 = envelope.sha256;
    const after = await job();
    if (after.erased_at != null) fail("job_erased");
    if (JSON.stringify(after) !== JSON.stringify(before)) fail("job_changed");
    result.jobRechecked = true;
    if (JSON.stringify(await pipeline()) !== JSON.stringify(beforePipeline)) fail("pipeline_changed");
    result.pipelineRechecked = true;
    checkAbort();
    const observedAt = (deps.now ?? (() => new Date()))().toISOString(); result.observedAt = observedAt;
    if (config.invocationMapping === null) {
      result.provenance = { status: "not_checked", reason: "invocation_mapping_unconfigured" }; result.blockers.push("invocation_mapping_unconfigured");
    } else if (before.web_url !== expectedJobUrl) {
      result.provenance = { status: "not_checked", reason: "invocation_unavailable" }; result.blockers.push("invocation_unavailable");
    } else {
      const verified = verifyMimouseBuildProvenance({ envelope: envelope.data, verifiedAt: observedAt, context: {
        companyId: context.companyId, operationId: context.operationId, invocationId: before.web_url,
        source: context.source, subject: context.subject, buildNotBefore: context.buildNotBefore,
      } }, input.provenancePolicy);
      result.provenance = verified.status === "verified_claim" ? {
        status: verified.status, cryptographicSignature: verified.cryptographicSignature, payloadSha256: verified.payloadSha256,
        policySha256: verified.policySha256, verifiedAt: verified.verifiedAt, startedOn: verified.startedOn, finishedOn: verified.finishedOn,
      } : { status: verified.status, diagnostic: verified.diagnostic, cryptographicSignature: verified.cryptographicSignature };
      if (verified.status !== "verified_claim") result.blockers.push("provenance_not_verified");
    }
    checkAbort(); return { ...result, status: "observed", diagnostic: "observation_complete" };
  } catch (error) {
    return { ...result, status: "blocked", diagnostic: error instanceof ObservationError ? error.code : "receipt_invalid" };
  } finally { if (deadline) clearTimeout(deadline); controller.abort(); }
}
