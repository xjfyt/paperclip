# Build provenance verification foundation — 2026-10-27

## Scope and status

This is an **unwired library/contract slice**, not a trusted build collector or
release gate. The existing six-target inventory is unchanged and remains blocked.
No database, route, GitLab client, signer, CI workflow, runner registration,
upload, credential, or runtime feature is added. Omitting operator policy (or
passing the explicit disabled configuration) disables verification. Importing or
calling this library performs no network, filesystem, database, or clock I/O.

The format is [in-toto Statement v1](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md)
with [SLSA provenance v1](https://slsa.dev/spec/v1.2/build-provenance), transported
in [DSSE](https://github.com/secure-systems-lab/dsse/blob/master/protocol.md).
Signatures cover standard byte-length PAE and the **original payload bytes**;
there is no custom JWS, JSON signing canonicalization, or custom cryptography.
The initial keyed scheme uses Node's
[Ed25519 verification](https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback)
with an explicitly configured public SPKI key and a null algorithm argument.

## Trust and context contract

`verifyMimouseBuildProvenance(input, operatorPolicy)` takes envelope bytes,
authenticated application context and an explicit verification time. The
operator policy must come from a trusted server configuration path, **never an
API request or the envelope**. It pins company, policy revision, source URI,
builder ID, build type, every external parameter (including the build-type's
workflow path and immutable ref), keys and temporal limits. There is no key
discovery or fetching of any URI. The envelope key ID is only a lookup hint;
acceptance requires the selected key to verify the signature. Duplicate key IDs
or duplicate SPKI material under different IDs are rejected, preventing alias
selection from changing revocation/validity semantics for the same key.
The caller must provide the **current trusted server clock** and **current
operator policy**, not a client-selected time or historical policy snapshot.
The pure library cannot detect a caller intentionally replaying old inputs.

The separate application context supplies company/operation identity, the
expected source commit, artifact name/SHA-256, build-not-before boundary, and
**the existing CI build invocation identity**. Invocation identity is not a new
verification request ID. External builders do not need to embed Paperclip
company/delivery/request IDs in the standard payload. A future caller must
resolve context from authorized operations and exact controller observations;
echoing client-provided expectations does not establish trust. Context is
returned as an application binding, not as something the CI signer attested.
Rebinding the same CI invocation to a different operation ID can therefore
still verify; the future route must independently authorize that exact
operation-to-invocation relationship. This is not cross-operation replay proof.

Successful results mean only `verified_claim`: a real provenance signature and
matching policy/context. Exact external-parameter equality is a policy-bound
claim, **not independently verified workflow closure**. Artifact bytes, artifact
code signatures, platform, tests and workflow closure remain `unassessed`;
controller collection and C3 remain `blocked`. This result must never populate
the existing `signatureVerified` field or make a matrix target/release green.
GitLab job success, JUnit, manual trust/platform booleans and JWS cannot qualify.

Results contain binding metadata, necessary identities/times and digests, not
raw external parameters, envelope payloads, PEM keys or exception messages.
Policy and public-key SHA-256 fingerprints identify the exact evaluated policy
and SPKI. Rejections use stable diagnostic codes and distinguish a signature
that was not checked, invalid, or cryptographically valid but rejected by policy.

## Restrictive acceptance profile

`dsse-slsa-v1-ed25519-single-subject-v1` is intentionally narrower than a general
standards consumer. DSSE/SLSA normally permit unknown fields; this acceptance
profile rejects them and requires otherwise optional fields. Unsupported
standard documents are rejected, not silently claimed to be malformed DSSE.
Future profiles need explicit review; there is no unknown-version fallback.

- One keyed Ed25519 signature, one named SHA-256 subject and one source resource
  (`uri` plus 40/64-character lowercase `gitCommit`). Multiple subjects,
  dependencies, signatures, alternate algorithms/digests, optional extensions,
  absent key IDs and undeclared fields are unsupported by this first profile.
- Full external-parameter object equality, independent of property order. The
  operator must pin workflow and all inputs according to the selected build
  type's documented semantics. This is not a GitLab build-type implementation.
- Maximum envelope 96 KiB, payload 64 KiB, expected parameters 16 KiB, JSON depth
  16 and 2,048 JSON values. UTF-8 must be valid; BOM, duplicate/escaped-duplicate
  keys, dangerous prototype keys and unpaired surrogates are rejected. Numeric
  tokens are restricted to safe decimal integers (no fractions/exponents/-0).
- Both standard and URL-safe base64 are accepted, padded or unpadded; mixed
  alphabets, whitespace, incorrect padding and nonzero unused bits are rejected.
- Timestamps use valid UTC seconds or exactly three fractional digits. Builds
  must start no earlier than the operation boundary, be ordered, stay within the
  configured age since **start**, and finish within the allowed future skew.
  Key validity must cover the build and current verification time; revocation
  at/before verification time rejects the key. No signature issuance timestamp
  or transparency-log proof is inferred from signed build timestamps.

Reverification does not rejuvenate old evidence: signed start/finish times stay
unchanged and are separate from `verifiedAt`. Invocation/context/freshness
checks prevent mismatched or stale reuse. There is **no durable replay store**;
rechecking the same valid build is intentionally possible. Later persisted
history must retain those original times, policy revision, context and digests,
and define replay/revocation semantics before serving as release evidence.

## Remaining boundary

[SLSA build requirements](https://slsa.dev/spec/v1.2/build-requirements) distinguish
signature authenticity from trusted control-plane generation and isolation.
An arbitrary tenant job holding a signing key is not automatically a trusted
builder. Operator key provisioning/rotation, real control-plane provenance
generation, exact GitLab job/artifact retrieval, immutable workflow closure,
artifact-byte reconciliation, platform/test/code-signature verification,
durable history and real six-target C3 evidence are still absent. No callback
stub is presented as a complete collector, and no SLSA level is claimed.

## Verification

Focused tests use ephemeral in-memory Node-generated Ed25519 keys and actual
signatures, the official DSSE PAE vector, an independent fixture framing helper,
valid base64 variants, byte tampering, policy/context mismatches, expiry and
revocation, stale/replayed contexts and bounded hostile parsing. They do not
register keys, contact CI or rely on seeded trusted booleans. Execution and
typecheck results are recorded in the implementation handoff; C3 is not implied.
The focused provenance/matrix/GitLab run passed 71 tests. Isolated strict
`noEmit` checking of the new shared, server and typed test sources passed.
Full server/workspace typecheck/build and real CI/controller checks were not run.
