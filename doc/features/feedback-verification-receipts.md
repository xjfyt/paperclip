# Human-attested feedback verification

This bounded P3 path connects an existing feedback import, its human-confirmed
private task, and two existing coding-delivery checks. It does **not** execute a
reproduction, invoke an agent/model, read a log path, fetch a trace, modify a
repository, change task status, or authorize publication. It does not replace
feedback-to-fixed-evaluation-dataset provenance.

## Evidence contract

A signed-in, currently active company owner/admin with access to the promoted
private task chooses a failed reproduction check and a passed regression check.
Both checks are loaded from company/task-scoped coding deliveries; the client
sends only delivery UUIDs and zero-based check indexes. Requirements are:

- Full 40-character source and delivery commit SHAs. The failed check's delivery
  head matches the feedback source commit; the fixed delivery's recorded base
  matches that head and its new head differs.
- Same task, GitLab origin/project and workspace; exact command-string digest
  equality. This does not prove ancestry in a live repository or equivalent
  environments; those are recorded references, not new repository observations.
- Failed/nonzero and passed/zero receipts, bounded nonempty command/log reference,
  valid ordered start/finish timestamps, no future finish, reproduction finishing
  before regression starts. Blocked/not-run/inconsistent checks are rejected.
- Explicit human confirmation that the old check reproduces this feedback, the
  later check verifies its regression, and the environments were compared.

Existing coding checks are **operator-supplied**. Their status, exit code and
interval remain human assertions even when their structure is valid. Preview
returns `awaiting_human_attestation`; only a persisted confirmation returns
`human_attested`. `machineVerification=reference_integrity_only` and
`environment=not_machine_verified` are always retained. No content or result
supplied through the verification request can create a passed check.

Snapshots freeze source identity/version/trace/commit references, source and
sanitized-content digests, promotion digest, both exact check digests and
recorded intervals, command/log-reference digests, repository identity hashes,
actor, timestamp and contract version. They contain no feedback body/title,
reproduction prose, command text, log path/URL/body or repository URL. Original
coding receipts remain the place for authorized human inspection. Imported
source references remain quarantined and are not independently verified.

## API and concurrency

Under `/api/companies/:companyId/feedback-inbox/:id`:

- `GET /verification-options`: safe checks from the newest 50 deliveries, at most
  100 checks each; `hasMore` explicitly reports truncation.
- `POST /verification-preview`: `{reproduction:{deliveryId,checkIndex},regression:{deliveryId,checkIndex}}`.
- `POST /verifications`: same selection plus a UUID `requestId`, exact
  `previewDigest`, and literal `true` values for `confirmReproduction`,
  `confirmFix`, and `confirmComparableEnvironment`.
- `GET /verifications`: newest 20 historical attestations with `hasMore`.

All responses are `no-store`; all routes require a human session. Service checks
current company/member authority and canonical private-task ACL. Confirmation
acquires a company/request advisory transaction lock **before** loading authority.
Company/member/source/promotion/task/delivery rows stay share-locked through
confirmation. The preview digest binds the actor and exact server snapshots;
replaced source text, metadata, promotion or selected check requires a new preview.
Task ACL is rechecked immediately before insertion and on replay, including grant
changes that do not update the locked task. This is not a new globally atomic
revocation protocol for all ancestor/project/grant writers.

Same request/actor/payload replays one receipt; different content or actor
conflicts. Replay still requires current access, but returns historical evidence
rather than claiming that mutable coding checks remain current. New request IDs
can append later corrections/reviews; no company/feedback uniqueness prevents
that. Immutable rows are never silently replaced. Three-column foreign keys bind
both deliveries and the feedback promotion to the same company and task. A
content-free private-task activity event commits with a new attestation.

## User interface and verification scope

The existing promoted feedback view includes selectors (without revealing the
private task identifier to another reviewer),
a fixed-reference preview, three independent human acknowledgments, cancel,
same-request retry, and historical receipts. Selecting other evidence clears the
preview; repeated confirmation clicks are guarded. Reads do not write. Session,
company and feedback changes remount state; failed access refresh hides prior
private receipts. The UI never labels an attestation as current success or a
machine-executed test.

Focused service/route/UI tests cover malformed or client-injected results,
company/private-task boundaries, changed source/check/reviewer, revoked access,
request conflict/replay, simulated concurrent idempotency, historical correction,
no sensitive text in projections, same-request retry and stale UI/session state.
PostgreSQL migration/constraint concurrency, full typecheck/build and live
reproduction remain separate integration checks; mocked advisory-lock tests are
not a substitute for real database concurrency validation.
