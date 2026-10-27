# Exact-job artifact observer — 2026-10-27

This second, separate slice is a default-off **read-only observer**, not a trusted
controller collector or release gate. It adds no routes, persistence, defaults,
credentials, signers, CI mutations, upload protocol or matrix changes. Only an
authorized server caller may supply its company/delivery snapshot, exact project,
pipeline/job IDs, expected source/subject/size, current secret and current
provenance trust policy. No production callsite is wired.

## Read contract

The observer uses the documented [exact job endpoint](https://docs.gitlab.com/api/jobs/#retrieve-a-job-by-job-id),
[exact pipeline endpoint](https://docs.gitlab.com/api/pipelines/#retrieve-a-single-pipeline)
and [single-file artifact endpoint](https://docs.gitlab.com/api/job_artifacts/#download-a-single-artifact-file-by-job-id).
It reads job, pipeline, the two operator-pinned artifact paths, then job and
pipeline again: six GETs, no pagination or latest-success/name fallback. Every
job/project/pipeline/source ID must match; cross-project and synthetic-commit
mapping are unsupported. The operator's source URI/project association must
already have been authorized; this library does not establish that enrollment.
Numeric identity tokens must be positive safe decimal integers before JSON
conversion, so fractional rounding cannot turn another representation into the
expected ID. Unrelated vendor values such as fractional duration remain allowed.

Requests use the existing DNS-pinned `guardedRemoteHttpFetch`, exact origin
allowlisting, HTTPS, no private networking, no redirects and no response/download
URLs. GitLab CDN redirects are explicitly unsupported; credentials are never
forwarded to them. Tests inject transport rather than contact GitLab. Artifact
paths reject traversal/encoding ambiguities. Success status is only a download
prerequisite, never platform/test proof. Missing `erased_at`/expiry fields remain
unknown and add blockers, but do not suppress otherwise useful byte observations.
An old reported expiry is not proof of removal: GitLab may retain artifacts.

All six requests, body reads and verification share a hard maximum 30-second
deadline and caller cancellation. Bodies are cancelled on failure/overflow;
late transport responses are also cancelled. Metadata is bounded at 2 MiB,
artifact bytes at 64 MiB and DSSE envelope at 96 KiB. Actual streamed bytes are
counted and hashed; Content-Length is not evidence. Full artifact bodies are
never buffered, saved, unpacked or executed. `Accept-Encoding: identity` is sent;
the existing transport may transparently decode **HTTP content encoding**. Hashes
and limits apply to the actual returned representation bytes, not archive
extraction. No custom decompression path is added.

## Provenance and remaining boundaries

The only optional invocation mapping is explicit operator confirmation that the
selected builder uses the observed GitLab job `web_url` as SLSA invocation ID.
That URL must match the configured source repository's exact job path. This is
not an invented controller protocol and is never inferred from the envelope.
Without mapping, observations remain available but provenance is not checked.
With mapping, the existing standard DSSE/SLSA verifier compares the downloaded
artifact's manifest-pinned digest and the independently resolved context.
Signed build timestamps are still claims; this slice does not establish trusted
equality between those timestamps and GitLab's reported job execution times.

Results expose only IDs, status categories, times, hashes, sizes, stable codes
and a minimized provenance result—not tokens, raw vendor bodies, envelope
contents, key material or arbitrary error strings. Even successful observation
returns `admission: blocked`. Exact bytes, provenance signature, effective
workflow closure, actual platform/tests, artifact code signature and trusted
control-plane collection are separate facts. The last five remain unassessed
or blocked; a signed tenant report does not become trusted controller evidence.
Rechecks are bounded snapshots, not durable history or atomic proof against
changes after the last GET. Current authorization, policy and source must be
rechecked by a future integrating caller. No real GitLab/C3 qualification is
claimed, and the existing six-target inventory remains unchanged.

## Local verification

The final focused run passed 128 tests across observer, provenance, existing
matrix and GitLab files (57 observer cases). Isolated strict `noEmit` checking
of the new contract, observer and fully typed fixtures passed. Independent
read-only review identified identity-number rounding ambiguity; the scanner
fix and regression tests are included. All HTTP responses are injected fixtures
and signing keys are ephemeral in-memory tests. No full server/workspace
typecheck/build or real GitLab/controller/C3 checks were run.
