# Langfuse feedback reader (P3)

This is **provider_fetch**, not manual import or live-provider acceptance proof.
Explicit administrator reads put bounded observations into the private feedback
inbox. All evidence stays quarantined. Human promotion gates remain unchanged.
No model call, Agent dispatch, customer reply or upstream mutation exists.

## Provider research (2026-10-26)

- [Official public API](https://langfuse.com/docs/api-and-data-platform/features/public-api):
  Basic auth uses public key as username, secret key as password. Use project
  credentials with trace-read access. This reader only issues GET.
- [Observations v2](https://langfuse.com/docs/api-and-data-platform/features/observations-api):
  `/api/public/v2/observations`, newest first, opaque `meta.cursor`, inclusive
  fromStartTime, exclusive toStartTime; provider max 1000, reader limit 50.
  Requests only `core,basic,trace_context`. No `io` or metadata requested;
  unsolicited fields, user/session identity and raw logs are not persisted.
- Current docs list self-hosted v4+ support. v3 is unsupported. 404/405/410 yields
  `unsupported`; unknown response schemas fail closed, with no legacy fallback.
  Capability detection is not proof of an installed version. Legacy Cloud trace
  endpoints sunset 2026-11-16. Older SDK/exporter data may be delayed 15 minutes;
  exhausted cursor does not prove eventual completeness. Explicit replay finds
  late arrivals. 429 surfaces numeric Retry-After, without automatic retries.

## Runtime boundaries

Immutable config: public HTTPS origin (no path, query, fragment or credentials),
project ID, operator product, explicit ≤24h window, `api: observations_v2`, two
active company secret references with pinned numeric versions. Runtime secret
resolution rechecks company, scope, version and revocation. Create a new job for
credential rotation; plaintext keys never enter this API or its UI.

Existing DNS-pinned transport rejects private/reserved networks and redirects.
Responses ≤1MiB, fetch/body deadline 20s. One page per request; database NOWAIT
row lock serializes pulls. Inbox inserts and cursor advancement are atomic.
Disconnect cancellation rolls back unfinished pages. A lost response after commit
has unknown client outcome: refresh status before continuing. Restart waits for
any active transaction. No background scheduler exists. A 1000-page cap fails
visibly: split the window rather than treating truncation as completion.

Dedup uses company + source kind + hashed origin/project + exact
length-prefixed `traceLength:traceId:observationId`. First sanitized snapshot wins, including after restart;
upstream edits do not overwrite reviewed evidence. Exact trace links are stored.
Immutable job retains origin/project source identity. Missing software version or
full 40-character hexadecimal release/commit remains unknown. This does not
reconstruct complete traces, ingest scores or perform semantic clustering.
Text uses existing redaction plus explicit current credential-value removal.
Pattern redaction is not perfect anonymization; text remains sensitive evidence.
Provider response/error bodies and credential values are not logged.

## Integration manifest (parent-owned central files)

1. Export DB schema `mimouse_langfuse.ts`; generate migration from merged schema.
2. Add nullable inbox `source_url`; drop/recreate `mimouse_feedback_shape`, changing
   only `ingestion_mode='manual_import'` to
   `ingestion_mode IN ('manual_import','provider_fetch')`, preserving all other
   status/redaction/source-kind/title/body clauses and the manual default.
3. Mount `mimouseLangfuseRoutes(db)` behind normal auth. Admin API prefix:
   `/api/companies/:companyId/feedback-langfuse/pulls`: GET list (latest 50), POST
   create config, POST `/:id/pull` `{}` one page, POST `/:id/restart` `{confirm:true}`.
   Responses omit cursor and secret references. Audit records contain no payload.
4. Mount `<MimouseLangfusePanel companyId={companyId} onImported={...}/>` in
   FeedbackCompany; key parent by company + user. Invalidate existing inbox query
   on imported callback. Reconcile four `langfuseUi` contribution files through
   the normal locale generator. Update existing manual-only boundary/detail copy:
   manual-import source labels are not proof of a connected provider.
5. Fetched detail should show sourceUrl, provider_fetch and quarantine; never label
   legacy manual Langfuse exports as fetched. No central exports/journal edited.

## Evidence and missing acceptance inputs

Fake-transport unit tests cover GET/auth/fields, redaction, exact identities,
pagination, project/time boundaries, cancellation, malformed/oversized payloads,
cycles, unsupported routes and rate limits, with no real network requests.
UI tests cover explicit page/replay controls, cancellation and company isolation.
No real-provider/customer-data tests or database execution were authorized here.
Parent runs integrated migration/type/build/browser checks; focused units are not
full acceptance. C3/C4 still need authorized origin/version, project, company-vault
read credentials, approved sanitized samples with product/version/commit mapping,
and permission/environment for live evidence. These inputs are missing, not
simulated. WeCom inbound and semantic clustering are separate work.

Local checks passed: 20 protocol + 12 legacy feedback tests; 3 direct-router
company/role denial tests (no listening server); 8 UI tests; token gates and
`git diff --check`. Database atomicity/dedup/migration behavior is implemented but
not DB-executed in this constrained branch. Parent integration verification remains
required, including typecheck/build and real mounted-browser flow.
